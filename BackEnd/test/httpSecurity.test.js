'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const cors = require('cors');
const { canonicalIp, trustedProxyPolicy, corsOptions, clientRateLimitIdentity } = require('../src/Config/httpSecurity');
const Limit = require('../src/models/signupRateLimit.model');
const limiter = require('../src/services/signupRateLimiter');
const { SignupError } = require('../src/services/signupOtpSecurity');

async function serve(t, policy, handler) {
    const app = express();
    app.set('trust proxy', policy);
    app.use(cors(corsOptions({})));
    app.use(handler);
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));
    return `http://127.0.0.1:${server.address().port}`;
}
const localProxy = hops => trustedProxyPolicy({ TRUSTED_PROXY_CIDRS: '127.0.0.1/32,192.0.2.10/32', TRUSTED_PROXY_MAX_HOPS: String(hops) });

test('proxy configuration defaults closed and rejects broad or malformed trust', () => {
    assert.equal(trustedProxyPolicy({}), false);
    for (const value of ['true', '1', '*', 'loopback', '10.0.0.0/8', '::/0', '127.0.0.1/33', '::ffff:127.0.0.1/96']) {
        assert.throws(() => trustedProxyPolicy({ TRUSTED_PROXY_CIDRS: value }));
    }
    assert.throws(() => trustedProxyPolicy({ TRUSTED_PROXY_MAX_HOPS: '1' }));
    assert.throws(() => trustedProxyPolicy({ TRUSTED_PROXY_CIDRS: '127.0.0.1', TRUSTED_PROXY_MAX_HOPS: '6' }));
    assert.equal(localProxy(1)('127.0.0.1', 1), false);
    assert.equal(localProxy(1)('198.51.100.1', 0), false);
});

test('canonical identities prevent equivalent IPv6 spellings creating separate budgets', () => {
    assert.equal(canonicalIp('::ffff:127.0.0.1'), '127.0.0.1');
    assert.equal(canonicalIp('2001:0DB8:0:0:0:0:0:1'), '2001:db8::1');
    for (const ip of ['garbage', '127.0.0.1:123', 'fe80::1%eth0', undefined]) assert.equal(canonicalIp(ip), null);
    assert.equal(clientRateLimitIdentity({ ip: 'garbage', socket: { remoteAddress: '127.0.0.1' } }), '127.0.0.1');
});

test('untrusted socket ignores every forwarded identity header', async t => {
    const url = await serve(t, trustedProxyPolicy({}), (req, res) => res.json({ ip: clientRateLimitIdentity(req) }));
    const response = await fetch(url, { headers: { 'X-Forwarded-For': '198.51.100.7', 'X-Real-IP': '198.51.100.8', 'CF-Connecting-IP': '198.51.100.9' } });
    assert.equal((await response.json()).ip, '127.0.0.1');
});

test('verified proxy resolves nearest untrusted client; forged prefixes do not alter identity', async t => {
    const url = await serve(t, localProxy(1), (req, res) => res.json({ ip: clientRateLimitIdentity(req) }));
    for (const prefix of ['203.0.113.1', '203.0.113.2, 203.0.113.3']) {
        const response = await fetch(url, { headers: { 'X-Forwarded-For': `${prefix}, 198.51.100.7` } });
        assert.equal((await response.json()).ip, '198.51.100.7');
    }
    const other = await fetch(url, { headers: { 'X-Forwarded-For': '198.51.100.8' } });
    assert.equal((await other.json()).ip, '198.51.100.8');
});

test('bounded multi-proxy walk stops at untrusted peer and hop ceiling', async t => {
    const url = await serve(t, localProxy(2), (req, res) => res.json({ ip: clientRateLimitIdentity(req) }));
    for (const [header, expected] of [
        ['203.0.113.9, 198.51.100.7, 192.0.2.10', '198.51.100.7'],
        ['203.0.113.9, 198.51.100.7', '198.51.100.7'],
        ['203.0.113.9, 192.0.2.10, 192.0.2.10', '192.0.2.10']
    ]) {
        const response = await fetch(url, { headers: { 'X-Forwarded-For': header } });
        assert.equal((await response.json()).ip, expected);
    }
});

test('forged headers cannot reset persistent limiter; allowed cross-origin 429 exposes Retry-After', async t => {
    const original = Limit.findOneAndUpdate;
    const counts = new Map();
    Limit.findOneAndUpdate = async ({ _id }) => {
        counts.set(_id, (counts.get(_id) || 0) + 1);
        return { count: counts.get(_id) };
    };
    t.after(() => { Limit.findOneAndUpdate = original; });
    const url = await serve(t, localProxy(1), async (req, res) => {
        try {
            await limiter.consume('test-only-secret', 'signup:ip', clientRateLimitIdentity(req), 1, 120000, 0);
            res.json({ ok: true });
        } catch (error) {
            assert.ok(error instanceof SignupError);
            res.set('Retry-After', String(error.retryAfter)).status(error.status).json({ code: error.code });
        }
    });
    const headers = { Origin: 'https://expenseiq-tracker-app.netlify.app', 'X-Forwarded-For': '203.0.113.1, 198.51.100.7' };
    assert.equal((await fetch(url, { method: 'POST', headers })).status, 200);
    headers['X-Forwarded-For'] = '203.0.113.2, 198.51.100.7';
    const limited = await fetch(url, { method: 'POST', headers });
    assert.equal(limited.status, 429);
    assert.equal(limited.headers.get('Retry-After'), '120');
    assert.equal(limited.headers.get('Access-Control-Expose-Headers'), 'Retry-After');
    assert.equal(limited.headers.get('Access-Control-Allow-Origin'), headers.Origin);
    headers['X-Forwarded-For'] = '198.51.100.8';
    assert.equal((await fetch(url, { method: 'POST', headers })).status, 200);
});

test('CORS preflight permits approved frontend headers; unknown origins lack access', async t => {
    const url = await serve(t, false, (req, res) => res.json({ ok: true }));
    const response = await fetch(url, { method: 'OPTIONS', headers: {
        Origin: 'https://expenseiq-tracker-app.netlify.app', 'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'authorization,content-type'
    } });
    assert.equal(response.status, 204);
    assert.match(response.headers.get('Access-Control-Allow-Headers'), /authorization/);
    assert.match(response.headers.get('Access-Control-Allow-Methods'), /POST/);
    const denied = await fetch(url, { headers: { Origin: 'https://unapproved.example' } });
    assert.equal(denied.headers.get('Access-Control-Allow-Origin'), null);
    assert.equal((await fetch(url)).status, 200);
    for (const origin of ['*', 'null', 'https://example.com/path', 'http://example.com']) {
        assert.throws(() => corsOptions({ CORS_ALLOWED_ORIGINS: origin }));
    }
    assert.doesNotThrow(() => corsOptions({ CORS_ALLOWED_ORIGINS: 'http://localhost:5500' }));
});
