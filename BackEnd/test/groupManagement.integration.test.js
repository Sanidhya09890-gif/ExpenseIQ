'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const Group = require('../src/models/group.model');
const User = require('../src/models/user.model');
const Expense = require('../src/models/expense.model');
const Invite = require('../src/models/groupInvite.model');
const Notification = require('../src/models/notification.model');
const management = require('../src/services/groupManagement');
const { inspectTopology } = require('../src/services/groupTransactions');
const expenseController = require('../src/controllers/expense.controller');
const { calculateGroupSummary } = require('../src/utils/expenseCalculations');

const enabled = Boolean(process.env.EXPENSEIQ_TEST_MONGO_URI && process.env.EXPENSEIQ_TEST_ALLOW_MUTATIONS === '1');
test('isolated MongoDB transaction/lifecycle/concurrency integration', { skip: !enabled, timeout: 120000 }, async t => {
    const uri = process.env.EXPENSEIQ_TEST_MONGO_URI;
    assert.notEqual(uri, process.env.MONGO_URI, 'Refusing to use the application URI as a test database');
    const dbName = `expenseiq_test_${process.pid}_${Date.now()}`;
    assert(/^expenseiq_test_\d+_\d+$/.test(dbName));
    await mongoose.connect(uri, { dbName, autoIndex: false, serverSelectionTimeoutMS: 5000 });
    t.after(async () => {
        // Only this newly generated, explicitly selected test database is deleted.
        assert.equal(mongoose.connection.name, dbName);
        await mongoose.connection.dropDatabase();
        await mongoose.disconnect();
    });
    await inspectTopology();
    for (const Model of [Group, User, Expense, Invite, Notification]) await Model.createCollection();
    await Invite.collection.createIndex({ groupId: 1, invitee: 1 }, { unique: true, partialFilterExpression: { status: 'pending' } });
    async function fixture() {
        const suffix = new mongoose.Types.ObjectId().toString();
        const [owner, member] = await User.create([
            { username: `owner_${suffix}`, email: `owner_${suffix}@example.test`, password: 'test-only' },
            { username: `member_${suffix}`, email: `member_${suffix}@example.test`, password: 'test-only' }
        ]);
        const group = await Group.create({ groupName: 'Integration', createdBy: owner._id, members: [owner._id, member._id] });
        const historical = await Expense.create({ title: 'History', amount: 100, paidBy: owner._id, createdBy: owner._id,
            groupId: group._id, splitBetween: [owner._id, member._id] });
        return { owner, member, group, historical, G: String(group._id), A: String(owner._id), B: String(member._id) };
    }
    async function add(f) {
        const result = {};
        await expenseController.addExpense({ user: { id: f.B }, body: { title: 'New', amount: '0.01',
            paidBy: f.B, groupId: f.G, splitBetween: [f.A, f.B] } }, {
            status(code) { result.status = code; return this; }, json(body) { result.body = body; }
        });
        return result;
    }
    await t.test('leave/reject/fresh rejoin and history conservation', async () => {
        const f = await fixture();
        const history = await Expense.find({ groupId: f.G }).lean();
        await management.removeMember(f.G, f.B, f.B, false);
        assert.equal((await add(f)).status, 404);
        const proposals = await Promise.allSettled([management.invite(f.G, f.A, { username: f.member.username }), management.invite(f.G, f.A, { username: f.member.username })]);
        assert.equal(proposals.filter(p => p.status === 'fulfilled').length, 1);
        const first = proposals.find(p => p.status === 'fulfilled').value.invite;
        await management.decideInvite(String(first._id), f.B, false);
        assert.equal((await Group.findById(f.G)).members.length, 1);
        const fresh = await management.invite(f.G, f.A, { username: f.member.username });
        const decisions = await Promise.allSettled([management.decideInvite(String(fresh.invite._id), f.B, true), management.decideInvite(String(fresh.invite._id), f.B, true)]);
        assert.equal(decisions.filter(p => p.status === 'fulfilled').length, 1);
        assert.equal((await Group.findById(f.G)).members.filter(id => String(id) === f.B).length, 1);
        const after = await Expense.find({ groupId: f.G }).lean();
        assert.deepEqual(after, history);
        assert.deepEqual(calculateGroupSummary(after), calculateGroupSummary(history));
    });
    await t.test('concurrent stale acceptance cannot undo a kick', async () => {
        const f = await fixture();
        const invite = await Invite.create({ groupId: f.G, invitedBy: f.A, invitee: f.B });
        const results = await Promise.allSettled([management.removeMember(f.G, f.A, f.B, true), management.decideInvite(String(invite._id), f.B, true)]);
        assert.equal(results[0].status, 'fulfilled');
        assert(!(await Group.findById(f.G)).members.some(id => String(id) === f.B));
        await assert.rejects(management.decideInvite(String(invite._id), f.B, true));
    });
    await t.test('stale pending invitations expire before a replacement under the partial index', async () => {
        const f = await fixture();
        await management.removeMember(f.G, f.B, f.B, false);
        const stale = await Invite.create({ groupId: f.G, invitedBy: f.A, invitee: f.B, expiresAt: new Date(0) });
        const fresh = await management.invite(f.G, f.A, { username: f.member.username });
        assert.notEqual(String(fresh.invite._id), String(stale._id));
        assert.equal((await Invite.findById(stale._id)).status, 'expired');
        assert.equal(await Invite.countDocuments({ groupId: f.G, invitee: f.B, status: 'pending' }), 1);
    });
    await t.test('expense/removal race serializes; no writes are allowed after revocation', async () => {
        const f = await fixture();
        const [removal, creation] = await Promise.all([management.removeMember(f.G, f.A, f.B, true), add(f)]);
        assert.equal(removal.memberId, f.B); assert([201, 404].includes(creation.status));
        const count = await Expense.countDocuments({ groupId: f.G });
        assert.equal((await add(f)).status, 404);
        assert.equal(await Expense.countDocuments({ groupId: f.G }), count);
        assert(await Expense.findById(f.historical._id));
    });
});
