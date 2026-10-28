'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Group = require('../src/models/group.model');
const Expense = require('../src/models/expense.model');
const User = require('../src/models/user.model');
const Invite = require('../src/models/groupInvite.model');
const Notification = require('../src/models/notification.model');
const tx = require('../src/services/groupTransactions');
const management = require('../src/services/groupManagement');
const expenses = require('../src/controllers/expense.controller');
const auth = require('../src/middleware/auth.middleware');
const routes = require('../src/routes/group.routes');
const { calculateGroupSummary } = require('../src/utils/expenseCalculations');
const id = n => n.toString(16).padStart(24, '0');
const A = id(1), B = id(2), C = id(3), G = id(10);
const future = () => new Date(Date.now() + 86400000);

// Deterministic transactional model doubles. These exercise policy and rollback,
// not MongoDB write conflicts; the separate opt-in integration test covers those.
function setup(t, records = []) {
    const state = { group: { _id: G, createdBy: A, members: [A, B], __v: 0 },
        expenses: structuredClone(records), invites: [], notifications: [], sequence: 100 };
    let tail = Promise.resolve();
    t.mock.method(tx, 'run', work => {
        const result = tail.then(async () => {
            const before = structuredClone(state);
            try { return await work({ transaction: true }); }
            catch (e) { Object.assign(state, before); throw e; }
        });
        tail = result.catch(() => {}); return result;
    });
    function match(record, filter) {
        return Object.entries(filter).every(([key, wanted]) => {
            if (key === '$or') return wanted.some(part => match(record, part));
            const value = record[key];
            if (wanted && typeof wanted === 'object') {
                if ('$all' in wanted) return wanted.$all.every(v => value.includes(v));
                if ('$in' in wanted) return wanted.$in.includes(value);
                if ('$gt' in wanted) return value > wanted.$gt;
                if ('$lte' in wanted) return value <= wanted.$lte;
            }
            return Array.isArray(value) ? value.includes(wanted) : value === wanted;
        });
    }
    const query = read => ({ session() { return this; }, select(fields) { assert.equal(fields, '_id username'); return this; },
        lean: async () => structuredClone(read()), then(resolve, reject) { return Promise.resolve().then(read).then(resolve, reject); } });
    function update(record, change) {
        if (change.$inc) for (const [key, n] of Object.entries(change.$inc)) record[key] = (record[key] || 0) + n;
        if (change.$set) Object.assign(record, change.$set);
        if (change.$pull) for (const [key, n] of Object.entries(change.$pull)) record[key] = record[key].filter(v => v !== n);
        if (change.$addToSet) for (const [key, n] of Object.entries(change.$addToSet)) if (!record[key].includes(n)) record[key].push(n);
    }
    t.mock.method(Group, 'findOne', filter => query(() => state.group && match(state.group, filter) ? structuredClone(state.group) : null));
    t.mock.method(Group, 'findById', groupId => query(() => state.group?._id === groupId ? structuredClone(state.group) : null));
    t.mock.method(Group, 'findOneAndUpdate', async (filter, change, options) => {
        assert(options.session); assert.deepEqual(change, { $inc: { __v: 1 } });
        if (!state.group || !match(state.group, filter)) return null;
        update(state.group, change); return structuredClone(state.group);
    });
    t.mock.method(Group, 'updateOne', async (filter, change, options) => {
        assert(options.session);
        if (!match(state.group, filter)) return { modifiedCount: 0 };
        update(state.group, change); return { modifiedCount: 1 };
    });
    t.mock.method(Expense, 'find', filter => query(() => state.expenses.filter(e => e.groupId === filter.groupId)));
    t.mock.method(Expense, 'create', async (rows, options) => { assert(options.session); state.expenses.push(...structuredClone(rows)); return rows; });
    const users = [{ _id: A, username: 'Owner' }, { _id: B, username: 'Member' }, { _id: C, username: 'Other' }];
    t.mock.method(User, 'find', filter => query(() => users.filter(user => filter._id.$in.includes(user._id))));
    t.mock.method(User, 'findOne', filter => query(() => users.find(user => match(user, filter))));
    t.mock.method(Invite, 'find', filter => query(() => state.invites.filter(i => match(i, filter))));
    t.mock.method(Invite, 'findOne', filter => query(() => state.invites.find(i => match(i, filter))));
    t.mock.method(Invite, 'findById', inviteId => query(() => state.invites.find(i => i._id === inviteId)));
    t.mock.method(Invite, 'create', async (rows, options) => {
        assert(options.session);
        const made = rows.map(row => ({ ...row, _id: id(state.sequence++), status: 'pending', expiresAt: future() }));
        state.invites.push(...made); return structuredClone(made);
    });
    for (const method of ['updateOne', 'updateMany']) t.mock.method(Invite, method, async (filter, change, options) => {
        assert(options.session); let modifiedCount = 0;
        for (const i of state.invites) if (match(i, filter)) { update(i, change); modifiedCount++; if (method === 'updateOne') break; }
        return { modifiedCount };
    });
    t.mock.method(Notification, 'create', async (rows, options) => { assert(options.session); state.notifications.push(...structuredClone(rows)); return rows; });
    t.mock.method(Notification, 'deleteMany', async (filter, options) => {
        assert(options.session); state.notifications = state.notifications.filter(n => !match(n, filter)); return {};
    });
    return state;
}
const record = (paidBy = A, splitBetween = [A, B], amount = '100') => ({ groupId: G, title: 'Hotel', amount, paidBy, splitBetween, createdBy: paidBy });

for (const kick of [false, true]) test(`${kick ? 'kick' : 'leave'} preserves history, invalidates old pending invites, and denies expense access`, async t => {
    const state = setup(t, [record()]); const before = structuredClone(state.expenses);
    state.invites.push({ _id: id(50), groupId: G, invitee: B, invitedBy: A, status: 'pending', expiresAt: future() },
        { _id: id(51), groupId: G, invitee: B, invitedBy: A, status: 'accepted', expiresAt: future() });
    state.notifications.push({ recipient: B, groupId: G, type: 'INVITE_RECEIVED' }, { recipient: B, groupId: G, type: 'INVITE_ACCEPTED' });
    const summary = calculateGroupSummary(state.expenses);
    const result = await management.removeMember(G, kick ? A : B, B, kick);
    assert.equal(result.balance.netPaise, -5000); assert.equal(result.balance.warning.code, 'OUTSTANDING_BALANCE');
    assert.deepEqual(state.group.members, [A]); assert.deepEqual(state.expenses, before);
    assert.deepEqual(calculateGroupSummary(state.expenses), summary);
    assert.equal(state.invites[0].status, 'expired'); assert.equal(state.invites[1].status, 'accepted');
    assert.equal(state.notifications.length, 1);
    await assert.rejects(management.getMembers(G, B), { status: 404 });
    for (const old of state.invites) await assert.rejects(management.decideInvite(old._id, B, true), { status: 409 });
    let code; await expenses.addExpense({ user: { id: B }, body: { ...record(B), paidBy: B } },
        { status(c) { code = c; return this; }, json() {} });
    assert.equal(code, 404); assert.deepEqual(state.expenses, before);
    await expenses.getGroupExpenses({ user: { id: B }, params: { groupId: G } },
        { status(c) { code = c; return this; }, json() {} });
    assert.equal(code, 404);
    await assert.rejects(management.removeMember(G, kick ? A : B, B, kick), { status: 404 });
});

test('owner leave, owner self-kick, ordinary kick, outsider and malformed IDs are denied', async t => {
    const state = setup(t);
    await assert.rejects(management.removeMember(G, A, A, false), { status: 409 });
    await assert.rejects(management.removeMember(G, A, A, true), { status: 409 });
    await assert.rejects(management.removeMember(G, B, A, true), { status: 403 });
    await assert.rejects(management.removeMember(G, C, B, true), { status: 404 });
    await assert.rejects(management.removeMember(G, A, C, true), { status: 404 });
    await assert.rejects(management.getMembers(id(999), A), { status: 404 });
    await assert.rejects(management.removeMember('bad', B, B, false), { status: 400 });
    await assert.rejects(management.removeMember(G, A, 'bad', true), { status: 400 });
    assert.deepEqual(state.group.members, [A, B]);
});

for (const [label, rows, net] of [['positive', [record(B)], 5000], ['negative', [record()], -5000],
    ['zero', [record(B, [B])], 0], ['unavailable', [record(A, [])], null]]) {
    test(`${label} balances have pre-removal metadata and do not prevent removal`, async t => {
        const state = setup(t, rows);
        const preview = await management.getMembers(G, A);
        assert.equal(preview.ownerId, A);
        const target = preview.members.find(m => m.userId === B);
        assert.equal(target.username, 'Member'); assert.equal(target.canRemove, true); assert.equal(target.balance.netPaise, net);
        assert(!JSON.stringify(preview).includes('email'));
        const result = await management.removeMember(G, A, B, true);
        assert.deepEqual(result.balance, target.balance);
        assert.equal(result.balance.available, net !== null);
        if (net === null) assert.equal(result.balance.warning.code, 'BALANCE_UNAVAILABLE');
        if (net === 0) assert.equal(result.balance.warning, null);
        assert.deepEqual(state.expenses, rows);
    });
}

test('fresh owner invitation restores membership once; rejection and old acceptance never do', async t => {
    const state = setup(t, [record()]); const before = structuredClone(state.expenses);
    await management.removeMember(G, B, B, false);
    await assert.rejects(management.invite(G, B, { username: 'Member' }), { status: 404 });
    const first = await management.invite(G, A, { username: 'Member' });
    await assert.rejects(management.decideInvite(first.invite._id, C, true), { status: 403 });
    await management.decideInvite(first.invite._id, B, false);
    assert.deepEqual(state.group.members, [A]);
    const second = await management.invite(G, A, { username: 'Member' });
    assert.notEqual(second.invite._id, first.invite._id);
    await management.decideInvite(second.invite._id, B, true);
    await assert.rejects(management.decideInvite(second.invite._id, B, true), { status: 409 });
    assert.deepEqual(state.group.members, [A, B]); assert.deepEqual(state.expenses, before);
    assert.equal((await management.getMembers(G, B)).members.find(m => m.userId === B).canLeave, true);
});

test('duplicate invitation creation is serialized; stale pending invites expire before a fresh one', async t => {
    const state = setup(t); state.group.members = [A];
    state.invites.push({ _id: id(70), groupId: G, invitee: B, invitedBy: A, status: 'pending', expiresAt: new Date(0) });
    const outcomes = await Promise.allSettled([management.invite(G, A, { username: 'Member' }), management.invite(G, A, { username: 'Member' })]);
    assert.equal(outcomes.filter(o => o.status === 'fulfilled').length, 1);
    assert.equal(state.invites[0].status, 'expired');
    assert.equal(state.invites.filter(i => i.status === 'pending').length, 1);
    await assert.rejects(management.invite(G, A, { username: 'Owner' }), { status: 400 });
});

test('invitation ownership is checked against the current owner, not historical inviter', async t => {
    const state = setup(t); state.group.members = [A];
    state.invites.push({ _id: id(80), groupId: G, invitee: B, invitedBy: C, status: 'pending', expiresAt: future() });
    await assert.rejects(management.decideInvite(id(80), B, true), { status: 404 });
    assert.deepEqual(state.group.members, [A]);
});

test('serialized accept/remove and duplicate decisions cannot restore removed membership', async t => {
    const state = setup(t); state.group.members = [A];
    const { invite } = await management.invite(G, A, { username: 'Member' });
    const result = await Promise.allSettled([management.decideInvite(invite._id, B, true), management.removeMember(G, A, B, true)]);
    assert(result.every(r => r.status === 'fulfilled')); assert.deepEqual(state.group.members, [A]);
    await assert.rejects(management.decideInvite(invite._id, B, true), { status: 409 });
});

test('serialized expense/removal contention prevents any expense after revocation', async t => {
    const state = setup(t, [record()]);
    const before = structuredClone(state.expenses);
    const removal = management.removeMember(G, A, B, true);
    let code;
    const creation = expenses.addExpense({ user: { id: B }, body: record(B) },
        { status(c) { code = c; return this; }, json() {} });
    await Promise.all([removal, creation]);
    assert.equal(code, 404); assert.deepEqual(state.expenses, before);
});

test('accept and reject compete for a single invitation decision', async t => {
    const state = setup(t); state.group.members = [A];
    const { invite } = await management.invite(G, A, { username: 'Member' });
    const results = await Promise.allSettled([management.decideInvite(invite._id, B, false), management.decideInvite(invite._id, B, true)]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal(state.invites[0].status, 'rejected'); assert.deepEqual(state.group.members, [A]);
});

test('normal members cannot invite, and rollback preserves state if notification cleanup fails', async t => {
    const state = setup(t);
    await assert.rejects(management.invite(G, B, { username: 'Other' }), { status: 403 });
    const before = structuredClone(state);
    t.mock.method(Notification, 'deleteMany', async () => { throw Error('Cleanup failed'); });
    await assert.rejects(management.removeMember(G, A, B, true), /Cleanup failed/);
    assert.deepEqual(state, before);
});

test('membership routes require existing JWT middleware and topology cannot silently fall back', async t => {
    for (const path of ['/:groupId/members', '/:groupId/leave', '/:groupId/members/:memberId']) {
        assert.equal(routes.stack.find(layer => layer.route?.path === path).route.stack[0].handle, auth);
    }
    await assert.rejects(tx.inspectTopology({ readyState: 0 }), { status: 503 });
    await assert.rejects(tx.inspectTopology({ readyState: 1, db: { admin: () => ({ command: async () => ({ maxWireVersion: 25, logicalSessionTimeoutMinutes: 30 }) }) } }), { status: 503 });
    assert.deepEqual(await tx.inspectTopology({ readyState: 1, db: { admin: () => ({ command: async () => ({ setName: 'test', maxWireVersion: 25, logicalSessionTimeoutMinutes: 30 }) }) } }), { transactionsSupported: true });
});
