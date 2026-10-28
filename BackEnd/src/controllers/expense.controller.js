const transactions = require('../services/groupTransactions');
const management = require('../services/groupManagement');
const Expense = require('../models/expense.model');
const Group = require('../models/group.model');
const User = require('../models/user.model');
const { amountToPaise, calculateGroupSummary } = require('../utils/expenseCalculations');

const validId = value => typeof value === 'string' && /^[a-fA-F0-9]{24}$/.test(value);
const normalizedId = value => String(value).toLowerCase();


// ADD EXPENSE
exports.addExpense = async (req, res) => {

    try {

        const {
            title,
            amount,
            paidBy,
            groupId,
            splitBetween
        } = req.body || {};

        if (!validId(groupId)) return res.status(400).json({ message: 'Invalid group ID' });
        if (typeof title !== 'string' || !title.trim()) {
            return res.status(400).json({ message: 'Expense title is required' });
        }
        let amountPaise;
        try {
            amountPaise = amountToPaise(amount);
            // The existing schema stores Number rupees: reject values it cannot preserve.
            if (amountToPaise(Number(amount)) !== amountPaise) throw new Error('Amount loses precision');
        } catch (error) {
            return res.status(400).json({ message: error.message });
        }
        if (!validId(paidBy) || normalizedId(paidBy) !== normalizedId(req.user.id)) {
            return res.status(400).json({ message: 'paidBy must be the authenticated user ID' });
        }
        if (!Array.isArray(splitBetween) || !splitBetween.length || !splitBetween.every(validId)) {
            return res.status(400).json({ message: 'splitBetween must contain valid member IDs' });
        }
        const participantIds = splitBetween.map(normalizedId);
        if (new Set(participantIds).size !== participantIds.length) {
            return res.status(400).json({ message: 'Duplicate split participants' });
        }

        const expense = await transactions.run(async session => {
            const group = await management.lockGroup(groupId, req.user.id, session);
            const memberIds = new Set(group.members.map(normalizedId));
            if (!memberIds.has(normalizedId(paidBy)) || participantIds.some(id => !memberIds.has(id))) {
                throw new transactions.ApiError(400, 'Payer and split participants must belong to the group');
            }
            const [created] = await Expense.create([{
                title: title.trim(), amount: Number(amount), paidBy, groupId,
                splitBetween, createdBy: req.user.id
            }], { session });
            return created;
        });

        res.status(201).json({
            message: "Expense added successfully",
            expense
        });

    } catch (error) {
        return transactions.respondError(res, error);
    }

};


// GET GROUP EXPENSES
exports.getGroupExpenses = async (req, res) => {

    try {

            
        const { groupId } = req.params;
        if (!validId(groupId)) return res.status(400).json({ message: 'Invalid group ID' });

        // CHECK IF THE GROUP BELONGS TO THE LOGGED-IN USER
        const group = await Group.findOne({
            _id: groupId,
            members: req.user.id
        });

        if (!group) {

            return res.status(404).json({
                message: "Group not found or you are not authorized to view its expenses"
            });

        }

        // Read raw references before resolving users: populate can erase deleted IDs.
        const rawExpenses = await Expense.find({ groupId }).lean();
        const referenceIds = new Set(group.members.map(normalizedId));
        for (const expense of rawExpenses) {
            for (const ref of [expense.paidBy, ...(Array.isArray(expense.splitBetween) ? expense.splitBetween : [])]) {
                if (ref != null && validId(String(ref))) referenceIds.add(normalizedId(ref));
            }
        }
        const users = await User.find({ _id: { $in: [...referenceIds] } }).select('_id username').lean();
        const byId = new Map(users.map(user => [normalizedId(user._id), user]));
        const resolveUser = ref => {
            if (ref == null) return ref;
            const id = normalizedId(ref);
            return byId.get(id) || { _id: ref, unresolved: true };
        };
        const members = group.members.map(resolveUser);
        const expenses = rawExpenses.map(expense => ({
            ...expense,
            paidBy: resolveUser(expense.paidBy),
            splitBetween: Array.isArray(expense.splitBetween)
                ? expense.splitBetween.map(resolveUser) : expense.splitBetween
        }));
        try {
            const knownUsers = users.filter(user => group.members.some(id => normalizedId(id) === normalizedId(user._id)));
            const summary = calculateGroupSummary(expenses, { knownUsers });
            return res.status(200).json({ expenses, members, summary });
        } catch (error) {
            // Existing cards remain readable; no partial or fabricated balances.
            return res.status(200).json({
                expenses, members, summary: null,
                calculationError: { code: 'INVALID_EXPENSE_DATA', message: error.message }
            });
        }

    } catch (error) {

        res.status(500).json({
            message: error.message
        });

    }

};
