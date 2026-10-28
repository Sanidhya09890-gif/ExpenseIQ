'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { amountToPaise, splitExpense, calculateGroupSummary } = require('../src/utils/expenseCalculations');
const A = '000000000000000000000001';
const B = '000000000000000000000002';
const C = '000000000000000000000003';
const expense = (amount = '100', paidBy = A, splitBetween = [A, B]) => ({ amount, paidBy, splitBetween });
const shares = record => splitExpense(record).shares.map(s => s.sharePaise);

test('converts valid rupee amounts exactly', () => {
    for (const [input, expected] of [['0.01', 1], [100, 10000], ['1.10', 110], [0.29, 29], ['90071992547409.91', Number.MAX_SAFE_INTEGER]]) {
        assert.equal(amountToPaise(input), expected);
    }
});

test('rejects invalid amounts and unsafe ranges', () => {
    for (const input of [0, -1, NaN, Infinity, null, undefined, {}, '', ' 1 ', '1e2', '1.001', 0.1 + 0.2, '90071992547409.92']) {
        assert.throws(() => amountToPaise(input));
    }
});

test('two-member and exact three-member splits', () => {
    assert.deepEqual(shares(expense()), [5000, 5000]);
    assert.deepEqual(shares(expense('90', A, [A, B, C])), [3000, 3000, 3000]);
});

test('100 rupees across three members allocates the remainder by ID', () => {
    assert.deepEqual(shares(expense('100', A, [C, B, A])), [3334, 3333, 3333]);
});

test('one paisa across three members preserves zero shares', () => {
    assert.deepEqual(shares(expense('0.01', C, [C, A, B])), [1, 0, 0]);
});

test('different payers receive the credit; payer need not be a participant', () => {
    const result = calculateGroupSummary([expense('100', C)], { knownUsers: [A, B, C] });
    assert.deepEqual(result.users.map(u => [u.paidPaise, u.sharePaise, u.netPaise, u.status]),
        [[0, 5000, -5000, 'owes'], [0, 5000, -5000, 'owes'], [10000, 0, 10000, 'receives']]);
    assert.equal(calculateGroupSummary([expense('100', B)]).users.find(u => u.userId === B).paidPaise, 10000);
});

test('combines expenses and includes inactive known members', () => {
    const result = calculateGroupSummary([expense('100'), expense('60', B)], { knownUsers: [A, B, C] });
    assert.equal(result.totalAmountPaise, 16000);
    assert.deepEqual(result.users.map(u => u.netPaise), [2000, -2000, 0]);
});

test('historical self-only expenses remain self-only', () => {
    const result = calculateGroupSummary([expense('2000', A, [A])], { knownUsers: [A, B] });
    assert.deepEqual(result.users.map(u => [u.paidPaise, u.sharePaise, u.netPaise]), [[200000, 200000, 0], [0, 0, 0]]);
});

test('rejects empty, duplicate, and malformed participant lists', () => {
    for (const list of [[], [A, A], null, 'invalid', ['bad'], [null]]) {
        assert.throws(() => splitExpense(expense('10', A, list)));
    }
    const uppercase = 'ABCDEF000000000000000001';
    assert.throws(() => splitExpense(expense('10', A, [uppercase, uppercase.toLowerCase()])));
});

test('rejects missing payers and malformed expense records with index context', () => {
    for (const record of [null, [], {}, expense('10', null), expense('10', 'bad'), expense('10', {})]) {
        assert.throws(() => calculateGroupSummary([expense(), record]), /index 1/);
    }
    assert.throws(() => calculateGroupSummary(null));
    assert.throws(() => calculateGroupSummary([], { knownUsers: null }));
});

test('preserves unresolved historical IDs and reports them explicitly', () => {
    const result = calculateGroupSummary([expense('10', C)], { knownUsers: [A, B] });
    assert.deepEqual(result.unresolvedUserIds, [C]);
    assert.equal(result.users.find(u => u.userId === C).paidPaise, 1000);
    assert.deepEqual(splitExpense(expense()).unresolvedUserIds, [A, B]);
    assert.deepEqual(splitExpense(expense('10', { _id: A, username: 'Owner' }, [A, { _id: B, username: 'Member' }])).unresolvedUserIds, []);
    // A populated null has already lost its identifier: reject rather than omit it.
    assert.throws(() => splitExpense(expense('10', A, [null])), /identifier unavailable/);
});

test('accepts ObjectId-like references and populated users without mutation', () => {
    const oid = Object.freeze({ toHexString: () => A });
    const participants = Object.freeze([Object.freeze({ _id: B, username: 'Member' }), oid]);
    const record = Object.freeze(expense('1', oid, participants));
    const users = Object.freeze([oid, B]);
    assert.deepEqual(calculateGroupSummary(Object.freeze([record]), { knownUsers: users }).unresolvedUserIds, []);
    assert.equal(participants[0]._id, B);
});

test('remainder allocation is independent of participant order', () => {
    const expected = splitExpense(expense('100', A, [A, B, C])).shares;
    for (const ids of [[C, B, A], [B, A, C], [A, C, B]]) {
        assert.deepEqual(splitExpense(expense('100', A, ids)).shares, expected);
    }
});

test('conserves amounts and zero-sum balances over many allocations', () => {
    const records = Array.from({ length: 150 }, (_, i) => expense(((i + 1) / 100).toFixed(2), [A, B, C][i % 3], [C, A, B]));
    const result = calculateGroupSummary(records);
    for (const allocation of result.allocations) {
        assert.equal(allocation.shares.reduce((sum, s) => sum + s.sharePaise, 0), allocation.amountPaise);
    }
    assert.equal(result.users.reduce((sum, u) => sum + u.paidPaise, 0), result.totalAmountPaise);
    assert.equal(result.users.reduce((sum, u) => sum + u.sharePaise, 0), result.totalAmountPaise);
    assert.equal(result.users.reduce((sum, u) => sum + u.netPaise, 0), 0);
    assert(result.users.every(u => Number.isSafeInteger(u.netPaise)));
});

test('rejects aggregate overflow and handles empty groups', () => {
    assert.throws(() => calculateGroupSummary([expense('90071992547409.91'), expense('0.01')]), /safe integer/);
    assert.deepEqual(calculateGroupSummary([]), { totalAmountPaise: 0, users: [], allocations: [], unresolvedUserIds: [] });
});
