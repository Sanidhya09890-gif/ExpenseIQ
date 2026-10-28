'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../js/dashboard.js'), 'utf8');
const nodeText = node => [node.textContent || '', ...node.children.map(nodeText)].join(' ');

class Element {
    constructor() {
        this.children = []; this.listeners = {}; this.attributes = {}; this.style = {}; this.value = '';
        const classes = new Set();
        this.classList = { add: x => classes.add(x), remove: x => classes.delete(x),
            contains: x => classes.has(x), toggle: x => classes.has(x) ? classes.delete(x) : classes.add(x) };
    }
    set innerHTML(value) { this.markup = value; this.children = []; }
    get innerHTML() { return this.markup || ''; }
    append(...nodes) { this.children.push(...nodes); }
    appendChild(node) { this.append(node); }
    replaceChildren(...nodes) { this.children = nodes; }
    setAttribute(k, v) { this.attributes[k] = v; }
    addEventListener(k, fn) { this.listeners[k] = fn; }
    reset() {}
    querySelector() { return this.submit; }
    focus() {}
}
async function page(groups = [], confirmDelete = true, notifications = []) {
    const ids = ['groupsContainer', 'groupForm', 'welcomeText', 'notificationBtn', 'notificationPanel',
        'notificationClose', 'notificationList', 'notificationBadge', 'groupName', 'groupCount'];
    const elements = Object.fromEntries(ids.map(id => [id, new Element()]));
    elements.groupForm.submit = new Element();
    const storage = new Map([['token', 'token'], ['userName', 'Long <username> '.repeat(15)]]);
    const requests = [], location = {}, feedback = [], loggedErrors = [], timers = [], windowListeners = {};
    const locks = new Set();
    const context = vm.createContext({ ExpenseUI: { notify(message) { feedback.push(message); }, formError(form, message) { if (message) feedback.push(message); },
        busy(button, text) { if (locks.has(button)) return null; locks.add(button); button.disabled = true; button.textContent = text; return () => { locks.delete(button); button.disabled = false; }; },
        async confirmDelete(name, action) { if (!confirmDelete) return false; await action(); return true; }
    }, document: { getElementById: id => elements[id], createElement: () => new Element() },
        localStorage: { getItem: k => storage.get(k), setItem: (k, v) => storage.set(k, v), clear: () => storage.clear() },
        window: { location, addEventListener: (type, fn) => { windowListeners[type] = fn; } },
        setTimeout: (fn, delay) => { timers.push({ fn, delay }); return timers.length; }, clearTimeout() {},
        console: { log(...args) { loggedErrors.push(...args.filter(arg => arg?.stack).map(arg => arg.stack)); } }, alert() {}, confirm: () => confirmDelete,
        fetch: async (url, options) => { requests.push({ url, options }); return { ok: true,
            json: async () => {
                if (options.method === 'PATCH') {
                    const ids = JSON.parse(options.body).notificationIds;
                    notifications.forEach(n => { if (ids.includes(n._id)) n.isRead = true; });
                    return { modifiedCount: ids.length };
                }
                return url.endsWith('/api/notifications') ? { notifications: notifications.map(n => ({ ...n })) } : { groups };
            } }; }
    });
    vm.runInContext(source, context);
    await new Promise(resolve => setImmediate(resolve));
    return { elements, storage, requests, location, context, feedback, loggedErrors, timers, windowListeners };
}

test('dashboard renders long names safely and preserves open/delete actions', async () => {
    const name = "Owner's <trip> " + 'Thailand'.repeat(30);
    const p = await page([{ _id: 'group-id', groupName: name }]);
    const card = p.elements.groupsContainer.children[0];
    assert.equal(card.children[0].children[1].children[0].textContent, name);
    assert.equal(card.children[1].children[0].textContent, 'Open Group');
    assert.equal(card.children[1].children[0].attributes['aria-label'], 'Open group ' + name);
    card.children[1].children[0].listeners.click();
    assert.equal(p.storage.get('groupId'), 'group-id');
    assert.equal(p.storage.get('selectedGroupName'), name);
    assert.equal(p.location.href, './group.html');
    await card.children[1].children[1].listeners.click();
    assert(p.requests.some(r => r.url.endsWith('/api/groups/delete/group-id') && r.options.method === 'DELETE'));
    assert(p.elements.welcomeText.children[1].textContent.includes('<username>'));
});

test('dashboard empty group state remains available', async () => {
    const p = await page();
    assert.match(p.elements.groupsContainer.innerHTML, /No Groups Yet/);
});

test('notification toggle and close keep accessible state in sync', async () => {
    const p = await page();
    p.elements.notificationBtn.listeners.click();
    assert.equal(p.elements.notificationBtn.attributes['aria-expanded'], 'true');
    assert(p.elements.notificationPanel.classList.contains('show'));
    p.elements.notificationClose.listeners.click();
    assert.equal(p.elements.notificationBtn.attributes['aria-expanded'], 'false');
    assert(!p.elements.notificationPanel.classList.contains('show'));
});

test('Create Group preserves API method, auth header, and submitted name', async () => {
    const p = await page();
    p.elements.groupName.value = ' Test group ';
    await p.elements.groupForm.listeners.submit({ preventDefault() {} });
    const request = p.requests.find(r => r.url.endsWith('/api/groups/create'));
    assert.equal(request.options.method, 'POST');
    assert.equal(request.options.headers.authorization, 'token');
    assert.equal(JSON.parse(request.options.body).groupName, 'Test group');
});

test('cancelling delete confirmation sends no delete request', async () => {
    const p = await page([{ _id: 'group-id', groupName: 'Trip' }], false);
    await p.elements.groupsContainer.children[0].children[1].children[1].listeners.click();
    assert(!p.requests.some(r => r.options.method === 'DELETE'));
});

test('group count refreshes after creation and deletion, including empty state', async () => {
    const groups = [];
    const p = await page(groups);
    assert.equal(p.elements.groupCount.textContent, '0');
    groups.push({ _id: 'new-group', groupName: 'New group' });
    p.elements.groupName.value = 'New group';
    await p.elements.groupForm.listeners.submit({ preventDefault() {} });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(p.elements.groupCount.textContent, '1');
    const remove = p.elements.groupsContainer.children[0].children[1].children[1];
    groups.length = 0;
    await remove.listeners.click();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(p.elements.groupCount.textContent, '0');
    assert.match(p.elements.groupsContainer.innerHTML, /No Groups Yet/);
});

test('Create Group pending state blocks duplicates and failure keeps the entered name', async () => {
    const p = await page(); let release, calls = 0;
    p.context.fetch = async () => { calls++; return new Promise(resolve => { release = resolve; }); };
    p.elements.groupName.value = 'Trip';
    const submit = () => p.elements.groupForm.listeners.submit({ preventDefault() {} });
    const pending = submit(); await submit();
    assert.equal(calls, 1); assert.equal(p.elements.groupForm.submit.disabled, true);
    assert.equal(p.elements.groupForm.submit.textContent, 'Creating group...');
    release({ ok: false, json: async () => ({ message: 'Creation failed' }) }); await pending;
    assert.equal(p.elements.groupForm.submit.disabled, false);
    assert.equal(p.elements.groupName.value, 'Trip');
    assert(p.feedback.includes('Creation failed'));
});

test('invitation action loading blocks competing decisions and restores on API failure', async () => {
    const p = await page(); let calls = 0, release;
    const button = new Element();
    p.context.inviteButton = button;
    p.context.fetch = async () => { calls++; return new Promise(resolve => { release = resolve; }); };
    const pending = vm.runInContext("acceptInvite('invite-id', inviteButton)", p.context);
    await vm.runInContext("rejectInvite('invite-id', inviteButton)", p.context);
    assert.equal(calls, 1); assert.equal(button.disabled, true); assert.equal(button.textContent, 'Accepting...');
    release({ ok: false, json: async () => ({ message: 'Invite expired' }) }); await pending;
    assert.equal(button.disabled, false); assert(p.feedback.includes('Invite expired'));
});

test('deleted-group notification renders a fallback instead of crashing', async () => {
    const p = await page([], true, [{ type: 'INVITE_ACCEPTED', groupId: null,
        relatedUser: { username: 'Admin' }, createdAt: '2026-10-29T10:00:00Z' }]);
    assert.deepEqual(p.loggedErrors, []);
    assert.equal(p.elements.notificationList.children.length, 1);
    assert.match(nodeText(p.elements.notificationList.children[0]), /Admin accepted your invite to a deleted group/);
    assert.deepEqual(p.feedback, []);
});

test('all invitation types tolerate deleted groups/users/invites and continue rendering valid notifications', async () => {
    const notifications = [
        { type: 'INVITE_REJECTED', groupId: null, relatedUser: null },
        { type: 'INVITE_RECEIVED', groupId: null, relatedUser: { username: 'Owner' }, inviteId: { _id: 'old-invite' } },
        { type: 'INVITE_RECEIVED', groupId: { groupName: 'Thailand' }, relatedUser: { username: 'Owner' }, inviteId: null },
        { type: 'INVITE_RECEIVED', groupId: { groupName: 'Thailand' }, relatedUser: { username: 'Owner' }, inviteId: { _id: 'valid-invite', status: 'pending', expiresAt: '2999-01-01T00:00:00Z' } },
        { type: 'INVITE_ACCEPTED', groupId: { groupName: 'Thailand' }, relatedUser: { username: 'Admin' } }
    ].map(n => ({ ...n, createdAt: '2026-10-29T10:00:00Z' }));
    const p = await page([], true, notifications);
    assert.deepEqual(p.loggedErrors, []); assert.deepEqual(p.feedback, []);
    const nodes = p.elements.notificationList.children;
    const cards = nodes.map(nodeText);
    assert.equal(cards.length, 5);
    assert.match(cards[0], /A former member rejected your invite to a deleted group/);
    assert.match(cards[1], /Owner invited you to a deleted group/);
    assert.equal(nodes[1].children[1].children.length, 3);
    assert.equal(nodes[2].children[1].children.length, 3);
    assert.match(cards[3], /Owner invited you to the group Thailand/);
    assert.equal(typeof nodes[3].children[1].children[3].children[0].listeners.click, 'function');
    assert.equal(typeof nodes[3].children[1].children[3].children[1].listeners.click, 'function');
    assert.match(cards[4], /Admin accepted your invite to Thailand/);
});

const notificationId = n => n.toString(16).padStart(24, '0');
function activity(n, isRead = false) {
    return { _id: notificationId(n), type: 'INVITE_ACCEPTED', isRead,
        relatedUser: { username: 'Admin' }, groupId: null, createdAt: '2026-10-29T10:00:00Z' };
}
function invitation(n, overrides = {}) {
    return { _id: notificationId(n), type: 'INVITE_RECEIVED', relatedUser: { username: 'Owner' },
        groupId: { groupName: 'Trip' }, inviteId: { _id: notificationId(n + 100), status: 'pending', expiresAt: '2999-01-01T00:00:00Z' },
        createdAt: '2026-10-29T10:00:00Z', ...overrides };
}

test('badge counts unread activity plus only actionable pending invitations', async () => {
    const notifications = [activity(1), activity(2, true), activity(3), invitation(4),
        invitation(5, { groupId: null }), invitation(6, { inviteId: null }),
        invitation(7, { inviteId: { _id: notificationId(107), status: 'accepted', expiresAt: '2999-01-01T00:00:00Z' } }),
        invitation(8, { inviteId: { _id: notificationId(108), status: 'pending', expiresAt: '2000-01-01T00:00:00Z' } })];
    const p = await page([], true, notifications);
    assert.equal(p.elements.notificationBadge.textContent, '3');
    assert.equal(p.elements.notificationList.children.length, 8);
    await p.elements.notificationBtn.listeners.click();
    const patch = p.requests.find(r => r.options.method === 'PATCH');
    assert.deepEqual(JSON.parse(patch.options.body).notificationIds, [notificationId(1), notificationId(3)]);
    assert.equal(patch.options.headers.authorization, 'token');
    assert.equal(p.elements.notificationBadge.textContent, '1');
    assert.equal(p.elements.notificationList.children.length, 8);
    assert.equal(notifications[3].isRead, undefined);
    await p.windowListeners.focus();
    assert.equal(p.elements.notificationBadge.textContent, '1');
    assert.equal(p.requests.filter(r => r.options.method === 'PATCH').length, 1);
});

test('reading last activity hides badge and keeps historical deleted-group activity visible', async () => {
    const p = await page([], true, [activity(1)]);
    assert.equal(p.elements.notificationBadge.textContent, '1');
    await p.elements.notificationBtn.listeners.click();
    assert.equal(p.elements.notificationBadge.textContent, '0');
    assert.equal(p.elements.notificationBadge.style.display, 'none');
    assert.match(nodeText(p.elements.notificationList.children[0]), /a deleted group/);
    await p.windowListeners.focus();
    assert.equal(p.elements.notificationList.children.length, 1);
    assert.equal(p.elements.notificationBadge.style.display, 'none');
});

test('failed mark-read keeps unread count and reports feedback', async () => {
    const p = await page([], true, [activity(1)]);
    p.context.fetch = async (url, options) => ({ ok: options.method !== 'PATCH', json: async () =>
        options.method === 'PATCH' ? { message: 'Read update failed' } : { notifications: [activity(1)] } });
    await p.elements.notificationBtn.listeners.click();
    assert.equal(p.elements.notificationBadge.textContent, '1');
    assert(p.feedback.includes('Read update failed'));
});

test('concurrent refreshes do not duplicate mark-read requests', async () => {
    const p = await page([], true, [activity(1)]); let patches = 0, release;
    p.context.fetch = async (url, options) => {
        if (options.method === 'PATCH') { patches++; return new Promise(resolve => { release = resolve; }); }
        return { ok: true, json: async () => ({ notifications: [activity(1)] }) };
    };
    const open = p.elements.notificationBtn.listeners.click();
    await new Promise(resolve => setImmediate(resolve));
    const focus = p.windowListeners.focus();
    assert.equal(patches, 1);
    release({ ok: true, json: async () => ({ modifiedCount: 1 }) });
    await Promise.all([open, focus]);
    assert.equal(patches, 1); assert.equal(p.elements.notificationBadge.textContent, '0');
});

test('invitation expiry timer updates badge without a reload', async () => {
    const expires = Date.now() + 60000;
    const p = await page([], true, [invitation(1, { inviteId: { _id: notificationId(101), status: 'pending', expiresAt: new Date(expires).toISOString() } })]);
    assert.equal(p.elements.notificationBadge.textContent, '1');
    assert(p.timers[0].delay > 0);
    p.context.Date = class extends Date { static now() { return expires + 1; } };
    p.timers[0].fn();
    assert.equal(p.elements.notificationBadge.textContent, '0');
    assert.equal(p.elements.notificationBadge.style.display, 'none');
});

test('notification usernames and group names remain literal text for every invitation type', async () => {
    const maliciousName = '<img src=x onerror="globalThis.compromised=true">';
    const maliciousGroup = '</p><script>globalThis.compromised=true</script><p>';
    const notifications = ['INVITE_ACCEPTED', 'INVITE_REJECTED', 'INVITE_RECEIVED'].map((type, i) => ({
        _id: notificationId(i + 1), type, isRead: true, createdAt: '2026-10-29T10:00:00Z',
        relatedUser: { username: maliciousName }, groupId: { groupName: maliciousGroup },
        message: '<svg onload="globalThis.compromised=true">',
        inviteId: { _id: notificationId(50), status: 'pending', expiresAt: '2999-01-01T00:00:00Z' }
    }));
    const p = await page([], true, notifications);
    for (const card of p.elements.notificationList.children) {
        const description = card.children[1].children[1];
        assert(description.textContent.includes(maliciousName));
        assert(description.textContent.includes(maliciousGroup));
        assert.equal(description.children.length, 0);
        assert.equal(card.markup, undefined, 'notification cards must not use innerHTML');
        assert.equal(card.children[1].markup, undefined);
    }
    assert.equal(p.context.compromised, undefined);
    assert.deepEqual(p.feedback, []);
});

test('safely rendered invitation buttons still invoke their correct API action', async () => {
    for (const [index, endpoint] of [[0, 'accept'], [1, 'reject']]) {
        const n = invitation(1);
        n.relatedUser.username = "Owner's <group>";
        const p = await page([], true, [n]);
        const button = p.elements.notificationList.children[0].children[1].children[3].children[index];
        await button.listeners.click();
        assert(p.requests.some(request => request.url.endsWith(`/api/groups/invites/${n.inviteId._id}/${endpoint}`) && request.options.method === 'POST'));
    }
});

test('all frontend production origins point to Render with no localhost remnants', () => {
    for (const name of ['login', 'signup', 'dashboard', 'group']) {
        const content = fs.readFileSync(path.join(__dirname, `../js/${name}.js`), 'utf8');
        assert(!content.includes('localhost:3000'));
        assert(content.includes('https://expenseiq-backend-xkmu.onrender.com'));
    }
});
