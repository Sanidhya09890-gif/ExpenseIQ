const Expense = require('../models/expense.model');
const Group = require('../models/group.model');


// ADD EXPENSE
exports.addExpense = async (req, res) => {

    try {

        const {
            title,
            amount,
            paidBy,
            groupId,
            splitBetween
        } = req.body;

        // CHECK IF THE GROUP BELONGS TO THE LOGGED-IN USER
        const group = await Group.findOne({
            _id: groupId,
            createdBy: req.user.id
        });

        if (!group) {

            return res.status(404).json({
                message: "Group not found or you are not authorized to add expenses to it"
            });

        }

        const expense = await Expense.create({

            title,
            amount,
            paidBy,
            groupId,
            splitBetween,
            createdBy: req.user.id

        });

        res.status(201).json({
            message: "Expense added successfully",
            expense
        });

    } catch (error) {

        res.status(500).json({
            message: error.message
        });

    }

};


// GET GROUP EXPENSES
exports.getGroupExpenses = async (req, res) => {

    try {
            console.log("Logged in user:", req.user);
            
        const { groupId } = req.params;

        // CHECK IF THE GROUP BELONGS TO THE LOGGED-IN USER
        const group = await Group.findOne({
            _id: groupId,
            createdBy: req.user.id
        });

        if (!group) {

            return res.status(404).json({
                message: "Group not found or you are not authorized to view its expenses"
            });

        }

        const expenses = await Expense.find({
            groupId
        })
        .populate('paidBy', 'name email')
        .populate('splitBetween', 'name email');

        res.status(200).json({
            expenses
        });

    } catch (error) {

        res.status(500).json({
            message: error.message
        });

    }

};