'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const app = require('../src/app');
const guard = require('../src/middleware/maintenance.middleware');
const User = require('../src/models/user.model');

function lock(t, value) {
    const previous = process.env.MAINTENANCE_WRITE_LOCK;
    t.after(() => { if (previous === undefined) delete process.env.MAINTENANCE_WRITE_LOCK;
        else process.env.MAINTENANCE_WRITE_LOCK = previous; });
    if (value === undefined) delete process.env.MAINTENANCE_WRITE_LOCK;
    else process.env.MAINTENANCE_WRITE_LOCK = value;
}
async function listen(t) {
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
    return `http://127.0.0.1:${server.address().port}`;
}

test('all protected write mounts return maintenance before body parsing or handlers', async t => {
    lock(t, 'true');
    t.mock.method(User, 'findOne', () => { assert.fail('blocked request reached database handler'); });
    const url = await listen(t);
    for (const path of ['/api/groups/create', '/api/groups/g/invite', '/api/groups/invites/i/accept',
        '/api/groups/invites/i/reject', '/api/groups/delete/g', '/api/expenses/add',
        '/api/auth/signup', '/api/notifications/read']) {
        for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
            const response = await fetch(url + path, { method, headers: { 'Content-Type': 'application/json' }, body: '{' });
            assert.equal(response.status, 503, `${method} ${path}`);
            assert.equal(response.headers.get('retry-after'), '120');
            assert.deepEqual(await response.json(), { message: 'ExpenseIQ is undergoing maintenance. Please try again shortly.' });
        }
    }
});

test('lock requires exact true; allowed methods reach next; blocked methods never do', t => {
    lock(t, undefined);
    for (const value of [undefined, '', 'false', 'TRUE', '1', 'true ', 'true']) {
        if (value === undefined) delete process.env.MAINTENANCE_WRITE_LOCK;
        else process.env.MAINTENANCE_WRITE_LOCK = value;
        for (const method of ['GET', 'HEAD', 'OPTIONS', 'POST', 'PUT', 'PATCH', 'DELETE']) {
            let calls = 0;
            guard({ method }, { set() {}, status(code) { assert.equal(code, 503); return this; }, json() {} }, () => calls++);
            assert.equal(calls, value === 'true' && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) ? 0 : 1);
        }
    }
});

test('login contract, authenticated reads and CORS remain available while locked', async t => {
    lock(t, 'true');
    t.mock.method(User, 'findOne', async () => null);
    const url = await listen(t);
    const login = await fetch(url + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(login.status, 400);
    assert.deepEqual(await login.json(), { message: 'Invalid username/email or password' });
    for (const method of ['GET', 'HEAD']) assert.equal((await fetch(url + '/api/groups', { method })).status, 401);
    assert.equal((await fetch(url + '/api/groups', { method: 'OPTIONS', headers: { Origin: 'https://example.test', 'Access-Control-Request-Method': 'POST' } })).status, 204);
    assert.equal((await fetch(url + '/api/groups-other', { method: 'POST' })).status, 404);
});

test('unset lock preserves production signup response and route handling', async t => {
    lock(t, undefined);
    t.mock.method(User, 'findOne', async () => ({ _id: 'test-only' }));
    const url = await listen(t);
    const response = await fetch(url + '/api/auth/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { message: 'User already exists' });
});
