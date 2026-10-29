'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('../src/models/user.model');
const Pending = require('../src/models/pendingRegistration.model');
const Limit = require('../src/models/signupRateLimit.model');
const { createService } = require('../src/services/signupRegistration');
const { login } = require('../src/controllers/auth.controller');
const { inspectTopology } = require('../src/services/groupTransactions');
const { approvedUsernameIndex } = require('../src/utils/usernamePolicy');
const Group = require('../src/models/group.model');
const Expense = require('../src/models/expense.model');
const { getGroupExpenses } = require('../src/controllers/expense.controller');
const enabled = Boolean(process.env.EXPENSEIQ_TEST_MONGO_URI && process.env.EXPENSEIQ_TEST_ALLOW_MUTATIONS === '1');

test('isolated signup OTP transactions, concurrency and mocked email', { skip: !enabled, timeout: 120000 }, async t => {
    const uri = process.env.EXPENSEIQ_TEST_MONGO_URI;
    const testHost = new URL(uri).hostname.toLowerCase();
    const prodHost = process.env.MONGO_URI ? new URL(process.env.MONGO_URI).hostname.toLowerCase() : '';
    assert(testHost !== prodHost && testHost !== 'practice-project-1.slsteow.mongodb.net', 'Refusing production cluster');
    const dbName = `expenseiq_test_${process.pid}_${Date.now()}`;
    await mongoose.connect(uri, { dbName, autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 8000 });
    t.after(async () => {
        assert.equal(mongoose.connection.name, dbName);
        await mongoose.connection.dropDatabase();
        await mongoose.disconnect();
    });
    await inspectTopology();
    for (const Model of [User, Pending, Limit, Group, Expense]) await Model.createCollection();
    await t.test('shared-proxy budgets persist and atomically bound rotated identities', async () => {
        const rate = require('../src/services/signupRateLimiter');
        const env = { SIGNUP_RATE_LIMIT_POLICY: 'shared_proxy' };
        const run = identity => rate.throttle('isolated-shared-policy', 'signup', identity, 'shared-peer', 0, rate.consume, env);
        for (let i = 0; i < 5; i++) await run('first@example.test');
        await assert.rejects(run('first@example.test'), e => e.code === 'RATE_LIMITED');
        for (let i = 0; i < 5; i++) await run('second@example.test');
        const results = await Promise.allSettled(Array.from({ length: 15 }, (_, i) => run(`rotated-${i}@example.test`)));
        assert.equal(results.filter(r => r.status === 'fulfilled').length, 10);
        assert.equal(results.filter(r => r.status === 'rejected' && r.reason.code === 'RATE_LIMITED').length, 5);
    });
    const legacyHash = await bcrypt.hash('isolated-legacy-password', 10);
    const legacyRecords = Array.from({ length: 4 }, (_, i) => ({
        _id: new mongoose.Types.ObjectId(), email: `legacy_${i}_${dbName}@example.test`, password: legacyHash,
        ...(i >= 2 ? { username: null } : {})
    }));
    await User.collection.insertMany(legacyRecords);
    // Build on a collection already containing multiple missing/null usernames.
    for (const Model of [User, Pending, Limit]) await Model.createIndexes();
    const originalJwt = process.env.JWT_SECRET;
    process.env.JWT_SECRET = 'isolated-test-only-signing-key';
    t.after(() => { if (originalJwt === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = originalJwt; });

    function context({ failDelivery = false, sendEmail } = {}) {
        const suffix = new mongoose.Types.ObjectId().toString();
        let clock = Date.now(), sequence = 0;
        const messages = [];
        const input = { username: `member_${suffix}`, email: `member_${suffix}@example.test`, password: 'isolated-test-password' };
        const service = createService({ now: () => clock, config: () => ({ secret: 'isolated-test-hmac-secret' }),
            makeOtp: () => String(++sequence).padStart(6, '0'), sendEmail: sendEmail || (async message => {
                if (failDelivery) throw Error('provider-details-must-not-leak');
                messages.push(message);
            }) });
        return { service, input, messages, ip: suffix, advance(ms) { clock += ms; },
            async start() { return service.start(input, suffix); },
            verify(challenge, otp = messages.at(-1)?.otp) { return service.verify({ ...challenge, otp }, suffix); },
            resend(challenge) { return service.resend(challenge, suffix); } };
    }
    async function loginResult(input) {
        const result = {};
        await login({ body: { loginInput: input.email, password: input.password } }, {
            status(code) { result.status = code; return this; }, json(body) { result.body = body; }
        }); return result;
    }
    await t.test('partial index preserves all missing/null legacy accounts, login IDs, group access and expense history', async () => {
        const indexes = await User.collection.indexes();
        assert(indexes.some(approvedUsernameIndex)); assert(!indexes.some(i => i.name === 'username_1'));
        for (const record of legacyRecords) {
            const before = await User.collection.findOne({ _id: record._id });
            const loginResponse = await loginResult({ email: record.email, password: 'isolated-legacy-password' });
            assert.equal(loginResponse.status, 200); assert.equal(String(loginResponse.body.user._id), String(record._id));
            assert.deepEqual(await User.collection.findOne({ _id: record._id }), before);
        }
        const group = await Group.create({ groupName: 'Legacy accounting', createdBy: legacyRecords[0]._id,
            members: legacyRecords.map(r => r._id) });
        const expense = await Expense.create({ title: 'History', amount: 100, paidBy: legacyRecords[0]._id,
            createdBy: legacyRecords[0]._id, groupId: group._id, splitBetween: legacyRecords.map(r => r._id) });
        const beforeExpense = await Expense.findById(expense._id).lean();
        const beforeGroup = await Group.findById(group._id).lean();
        let status, body;
        await getGroupExpenses({ user: { id: String(legacyRecords[1]._id) }, params: { groupId: String(group._id) } }, {
            status(code) { status = code; return this; }, json(value) { body = value; }
        });
        assert.equal(status, 200); assert.equal(body.expenses.length, 1);
        assert.equal(body.summary.totalAmountPaise, 10000);
        assert.equal(body.summary.users.reduce((sum, user) => sum + user.netPaise, 0), 0);
        assert.deepEqual(await Expense.findById(expense._id).lean(), beforeExpense);
        assert.deepEqual(await Group.findById(group._id).lean(), beforeGroup);
    });
    await t.test('database rejects duplicate new string usernames, retains case-sensitive semantics and serializes competing claims', async () => {
        const suffix = new mongoose.Types.ObjectId().toString();
        const username = `Member_${suffix}`;
        const insert = i => User.create({ username, email: `claim_${i}_${suffix}@example.test`, password: 'test-only-hash' });
        const results = await Promise.allSettled([insert(1), insert(2)]);
        assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
        assert.equal(results.filter(r => r.status === 'rejected' && r.reason.code === 11000).length, 1);
        await User.create({ username: username.toLowerCase(), email: `case_${suffix}@example.test`, password: 'test-only-hash' });
        assert.equal(await User.countDocuments({ username: { $in: [username, username.toLowerCase()] } }), 2);
        for (const invalid of [undefined, null, '', 'invalid name']) await assert.rejects(User.create({
            username: invalid, email: `invalid_${suffix}@example.test`, password: 'test-only-hash'
        }), error => error.name === 'ValidationError');
    });
    await t.test('no real User before verification; exact expiry and single use; pending secrets are cleared', async () => {
        const c = context(), challenge = await c.start();
        assert.equal(await User.countDocuments({ email: c.input.email }), 0);
        assert.equal((await loginResult(c.input)).status, 400);
        assert(!JSON.stringify(challenge).includes('otpDigest'));
        assert(!Object.hasOwn(challenge, 'otp'));
        const row = await Pending.findById(challenge.registrationId).select('+otpDigest +passwordHash +tokenDigest');
        assert(row.otpDigest !== c.messages[0].otp);
        assert(row.tokenDigest !== challenge.registrationToken);
        assert(await bcrypt.compare(c.input.password, row.passwordHash));
        c.advance(300000);
        await assert.rejects(c.verify(challenge), e => e.code === 'OTP_EXPIRED');
        await c.resend(challenge);
        await c.verify(challenge);
        const user = await User.findOne({ email: c.input.email });
        assert.equal(user.emailVerificationStatus, 'verified'); assert(user.emailVerifiedAt instanceof Date);
        assert.equal((await loginResult(c.input)).status, 200);
        await assert.rejects(c.verify(challenge));
        await assert.rejects(c.resend(challenge));
        assert.equal(await User.countDocuments({ email: c.input.email }), 1);
        const consumed = await Pending.findById(challenge.registrationId).select('+otpDigest +passwordHash +tokenDigest');
        assert.equal(consumed.state, 'consumed');
        assert(!consumed.otpDigest && !consumed.passwordHash && !consumed.tokenDigest);
    });
    await t.test('five incorrect guesses persist and lock even a correct code; cooldown boundary and old-code rejection', async () => {
        const c = context(), challenge = await c.start(), old = c.messages[0].otp;
        for (let i = 0; i < 5; i++) await assert.rejects(c.verify(challenge, '999999'),
            e => e.code === (i === 4 ? 'OTP_ATTEMPTS_EXCEEDED' : 'OTP_INVALID'));
        assert.equal((await Pending.findById(challenge.registrationId)).attempts, 5);
        await assert.rejects(c.verify(challenge), e => e.code === 'OTP_ATTEMPTS_EXCEEDED');
        c.advance(119999);
        await assert.rejects(c.resend(challenge), e => e.code === 'RESEND_COOLDOWN' && e.retryAfter === 1);
        c.advance(1); await c.resend(challenge);
        assert.equal((await Pending.findById(challenge.registrationId)).attempts, 0);
        await assert.rejects(c.verify(challenge, old), e => e.code === 'OTP_INVALID');
        await c.verify(challenge);
    });
    await t.test('concurrent correct verification creates exactly one account', async () => {
        const c = context(), challenge = await c.start();
        const results = await Promise.allSettled([c.verify(challenge), c.verify(challenge)]);
        assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
        assert.equal(await User.countDocuments({ email: c.input.email }), 1);
    });
    await t.test('competing OTP registrations for the same new username cannot create duplicate accounts', async () => {
        const first = context(), second = context();
        second.input.username = first.input.username;
        const challenges = await Promise.all([first.start(), second.start()]);
        const results = await Promise.allSettled([first.verify(challenges[0]), second.verify(challenges[1])]);
        assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
        assert.equal(results.filter(r => r.status === 'rejected' && r.reason.code === 'REGISTRATION_UNAVAILABLE').length, 1);
        assert.equal(await User.countDocuments({ username: first.input.username }), 1);
        assert.equal(await Pending.countDocuments({ _id: { $in: challenges.map(c => c.registrationId) }, state: 'consumed' }), 1);
    });
    await t.test('concurrent duplicate signup creates one pending registration, sends once and never creates an unverified User', async () => {
        const c = context();
        const results = await Promise.allSettled([c.start(), c.start()]);
        assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
        assert.equal(results.filter(r => r.status === 'rejected' && r.reason.code === 'REGISTRATION_UNAVAILABLE').length, 1);
        assert.equal(c.messages.length, 1);
        assert.equal(await Pending.countDocuments({ email: c.input.email }), 1);
        assert.equal(await User.countDocuments({ email: c.input.email }), 0);
        const challenge = results.find(r => r.status === 'fulfilled').value;
        await c.verify(challenge);
        assert.equal(await User.countDocuments({ email: c.input.email }), 1);
    });
    await t.test('concurrent wrong guesses cannot exceed the five-attempt budget', async () => {
        const c = context(), challenge = await c.start();
        const results = await Promise.allSettled(Array.from({ length: 8 }, () => c.verify(challenge, '999999')));
        assert(results.every(r => r.status === 'rejected'));
        assert.equal((await Pending.findById(challenge.registrationId)).attempts, 5);
        assert.equal(await User.countDocuments({ email: c.input.email }), 0);
    });
    await t.test('concurrent resends send only one replacement; verify-versus-resend cannot accept an obsolete generation', async () => {
        const c = context(), challenge = await c.start(); c.advance(120000);
        const results = await Promise.allSettled([c.resend(challenge), c.resend(challenge)]);
        assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
        assert.equal(c.messages.length, 2);
        c.advance(120000);
        const old = c.messages.at(-1).otp;
        const race = await Promise.allSettled([c.verify(challenge, old), c.resend(challenge)]);
        assert.equal(race.filter(r => r.status === 'fulfilled').length, 1);
        if (race[0].status === 'rejected') {
            await assert.rejects(c.verify(challenge, old));
            await c.verify(challenge);
        }
        assert.equal(await User.countDocuments({ email: c.input.email }), 1);
    });
    await t.test('provider failures create no User, invalidate unusable OTPs and allow a cooldown-controlled retry', async () => {
        const c = context({ failDelivery: true });
        let challenge;
        try { await c.start(); assert.fail('Expected delivery failure'); }
        catch (error) { assert.equal(error.code, 'EMAIL_DELIVERY_FAILED'); challenge = error.challenge; assert(!error.message.includes('provider-details')); }
        assert(challenge?.registrationToken);
        assert.equal(await User.countDocuments({ email: c.input.email }), 0);
        const row = await Pending.findById(challenge.registrationId).select('+otpDigest');
        assert.equal(row.state, 'delivery_failed'); assert(!row.otpDigest);
        await assert.rejects(c.verify(challenge, '000001'), e => e.code === 'OTP_NOT_READY');
        await assert.rejects(c.resend(challenge), e => e.code === 'RESEND_COOLDOWN');
        c.advance(120000);
        await assert.rejects(c.resend(challenge), e => e.code === 'EMAIL_DELIVERY_FAILED');
    });
    await t.test('provider still pending means verification cannot race delivery; late success is not usable after expiry', async () => {
        let release, sent;
        const gate = new Promise(resolve => { release = resolve; });
        const c = context({ sendEmail: async message => { sent = message; await gate; } });
        const starting = c.start();
        while (!sent) await new Promise(resolve => setTimeout(resolve, 10));
        const row = await Pending.findOne({ email: c.input.email });
        assert.equal(row.state, 'sending');
        c.advance(300000); release();
        await assert.rejects(starting, e => e.code === 'OTP_SUPERSEDED');
        assert.equal(await User.countDocuments({ email: c.input.email }), 0);
    });
    await t.test('registration cannot overwrite another pending password, case-variant legacy email, or another username', async () => {
        const c = context(), challenge = await c.start();
        await assert.rejects(c.service.start({ ...c.input, password: 'different-test-password' }, c.ip), e => e.code === 'REGISTRATION_UNAVAILABLE');
        await c.verify(challenge);
        const another = context();
        await assert.rejects(another.service.start({ ...another.input, email: c.input.email.toUpperCase() }, another.ip), e => e.code === 'REGISTRATION_UNAVAILABLE');
        const conflict = context(), pending = await conflict.start();
        await User.create({ username: conflict.input.username, email: `other_${conflict.ip}@example.test`, password: 'hash' });
        await assert.rejects(conflict.verify(pending), e => e.code === 'REGISTRATION_UNAVAILABLE');
    });
    await t.test('overall expiry rejects challenges before TTL deletion; verified/legacy login identities stay unchanged', async () => {
        const c = context(), challenge = await c.start(); c.advance(86400000);
        await assert.rejects(c.resend(challenge)); await assert.rejects(c.verify(challenge));
        const legacy = context();
        const original = await User.create({ username: legacy.input.username, email: legacy.input.email,
            password: await bcrypt.hash(legacy.input.password, 10) });
        const result = await loginResult(legacy.input);
        assert.equal(result.status, 200); assert.equal(String(result.body.user._id), String(original._id));
        assert.equal(original.emailVerificationStatus, 'legacy_unverified'); assert.equal(original.emailVerifiedAt, null);
    });
    await t.test('persistent rate limits survive a new service instance and cannot be bypassed with resends', async () => {
        const c = context(), challenge = await c.start();
        for (let i = 0; i < 5; i++) await assert.rejects(c.resend(challenge), e => e.code === 'RESEND_COOLDOWN');
        await assert.rejects(c.resend(challenge), e => e.code === 'RATE_LIMITED');
        const anotherService = createService({ config: () => ({ secret: 'isolated-test-hmac-secret' }), sendEmail: async () => assert.fail('Rate-limited request sent email') });
        await assert.rejects(anotherService.resend(challenge, c.ip), e => e.code === 'RATE_LIMITED');
    });
});
