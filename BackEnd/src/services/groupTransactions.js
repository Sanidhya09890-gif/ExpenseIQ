'use strict';
const mongoose = require('mongoose');

class ApiError extends Error {
    constructor(status, message, code) { super(message); this.status = status; this.code = code; }
}

async function inspectTopology(connection = mongoose.connection) {
    if (connection.readyState !== 1) throw new ApiError(503, 'Database is not connected', 'TRANSACTIONS_UNAVAILABLE');
    const hello = await connection.db.admin().command({ hello: 1 });
    const supported = Boolean(hello.logicalSessionTimeoutMinutes != null &&
        ((hello.setName && hello.maxWireVersion >= 7) || (hello.msg === 'isdbgrid' && hello.maxWireVersion >= 8)));
    if (!supported) throw new ApiError(503, 'Group writes require a transaction-capable replica set or sharded MongoDB deployment', 'TRANSACTIONS_UNAVAILABLE');
    return { transactionsSupported: true };
}

async function run(work) {
    await inspectTopology();
    try {
        return await mongoose.connection.transaction(work, {
            readPreference: 'primary', readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' }
        });
    } catch (error) {
        if (error.code === 20 || error.code === 303) {
            throw new ApiError(503, 'MongoDB transactions are unavailable; no fallback write was attempted', 'TRANSACTIONS_UNAVAILABLE');
        }
        throw error;
    }
}

function validId(value) { return typeof value === 'string' && /^[a-fA-F0-9]{24}$/.test(value); }
function requireId(value, name) {
    if (!validId(value)) throw new ApiError(400, `Invalid ${name}`);
    return value.toLowerCase();
}
function respondError(res, error) {
    if (error instanceof ApiError) return res.status(error.status).json({ message: error.message, code: error.code });
    if (error.code === 11000) return res.status(409).json({ message: 'A pending invitation already exists' });
    return res.status(500).json({ message: 'Unable to complete group operation' });
}
module.exports = { ApiError, inspectTopology, run, validId, requireId, respondError };
