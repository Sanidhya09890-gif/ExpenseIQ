'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const User = require('../src/models/user.model');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { login, signup } = require('../src/controllers/auth.controller');

async function request(controller, body) {
    const result = {};
    await controller({ body }, { status(code) { result.status = code; return this; }, json(value) { result.body = value; } });
    return result;
}
const storedUser = { _id: '000000000000000000000001', username: 'Owner', email: 'owner@example.test',
    password: 'test-hash-must-never-be-returned', __v: 7, internalFlag: true, resetToken: 'private-test-token' };

test('login explicitly allowlists safe user fields while preserving token and user._id contract', async t => {
    t.mock.method(User, 'findOne', async () => ({ ...storedUser }));
    t.mock.method(bcrypt, 'compare', async (password, hash) => { assert.equal(hash, storedUser.password); return password === 'test-password'; });
    t.mock.method(jwt, 'sign', (payload, secret, options) => {
        assert.equal(payload.id, storedUser._id); assert.equal(options.expiresIn, '7d'); return 'test-jwt';
    });
    const response = await request(login, { loginInput: 'Owner', password: 'test-password' });
    assert.equal(response.status, 200); assert.equal(response.body.token, 'test-jwt');
    assert.deepEqual(response.body.user, { _id: storedUser._id, username: 'Owner', email: 'owner@example.test' });
    assert(!JSON.stringify(response).includes(storedUser.password));
    assert(!JSON.stringify(response).includes(storedUser.resetToken));
    assert.equal(response.body.user.internalFlag, undefined); assert.equal(response.body.user.__v, undefined);
});

test('signup already returns only explicitly allowed fields, never the stored hash', async t => {
    t.mock.method(User, 'findOne', async () => null);
    t.mock.method(bcrypt, 'hash', async () => storedUser.password);
    t.mock.method(User, 'create', async data => { assert.equal(data.password, storedUser.password); return { ...storedUser }; });
    const response = await request(signup, { username: 'Owner', email: 'owner@example.test', password: 'test-password' });
    assert.equal(response.status, 201);
    assert.deepEqual(Object.keys(response.body).sort(), ['email', 'id', 'message', 'username']);
    assert(!JSON.stringify(response).includes(storedUser.password));
});

test('invalid login does not expose stored password or internal user fields', async t => {
    t.mock.method(User, 'findOne', async () => ({ ...storedUser }));
    t.mock.method(bcrypt, 'compare', async () => false);
    const response = await request(login, { loginInput: 'Owner', password: 'incorrect' });
    assert.equal(response.status, 400); assert.deepEqual(Object.keys(response.body), ['message']);
});

for (const status of [undefined, 'legacy', 'legacy_unverified']) {
    test(`OTP-enabled rollout preserves password login for legacy account (${status || 'missing metadata'}) without modifying it`, async t => {
        const previous = process.env.SIGNUP_EMAIL_OTP_ENABLED;
        process.env.SIGNUP_EMAIL_OTP_ENABLED = 'true';
        t.after(() => {
            if (previous === undefined) delete process.env.SIGNUP_EMAIL_OTP_ENABLED;
            else process.env.SIGNUP_EMAIL_OTP_ENABLED = previous;
        });
        const account = { ...storedUser, email: 'inaccessible@example.invalid', emailVerifiedAt: null };
        if (status) account.emailVerificationStatus = status;
        const before = structuredClone(account);
        t.mock.method(User, 'findOne', async () => account);
        t.mock.method(User, 'create', async () => assert.fail('Login must not recreate accounts'));
        t.mock.method(User, 'updateOne', async () => assert.fail('Login must not mark ownership verified'));
        t.mock.method(bcrypt, 'compare', async () => true);
        t.mock.method(jwt, 'sign', payload => { assert.equal(payload.id, storedUser._id); return 'test-jwt'; });
        const result = await request(login, { loginInput: account.username, password: 'test-password' });
        assert.equal(result.status, 200); assert.equal(result.body.user._id, storedUser._id);
        assert.deepEqual(account, before);
    });
}
