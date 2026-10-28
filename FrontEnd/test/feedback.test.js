'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const script = name => fs.readFileSync(path.join(__dirname, `../js/${name}.js`), 'utf8');

function environment() {
    let document;
    class Node {
        constructor(tag) { this.tag = tag; this.children = []; this.listeners = {}; this.attributes = {}; this.textContent = ''; this.disabled = false; this.isConnected = true; this.value = ''; }
        append(...children) { children.forEach(child => { child.parent = this; this.children.push(child); }); }
        appendChild(child) { this.append(child); }
        setAttribute(k, v) { this.attributes[k] = v; }
        removeAttribute(k) { delete this.attributes[k]; }
        addEventListener(k, v) { this.listeners[k] = v; }
        focus() { document.activeElement = this; }
        remove() { this.isConnected = false; if (this.parent) this.parent.children = this.parent.children.filter(n => n !== this); }
        showModal() { this.open = true; }
        close() { this.open = false; }
        getBoundingClientRect() { return { left: 10, right: 100, top: 10, bottom: 100 }; }
        querySelector() { return this.submit; }
    }
    const ids = {};
    document = { body: new Node('body'), activeElement: null, createElement: tag => new Node(tag), getElementById: id => ids[id] };
    const storage = new Map();
    const context = vm.createContext({ document, setTimeout() {}, console: { error() {} },
        localStorage: { setItem: (k, v) => storage.set(k, v) }, window: { location: {} } });
    vm.runInContext(script('feedback'), context);
    return { context, document, ids, storage, Node, ui: context.ExpenseUI };
}

test('busy states prevent duplicates and restore text, disabled state, and ARIA', () => {
    const p = environment(), button = new p.Node('button'); button.textContent = 'Submit';
    const restore = p.ui.busy(button, 'Working...');
    assert.equal(button.disabled, true); assert.equal(button.textContent, 'Working...');
    assert.equal(button.attributes['aria-busy'], 'true');
    assert.equal(p.ui.busy(button, 'Duplicate'), null);
    restore(); assert.equal(button.disabled, false); assert.equal(button.textContent, 'Submit');
    assert.equal(button.attributes['aria-busy'], undefined);
});

test('shared confirmation supports member actions with custom labels and warnings', async () => {
    const p = environment(); let release;
    const result = p.ui.confirmAction({ title: 'Leave group?', message: 'You owe ₹50.00. Debts remain unchanged.',
        confirmLabel: 'Leave Group', pendingLabel: 'Leaving...' }, async () => new Promise(resolve => { release = resolve; }));
    const dialog = p.document.body.children[0];
    assert.equal(dialog.children[0].textContent, 'Leave group?');
    assert.match(dialog.children[1].textContent, /₹50\.00/);
    const button = dialog.children[3].children[1];
    assert.equal(button.textContent, 'Leave Group');
    const action = button.listeners.click(); assert.equal(button.textContent, 'Leaving...');
    release(); await action; assert.equal(await result, true);
});

test('inline errors reuse an accessible node and toasts render text safely', () => {
    const p = environment(), form = new p.Node('form'); form.id = 'form';
    p.ui.formError(form, 'Invalid input'); p.ui.formError(form, 'Try again');
    assert.equal(form.children.length, 1); assert.equal(form.children[0].attributes.role, 'alert');
    assert.equal(form.children[0].textContent, 'Try again');
    p.ui.formError(form); assert.equal(form.children[0].hidden, true);
    p.ui.notify('<success>', 'success');
    const toast = p.document.body.children[0].children[0];
    assert.equal(toast.attributes.role, 'status'); assert.equal(toast.children[0].textContent, '<success>');
    toast.children[1].listeners.click(); assert.equal(toast.isConnected, false);
});

for (const method of ['cancel', 'escape', 'backdrop']) {
    test(`delete confirmation ${method} sends no delete and restores focus`, async () => {
        const p = environment(), trigger = new p.Node('button'); trigger.focus(); let calls = 0;
        const result = p.ui.confirmDelete('Owner’s trip', async () => { calls++; });
        const dialog = p.document.body.children[0], actions = dialog.children[3];
        assert.match(dialog.children[1].textContent, /Owner’s trip/);
        assert.equal(p.document.activeElement, actions.children[0]);
        if (method === 'cancel') actions.children[0].listeners.click();
        if (method === 'escape') dialog.listeners.cancel({ preventDefault() {} });
        if (method === 'backdrop') dialog.listeners.click({ target: dialog, clientX: 0, clientY: 0 });
        assert.equal(await result, false); assert.equal(calls, 0); assert.equal(p.document.activeElement, trigger);
    });
}

test('delete confirmation keeps loading locked, prevents duplicates, and reports failures before retry', async () => {
    const p = environment(); let calls = 0, release;
    const result = p.ui.confirmDelete('Trip', async () => { calls++; if (calls === 1) throw Error('Denied'); await new Promise(r => { release = r; }); });
    const dialog = p.document.body.children[0], [cancel, remove] = dialog.children[3].children;
    await remove.listeners.click(); assert.equal(dialog.children[2].textContent, 'Denied');
    assert.equal(remove.disabled, false);
    const request = remove.listeners.click();
    assert.equal(remove.textContent, 'Deleting...'); assert.equal(cancel.disabled, true);
    await remove.listeners.click(); assert.equal(calls, 2);
    dialog.listeners.cancel({ preventDefault() {} }); assert.equal(dialog.open, true);
    assert.equal(await p.ui.confirmDelete('Other', async () => {}), false);
    release(); await request; assert.equal(await result, true);
});

for (const name of ['login', 'signup']) {
    test(`${name} shows progress, blocks duplicate submission, and navigates only on success`, async () => {
        const p = environment(); const form = new p.Node('form'); form.id = `${name}Form`;
        form.submit = new p.Node('button'); form.submit.textContent = 'Submit'; p.ids[form.id] = form;
        for (const id of ['loginInput', 'username', 'email', 'password']) { p.ids[id] = new p.Node('input'); p.ids[id].value = 'test'; }
        let requests = 0, finish;
        p.context.fetch = async () => { requests++; return new Promise(resolve => { finish = resolve; }); };
        vm.runInContext(script(name), p.context);
        const submit = () => form.listeners.submit({ preventDefault() {} });
        const pending = submit(); await submit(); assert.equal(requests, 1);
        assert.equal(form.submit.disabled, true);
        assert.equal(form.submit.textContent, name === 'login' ? 'Signing in...' : 'Creating account...');
        finish({ ok: false, json: async () => ({ message: 'Invalid credentials' }) }); await pending;
        assert.equal(form.submit.disabled, false); assert.equal(p.context.window.location.href, undefined);
        assert.equal(form.children[0].textContent, 'Invalid credentials');
        const successful = submit(); finish({ ok: true, json: async () => ({ token: 'token', user: { _id: 'id', username: 'Owner' } }) });
        await successful;
        assert.equal(p.context.window.location.href, name === 'login' ? './dashboard.html' : './login.html');
        if (name === 'login') assert.equal(p.storage.get('token'), 'token');
    });
}
