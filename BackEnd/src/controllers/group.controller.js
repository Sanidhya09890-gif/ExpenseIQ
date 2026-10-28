const management = require('../services/groupManagement');
const transactions = require('../services/groupTransactions');
const Group = require('../models/group.model');
const Expense = require('../models/expense.model');
const GroupInvite = require('../models/groupInvite.model');


// CREATE GROUP
exports.createGroup = async (req, res) => {

    try {

        const { groupName } = req.body;

        const group = await Group.create({

            groupName,

            members: [req.user.id],

            createdBy: req.user.id

        });

        res.status(201).json({
            message: "Group created successfully",
            group
        });

    } catch (error) {

        res.status(500).json({
            message: error.message
        });

    }

};


// GET ALL GROUPS OF LOGGED-IN USER
exports.getGroups = async (req, res) => {

    try {

        const groups = await Group.find({
            members: req.user.id
        }).populate('members', 'username');

        res.status(200).json({
            groups
        });

    } catch (error) {

        res.status(500).json({
            message: error.message
        });

    }

};
//genrating invite for the user
exports.inviteUser = async (req, res) => {
    try { return res.status(201).json(await management.invite(req.params.groupId, req.user.id, req.body)); }
    catch (error) { return transactions.respondError(res, error); }
};
//fetching pending invites for the user
exports.getPendingInvites = async (req, res) => {
    try {
        const invites = await GroupInvite.find({
            invitee: req.user.id,
            status: 'pending'
        })
        .populate('invitedBy', 'name username')
        .populate('groupId', 'groupName');

        res.status(200).json({
            invites
        });

    } catch (error) {
        res.status(500).json({
            message: error.message
        });
    }
};

//user can acceptInvite
exports.acceptInvite = async (req, res) => {
    try { return res.status(200).json(await management.decideInvite(req.params.inviteId, req.user.id, true)); }
    catch (error) { return transactions.respondError(res, error); }
};
// USER CAN REJECT INVITE
exports.rejectInvite = async (req, res) => {
    try { return res.status(200).json(await management.decideInvite(req.params.inviteId, req.user.id, false)); }
    catch (error) { return transactions.respondError(res, error); }
};
// GET REJECTED INVITES FOR GROUP OWNER
exports.getRejectedInvites = async (req, res) => {
    try {

        const invites = await GroupInvite.find({
            invitedBy: req.user.id,
            status: 'rejected'
        })
        .populate('invitee', 'name username')
        .populate('groupId', 'groupName');

        res.status(200).json({
            invites
        });

    } catch (error) {

        res.status(500).json({
            message: error.message
        });

    }
};

// DELETE GROUP
exports.deleteGroup = async (req, res) => {
    try {
        const groupId = transactions.requireId(req.params.groupId, 'group ID');
        await transactions.run(async session => {
            const group = await management.lockGroup(groupId, req.user.id, session);
            if (String(group.createdBy) !== req.user.id) throw new transactions.ApiError(403, 'Only the group owner can delete this group');
            await Expense.deleteMany({ groupId }, { session });
            await Group.deleteOne({ _id: groupId, createdBy: req.user.id }, { session });
        });
        return res.status(200).json({ message: 'Group and all expenses deleted successfully' });
    } catch (error) { return transactions.respondError(res, error); }
};

exports.getMembers = async (req, res) => {
    try { return res.status(200).json(await management.getMembers(req.params.groupId, req.user.id)); }
    catch (error) { return transactions.respondError(res, error); }
};
exports.leaveGroup = async (req, res) => {
    try { return res.status(200).json(await management.removeMember(req.params.groupId, req.user.id, req.user.id, false)); }
    catch (error) { return transactions.respondError(res, error); }
};
exports.kickMember = async (req, res) => {
    try { return res.status(200).json(await management.removeMember(req.params.groupId, req.user.id, req.params.memberId, true)); }
    catch (error) { return transactions.respondError(res, error); }
};
