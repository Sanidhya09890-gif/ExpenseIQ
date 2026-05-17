const express = require('express');

const router = express.Router();

const authMiddleware = require('../middleware/auth.middleware');

const {
    addExpense,
    getGroupExpenses
} = require('../controllers/expense.controller');

router.post('/add', authMiddleware, addExpense);

router.get('/group/:groupId', authMiddleware, getGroupExpenses);

module.exports = router;