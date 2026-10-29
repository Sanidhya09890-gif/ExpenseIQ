'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const nodemailer = require('nodemailer');
const { Resend } = require('resend');
const { sendSignupOtp } = require('../src/services/signupEmail');
const { emailConfiguration } = require('../src/services/signupEmailConfiguration');
const { configuration } = require('../src/services/signupOtpSecurity');
const smtp = { EMAIL_PROVIDER: 'smtp', SMTP_HOST: 'smtp.gmail.com', SMTP_PORT: '465',
    SMTP_USER: 'sender@example.test', SMTP_APP_PASSWORD: 'mock-app-password', SMTP_FROM_NAME: 'ExpenseIQ Test' };
const resend = { RESEND_API_KEY: 'mock-api-key', RESEND_FROM_EMAIL: 'sender@example.test' };
const brevo = { EMAIL_PROVIDER: 'brevo', BREVO_API_KEY: 'mock-brevo-key',
    BREVO_SENDER_EMAIL: 'sender@example.test', BREVO_SENDER_NAME: 'ExpenseIQ Test' };
const payload = { email: 'recipient@example.test', otp: '000001', deliveryId: 'mock-generation' };
function environment(t, values) {
    for (const key of [...new Set([...Object.keys(smtp), ...Object.keys(resend), ...Object.keys(brevo)])]) {
        const previous = process.env[key];
        t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
        if (values[key] === undefined) delete process.env[key]; else process.env[key] = values[key];
    }
}
test('provider selection defaults to Resend, supports Resend, SMTP and Brevo, and never silently falls back', () => {
    assert.equal(emailConfiguration(resend).provider, 'resend');
    assert.equal(emailConfiguration({ ...resend, EMAIL_PROVIDER: 'resend' }).provider, 'resend');
    assert.equal(emailConfiguration(smtp).provider, 'smtp');
    assert.equal(emailConfiguration(brevo).provider, 'brevo');
    for (const provider of ['unknown', 'SMTP', 'smtp ', 'gmail']) assert.throws(() => emailConfiguration({ ...smtp, ...resend, EMAIL_PROVIDER: provider }));
    assert.throws(() => emailConfiguration({ EMAIL_PROVIDER: 'smtp', ...resend }));
    assert.throws(() => emailConfiguration({ ...resend, EMAIL_PROVIDER: 'brevo' }));
});

test('Brevo validates its own API key and sender independently of SMTP/Resend configuration', () => {
    const valid = { ...brevo, OTP_HMAC_SECRET: 'x'.repeat(64), JWT_SECRET: 'another-secret' };
    assert.equal(configuration(valid).secret, valid.OTP_HMAC_SECRET);
    for (const changes of [{ BREVO_API_KEY: '' }, { BREVO_API_KEY: 'bad\r\nkey' },
        { BREVO_SENDER_EMAIL: 'invalid' }, { BREVO_SENDER_EMAIL: 'a@test.test,b@test.test' },
        { BREVO_SENDER_NAME: '' }, { BREVO_SENDER_NAME: 'bad\nname' }]) {
        assert.throws(() => emailConfiguration({ ...brevo, ...changes }));
        assert.throws(() => configuration({ ...valid, ...changes }), e => e.code === 'SIGNUP_UNAVAILABLE');
    }
});
test('Brevo sends one HTTPS POST with secret header, configured sender, one recipient and unchanged OTP content', async t => {
    environment(t, brevo); let calls = 0;
    t.mock.method(nodemailer, 'createTransport', () => assert.fail('Brevo must not open SMTP'));
    t.mock.method(Resend.prototype, 'post', async () => assert.fail('Brevo must not invoke Resend'));
    t.mock.method(globalThis, 'fetch', async (url, options) => {
        calls++; assert.equal(url, 'https://api.brevo.com/v3/smtp/email'); assert.equal(options.method, 'POST');
        assert.equal(options.redirect, 'error'); assert.equal(options.credentials, 'omit');
        assert.equal(options.headers['api-key'], brevo.BREVO_API_KEY);
        assert.equal(options.headers['Content-Type'], 'application/json'); assert(options.signal instanceof AbortSignal);
        assert(!url.includes(brevo.BREVO_API_KEY)); assert(!options.body.includes(brevo.BREVO_API_KEY));
        const body = JSON.parse(options.body);
        assert.deepEqual(body.sender, { email: brevo.BREVO_SENDER_EMAIL, name: brevo.BREVO_SENDER_NAME });
        assert.deepEqual(body.to, [{ email: payload.email }]); assert.equal(body.subject, 'ExpenseIQ - Verify your email');
        assert(body.textContent.includes(payload.otp)); assert(body.textContent.includes('5 minutes'));
        assert(!body.cc && !body.bcc);
        return { ok: true, status: 201, json: async () => ({ messageId: 'mock-brevo-message' }) };
    });
    await sendSignupOtp(payload); assert.equal(calls, 1);
});
for (const failure of [401, 403, 429, 400, 500, 302, 'network', 'timeout', 'json', 'missing-id']) {
    test(`Brevo ${failure} failure is sanitized and never retried or sent through another provider`, async t => {
        environment(t, brevo); let calls = 0;
        t.mock.method(nodemailer, 'createTransport', () => assert.fail('No SMTP fallback'));
        t.mock.method(Resend.prototype, 'post', async () => assert.fail('No Resend fallback'));
        t.mock.method(globalThis, 'fetch', async () => {
            calls++;
            if (failure === 'network' || failure === 'timeout') throw new Error(`private ${brevo.BREVO_API_KEY} ${payload.otp}`);
            return { ok: typeof failure === 'string', status: typeof failure === 'number' ? failure : 201,
                body: { cancel: async () => {} }, json: async () => {
                    if (failure === 'json') throw Error('private response body');
                    return failure === 'missing-id' ? {} : { message: 'private provider details' };
                } };
        });
        await assert.rejects(sendSignupOtp(payload), e => e.message === 'Email provider did not accept the message' && !e.cause);
        assert.equal(calls, 1);
    });
}
test('invalid Brevo configuration fails without any outbound request', async t => {
    environment(t, { ...brevo, BREVO_API_KEY: '' });
    t.mock.method(globalThis, 'fetch', async () => assert.fail('Invalid configuration must not send'));
    await assert.rejects(sendSignupOtp(payload), /Email provider did not accept/);
});
test('SMTP requires Gmail implicit TLS configuration and validated sender without requiring Resend credentials', () => {
    const valid = { ...smtp, OTP_HMAC_SECRET: 'x'.repeat(64), JWT_SECRET: 'different' };
    assert.equal(configuration(valid).secret, valid.OTP_HMAC_SECRET);
    for (const changes of [{ SMTP_HOST: 'other.example.test' }, { SMTP_PORT: '587' }, { SMTP_PORT: '' },
        { SMTP_USER: 'sender@example.test\r\nBcc:other@example.test' }, { SMTP_APP_PASSWORD: '' },
        { SMTP_FROM_NAME: '' }, { SMTP_FROM_NAME: 'Name\r\nBcc:other@example.test' }]) {
        assert.throws(() => emailConfiguration({ ...smtp, ...changes }));
        assert.throws(() => configuration({ ...valid, ...changes }), e => e.code === 'SIGNUP_UNAVAILABLE');
    }
});
test('SMTP uses secure port 465, verified TLS, credentials and structured display-name sender; closes transport', async t => {
    environment(t, smtp);
    let sends = 0, closes = 0;
    t.mock.method(Resend.prototype, 'post', async () => assert.fail('SMTP must not invoke Resend'));
    t.mock.method(nodemailer, 'createTransport', options => {
        assert.equal(options.host, 'smtp.gmail.com'); assert.equal(options.port, 465);
        assert.equal(options.secure, true); assert.equal(options.requireTLS, true);
        assert.equal(options.tls.rejectUnauthorized, true); assert.equal(options.tls.minVersion, 'TLSv1.2');
        assert.equal(options.tls.servername, 'smtp.gmail.com'); assert.equal(options.auth.user, smtp.SMTP_USER);
        assert.equal(options.auth.pass, smtp.SMTP_APP_PASSWORD); assert.equal(options.logger, false); assert.equal(options.debug, false);
        assert.equal(options.connectionTimeout, 10000); assert.equal(options.socketTimeout, 10000);
        assert.equal(options.disableFileAccess, true); assert.equal(options.disableUrlAccess, true); assert.equal(options.maxRecipients, 1);
        return { async sendMail(message) {
            sends++; assert.deepEqual(message.from, { name: smtp.SMTP_FROM_NAME, address: smtp.SMTP_USER });
            assert.deepEqual(message.to, [{ address: payload.email }]); assert.equal(message.subject, 'ExpenseIQ - Verify your email');
            assert(message.text.includes(payload.otp)); assert(message.text.includes('5 minutes'));
            return { messageId: 'mock-smtp-message', accepted: [payload.email], rejected: [] };
        }, close() { closes++; } };
    });
    await sendSignupOtp(payload); assert.equal(sends, 1); assert.equal(closes, 1);
});
for (const category of ['authentication', 'connection', 'timeout', 'tls', 'recipient-rejected', 'missing-acceptance']) {
    test(`SMTP ${category} failure is sanitized, closes transport and never retries/falls back`, async t => {
        environment(t, smtp); let sends = 0, closes = 0;
        t.mock.method(Resend.prototype, 'post', async () => assert.fail('No provider fallback allowed'));
        t.mock.method(nodemailer, 'createTransport', () => ({ async sendMail() {
            sends++;
            if (category === 'recipient-rejected') return { messageId: 'mock', accepted: [], rejected: [payload.email] };
            if (category === 'missing-acceptance') return { messageId: 'mock' };
            throw new Error(`private transport details ${smtp.SMTP_APP_PASSWORD} ${payload.otp}`);
        }, close() { closes++; } }));
        await assert.rejects(sendSignupOtp(payload), e => e.message === 'Email provider did not accept the message' && !e.cause);
        assert.equal(sends, 1); assert.equal(closes, 1);
    });
}
test('invalid SMTP configuration or recipient fails before any transport is created', async t => {
    environment(t, { ...smtp, SMTP_PORT: '587' });
    t.mock.method(nodemailer, 'createTransport', () => assert.fail('No transport expected'));
    await assert.rejects(sendSignupOtp(payload), /Email provider did not accept/);
    process.env.SMTP_PORT = '465';
    await assert.rejects(sendSignupOtp({ ...payload, email: 'a@example.test,b@example.test' }), /Email provider did not accept/);
});
test('default Resend preserves sender, idempotency and timeout and does not initialize SMTP', async t => {
    environment(t, resend); let sends = 0;
    t.mock.method(nodemailer, 'createTransport', () => assert.fail('Resend must not initialize SMTP'));
    t.mock.method(Resend.prototype, 'post', async (url, message, options) => {
        sends++; assert.equal(url, '/emails'); assert.equal(message.from, resend.RESEND_FROM_EMAIL);
        assert.deepEqual(message.to, [payload.email]); assert.equal(options.idempotencyKey, 'expenseiq-signup-mock-generation');
        assert(options.signal instanceof AbortSignal); return { data: { id: 'mock-resend-message' }, error: null };
    });
    await sendSignupOtp(payload); assert.equal(sends, 1);
});
