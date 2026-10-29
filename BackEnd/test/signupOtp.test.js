'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const security = require('../src/services/signupOtpSecurity');
const email = require('../src/services/signupEmail');
const { Resend } = require('resend');
const registration = require('../src/services/signupRegistration');
const controller = require('../src/controllers/signupVerification.controller');
const { signup } = require('../src/controllers/auth.controller');
const User = require('../src/models/user.model');
const Pending = require('../src/models/pendingRegistration.model');
const Limit = require('../src/models/signupRateLimit.model');
const limiter = require('../src/services/signupRateLimiter');

function env(t, key, value) {
    const previous = process.env[key];
    t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
}
function response() {
    return { headers: {}, set(k, v) { this.headers[k] = v; return this; },
        status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
}
test('cryptographic OTPs are six-digit strings including leading-zero values; digests bind purpose and generation', () => {
    for (let i = 0; i < 100; i++) assert.match(security.generateOtp(), /^\d{6}$/);
    const a = security.otpDigest('test-secret', 'id', 1, '000001');
    assert.match(a, /^[a-f0-9]{64}$/);
    assert(!a.includes('000001'));
    assert.notEqual(a, security.otpDigest('test-secret', 'id', 2, '000001'));
    assert.notEqual(a, security.otpDigest('another-secret', 'id', 1, '000001'));
    assert(security.equalDigest(a, a)); assert(!security.equalDigest(a, 'malformed'));
});
test('OTP configuration fails closed for missing/reused secrets or missing provider configuration', () => {
    const valid = { OTP_HMAC_SECRET: 'x'.repeat(64), JWT_SECRET: 'another-secret', RESEND_API_KEY: 'mock-only', RESEND_FROM_EMAIL: 'sender@example.test' };
    assert.equal(security.configuration(valid).secret, valid.OTP_HMAC_SECRET);
    for (const changes of [{ OTP_HMAC_SECRET: '' }, { OTP_HMAC_SECRET: valid.JWT_SECRET }, { RESEND_API_KEY: '' }, { RESEND_FROM_EMAIL: '' }]) {
        assert.throws(() => security.configuration({ ...valid, ...changes }), e => e.code === 'SIGNUP_UNAVAILABLE');
    }
});
test('registration validation rejects operator injection, malformed email, weak/oversize passwords and malformed challenges', () => {
    const data = { username: 'Member', email: ' Member@Example.test ', password: 'test-only-password' };
    assert.equal(security.registrationInput(data).email, 'member@example.test');
    for (const changes of [{ username: { $ne: null } }, { email: { $ne: null } }, { password: 'short' }, { password: 'é'.repeat(40) },
        { email: 'a@example.test\nBcc:b@test.test' }, { email: 'a,b@example.test' }, { email: 'a;bad@example.test' },
        { email: 'a..b@example.test' }, { email: 'a@-example.test' }]) {
        assert.throws(() => security.registrationInput({ ...data, ...changes }));
    }
    assert.throws(() => security.challengeInput({ registrationId: {}, registrationToken: 'x', otp: 123456 }, true));
});
test('new models disable automatic collection/index creation and only pending data has TTL', () => {
    for (const Model of [Pending, Limit]) {
        assert.equal(Model.schema.options.autoCreate, false);
        assert.equal(Model.schema.options.autoIndex, false);
    }
    assert(!User.schema.indexes().some(([, options]) => options.expireAfterSeconds !== undefined));
    const legacy = new User({ username: 'Legacy', email: 'legacy@example.test', password: 'hash' });
    assert.equal(legacy.emailVerificationStatus, 'legacy_unverified'); assert.equal(legacy.emailVerifiedAt, null);
});
test('feature defaults off: verification/resend are unavailable and legacy signup contract remains', async t => {
    env(t, 'SIGNUP_EMAIL_OTP_ENABLED', undefined);
    for (const action of ['verify', 'resend']) {
        const res = response(); await controller[action]({ body: {} }, res);
        assert.equal(res.statusCode, 404);
    }
    t.mock.method(User, 'findOne', async () => ({ _id: 'existing' }));
    const res = response(); await signup({ body: { username: 'Member', email: 'existing@example.test' } }, res);
    assert.equal(res.statusCode, 400); assert.equal(res.body.message, 'User already exists');
});
test('enabled signup delegates only to pending flow; errors are sanitized and rate limits use Retry-After', async t => {
    env(t, 'SIGNUP_EMAIL_OTP_ENABLED', 'true');
    t.mock.method(registration, 'start', async () => { throw new Error('private-provider-key-must-not-leak'); });
    const res = response(); await signup({ body: {}, ip: 'test-ip' }, res);
    assert.equal(res.statusCode, 503); assert(!JSON.stringify(res.body).includes('private-provider'));
    t.mock.method(registration, 'verify', async () => { throw new security.SignupError(429, 'RATE_LIMITED', 'Wait', 120); });
    const limited = response(); await controller.verify({ body: {} }, limited);
    assert.equal(limited.statusCode, 429); assert.equal(limited.headers['Retry-After'], '120');
});
test('email adapter uses a single recipient, explicit sender, purpose-specific code and idempotency; provider failures are not leaked', async t => {
    env(t, 'EMAIL_PROVIDER', 'resend');
    env(t, 'RESEND_API_KEY', 'mock-only'); env(t, 'RESEND_FROM_EMAIL', 'sender@example.test');
    let calls = 0;
    t.mock.method(Resend.prototype, 'post', async (path, body, options) => {
        calls++; assert.equal(path, '/emails'); assert.deepEqual(body.to, ['member@example.test']);
        assert.equal(body.from, 'sender@example.test'); assert(body.text.includes('000001'));
        assert.equal(options.idempotencyKey, 'expenseiq-signup-mock-delivery');
        assert(options.signal instanceof AbortSignal); return { data: { id: 'mock-message' }, error: null };
    });
    await email.sendSignupOtp({ email: 'member@example.test', otp: '000001', deliveryId: 'mock-delivery' });
    assert.equal(calls, 1);
    t.mock.method(Resend.prototype, 'post', async () => ({ error: { message: 'private' }, data: null }));
    await assert.rejects(email.sendSignupOtp({ email: 'member@example.test', otp: '000001', deliveryId: 'mock-delivery' }),
        e => e.message === 'Email provider did not accept the message');
});
test('persistent limiter increments atomically and reports a bounded retry', async t => {
    t.mock.method(Limit, 'findOneAndUpdate', async (filter, update) => {
        assert.match(filter._id, /^[a-f0-9]{64}$/); assert.equal(update.$inc.count, 1);
        return { count: 6 };
    });
    await assert.rejects(limiter.consume('test-secret', 'signup:ip', 'test-ip', 5, 900000, 1000),
        e => e.code === 'RATE_LIMITED' && e.retryAfter === 899);
});
test('missing explicitly provisioned indexes fails before signup, email or limiter writes', async () => {
    let calls = 0;
    const service = registration.createService({
        Pending: { collection: { indexes: async () => [] } },
        Limits: { collection: { indexes: async () => [] } }, Users: { collection: { indexes: async () => [] } },
        config: () => ({ secret: 'mock-secret' }), sendEmail: async () => calls++, consume: async () => calls++
    });
    await assert.rejects(service.start({ username: 'Member', email: 'member@example.test', password: 'test-only-password' }, 'ip'),
        e => e.code === 'SIGNUP_UNAVAILABLE');
    assert.equal(calls, 0);
});
