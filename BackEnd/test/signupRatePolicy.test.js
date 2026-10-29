'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const rate = require('../src/services/signupRateLimiter');
const { clientRateLimitIdentity } = require('../src/Config/httpSecurity');
function counters() {
    const values = new Map();
    return { values, consume: async (secret, scope, identity, max) => {
        const key = `${scope}:${identity}`;
        const count = (values.get(key) || 0) + 1;
        values.set(key, count);
        if (count > max) throw Object.assign(Error('Limited'), { code: 'RATE_LIMITED' });
    } };
}
const shared = { SIGNUP_RATE_LIMIT_POLICY: 'shared_proxy' };
test('strict is default; shared mode is bounded; invalid configuration fails before writes', async () => {
    assert.deepEqual(rate.policy({}), { signup: 5, resend: 5, verify: 30 });
    assert.deepEqual(rate.policy(shared), { signup: 20, resend: 20, verify: 120 });
    for (const value of ['', 'true', 'unlimited', 'SHARED_PROXY']) {
        await assert.rejects(rate.throttle('test', 'signup', 'email', 'peer', 0,
            () => assert.fail('Counter must not be written'), { SIGNUP_RATE_LIMIT_POLICY: value }),
        e => e.code === 'SIGNUP_UNAVAILABLE');
    }
});
test('two legitimate emails share a proxy without one exhausted identity consuming the shared budget', async () => {
    const counter = counters();
    const submit = email => rate.throttle('test', 'signup', email, 'proxy', 0, counter.consume, shared);
    for (let i = 0; i < 5; i++) await submit('first@example.test');
    for (let i = 0; i < 20; i++) await assert.rejects(submit('first@example.test'));
    for (let i = 0; i < 5; i++) await submit('second@example.test');
    assert.equal(counter.values.get('signup:ip:proxy'), 10);
});
test('email rotation and forged forwarding headers cannot bypass aggregate ingress limits', async () => {
    const counter = counters();
    for (let i = 0; i <= 20; i++) {
        const req = { ip: '192.0.2.1', socket: { remoteAddress: '192.0.2.1' },
            headers: { 'x-forwarded-for': `198.51.100.${i}`, 'x-real-ip': `203.0.113.${i}` } };
        const request = rate.throttle('test', 'signup', `member${i}@example.test`, clientRateLimitIdentity(req), 0, counter.consume, shared);
        if (i < 20) await request;
        else await assert.rejects(request, e => e.code === 'RATE_LIMITED');
    }
});
test('global email cap survives rotating emails and socket identities', async () => {
    const counter = counters();
    for (let i = 0; i <= 100; i++) {
        const request = rate.throttle('test', i % 2 ? 'resend' : 'signup', `identity${i}`, `peer${i}`, 0, counter.consume, shared);
        if (i < 100) await request;
        else await assert.rejects(request);
    }
});
test('verify retains per-challenge cap without consuming email budget', async () => {
    const counter = counters();
    for (let i = 0; i < 20; i++) await rate.throttle('test', 'verify', 'challenge', 'peer', 0, counter.consume, shared);
    await assert.rejects(rate.throttle('test', 'verify', 'challenge', 'peer', 0, counter.consume, shared));
    assert.equal(counter.values.get('verify:ip:peer'), 20);
    assert.equal(counter.values.has('mail:global:all'), false);
});
