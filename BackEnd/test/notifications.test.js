'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Notification = require('../src/models/notification.model');
const { markAsRead } = require('../src/controllers/notification.controller');
const routes = require('../src/routes/notification.routes');
const auth = require('../src/middleware/auth.middleware');
const jwt = require('jsonwebtoken');
const id = n => n.toString(16).padStart(24, '0');
async function request(body, user = 'owner') {
    const result = {};
    await markAsRead({ body, user: { id: user } }, {
        status(code) { result.status = code; return this; }, json(body) { result.body = body; return this; }
    });
    return result;
}

test('mark read is recipient-scoped, activity-only, and idempotent', async t => {
    const records = [
        { _id: id(1), recipient: 'owner', type: 'INVITE_ACCEPTED', isRead: false },
        { _id: id(2), recipient: 'other', type: 'INVITE_REJECTED', isRead: false },
        { _id: id(3), recipient: 'owner', type: 'INVITE_RECEIVED', isRead: false },
        { _id: id(4), recipient: 'owner', type: 'INVITE_REJECTED', isRead: true }
    ];
    t.mock.method(Notification, 'updateMany', async (filter, update) => {
        assert.equal(filter.recipient, 'owner'); assert.equal(filter.isRead, false);
        assert.deepEqual(filter.type.$in, ['INVITE_ACCEPTED', 'INVITE_REJECTED']);
        assert.deepEqual(update, { $set: { isRead: true } });
        let modifiedCount = 0;
        for (const n of records) if (filter._id.$in.includes(n._id) && n.recipient === filter.recipient &&
            filter.type.$in.includes(n.type) && n.isRead === false) { n.isRead = true; modifiedCount++; }
        return { modifiedCount };
    });
    const body = { notificationIds: records.map(n => n._id) };
    assert.deepEqual(await request(body), { status: 200, body: { modifiedCount: 1 } });
    assert.deepEqual(await request(body), { status: 200, body: { modifiedCount: 0 } });
    assert.equal(records[1].isRead, false); assert.equal(records[2].isRead, false);
});

test('rejects missing, malformed, duplicate and oversized ID arrays without writes', async t => {
    const update = t.mock.method(Notification, 'updateMany', () => { throw Error('Unexpected write'); });
    for (const notificationIds of [undefined, null, [], 'id', ['bad'], [null], [id(1), id(1)],
        ['abcdef000000000000000001', 'ABCDEF000000000000000001'], Array.from({ length: 101 }, (_, i) => id(i))]) {
        assert.equal((await request({ notificationIds })).status, 400);
    }
    assert.equal((await request(undefined)).status, 400);
    assert.equal(update.mock.callCount(), 0);
});

test('read endpoint requires existing JWT middleware; missing/invalid tokens cannot proceed', t => {
    const route = routes.stack.find(layer => layer.route?.path === '/read').route;
    assert.equal(route.methods.patch, true);
    assert.equal(route.stack[0].handle, auth);
    assert.equal(route.stack[1].handle, markAsRead);
    t.mock.method(jwt, 'verify', () => { throw Error('Invalid token'); });
    for (const headers of [{}, { authorization: 'invalid' }]) {
        let status, advanced = false;
        const logger = t.mock.method(console, 'log', () => {});
        auth({ headers }, { status(code) { status = code; return this; }, json() {} }, () => { advanced = true; });
        assert.equal(status, 401); assert.equal(advanced, false); logger.mock.restore();
    }
});

test('database errors return a controlled failure', async t => {
    t.mock.method(Notification, 'updateMany', async () => { throw Error('Database failure'); });
    assert.equal((await request({ notificationIds: [id(1)] })).status, 500);
});
