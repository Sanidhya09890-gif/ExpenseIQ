'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { validatePrerequisites } = require('../src/services/signupPrerequisites');
const security = require('../src/services/signupOtpSecurity');
const rate = require('../src/services/signupRateLimiter');
const { usernameIndex } = require('../src/utils/usernamePolicy');
function fixture() {
    const username = usernameIndex();
    const indexes = {
        users: [{ key: username.key, ...username.options }, { name: 'email_1', key: { email: 1 }, unique: true }],
        pending: [{ name: 'unique_pending_registration_email', key: { email: 1 }, unique: true },
            { name: 'pending_registration_cleanup', key: { purgeAt: 1 }, expireAfterSeconds: 0 }],
        limits: [{ name: 'signup_limit_cleanup', key: { purgeAt: 1 }, expireAfterSeconds: 0 }]
    };
    const calls = [];
    const model = name => ({ collection: { indexes: async () => { calls.push(name); return indexes[name]; } } });
    return { indexes, calls, options: { Users: model('users'), Pending: model('pending'), Limits: model('limits'),
        config: () => ({ secret: 'test-only-secret' }), ratePolicy: () => rate.policy({}),
        transactions: { inspectTopology: async () => { calls.push('topology'); } } } };
}
test('read-only prerequisites accept exact indexes and inspect topology without invoking writes or email', async () => {
    const f = fixture();
    assert.deepEqual(await validatePrerequisites(f.options), { secret: 'test-only-secret' });
    assert.deepEqual(f.calls, ['pending', 'limits', 'users', 'topology']);
});
test('missing HMAC, provider configuration and invalid rate policy fail before database access', async () => {
    const valid = { OTP_HMAC_SECRET: 'a'.repeat(32), JWT_SECRET: 'different', EMAIL_PROVIDER: 'brevo',
        BREVO_API_KEY: 'mock-key', BREVO_SENDER_EMAIL: 'sender@example.test', BREVO_SENDER_NAME: 'ExpenseIQ' };
    for (const change of [{ OTP_HMAC_SECRET: undefined }, { OTP_HMAC_SECRET: 'short' },
        { JWT_SECRET: valid.OTP_HMAC_SECRET }, { BREVO_API_KEY: undefined }, { BREVO_SENDER_EMAIL: 'invalid' },
        { BREVO_SENDER_NAME: '' }]) {
        const f = fixture(); f.options.config = () => security.configuration({ ...valid, ...change });
        await assert.rejects(validatePrerequisites(f.options)); assert.deepEqual(f.calls, []);
    }
    const f = fixture(); f.options.ratePolicy = () => rate.policy({ SIGNUP_RATE_LIMIT_POLICY: 'unlimited' });
    await assert.rejects(validatePrerequisites(f.options)); assert.deepEqual(f.calls, []);
    assert.equal(security.configuration(valid).secret, valid.OTP_HMAC_SECRET);
});
test('missing collections and altered exact index specifications fail closed', async () => {
    const mutations = [
        f => { f.indexes.pending = []; },
        f => { f.indexes.users[1].unique = false; },
        f => { f.indexes.pending[1].key.extra = 1; },
        f => { f.indexes.pending[1].expireAfterSeconds = 60; },
        f => { f.indexes.limits[0].name = 'wrong'; },
        f => { f.indexes.limits[0].hidden = true; },
        f => { f.indexes.pending[0].sparse = true; },
        f => { f.indexes.users[0].partialFilterExpression = { username: { $exists: true } }; },
        f => { f.indexes.users[1].collation = { locale: 'en', strength: 2 }; }
    ];
    for (const change of mutations) { const f = fixture(); change(f);
        await assert.rejects(validatePrerequisites(f.options)); assert.ok(!f.calls.includes('topology')); }
    const f = fixture(); f.options.Pending.collection.indexes = async () => { throw Error('namespace unavailable'); };
    await assert.rejects(validatePrerequisites(f.options));
});
test('transaction prerequisite failure is propagated without writes', async () => {
    const f = fixture(); f.options.transactions.inspectTopology = async () => { throw Error('unsupported topology'); };
    await assert.rejects(validatePrerequisites(f.options));
});
async function startup(flag, failure) {
    const events = [], logs = []; let exitCode;
    const modules = { 'node:dns': { setServers() {} }, dotenv: { config() {} },
        './src/app': { listen(port, callback) { events.push('listen'); callback(); return { on() {} }; } },
        './src/Config/db': async () => { events.push('connect'); },
        mongoose: { disconnect: async () => { events.push('disconnect'); } },
        './src/services/serverLifecycle': () => {},
        './src/services/signupPrerequisites': { validatePrerequisites: async () => {
            events.push('validate'); if (failure) throw Error('sensitive error must not appear');
        } } };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8'), {
        require: name => { assert.ok(modules[name]); return modules[name]; },
        process: { env: { SIGNUP_EMAIL_OTP_ENABLED: flag }, set exitCode(v) { exitCode = v; } },
        console: { log: v => logs.push(v), error: v => logs.push(v) }
    });
    await new Promise(resolve => setImmediate(resolve)); return { events, logs, exitCode };
}
test('startup validates after connection and before listen, with fixed PASS output', async () => {
    const r = await startup('true', false);
    assert.deepEqual(r.events, ['connect', 'validate', 'listen']);
    assert.equal(r.logs.filter(v => v.startsWith('OTP')).join(), 'OTP prerequisites: PASS');
});
test('failed startup logs only fixed FAIL, disconnects and never listens', async () => {
    const r = await startup('true', true);
    assert.deepEqual(r.events, ['connect', 'validate', 'disconnect']);
    assert.deepEqual(r.logs, ['OTP prerequisites: FAIL']); assert.equal(r.exitCode, 1);
});
test('disabled startup skips OTP checks and preserves HTTP startup', async () => {
    for (const flag of [undefined, 'false', 'TRUE']) {
        const r = await startup(flag, true); assert.deepEqual(r.events, ['connect', 'listen']);
        assert.ok(!r.logs.some(v => v.startsWith('OTP')));
    }
});
