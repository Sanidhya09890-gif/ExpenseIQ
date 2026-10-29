'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const User = require('../src/models/user.model');
const app = require('../src/app');
const guard = require('../src/middleware/maintenance.middleware');
const installShutdown = require('../src/services/serverLifecycle');

function setLock(t, value) {
    const previous = process.env.MAINTENANCE_WRITE_LOCK;
    t.after(() => {
        if (previous === undefined) delete process.env.MAINTENANCE_WRITE_LOCK;
        else process.env.MAINTENANCE_WRITE_LOCK = previous;
    });
    if (value === undefined) delete process.env.MAINTENANCE_WRITE_LOCK;
    else process.env.MAINTENANCE_WRITE_LOCK = value;
}

async function listen(t, application) {
    const server = application.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
    return `http://127.0.0.1:${server.address().port}`;
}

test('maintenance blocks actual mounted write routes before their handlers', async t => {
    setLock(t, 'true');
    const url = await listen(t, app);
    for (const path of ['/api/groups/create', '/api/groups/g/invite', '/api/groups/g/leave',
        '/api/groups/g/members/m', '/api/groups/invites/i/accept', '/api/groups/invites/i/reject',
        '/api/groups/delete/g', '/api/expenses/add', '/api/auth/signup', '/api/auth/signup/verify',
        '/api/auth/signup/resend', '/api/notifications/read']) {
        for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
            const response = await fetch(url + path, { method });
            assert.equal(response.status, 503, `${method} ${path}`);
            assert.equal(response.headers.get('retry-after'), '120');
            assert.match((await response.json()).message, /maintenance/i);
        }
    }
    // Invalid JSON never reaches the body parser or signup handler.
    assert.equal((await fetch(url + '/api/auth/signup', { method: 'POST',
        headers: { 'Content-Type': 'application/json' }, body: '{' })).status, 503);
    assert.equal((await fetch(url + '/api/groups', { method: 'OPTIONS',
        headers: { Origin: 'https://expenseiq-tracker-app.netlify.app', 'Access-Control-Request-Method': 'POST' } })).status, 204);
    assert.equal((await fetch(url + '/api/groups')).status, 401);
});

test('only exact true blocks mutations; reads, HEAD, OPTIONS and login remain allowed', t => {
    setLock(t, undefined);
    for (const value of ['', 'false', 'TRUE', '1', 'true ', 'true']) {
        process.env.MAINTENANCE_WRITE_LOCK = value;
        for (const method of ['GET', 'HEAD', 'OPTIONS', 'POST', 'PUT', 'PATCH', 'DELETE']) {
            let reached = false, status;
            guard({ method }, { set() {}, status(code) { status = code; return this; }, json() {} }, () => { reached = true; });
            const blocked = value === 'true' && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
            assert.equal(reached, !blocked);
            assert.equal(status, blocked ? 503 : undefined);
        }
    }
});

test('login is outside guard mount; default-disabled signup reaches validation', async t => {
    t.mock.method(User, 'findOne', async () => ({ _id: 'test-only' }));
    setLock(t, 'true');
    const url = await listen(t, app);
    const login = await fetch(url + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.notEqual(login.status, 503);
    delete process.env.MAINTENANCE_WRITE_LOCK;
    const signup = await fetch(url + '/api/auth/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.notEqual(signup.status, 503);
});

test('readiness reflects database connection and shutdown without sensitive information', async t => {
    const original = mongoose.connection.readyState;
    t.after(() => { mongoose.connection.readyState = original; delete app.locals.shuttingDown; });
    const url = await listen(t, app);
    for (const [state, stopping, expected] of [[0, false, 503], [1, false, 200], [1, true, 503]]) {
        mongoose.connection.readyState = state; app.locals.shuttingDown = stopping;
        const response = await fetch(url + '/readyz');
        assert.equal(response.status, expected);
        assert.equal(response.headers.get('cache-control'), 'no-store');
        assert.deepEqual(await response.json(), { status: expected === 200 ? 'ready' : 'unavailable' });
    }
    assert.equal((await fetch(url + '/readyz', { method: 'HEAD' })).status, 503);
});

test('shutdown drains HTTP before disconnecting database; signals are idempotent', async () => {
    const events = [], signals = {}, application = { locals: {} };
    let closeCallback, deadline;
    const shutdown = installShutdown({ close(cb) { events.push('close'); closeCallback = cb; },
        closeIdleConnections() { events.push('idle'); } }, application,
    { async disconnect() { events.push('disconnect'); } },
    { on(signal, cb) { signals[signal] = cb; }, exit(code) { events.push(`exit:${code}`); } },
    { setTimeout(cb, ms) { assert.equal(ms, 25000); deadline = cb; return { unref() {} }; }, clearTimeout() { events.push('clear'); } });
    signals.SIGTERM(); signals.SIGINT();
    assert.equal(application.locals.shuttingDown, true);
    assert.deepEqual(events, ['close', 'idle']);
    await closeCallback();
    assert.deepEqual(events, ['close', 'idle', 'disconnect', 'clear', 'exit:0']);
    assert.equal(typeof deadline, 'function'); assert.equal(shutdown, signals.SIGTERM);
});

test('shutdown deadline forcibly closes connections and fails safely', () => {
    let timeout, exited, forced = false;
    const shutdown = installShutdown({ close() {}, closeAllConnections() { forced = true; } }, { locals: {} }, {},
        { on() {}, exit(code) { exited = code; } },
        { setTimeout(cb) { timeout = cb; return { unref() {} }; }, clearTimeout() {} });
    shutdown(); timeout();
    assert.equal(forced, true); assert.equal(exited, 1);
});
