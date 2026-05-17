const mongoose = require('mongoose');

const expenseSchema = new mongoose.Schema({

    title: {
        type: String,
        required: true
    },

    amount: {
        type: Number,
        required: true
    },

    paidBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },

    groupId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Group'
    },

    splitBetween: [
        {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User'
        }
    ]

}, {
    timestamps: true
});

const Expense = mongoose.model('Expense', expenseSchema);

module.exports = Expense;