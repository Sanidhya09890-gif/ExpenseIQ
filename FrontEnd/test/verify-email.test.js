'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const script = name => fs.readFileSync(path.join(__dirname, `../js/${name}.js`), 'utf8');
const key = 'expenseiq-signup-verification';

function page({ signup = false, missing = false, blockedStorage = false } = {}) {
    let time = 1700000000000;
    const elements = {}, events = {}, requests = [], errors = [], notices = [], flashes = [], intervals = new Map(), storage = new Map();
    class Element {
        constructor(id) { this.id = id; this.value = ''; this.textContent = ''; this.disabled = false; this.listeners = {}; this.attributes = {}; }
        addEventListener(name, handler) { this.listeners[name] = handler; }
        setAttribute(name, value) { this.attributes[name] = value; }
        focus() { this.focused = true; }
        querySelector() { return elements.signupSubmit; }
    }
    for (const id of ['verifyEmailForm', 'otp', 'verifyEmailButton', 'resendCode', 'verificationStatus', 'otpExpiry', 'resendCountdown',
        'signupForm', 'signupSubmit', 'username', 'email', 'password']) elements[id] = new Element(id);
    elements.username.value = 'Member'; elements.email.value = 'member@example.test'; elements.password.value = 'not-for-storage';
    class Clock extends Date { static now() { return time; } }
    const context = vm.createContext({ Date: Clock, AbortSignal, document: { getElementById: id => elements[id] },
        window: { location: {}, addEventListener: (name, handler) => { events[name] = handler; } },
        sessionStorage: { getItem(k) { if (blockedStorage) throw Error('blocked'); return storage.get(k) || null; },
            setItem(k, v) { if (blockedStorage) throw Error('blocked'); storage.set(k, v); }, removeItem: k => storage.delete(k) },
        localStorage: { setItem() { assert.fail('OTP flow must not write localStorage'); } },
        setInterval(handler) { intervals.set(1, handler); return 1; }, clearInterval: id => intervals.delete(id),
        ExpenseUI: { formError(form, message = '') { errors.push(message); }, notify: (...args) => notices.push(args), flash: (...args) => flashes.push(args),
            busy(button, label) { if (button.busy) return null; button.busy = true; const text = button.textContent;
                button.textContent = label; button.disabled = true; return () => { button.busy = false; button.textContent = text; button.disabled = false; }; } },
        fetch: async (...args) => { requests.push(args); throw Error('Network unavailable'); } });
    vm.runInContext(script('signup-verification-state'), context);
    const challenge = () => ({ verificationRequired: true, registrationId: '000000000000000000000001', registrationToken: 'a'.repeat(64),
        expiresAt: new Date(time + 300000).toISOString(), resendAvailableAt: new Date(time + 120000).toISOString() });
    if (!signup && !missing) context.ExpenseSignupVerification.save(challenge());
    vm.runInContext(script(signup ? 'signup' : 'verify-email'), context);
    return { context, elements, events, requests, errors, notices, flashes, storage, intervals, challenge,
        advance(ms) { time += ms; for (const handler of intervals.values()) handler(); },
        fill(value = '000001') { elements.otp.value = value; elements.otp.listeners.input(); },
        submit() { return elements[signup ? 'signupForm' : 'verifyEmailForm'].listeners.submit({ preventDefault() {} }); },
        resend() { return elements.resendCode.listeners.click(); },
        respond(body, status = 200, retryAfter = null) { context.fetch = async (url, options) => { requests.push([url, options]);
            return { ok: status >= 200 && status < 300, status, headers: { get: () => retryAfter }, json: async () => body }; }; }
    };
}

test('signup OTP success redirects with only whitelisted capability state, never passwords or codes', async () => {
    const p = page({ signup: true });
    p.respond({ ...p.challenge(), otp: '123456', password: 'server-field-must-not-store', apiKey: 'private' }, 202);
    await p.submit();
    assert.equal(p.context.window.location.href, './verify-email.html');
    const saved = p.storage.get(key);
    assert(saved.includes('registrationToken'));
    for (const forbidden of ['123456', 'not-for-storage', 'password', 'apiKey', 'member@example.test']) assert(!saved.includes(forbidden));
    assert.equal(p.elements.password.value, '');
    assert(!p.context.window.location.href.includes('?'));
});
test('signup keeps disabled-feature behavior and does not redirect failed or malformed challenges', async () => {
    const legacy = page({ signup: true }); legacy.respond({ message: 'User created', id: 'existing' }, 201);
    await legacy.submit(); assert.equal(legacy.context.window.location.href, './login.html'); assert(!legacy.storage.has(key));
    for (const body of [{ message: 'Unavailable' }, { ...page({ signup: true }).challenge(), registrationToken: null, verificationRequired: true }]) {
        const p = page({ signup: true }); p.respond(body, body.verificationRequired ? 202 : 503);
        await p.submit(); assert.equal(p.context.window.location.href, undefined); assert(!p.storage.has(key)); assert(p.errors.at(-1));
    }
});
test('signup preserves a provider-failure challenge for safe resend rather than creating a login session', async () => {
    const p = page({ signup: true });
    p.respond({ ...p.challenge(), code: 'EMAIL_DELIVERY_FAILED', message: 'Not confirmed' }, 503);
    await p.submit(); assert.equal(p.context.window.location.href, './verify-email.html');
    assert.equal(JSON.parse(p.storage.get(key)).deliveryStatus, 'unavailable');
});
test('blocked session storage prevents capability-losing navigation', async () => {
    const p = page({ signup: true, blockedStorage: true }); p.respond(p.challenge(), 202);
    await p.submit(); assert.equal(p.context.window.location.href, undefined); assert.match(p.errors.at(-1), /session storage/);
});
test('expiry and cooldown use absolute backend times and recover after background timer throttling', async () => {
    const p = page();
    assert.equal(p.elements.otpExpiry.textContent, 'Code expires in 5:00');
    assert.match(p.elements.resendCountdown.textContent, /2:00/);
    p.fill('00a0001'); assert.equal(p.elements.otp.value, '000001'); assert.equal(p.elements.verifyEmailButton.disabled, false);
    assert.equal(p.elements.resendCode.disabled, true); await p.resend(); assert.equal(p.requests.length, 0);
    p.advance(120000); assert.equal(p.elements.resendCode.disabled, false); assert.match(p.elements.otpExpiry.textContent, /3:00/);
    p.advance(180000); assert.match(p.elements.otpExpiry.textContent, /expired/);
    await p.submit(); assert.equal(p.requests.length, 0);
});
test('successful verification sends code only in request body, clears challenge and redirects to login', async () => {
    const p = page(); p.fill(); p.respond({ id: 'verified-user', message: 'Verified' }, 201);
    await p.submit();
    assert.equal(p.requests[0][0], 'https://expenseiq-backend-xkmu.onrender.com/api/auth/signup/verify');
    const options = p.requests[0][1], body = JSON.parse(options.body);
    assert.equal(body.otp, '000001'); assert.equal(options.credentials, 'omit');
    assert.equal(options.headers.authorization, undefined);
    assert.equal(p.elements.otp.value, ''); assert(!p.storage.has(key));
    assert.equal(p.context.window.location.href, './login.html'); assert.equal(p.flashes[0][1], 'success');
});
test('a pending request blocks duplicate verification and concurrent resend', async () => {
    const p = page(); p.advance(120000); p.fill(); let finish;
    p.context.fetch = (url, options) => { p.requests.push([url, options]); return new Promise(resolve => { finish = resolve; }); };
    const pending = p.submit(); await p.submit(); await p.resend();
    assert.equal(p.requests.length, 1); assert.equal(p.elements.resendCode.disabled, true);
    finish({ ok: false, status: 400, headers: { get() {} }, json: async () => ({ code: 'OTP_INVALID', message: 'Invalid code' }) });
    await pending; assert.equal(p.context.window.location.href, undefined); assert.equal(p.elements.otp.disabled, false);
});
for (const [code, expected] of [['OTP_INVALID', 'editable'], ['OTP_EXPIRED', 'expired'], ['OTP_ATTEMPTS_EXCEEDED', 'locked'],
    ['OTP_NOT_READY', 'unavailable'], ['REGISTRATION_UNAVAILABLE', 'missing']]) {
    test(`handles backend ${code} without inventing verification success`, async () => {
        const p = page(); p.fill(); p.respond({ code, message: `Server says ${code}` }, code === 'OTP_ATTEMPTS_EXCEEDED' ? 429 : 400);
        await p.submit(); assert.equal(p.context.window.location.href, undefined); assert.match(p.errors.at(-1), /Server says/);
        if (expected === 'editable') assert.equal(p.elements.otp.disabled, false);
        else assert.equal(p.elements.verifyEmailButton.disabled, true);
        if (expected === 'locked') assert.equal(JSON.parse(p.storage.get(key)).attemptsExhausted, true);
        if (expected === 'missing') assert(!p.storage.has(key));
    });
}
test('successful resend uses the same capability, new server times and resets the exhausted-code UI', async () => {
    const p = page(); p.fill(); p.respond({ code: 'OTP_ATTEMPTS_EXCEEDED', message: 'Locked' }, 429); await p.submit();
    p.advance(120000); p.respond(p.challenge(), 202); await p.resend();
    assert.equal(p.requests.at(-1)[0], 'https://expenseiq-backend-xkmu.onrender.com/api/auth/signup/resend');
    assert.equal(JSON.parse(p.requests.at(-1)[1].body).otp, undefined);
    assert.equal(JSON.parse(p.storage.get(key)).attemptsExhausted, false);
    assert.equal(p.elements.otpExpiry.textContent, 'Code expires in 5:00');
    assert.match(p.elements.resendCountdown.textContent, /2:00/); assert.equal(p.elements.resendCode.disabled, true);
    assert.equal(p.elements.otp.disabled, false);
});
test('rate errors respect Retry-After and never overwrite the current code state', async () => {
    const p = page(); p.advance(120000); p.respond({ code: 'RATE_LIMITED', message: 'Slow down' }, 429, '300');
    await p.resend(); assert.match(p.elements.resendCountdown.textContent, /5:00/);
    assert.equal(JSON.parse(p.storage.get(key)).deliveryStatus, 'ready');
    p.advance(300000); assert.equal(p.elements.resendCode.disabled, false);
});
test('failed resend delivery and network uncertainty are visible, with cooldown and no false success', async () => {
    const failed = page(); failed.advance(120000); failed.respond({ code: 'EMAIL_DELIVERY_FAILED', message: 'Delivery failed' }, 503);
    await failed.resend(); assert.equal(JSON.parse(failed.storage.get(key)).deliveryStatus, 'unavailable');
    assert.match(failed.elements.verificationStatus.textContent, /delivery could not be confirmed/); assert.equal(failed.notices.length, 0);
    const network = page(); network.advance(120000); await network.resend();
    assert.equal(JSON.parse(network.storage.get(key)).deliveryStatus, 'unknown');
    assert.match(network.elements.verificationStatus.textContent, /could not be confirmed/);
    assert.equal(network.elements.resendCode.disabled, true); assert.equal(network.notices.length, 0);
    network.fill(); assert.equal(network.elements.verifyEmailButton.disabled, false);
});
test('verification network error preserves capability and clears entered OTP', async () => {
    const p = page(); p.fill(); await p.submit();
    assert.equal(p.context.window.location.href, undefined); assert.equal(p.elements.otp.value, '');
    assert(p.storage.has(key)); assert.match(p.errors.at(-1), /Network/);
});
test('backend feature-off 404 preserves session; missing/corrupt sessions disable actions without API calls', async () => {
    const p = page(); p.fill(); p.respond({ message: 'Not found' }, 404); await p.submit();
    assert(p.storage.has(key)); assert.match(p.errors.at(-1), /unavailable on this backend/);
    const missing = page({ missing: true }); await missing.submit(); await missing.resend();
    assert.equal(missing.requests.length, 0); assert.equal(missing.elements.otp.disabled, true);
    p.storage.set(key, '{broken'); p.events.pageshow();
    assert.equal(p.elements.otp.disabled, true); assert(!p.storage.has(key));
});
test('reload state retains exhausted attempts, never preserves OTP input, and expires the capability after one day', async () => {
    const p = page(); p.fill(); p.respond({ code: 'OTP_ATTEMPTS_EXCEEDED', message: 'Locked' }, 429); await p.submit();
    p.events.pagehide(); assert.equal(p.elements.otp.value, ''); assert.equal(p.intervals.size, 0);
    p.events.pageshow(); assert.equal(p.elements.otp.disabled, true); assert.equal(p.intervals.size, 1);
    p.advance(86400000); p.events.pageshow(); assert(!p.storage.has(key)); assert.equal(p.elements.otp.disabled, true);
});
test('malformed resend success and unexpected non-JSON responses do not claim successful delivery', async () => {
    const p = page(); p.advance(120000); p.respond({ message: 'Sent' }); await p.resend();
    assert.equal(p.notices.length, 0); assert.match(p.errors.at(-1), /could not be confirmed/);
    const q = page(); q.fill(); q.context.fetch = async () => ({ ok: false, status: 503, json: async () => { throw Error('HTML'); } });
    await q.submit(); assert.match(q.errors.at(-1), /unexpected response/); assert(q.storage.has(key));
});
test('verification markup is accessible, assets load in order, and dynamic content has no HTML injection sinks', () => {
    const html = fs.readFileSync(path.join(__dirname, '../verify-email.html'), 'utf8');
    assert(html.includes('for="otp"')); assert(html.includes('autocomplete="one-time-code"'));
    assert(html.includes('inputmode="numeric"')); assert(html.includes('pattern="[0-9]{6}"'));
    assert(html.includes('role="status"')); assert(html.includes('aria-describedby="otpHelp otpExpiry"'));
    assert(html.indexOf('js/feedback.js') < html.indexOf('js/verify-email.js'));
    assert(html.indexOf('js/signup-verification-state.js') < html.indexOf('js/verify-email.js'));
    assert(!/innerHTML|insertAdjacentHTML|localStorage|console\./.test(script('verify-email')));
    assert(!/localStorage|console\./.test(script('signup-verification-state')));
});
