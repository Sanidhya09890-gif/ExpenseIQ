'use strict';
// Default: READ ONLY. Index creation requires an explicit --create-index action.
const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '../.env'), quiet: true });
const mongoose = require('mongoose');
const GroupInvite = require('../src/models/groupInvite.model');
const { inspectTopology } = require('../src/services/groupTransactions');

async function audit() {
    if (!process.env.MONGO_URI) throw Error('No application database configured');
    await mongoose.connect(process.env.MONGO_URI, { autoIndex: false, serverSelectionTimeoutMS: 5000 });
    const topology = await inspectTopology();
    const duplicates = await GroupInvite.aggregate([
        { $match: { status: 'pending' } },
        { $group: { _id: { groupId: '$groupId', invitee: '$invitee' }, count: { $sum: 1 } } },
        { $match: { count: { $gt: 1 } } }, { $count: 'pairs' }
    ]);
    const duplicatePairs = duplicates[0]?.pairs || 0;
    console.log(JSON.stringify({ ...topology, duplicatePendingPairs: duplicatePairs }));
    if (process.argv.includes('--create-index')) {
        if (duplicatePairs) throw Error('Duplicate pending records must be reviewed before creating the index');
        await GroupInvite.collection.createIndex({ groupId: 1, invitee: 1 }, {
            name: 'unique_pending_group_invitee', unique: true, partialFilterExpression: { status: 'pending' }
        });
        console.log('Pending invitation unique index created');
    }
}
const deadline = setTimeout(() => {
    console.error('Read-only audit timed out; database topology and duplicate state remain unverified.');
    process.exit(1);
}, 15000);
audit().catch(error => {
    // Never print connection strings, server addresses, or credential-bearing errors.
    console.error('Audit could not complete. Check database connectivity, transaction support, and duplicate pending records.');
    if (error.code) console.error('Error code:', error.code);
    process.exitCode = 1;
}).finally(async () => { await mongoose.disconnect(); clearTimeout(deadline); });
