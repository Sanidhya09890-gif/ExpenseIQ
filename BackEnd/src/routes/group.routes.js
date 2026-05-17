const express = require('express');

const router = express.Router();

const authMiddleware = require('../middleware/auth.middleware');

const {
    createGroup,
    getGroups,
    deleteGroup
} = require('../controllers/group.controller');

router.post('/create', authMiddleware, createGroup);
router.get('/', authMiddleware, getGroups);
router.delete('/delete/:groupId', authMiddleware, deleteGroup);

module.exports = router;