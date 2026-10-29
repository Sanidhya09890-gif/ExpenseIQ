'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');
const zlib = require('node:zlib');
const proxyaddr = require('proxy-addr');
const mongoose = require('mongoose');
const qs = require('qs');

function post(port, body, encoding) {
    return new Promise((resolve, reject) => {
        const req = http.request({ hostname: '127.0.0.1', port, path: '/echo', method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body),
                ...(encoding ? { 'Content-Encoding': encoding } : {}) } }, res => {
            let text = ''; res.on('data', chunk => { text += chunk; });
            res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(text) }));
        });
        req.on('error', reject); req.end(body);
    });
}
test('Express preserves JSON/gzip parsing, rejects malformed/oversize input, and survives compressed trailing garbage', async t => {
    const app = express(); app.use(express.json()); app.post('/echo', (req, res) => res.json(req.body));
    app.use((error, req, res, next) => res.status(error.status || 500).json({ error: 'Invalid body' }));
    const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
    t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
    const port = server.address().port;
    const input = { title: 'Expense', amount: '100.01', splitBetween: ['member-a', 'member-b'] };
    assert.deepEqual((await post(port, JSON.stringify(input))).body, input);
    assert.deepEqual((await post(port, zlib.gzipSync(JSON.stringify(input)), 'gzip')).body, input);
    assert.equal((await post(port, '{broken')).status, 400);
    assert.equal((await post(port, JSON.stringify({ oversized: 'x'.repeat(110000) }))).status, 413);
    const trailing = Buffer.concat([zlib.gzipSync(JSON.stringify(input)), Buffer.from('trailing-invalid-gzip')]);
    assert([200, 400].includes((await post(port, trailing, 'gzip')).status));
    // An uncaught decoder error must not terminate the process after responding.
    await new Promise(resolve => setImmediate(resolve));
    assert.equal((await post(port, JSON.stringify(input))).status, 200);
});
test('proxy-addr does not trust arbitrary IPv4 clients through short IPv6/mapped-IPv6 subnet prefixes', () => {
    for (const subnet of ['::ffff:10.0.0.0/8', '::/1']) {
        const trust = proxyaddr.compile(subnet);
        assert.equal(trust('203.0.113.20', 0), false);
        const req = { socket: { remoteAddress: '203.0.113.20' }, headers: { 'x-forwarded-for': '198.51.100.10' } };
        assert.equal(proxyaddr(req, trust), '203.0.113.20');
    }
    const valid = proxyaddr.compile('::ffff:10.0.0.0/104');
    assert.equal(valid('10.1.2.3'), true); assert.equal(valid('203.0.113.20'), false);
});
test('Mongoose update casting cannot pollute Object.prototype with __proto__-prefixed dotted paths', () => {
    assert.equal(Object.prototype.$fullPath, undefined); assert.equal(Object.prototype.$parentSchemaDocArray, undefined);
    const Model = mongoose.model('DependencySecurityProbe', new mongoose.Schema({ name: String }, { autoCreate: false, autoIndex: false }));
    try {
        const query = Model.updateOne({}, {});
        try { query._castUpdate(JSON.parse('{"$set":{"__proto__.x":"anything"}}')); } catch { /* Rejection is also safe. */ }
        assert.equal(Object.prototype.$fullPath, undefined);
        assert.equal(Object.prototype.$parentSchemaDocArray, undefined);
    } finally {
        delete Object.prototype.$fullPath; delete Object.prototype.$parentSchemaDocArray;
        mongoose.deleteModel('DependencySecurityProbe');
    }
});
test('qs handles comma-format null entries and rejects prototype-key pollution', () => {
    assert.doesNotThrow(() => qs.stringify({ a: [null, undefined, 'value'] }, { arrayFormat: 'comma', encodeValuesOnly: true }));
    qs.parse('item[__proto__][expenseiqPolluted]=true&constructor[prototype][expenseiqPolluted]=true');
    assert.equal(Object.prototype.expenseiqPolluted, undefined);
});
