const Expense = require('../models/expense.model');


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

        const expense = await Expense.create({

            title,
            amount,
            paidBy,
            groupId,
            splitBetween

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

        const { groupId } = req.params;

        const expenses = await Expense.find({
            groupId
        })
        .populate('paidBy', 'name email');

        res.status(200).json({
            expenses
        });

    } catch (error) {

        res.status(500).json({
            message: error.message
        });

    }

};