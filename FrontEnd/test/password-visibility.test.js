'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const script = fs.readFileSync(path.join(root, 'js/password-visibility.js'), 'utf8');

function fixture(page) {
    const html = fs.readFileSync(path.join(root, page), 'utf8');
    const inputTag = html.match(/<input[^>]*type="password"[^>]*>/s)?.[0];
    assert.ok(inputTag, `${page} must retain a password input`);
    const inputId = inputTag.match(/id="([^"]+)"/)[1];
    const buttonTag = html.match(/<button class="password-toggle"[^>]*>/)?.[0];
    assert.ok(buttonTag, `${page} must provide a visibility button`);
    assert.match(buttonTag, /type="button"/);
    assert.match(buttonTag, new RegExp(`aria-controls="${inputId}"`));

    const buttonStart = html.indexOf(buttonTag);
    const iconMarkup = html.slice(buttonStart, html.indexOf('</button>', buttonStart));
    assert.equal((iconMarkup.match(/<svg\s/g) || []).length, 1, 'toggle uses one inline SVG');
    assert.match(iconMarkup, /<path\s+data-eye-slash(?:\s|>)/);

    const input = { type: 'password', value: 'keep-this-password' };
    const slashMarkup = iconMarkup.match(/<path data-eye-slash([^>]*)>/)[1];
    const slash = { hidden: /(?:^|\s)hidden(?:\s|$)/.test(slashMarkup) };
    const attrs = {
        'aria-controls': inputId,
        'aria-pressed': buttonTag.match(/aria-pressed="([^"]+)"/)[1],
        'aria-label': buttonTag.match(/aria-label="([^"]+)"/)[1]
    };
    let click;
    const button = {
        setAttribute: (name, value) => { attrs[name] = value; },
        getAttribute: name => attrs[name],
        addEventListener: (name, handler) => { if (name === 'click') click = handler; },
        querySelector: selector => selector === '[data-eye-slash]' ? slash : null
    };
    const document = {
        querySelectorAll: () => [button],
        getElementById: id => id === inputId ? input : null
    };

    vm.runInNewContext(script, { document });
    return { html, input, attrs, slash, click };
}

function assertState(page, type, visible) {
    assert.equal(page.input.type, type);
    assert.equal(page.slash.hidden, visible, 'slash is hidden exactly while password is visible');
    assert.equal(page.attrs['aria-label'], visible ? 'Hide password' : 'Show password');
    assert.equal(page.attrs['aria-pressed'], String(visible));
    assert.equal(page.input.value, 'keep-this-password', 'toggle preserves entered password');
}

for (const pageName of ['login.html', 'signup.html']) {
    test(`${pageName} keeps icon, accessible state and value synchronized over repeated toggles`, () => {
        const page = fixture(pageName);
        assertState(page, 'password', false);
        for (let click = 0; click < 8; click++) {
            const visible = click % 2 === 0;
            page.click();
            assertState(page, visible ? 'text' : 'password', visible);
        }
        assert.match(page.html, /<script src="\.\/js\/password-visibility\.js"><\/script>/);
        assert.match(page.html, pageName === 'login.html' ? /login\.js/ : /signup\.js/);
    });
}

test('signup password fields are covered; no confirm-password field is currently present', () => {
    const html = fs.readFileSync(path.join(root, 'signup.html'), 'utf8');
    assert.equal((html.match(/type="password"/g) || []).length, 1);
    assert.equal((html.match(/class="password-toggle"/g) || []).length, 1);
});
