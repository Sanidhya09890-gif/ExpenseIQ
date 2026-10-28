'use strict';

const MAX = BigInt(Number.MAX_SAFE_INTEGER);

function safeNumber(value) {
    if (value > MAX || value < -MAX) throw new RangeError('Paise total exceeds safe integer range');
    return Number(value);
}

/** Positive INR number or plain decimal string, with at most two decimal places. */
function amountToPaise(amount) {
    if (typeof amount !== 'string' && typeof amount !== 'number') {
        throw new TypeError('Amount must be a number or decimal string');
    }
    const text = String(amount);
    if (!/^\d+(?:\.\d{1,2})?$/.test(text)) throw new TypeError('Invalid INR amount');
    const [whole, fraction = ''] = text.split('.');
    const paise = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
    if (paise <= 0n) throw new RangeError('Amount must be positive');
    return safeNumber(paise);
}

// Accept stored ObjectIds, JSON IDs, or populated User objects. Never invent IDs.
function userId(reference) {
    let value = reference;
    if (value && typeof value === 'object' && '_id' in value) value = value._id;
    if (value && typeof value.toHexString === 'function') value = value.toHexString();
    if (typeof value !== 'string' || !/^[a-fA-F0-9]{24}$/.test(value)) {
        throw new TypeError('Missing or malformed user ID; original identifier unavailable');
    }
    return value.toLowerCase();
}

/** No database access. Bare IDs require knownUsers to establish resolution. */
function splitExpense(expense, { knownUsers = [] } = {}) {
    if (!expense || typeof expense !== 'object' || Array.isArray(expense)) {
        throw new TypeError('Expense must be an object');
    }
    if (!Array.isArray(knownUsers)) throw new TypeError('knownUsers must be an array');
    const amountPaise = amountToPaise(expense.amount);
    const payerId = userId(expense.paidBy);
    if (!Array.isArray(expense.splitBetween) || expense.splitBetween.length === 0) {
        throw new TypeError('Expense requires a nonempty splitBetween array');
    }
    const participantIds = expense.splitBetween.map(userId);
    if (new Set(participantIds).size !== participantIds.length) {
        throw new TypeError('Duplicate split participants');
    }
    participantIds.sort();
    const count = BigInt(participantIds.length);
    const base = BigInt(amountPaise) / count;
    const remainder = BigInt(amountPaise) % count;
    const shares = participantIds.map((id, index) => ({
        userId: id,
        sharePaise: safeNumber(base + (BigInt(index) < remainder ? 1n : 0n))
    }));
    const resolved = new Set(knownUsers.map(userId));
    for (const ref of [expense.paidBy, ...expense.splitBetween]) {
        if (ref && typeof ref.username === 'string' && ref.username.trim()) resolved.add(userId(ref));
    }
    const unresolvedUserIds = [...new Set([payerId, ...participantIds])]
        .filter(id => !resolved.has(id)).sort();
    return { payerId, amountPaise, shares, unresolvedUserIds };
}

/** Strict, all-or-nothing summary. Invalid historical records throw with their index.
 * knownUsers is an optional authoritative list of existing users (IDs or objects).
 * Users with historical expenses remain in balances even if absent from that list.
 */
function calculateGroupSummary(expenses, { knownUsers = [] } = {}) {
    if (!Array.isArray(expenses)) throw new TypeError('Expenses must be an array');
    if (!Array.isArray(knownUsers)) throw new TypeError('knownUsers must be an array');
    const balances = new Map();
    function ensure(id) {
        if (!balances.has(id)) balances.set(id, { paid: 0n, share: 0n });
        return balances.get(id);
    }
    knownUsers.forEach(ref => ensure(userId(ref)));
    const unresolved = new Set();
    let total = 0n;
    const allocations = expenses.map((expense, index) => {
        let allocation;
        try {
            allocation = splitExpense(expense, { knownUsers });
        } catch (cause) {
            throw new TypeError(`Invalid expense at index ${index}: ${cause.message}`, { cause });
        }
        total += BigInt(allocation.amountPaise);
        ensure(allocation.payerId).paid += BigInt(allocation.amountPaise);
        allocation.shares.forEach(({ userId: id, sharePaise }) => {
            ensure(id).share += BigInt(sharePaise);
        });
        allocation.unresolvedUserIds.forEach(id => unresolved.add(id));
        return allocation;
    });
    const users = [...balances.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
        .map(([id, { paid, share }]) => ({
            userId: id,
            paidPaise: safeNumber(paid),
            sharePaise: safeNumber(share),
            netPaise: safeNumber(paid - share),
            status: paid > share ? 'receives' : paid < share ? 'owes' : 'settled'
        }));
    return { totalAmountPaise: safeNumber(total), users, allocations,
        unresolvedUserIds: [...unresolved].sort() };
}

module.exports = { amountToPaise, splitExpense, calculateGroupSummary };
