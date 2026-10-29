'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const User = require('../src/models/user.model');
const bcrypt = require('bcryptjs');
const { validUsername, usernameIndex, approvedUsernameIndex } = require('../src/utils/usernamePolicy');
const { createService } = require('../src/services/signupRegistration');
const { signup } = require('../src/controllers/auth.controller');
const specification = () => { const { key, options } = usernameIndex(); return { key, ...options }; };

test('username index is partial, case-sensitive and explicit; schema cannot auto-provision it', () => {
    assert.deepEqual(specification(), { key: { username: 1 }, name: 'unique_username_string', unique: true,
        partialFilterExpression: { username: { $type: 'string' } }, collation: { locale: 'simple' } });
    assert.equal(User.schema.options.autoIndex, false);
    const indexes = User.schema.indexes().filter(([key]) => key.username);
    assert.equal(indexes.length, 1);
    assert.equal(indexes[0][1].name, 'unique_username_string');
    assert.equal(User.schema.path('username').options.unique, undefined);
});
test('new usernames retain exact case and valid syntax; empty/null/missing/objects are rejected', () => {
    for (const name of ['Owner', 'owner', 'Member_1', 'a.b-c']) assert(validUsername(name));
    for (const name of [undefined, null, '', 'ab', 'a'.repeat(41), ' padded ', '<script>', 123, { $ne: null }]) {
        assert(!validUsername(name));
    }
});
test('new User documents require usernames; hydrated missing/null legacy usernames stay untouched and remain valid', async () => {
    for (const username of [undefined, null, '', 'invalid name']) {
        const data = { _id: '000000000000000000000001', email: 'legacy@example.test', password: 'unchanged-hash',
            ...(username === undefined ? {} : { username }) };
        const legacy = User.hydrate(data);
        const before = legacy.toObject(); await legacy.validate();
        assert.deepEqual(legacy.toObject(), before);
        const fresh = new User({ ...data, _id: undefined });
        await assert.rejects(fresh.validate());
        legacy.username = 'still invalid'; await assert.rejects(legacy.validate());
    }
});
test('readiness matcher accepts only the exact approved partial policy with simple collation', () => {
    const valid = specification(); assert(approvedUsernameIndex(valid));
    const { collation, ...implicitSimple } = valid; assert(approvedUsernameIndex(implicitSimple));
    for (const changes of [{ name: 'username_1' }, { unique: false }, { key: { username: 1, email: 1 } },
        { partialFilterExpression: undefined }, { partialFilterExpression: { username: { $exists: true } } },
        { partialFilterExpression: { username: { $type: 2 } } },
        { partialFilterExpression: { username: { $type: 'string' }, active: true } },
        { partialFilterExpression: { username: { $type: 'string', $gt: '' } } },
        { sparse: true }, { hidden: true }, { collation: { locale: 'en', strength: 2 } }]) {
        assert(!approvedUsernameIndex({ ...valid, ...changes }));
    }
});
test('OTP readiness accepts approved partial index and rejects the old full index before writes', async () => {
    const email = { name: 'email_1', key: { email: 1 }, unique: true };
    const ttl = { name: 'pending_registration_cleanup', key: { purgeAt: 1 }, expireAfterSeconds: 0 };
    for (const index of [specification(), { key: { username: 1 }, name: 'username_1', unique: true }]) {
        let checks = 0, limits = 0;
        const service = createService({
            Pending: { collection: { indexes: async () => [{ ...email, name: 'unique_pending_registration_email' }, ttl] } },
            Limits: { collection: { indexes: async () => [{ ...ttl, name: 'signup_limit_cleanup' }] } },
            Users: { collection: { indexes: async () => [email, index] }, findOne: async () => ({ _id: 'existing' }) },
            transactions: { inspectTopology: async () => checks++ },
            config: () => ({ secret: 'mock-only' }), consume: async () => limits++,
            sendEmail: async () => assert.fail('Readiness test must not send email')
        });
        await assert.rejects(service.start({ username: 'Member', email: 'member@example.test', password: 'test-only-password' }, 'ip'),
            error => error.code === (index.name === 'unique_username_string' ? 'REGISTRATION_UNAVAILABLE' : 'SIGNUP_UNAVAILABLE'));
        assert.equal(checks, index.name === 'unique_username_string' ? 1 : 0);
        assert.equal(limits, index.name === 'unique_username_string' ? 3 : 0);
    }
});
test('flag-disabled signup also rejects invalid new usernames before querying or creating accounts', async t => {
    const previous = process.env.SIGNUP_EMAIL_OTP_ENABLED; delete process.env.SIGNUP_EMAIL_OTP_ENABLED;
    t.after(() => { if (previous === undefined) delete process.env.SIGNUP_EMAIL_OTP_ENABLED; else process.env.SIGNUP_EMAIL_OTP_ENABLED = previous; });
    t.mock.method(User, 'findOne', async () => assert.fail('Invalid username must not reach database'));
    t.mock.method(User, 'create', async () => assert.fail('Invalid username must not create User'));
    for (const username of [undefined, null, '', 'xx', { $ne: null }]) {
        let status;
        await signup({ body: { username, email: 'member@example.test', password: 'test-only-password' } }, {
            status(code) { status = code; return this; }, json() {}
        });
        assert.equal(status, 400);
    }
});
test('a concurrent duplicate in legacy-mode signup returns a safe validation error rather than MongoDB details', async t => {
    const previous = process.env.SIGNUP_EMAIL_OTP_ENABLED; delete process.env.SIGNUP_EMAIL_OTP_ENABLED;
    t.after(() => { if (previous === undefined) delete process.env.SIGNUP_EMAIL_OTP_ENABLED; else process.env.SIGNUP_EMAIL_OTP_ENABLED = previous; });
    t.mock.method(User, 'findOne', async () => null);
    t.mock.method(bcrypt, 'hash', async () => 'mock-hash');
    t.mock.method(User, 'create', async () => { throw Object.assign(Error('private database duplicate details'), { code: 11000 }); });
    let status, body;
    await signup({ body: { username: 'Member', email: 'member@example.test', password: 'test-only-password' } }, {
        status(code) { status = code; return this; }, json(value) { body = value; }
    });
    assert.equal(status, 400); assert.deepEqual(body, { message: 'Username or email is already registered' });
});
