'use strict';
const Group = require('../models/group.model');
const Expense = require('../models/expense.model');
const User = require('../models/user.model');
const GroupInvite = require('../models/groupInvite.model');
const Notification = require('../models/notification.model');
const tx = require('./groupTransactions');
const { calculateGroupSummary } = require('../utils/expenseCalculations');
const same = (a, b) => String(a) === String(b);
const member = (group, id) => group.members.some(value => same(value, id));

// All membership, invitation decisions and expense writes increment the same
// group document. A competing transaction must retry against fresh membership.
async function lockGroup(groupId, userId, session) {
    const group = await Group.findOneAndUpdate({ _id: groupId, members: userId },
        { $inc: { __v: 1 } }, { new: true, session });
    if (!group) throw new tx.ApiError(404, 'Group not found or you are not a current member');
    return group;
}

async function balances(group, session) {
    const expenses = await Expense.find({ groupId: group._id }).session(session).lean();
    try {
        return { summary: calculateGroupSummary(expenses, { knownUsers: group.members }) };
    } catch (error) {
        if (!(error instanceof TypeError || error instanceof RangeError)) throw error;
        return { unavailable: true };
    }
}
function preview(result, userId) {
    if (result.unavailable) return { available: false, netPaise: null, warning: {
        code: 'BALANCE_UNAVAILABLE', message: 'Historical data prevents an accurate balance. Removal does not settle, cancel, or redistribute existing debts.'
    } };
    const netPaise = result.summary.users.find(user => same(user.userId, userId))?.netPaise;
    if (!Number.isSafeInteger(netPaise)) throw new tx.ApiError(409, 'Member balance is missing');
    return { available: true, netPaise, warning: netPaise === 0 ? null : {
        code: 'OUTSTANDING_BALANCE', message: 'Removal does not settle, cancel, or redistribute existing debts. Historical balances remain unchanged.'
    } };
}

async function getMembers(groupId, userId) {
    groupId = tx.requireId(groupId, 'group ID');
    return tx.run(async session => {
        const group = await Group.findOne({ _id: groupId, members: userId }).session(session);
        if (!group) throw new tx.ApiError(404, 'Group not found or you are not a current member');
        const users = await User.find({ _id: { $in: group.members } }).select('_id username').session(session).lean();
        const names = new Map(users.map(user => [String(user._id), user.username]));
        const result = await balances(group, session);
        const isOwner = same(group.createdBy, userId);
        return { groupId: String(group._id), ownerId: String(group.createdBy), members: group.members.map(id => ({
            userId: String(id), username: names.get(String(id)) || null, unresolved: !names.has(String(id)),
            role: same(id, group.createdBy) ? 'owner' : 'member',
            canLeave: same(id, userId) && !isOwner,
            canRemove: isOwner && !same(id, userId), balance: preview(result, id)
        })), balancePolicy: 'preserve-history', previewOnly: true };
    });
}

async function removeMember(groupId, actorId, targetId, kick) {
    groupId = tx.requireId(groupId, 'group ID'); targetId = tx.requireId(targetId, 'member ID');
    return tx.run(async session => {
        const group = await lockGroup(groupId, actorId, session);
        if (kick && !same(group.createdBy, actorId)) throw new tx.ApiError(403, 'Only the group owner can remove members');
        if (same(group.createdBy, targetId)) throw new tx.ApiError(409, 'The owner cannot leave or remove themselves');
        if (!member(group, targetId)) throw new tx.ApiError(404, 'Target is not a current member');
        const balance = preview(await balances(group, session), targetId);
        const filter = { _id: groupId, members: targetId };
        if (kick) filter.createdBy = actorId;
        const changed = await Group.updateOne(filter, { $pull: { members: targetId } }, { session });
        if (changed.modifiedCount !== 1) throw new tx.ApiError(409, 'Membership changed; refresh and retry');
        await GroupInvite.updateMany({ groupId, invitee: targetId, status: 'pending' },
            { $set: { status: 'expired', expiresAt: new Date() } }, { session });
        await Notification.deleteMany({ groupId, recipient: targetId, type: 'INVITE_RECEIVED' }, { session });
        return { message: kick ? 'Member removed' : 'You left the group', groupId, memberId: targetId, balance };
    });
}

async function invite(groupId, actorId, input) {
    groupId = tx.requireId(groupId, 'group ID');
    const search = input?.username || input?.email;
    if (typeof search !== 'string' || !search.trim()) throw new tx.ApiError(400, 'Username or email is required');
    return tx.run(async session => {
        const group = await lockGroup(groupId, actorId, session);
        if (!same(group.createdBy, actorId)) throw new tx.ApiError(403, 'Only the group owner can send invitations');
        const invitee = await User.findOne({ $or: [{ username: search.trim() }, { email: search.trim().toLowerCase() }] }).session(session);
        if (!invitee) throw new tx.ApiError(404, 'This user is not on ExpenseIQ. Ask them to create an account first.');
        if (member(group, invitee._id)) throw new tx.ApiError(400, 'User is already a member of this group');
        const now = new Date();
        const stale = await GroupInvite.find({ groupId, invitee: invitee._id, status: 'pending', expiresAt: { $lte: now } }).session(session).lean();
        await GroupInvite.updateMany({ groupId, invitee: invitee._id, status: 'pending', expiresAt: { $lte: now } }, { $set: { status: 'expired' } }, { session });
        if (stale.length) await Notification.deleteMany({ recipient: invitee._id, type: 'INVITE_RECEIVED', inviteId: { $in: stale.map(i => i._id) } }, { session });
        const existing = await GroupInvite.findOne({ groupId, invitee: invitee._id, status: 'pending' }).session(session);
        if (existing) throw new tx.ApiError(409, 'A pending invitation already exists for this user');
        const [invitation] = await GroupInvite.create([{ invitedBy: actorId, groupId, invitee: invitee._id }], { session });
        await Notification.create([{ recipient: invitee._id, type: 'INVITE_RECEIVED', message: 'You received a group invitation', groupId, relatedUser: actorId, inviteId: invitation._id }], { session });
        return { message: 'Invitation sent successfully', invite: invitation };
    });
}

async function decideInvite(inviteId, userId, accept) {
    inviteId = tx.requireId(inviteId, 'invitation ID');
    return tx.run(async session => {
        const invitation = await GroupInvite.findById(inviteId).session(session);
        if (!invitation) throw new tx.ApiError(404, 'Invitation not found');
        if (!same(invitation.invitee, userId)) throw new tx.ApiError(403, 'This invitation belongs to another user');
        if (invitation.status !== 'pending' || invitation.expiresAt <= new Date()) throw new tx.ApiError(409, 'Invitation is no longer pending or has expired');
        const group = await Group.findOneAndUpdate({ _id: invitation.groupId, createdBy: invitation.invitedBy, members: invitation.invitedBy },
            { $inc: { __v: 1 } }, { new: true, session });
        if (!group) throw new tx.ApiError(404, 'Group or authorized owner no longer exists');
        const decided = await GroupInvite.updateOne({ _id: inviteId, invitee: userId, status: 'pending', expiresAt: { $gt: new Date() } },
            { $set: { status: accept ? 'accepted' : 'rejected' } }, { session });
        if (decided.modifiedCount !== 1) throw new tx.ApiError(409, 'Invitation changed; refresh and retry');
        if (accept) await Group.updateOne({ _id: group._id, createdBy: invitation.invitedBy, members: invitation.invitedBy }, { $addToSet: { members: userId } }, { session });
        await Notification.deleteMany({ recipient: userId, inviteId, type: 'INVITE_RECEIVED' }, { session });
        await Notification.create([{ recipient: invitation.invitedBy, type: accept ? 'INVITE_ACCEPTED' : 'INVITE_REJECTED',
            message: accept ? 'Your invitation was accepted' : 'Your invitation was rejected', groupId: group._id, relatedUser: userId }], { session });
        // Read back the committed-to-be membership rather than returning a stale group.
        return { message: accept ? 'Invitation accepted successfully' : 'Invitation rejected successfully',
            ...(accept ? { group: await Group.findById(group._id).session(session) } : {}) };
    });
}

module.exports = { lockGroup, getMembers, removeMember, invite, decideInvite };
