'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const Group = require('../src/models/group.model');
const Expense = require('../src/models/expense.model');
const User = require('../src/models/user.model');
const controller = require('../src/controllers/expense.controller');
const { getGroups } = require('../src/controllers/group.controller');
const transactions = require('../src/services/groupTransactions');
const management = require('../src/services/groupManagement');

const A = '000000000000000000000001';
const B = '000000000000000000000002';
const C = '000000000000000000000003';
const G = '000000000000000000000010';
const base = () => ({ title: 'Hotel', amount: '100.00', paidBy: A, groupId: G, splitBetween: [A, B] });
const row = overrides => ({ ...base(), _id: G, ...overrides });

function setup(t, { records = [], users = [{ _id: A, username: 'Owner' }, { _id: B, username: 'Admin' }] } = {}) {
    const writes = [];
    t.mock.method(transactions, 'run', async work => work({}));
    t.mock.method(management, 'lockGroup', async (groupId, userId) => {
        const group = await Group.findOne({ _id: groupId, members: userId });
        if (!group) throw new transactions.ApiError(404, 'Group not found');
        return group;
    });
    t.mock.method(Group, 'findOne', async filter => {
        assert.deepEqual(filter, { _id: G, members: filter.members });
        return [A, B].includes(filter.members) ? { members: [A, B], createdBy: A } : null;
    });
    t.mock.method(Expense, 'create', async data => { writes.push(data[0]); return [{ _id: G, ...data[0] }]; });
    t.mock.method(Expense, 'find', filter => {
        assert.deepEqual(filter, { groupId: G });
        return { lean: async () => structuredClone(records) };
    });
    t.mock.method(User, 'find', filter => ({ select(fields) {
        assert.equal(fields, '_id username');
        return { lean: async () => users.filter(user => filter._id.$in.includes(user._id)) };
    } }));
    return writes;
}

async function call(name, id = A, body = base(), groupId = G) {
    const result = {};
    await controller[name]({ user: { id }, body, params: { groupId } }, {
        status(code) { result.status = code; return this; },
        json(data) { result.body = JSON.parse(JSON.stringify(data)); return this; }
    });
    return result;
}

for (const [label, id] of [['creator', A], ['accepted member', B]]) {
    test(`${label} can create and read expenses with compatible response fields`, async t => {
        const writes = setup(t, { records: [row()] });
        const created = await call('addExpense', id, { ...base(), paidBy: id });
        assert.equal(created.status, 201);
        assert.equal(created.body.message, 'Expense added successfully');
        assert.equal(created.body.expense.createdBy, id);
        assert.equal(writes.length, 1);
        const read = await call('getGroupExpenses', id);
        assert.equal(read.status, 200);
        assert.equal(read.body.expenses[0].paidBy.username, 'Owner');
        assert.equal(read.body.expenses[0].amount, '100.00');
        assert.deepEqual(read.body.expenses[0].splitBetween.map(u => u._id), [A, B]);
        assert.deepEqual(read.body.members.map(u => u.username), ['Owner', 'Admin']);
        assert.equal(read.body.summary.totalAmountPaise, 10000);
        assert.deepEqual(read.body.summary.users.map(u => u.netPaise), [5000, -5000]);
        assert.equal(read.body.calculationError, undefined);
    });
}

test('non-members cannot read or create; no write or expense read occurs', async t => {
    const writes = setup(t);
    assert.equal((await call('addExpense', C, { ...base(), paidBy: C })).status, 404);
    assert.equal((await call('getGroupExpenses', C)).status, 404);
    assert.equal(writes.length, 0);
    assert.equal(Expense.find.mock.callCount(), 0);
});

const invalid = [
    ['group ID', { groupId: 'bad' }], ['missing group ID', { groupId: undefined }],
    ['empty title', { title: '   ' }], ['object title', { title: {} }],
    ['duplicate participants', { splitBetween: [A, A] }], ['empty participants', { splitBetween: [] }],
    ['malformed participant', { splitBetween: ['bad'] }], ['null participant', { splitBetween: [null] }],
    ['object participant', { splitBetween: [{ _id: A }] }], ['missing participants', { splitBetween: undefined }],
    ['outsider', { splitBetween: [A, C] }], ['payer spoofing', { paidBy: B }],
    ['malformed payer', { paidBy: 'bad' }], ['missing payer', { paidBy: undefined }],
    ...[0, -1, '1.001', 'NaN', null, {}, '90071992547409.91'].map(amount => [`amount ${String(amount)}`, { amount }])
];
for (const [label, overrides] of invalid) {
    test(`rejects ${label} with a clear 400 and no writes`, async t => {
        const writes = setup(t);
        const response = await call('addExpense', A, { ...base(), ...overrides });
        assert.equal(response.status, 400);
        assert.equal(typeof response.body.message, 'string');
        assert(response.body.message.length > 0);
        assert.equal(writes.length, 0);
    });
}

test('valid participants may exclude payer; creates unchanged recorded participants', async t => {
    const writes = setup(t);
    assert.equal((await call('addExpense', A, { ...base(), splitBetween: [B] })).status, 201);
    assert.deepEqual(writes[0].splitBetween, [B]);
});

test('case-normalized IDs detect duplicates', async t => {
    setup(t);
    const id = 'abcdef000000000000000001';
    assert.equal((await call('addExpense', A, { ...base(), splitBetween: [id, id.toUpperCase()] })).status, 400);
});

test('malformed retrieval group ID is a 400 without database queries', async t => {
    setup(t);
    assert.equal((await call('getGroupExpenses', A, undefined, 'invalid')).status, 400);
    assert.equal(Group.findOne.mock.callCount(), 0);
});

test('historical self-only remains unchanged alongside combined exact allocations', async t => {
    const records = [row({ amount: '100', splitBetween: [A] }), row({ amount: '0.01', paidBy: B })];
    const before = structuredClone(records);
    setup(t, { records });
    const { body } = await call('getGroupExpenses');
    assert.deepEqual(body.expenses[0].splitBetween.map(u => u._id), [A]);
    assert.deepEqual(body.summary.users.map(u => [u.paidPaise, u.sharePaise, u.netPaise]),
        [[10000, 10001, -1], [1, 0, 1]]);
    assert.deepEqual(records, before);
});

test('retains deleted participant IDs and reports unresolved references', async t => {
    setup(t, { records: [row({ splitBetween: [A, C] })] });
    const { body } = await call('getGroupExpenses');
    assert.deepEqual(body.expenses[0].splitBetween[1], { _id: C, unresolved: true });
    assert.deepEqual(body.summary.unresolvedUserIds, [C]);
    assert.equal(body.summary.users.find(u => u.userId === C).sharePaise, 5000);
});

test('resolves former members without filtering historical participants or exposing emails', async t => {
    setup(t, { records: [row({ paidBy: C, splitBetween: [A, C] })], users: [
        { _id: A, username: 'Owner' }, { _id: B, username: 'Admin' }, { _id: C, username: 'Former' }
    ] });
    const { body } = await call('getGroupExpenses');
    assert.equal(body.expenses[0].paidBy.username, 'Former');
    assert.deepEqual(body.summary.unresolvedUserIds, []);
    assert.equal(body.summary.users.find(u => u.userId === C).netPaise, 5000);
});

for (const overrides of [{ amount: -1 }, { splitBetween: [] }, { splitBetween: [A, A] }, { paidBy: null }, { splitBetween: [null] }]) {
    test(`invalid historical record remains readable with explicit calculation error: ${JSON.stringify(overrides)}`, async t => {
        setup(t, { records: [row(overrides)] });
        const { status, body } = await call('getGroupExpenses');
        assert.equal(status, 200);
        assert.equal(body.expenses.length, 1);
        assert.equal(body.summary, null);
        assert.equal(body.calculationError.code, 'INVALID_EXPENSE_DATA');
        assert.match(body.calculationError.message, /index 0/);
        assert.equal(Expense.create.mock.callCount(), 0);
    });
}

test('getGroups requests only member usernames', async t => {
    t.mock.method(Group, 'find', filter => ({ populate(path, fields) {
        assert.deepEqual(filter, { members: A });
        assert.equal(path, 'members');
        assert.equal(fields, 'username');
        return Promise.resolve([{ _id: G, members: [{ _id: A, username: 'Owner' }] }]);
    } }));
    let body;
    await getGroups({ user: { id: A } }, { status(code) { assert.equal(code, 200); return this; }, json(value) { body = value; } });
    assert.equal(body.groups[0].members[0].username, 'Owner');
});

test('retrieval handles real ObjectIds and allocates a three-way remainder exactly', async t => {
    const mongoose = require('mongoose');
    setup(t, { records: [row({ paidBy: new mongoose.Types.ObjectId(A), splitBetween: [C, B, A] })] });
    // A lean MongoDB result retains ObjectId objects (structuredClone does not).
    t.mock.method(Expense, 'find', () => ({ lean: async () => [row({
        paidBy: new mongoose.Types.ObjectId(A),
        splitBetween: [C, B, A].map(id => new mongoose.Types.ObjectId(id))
    })] }));
    const { body } = await call('getGroupExpenses');
    assert.equal(body.expenses[0].paidBy.username, 'Owner');
    assert.deepEqual(body.summary.allocations[0].shares.map(s => s.sharePaise), [3334, 3333, 3333]);
    assert.equal(body.summary.users.reduce((sum, u) => sum + u.netPaise, 0), 0);
});

test('empty group expenses return zero balances for current members', async t => {
    setup(t);
    const { body } = await call('getGroupExpenses');
    assert.deepEqual(body.expenses, []);
    assert.equal(body.summary.totalAmountPaise, 0);
    assert.deepEqual(body.summary.users.map(u => u.netPaise), [0, 0]);
});
