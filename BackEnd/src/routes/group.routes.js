const express = require('express');

const router = express.Router();

const authMiddleware = require('../middleware/auth.middleware');

const {
    createGroup,
    getGroups,
    deleteGroup,
    inviteUser,
    getPendingInvites,
    acceptInvite,
    rejectInvite,
    getRejectedInvites
} = require('../controllers/group.controller');

router.post('/create', authMiddleware, createGroup);
const managementController = require('../controllers/group.controller');
router.get('/:groupId/members', authMiddleware, managementController.getMembers);
router.post('/:groupId/leave', authMiddleware, managementController.leaveGroup);
router.delete('/:groupId/members/:memberId', authMiddleware, managementController.kickMember);
router.get('/', authMiddleware, getGroups);
router.post('/:groupId/invite', authMiddleware, inviteUser);
router.get('/invites', authMiddleware, getPendingInvites);
router.get('/invites/rejected', authMiddleware, getRejectedInvites);
router.post('/invites/:inviteId/accept', authMiddleware, acceptInvite);
router.post('/invites/:inviteId/reject', authMiddleware, rejectInvite);
router.delete('/delete/:groupId', authMiddleware, deleteGroup);

module.exports = router;
