'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
for (const [configured, expected] of [[undefined, 3000], ['10000', 10000]]) {
    test(`server uses ${configured ? 'environment PORT' : 'local port fallback'}`, async () => {
        let port;
        const modules = {
            'node:dns': { setServers() {} }, dotenv: { config() {} },
            './src/app': { listen(value, done) { port = value; done(); return { on() {} }; } }, './src/Config/db': async () => {},
            mongoose: {}, './src/services/serverLifecycle': () => {}
        };
        vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8'), {
            require: name => modules[name], process: { env: { PORT: configured } }, console: { log() {} }
        });
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(port, expected);
    });
}
