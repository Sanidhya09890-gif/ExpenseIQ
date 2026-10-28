'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../js/group.js'), 'utf8');
const A = '000000000000000000000001';
const B = '000000000000000000000002';
const C = '000000000000000000000003';
const G = '000000000000000000000010';
const member = (id, username) => ({ _id: id, username });
const payload = () => ({ members: [member(A, 'Owner'), member(B, 'Admin')], expenses: [
    { title: 'Hotel', amount: 2000, paidBy: member(B, 'Admin'), splitBetween: [B] }
], summary: { totalAmountPaise: 200000, users: [
    { userId: A, paidPaise: 0, sharePaise: 0, netPaise: 0 },
    { userId: B, paidPaise: 200000, sharePaise: 200000, netPaise: 0 }
], unresolvedUserIds: [] } });

// Minimal DOM adapter: exercises the actual page script and event handlers without
// dependencies, a browser, network access, or a database. Layout needs browser QA.
class Element {
    constructor(tag = 'div') {
        this.tag = tag; this.children = []; this.listeners = {}; this.value = '';
        this.textContent = ''; this.checked = false; this.disabled = false;
        const classes = new Set();
        this.classList = { add: c => classes.add(c), remove: c => classes.delete(c), contains: c => classes.has(c) };
    }
    addEventListener(type, fn) { this.listeners[type] = fn; }
    setAttribute(name, value) { (this.attributes ||= {})[name] = value; }
    getAttribute(name) { return this.attributes?.[name]; }
    contains(node) { return node === this || this.children.some(child => child.contains(node)); }
    append(...nodes) { this.children.push(...nodes); }
    appendChild(node) { this.append(node); }
    replaceChildren(...nodes) { this.children = nodes; }
    querySelector() { return this.submit; }
    reset() {}
    focus() {}
    async fire(type) { return this.listeners[type]?.({ target: this, preventDefault() {} }); }
}

async function page(initial = payload(), loggedInId = A) {
    const ids = ['expenseForm', 'expensesContainer', 'expenseTitle', 'expenseAmount', 'totalGroupSpend',
        'splitMembers', 'splitMemberList', 'splitMemberStatus', 'retryMembers', 'groupTitle',
        'inviteModalOverlay', 'openInviteModal', 'closeInviteModal', 'cancelInviteModal', 'inviteMemberForm',
        'inviteUserInput', 'inviteFeedback', 'sendInvitationBtn', 'yourTotalPaid', 'yourAllocatedShare',
        'yourNetBalance', 'yourNetBalanceCard', 'memberBalances', 'balanceStatus', 'groupMembersList',
        'groupMembersStatus', 'groupMemberCount', 'leaveGroup', 'retryGroupMembers', 'groupMembersHeading',
        'manageGroup', 'groupMembersPanel'];
    const elements = Object.fromEntries(ids.map(id => [id, new Element()]));
    elements.expenseForm.submit = new Element('button');
    elements.groupMembersPanel.hidden = true;
    elements.manageGroup.setAttribute('aria-expanded', 'false');
    elements.expenseTitle.value = 'Dinner'; elements.expenseAmount.value = '100.00';
    const storage = new Map([['token', 'test-token'], ['groupId', G], ['userId', loggedInId]]);
    const requests = [], alerts = [], documentListeners = {}, windowListeners = {};
    let next = { ok: true, data: initial };
    let membersResponse = { ok: true, status: 200, data: { groupId: G, ownerId: A, members: [A, B].map((id, i) => ({
        userId: id, username: i ? 'Admin' : 'Owner', role: i ? 'member' : 'owner',
        canLeave: id === loggedInId && id !== A, canRemove: loggedInId === A && id !== A,
        balance: { available: true, netPaise: 0, warning: null }
    })) } };
    const confirmations = [];
    let confirmAnswer = true;
    const context = vm.createContext({
        document: { getElementById: id => elements[id], createElement: tag => new Element(tag),
            createDocumentFragment: () => new Element('fragment'),
            addEventListener: (type, fn) => { documentListeners[type] = fn; } },
        window: { location: {}, addEventListener: (type, fn) => { windowListeners[type] = fn; } },
        localStorage: { getItem: key => storage.get(key) ?? null, removeItem: key => storage.delete(key), clear: () => storage.clear() },
        alert: message => alerts.push(message), console: { error() {} }, Intl, setTimeout: fn => fn(),
        ExpenseUI: { formError: (form, message) => { if (message) alerts.push(message); },
            notify(message) { alerts.push(message); }, flash(message) { alerts.push(message); },
            async confirmAction(options, action) { confirmations.push(options); if (!confirmAnswer) return false; await action(); return true; } },
        fetch: async (url, options) => {
            requests.push({ url, options });
            if (url.endsWith('/members') && options.method === 'GET') return { ok: membersResponse.ok, status: membersResponse.status, json: async () => membersResponse.data };
            return { ok: next.ok, json: async () => next.data };
        }
    });
    for (const element of Object.values(elements)) {
        element.focus = () => { context.document.activeElement = element; };
    }
    vm.runInContext(source, context);
    await new Promise(resolve => setImmediate(resolve));
    return { elements, storage, requests, alerts, context, windowListeners, documentListeners, confirmations,
        respondMembers(data, status = 200) { membersResponse = { data, status, ok: status === 200 }; },
        cancelConfirmation() { confirmAnswer = false; },
        respond(data, ok = true) { next = { data, ok }; },
        refresh: () => vm.runInContext('fetchExpenses()', context),
        boxes: () => elements.splitMemberList.children.map(label => label.children[0]) };
}

test('members use actual usernames, all selected by default; existing cards render', async () => {
    const p = await page();
    assert(p.boxes().every(box => box.checked));
    assert.equal(p.elements.splitMemberStatus.textContent, '2 of 2 selected');
    assert.equal(p.elements.expenseForm.submit.disabled, false);
    assert.deepEqual(p.elements.splitMemberList.children.map(label => label.children[1].textContent), ['Owner', 'Admin']);
    const card = p.elements.expensesContainer.children[0].children[0];
    assert.equal(card.children[0].children[0].textContent, 'Hotel');
    assert.equal(card.children[1].textContent, 'Paid by: Admin');
});

test('submits selected IDs, allows payer exclusion, keeps payer and endpoints', async () => {
    const p = await page();
    const payer = p.boxes()[0]; payer.checked = false; await payer.fire('change');
    await p.elements.expenseForm.fire('submit');
    const post = p.requests.find(r => r.options.method === 'POST');
    const body = JSON.parse(post.options.body);
    assert.deepEqual(body.splitBetween, [B]);
    assert.equal(body.paidBy, A);
    assert.equal(body.groupId, G);
    assert(post.url.endsWith('/api/expenses/add'));
    assert.equal(post.options.headers.authorization, 'test-token');
    assert(p.boxes().every(box => box.checked), 'next expense defaults to all members');
});

test('zero selected disables submit and programmatic submit sends no POST', async () => {
    const p = await page();
    for (const box of p.boxes()) { box.checked = false; await box.fire('change'); }
    assert.equal(p.elements.expenseForm.submit.disabled, true);
    await p.elements.expenseForm.fire('submit');
    assert(!p.requests.some(r => r.options.method === 'POST'));
    assert.match(p.elements.splitMemberStatus.textContent, /0 of 2 selected/);
});

test('refresh removes departed IDs, adds members, preserves manual choices', async () => {
    const p = await page();
    p.boxes()[0].checked = false; await p.boxes()[0].fire('change');
    p.respond({ members: [member(A, 'Owner renamed'), member(C, 'New member')], expenses: [] });
    await p.refresh();
    assert.deepEqual(p.boxes().map(b => [b.value, b.checked]), [[A, false], [C, true]]);
    assert.equal(p.elements.splitMemberList.children[0].children[1].textContent, 'Owner renamed');
});

test('missing API member data preserves expense history and blocks adding', async () => {
    const data = payload(); delete data.members;
    const p = await page(data);
    assert.equal(p.elements.expenseForm.submit.disabled, true);
    assert.match(p.elements.splitMemberStatus.textContent, /unavailable/);
    assert.equal(p.elements.expensesContainer.children.length, 1);
});

test('empty/unresolved members block adding; retry recovers from API errors', async () => {
    const p = await page({ members: [{ _id: A, unresolved: true }], expenses: [] });
    assert.equal(p.elements.expenseForm.submit.disabled, true);
    assert.match(p.elements.splitMemberStatus.textContent, /No available/);
    p.respond({ message: 'Membership denied' }, false);
    await p.refresh();
    assert.equal(p.elements.splitMemberStatus.textContent, 'Membership denied');
    p.respond(payload()); await p.elements.retryMembers.fire('click');
    assert.equal(p.elements.expenseForm.submit.disabled, false);
});

test('backend validation messages are preserved and selected participants retained', async () => {
    const p = await page();
    p.boxes()[0].checked = false; await p.boxes()[0].fire('change');
    p.respond({ message: 'Payer and split participants must belong to the group' }, false);
    await p.elements.expenseForm.fire('submit');
    assert.match(p.alerts[0], /must belong/);
    assert.equal(p.boxes()[0].checked, false);
    assert.equal(p.elements.expenseForm.submit.disabled, false);
});

test('changing groups in another tab blocks submission with old participants', async () => {
    const p = await page(); p.storage.set('groupId', C);
    p.windowListeners.storage({ key: 'groupId' });
    assert.equal(p.elements.expenseForm.submit.disabled, true);
    await p.elements.expenseForm.fire('submit');
    assert(!p.requests.some(r => r.options.method === 'POST'));
});

test('refresh disables submission during loading and ignores stale responses', async () => {
    const p = await page();
    let resolve;
    p.context.fetch = () => new Promise(done => { resolve = done; });
    const pending = p.refresh();
    assert.equal(p.elements.expenseForm.submit.disabled, true);
    assert.equal(p.elements.splitMembers.disabled, true);
    assert.match(p.elements.splitMemberStatus.textContent, /Loading/);
    p.storage.set('groupId', C);
    resolve({ ok: true, json: async () => ({ members: [member(C, 'Other group')], expenses: [] }) });
    await pending;
    assert(!p.elements.splitMemberList.children.some(label => label.children[1].textContent === 'Other group'));
    assert.equal(p.elements.expenseForm.submit.disabled, true);
});

test('existing invite modal and invitation request remain functional', async () => {
    const p = await page();
    await p.elements.openInviteModal.fire('click');
    assert(p.elements.inviteModalOverlay.classList.contains('show'));
    p.elements.inviteUserInput.value = 'Admin';
    p.respond({ message: 'Invitation sent successfully' });
    await p.elements.inviteMemberForm.fire('submit');
    const request = p.requests.find(r => r.url.endsWith(`/api/groups/${G}/invite`));
    assert.deepEqual(JSON.parse(request.options.body), { username: 'Admin' });
    assert.equal(p.elements.inviteFeedback.className, 'invite-feedback success');
    await p.elements.closeInviteModal.fire('click');
    assert(!p.elements.inviteModalOverlay.classList.contains('show'));
});

function sharedSummary() {
    const data = payload();
    data.summary = { totalAmountPaise: 10000, users: [
        { userId: A, paidPaise: 10000, sharePaise: 5000, netPaise: 5000 },
        { userId: B, paidPaise: 0, sharePaise: 5000, netPaise: -5000 }
    ], unresolvedUserIds: [] };
    return data;
}

test('same group shows positive and negative balances for different viewers', async () => {
    const owner = await page(sharedSummary(), A);
    const other = await page(sharedSummary(), B);
    assert.equal(owner.elements.yourNetBalance.textContent, 'You are owed ₹50.00');
    assert.equal(owner.elements.yourNetBalance.className, 'balance-positive');
    assert.equal(owner.elements.yourNetBalanceCard.className, 'personal-net balance-positive');
    assert.equal(other.elements.yourNetBalance.textContent, 'You owe ₹50.00');
    assert.equal(other.elements.yourNetBalance.className, 'balance-negative');
    assert.equal(other.elements.yourNetBalanceCard.className, 'personal-net balance-negative');
    assert.equal(owner.elements.yourTotalPaid.textContent, '₹100.00');
    assert.equal(other.elements.yourAllocatedShare.textContent, '₹50.00');
    assert.deepEqual(owner.elements.memberBalances.children.map(row => row.children[0].textContent), ['Owner', 'Admin']);
    assert.equal(owner.elements.memberBalances.children[1].children[1].textContent, 'Owes ₹50.00');
});

test('zero-expense members show genuine settled values', async () => {
    const data = payload(); data.expenses = [];
    data.summary = { totalAmountPaise: 0, users: [A, B].map(userId => ({ userId, paidPaise: 0, sharePaise: 0, netPaise: 0 })) };
    const p = await page(data);
    assert.equal(p.elements.totalGroupSpend.textContent, '₹0.00');
    assert.equal(p.elements.yourTotalPaid.textContent, '₹0.00');
    assert.equal(p.elements.yourNetBalance.textContent, 'All settled');
    assert.equal(p.elements.yourNetBalance.className, 'balance-neutral');
    assert.equal(p.elements.yourNetBalanceCard.className, 'personal-net balance-neutral');
});

test('integer paise formatting retains fractions and safe maximum precision', async () => {
    const p = await page();
    assert.equal(vm.runInContext('formatPaise(1)', p.context), '₹0.01');
    assert.equal(vm.runInContext('formatPaise(3334)', p.context), '₹33.34');
    assert.equal(vm.runInContext('formatPaise(10000000)', p.context), '₹1,00,000.00');
    assert.equal(vm.runInContext('formatPaise(9007199254740991)', p.context), '₹9,00,71,99,25,47,409.91');
});

test('successful add refreshes balance cards from the new response', async () => {
    const p = await page();
    assert.equal(p.elements.yourNetBalance.textContent, 'All settled');
    p.respond(sharedSummary());
    await p.elements.expenseForm.fire('submit');
    assert.equal(p.elements.yourNetBalance.textContent, 'You are owed ₹50.00');
    assert.equal(p.elements.totalGroupSpend.textContent, '₹100.00');
    assert(p.boxes().every(box => box.checked));
});

test('null, missing, malformed, inconsistent and absent-viewer summaries show no fabricated zero', async () => {
    for (const summary of [null, undefined, {}, { totalAmountPaise: '100', users: [] },
        { totalAmountPaise: 0, users: [] },
        { totalAmountPaise: 10, users: [{ userId: A, paidPaise: 10, sharePaise: 0, netPaise: 10 }] },
        { totalAmountPaise: 0, users: [{ userId: A, paidPaise: 0, sharePaise: 0, netPaise: 0.1 }] }]) {
        const data = payload(); data.summary = summary;
        const p = await page(data);
        assert.equal(p.elements.totalGroupSpend.textContent, '—');
        assert.equal(p.elements.yourNetBalance.textContent, '—');
        assert.equal(p.elements.yourNetBalanceCard.className, 'personal-net balance-neutral');
        assert.equal(p.elements.memberBalances.children.length, 0);
        assert.match(p.elements.balanceStatus.textContent, /Balances unavailable/);
        assert.equal(p.elements.expensesContainer.children.length, 1);
        assert.equal(p.elements.expenseForm.submit.disabled, false);
    }
});

test('calculation errors and API failures clear previous balances visibly', async () => {
    const p = await page(sharedSummary());
    p.respond({ ...payload(), summary: null, calculationError: { message: 'Invalid expense at index 0' } });
    await p.refresh();
    assert.match(p.elements.balanceStatus.textContent, /Invalid expense at index 0/);
    assert.equal(p.elements.yourTotalPaid.textContent, '—');
    p.respond({ message: 'Access denied' }, false); await p.refresh();
    assert.match(p.elements.balanceStatus.textContent, /Access denied/);
    assert.equal(p.elements.totalGroupSpend.textContent, '—');
});

test('legacy self-only and rounded shares use server figures without reconstructing splits', async () => {
    const legacy = await page(payload(), B);
    assert.equal(legacy.elements.yourTotalPaid.textContent, '₹2,000.00');
    assert.equal(legacy.elements.yourAllocatedShare.textContent, '₹2,000.00');
    assert.equal(legacy.elements.yourNetBalance.textContent, 'All settled');
    const data = payload();
    data.members.push(member(C, 'Third'));
    data.summary = { totalAmountPaise: 10000, users: [
        { userId: A, paidPaise: 10000, sharePaise: 3334, netPaise: 6666 },
        { userId: B, paidPaise: 0, sharePaise: 3333, netPaise: -3333 },
        { userId: C, paidPaise: 0, sharePaise: 3333, netPaise: -3333 }
    ] };
    const p = await page(data);
    assert.equal(p.elements.yourAllocatedShare.textContent, '₹33.34');
    assert.equal(p.elements.yourNetBalance.textContent, 'You are owed ₹66.66');
});

test('historical unresolved IDs stay visible with a warning', async () => {
    const data = sharedSummary();
    data.summary.users[1].userId = C;
    data.summary.unresolvedUserIds = [C];
    const p = await page(data);
    assert.match(p.elements.memberBalances.children[1].children[0].textContent, new RegExp(C));
    assert.match(p.elements.balanceStatus.textContent, /historical users/);
});

test('balance values are hidden during refresh loading', async () => {
    const p = await page(sharedSummary());
    let resolve;
    p.context.fetch = () => new Promise(done => { resolve = done; });
    const pending = p.refresh();
    assert.equal(p.elements.totalGroupSpend.textContent, '—');
    assert.equal(p.elements.balanceStatus.textContent, 'Loading balances...');
    assert.equal(p.elements.yourNetBalanceCard.className, 'personal-net balance-neutral');
    resolve({ ok: true, json: async () => sharedSummary() });
    await pending;
    assert.equal(p.elements.yourNetBalance.textContent, 'You are owed ₹50.00');
});

test('group markup provides dashboard navigation, decimal constraints and enabled retry placement', () => {
    const html = fs.readFileSync(path.join(__dirname, '../group.html'), 'utf8');
    assert.match(html, /class="group-dashboard-link"[^>]*href="\.\/dashboard\.html"/);
    assert(!html.includes('Back to Dashboard'));
    assert(!html.includes('onclick="logout()"'));
    assert.equal((html.match(/href="\.\/dashboard\.html"/g) || []).length, 1);
    assert.match(html, /href="#expenseForm"/);
    const amount = html.match(/<input[^>]*id="expenseAmount"[^>]*>/)[0];
    assert.match(amount, /step="0\.01"/);
    assert.match(amount, /min="0\.01"/);
    assert.match(amount, /inputmode="decimal"/);
    assert.match(amount, /required/);
    for (const field of ['expenseTitle', 'expenseAmount']) assert(html.includes(`for="${field}"`));
    const fieldset = html.match(/<fieldset[^>]*id="splitMembers"[\s\S]*?<\/fieldset>/)[0];
    assert(!fieldset.includes('id="retryMembers"'));
    assert.match(html, /<\/fieldset>\s*<button[^>]*id="retryMembers"/);
});

test('invite focus cycles, skips disabled submit, closes with Escape and restores trigger focus', async () => {
    const p = await page();
    p.elements.openInviteModal.focus();
    await p.elements.openInviteModal.fire('click');
    assert.equal(p.context.document.activeElement, p.elements.inviteUserInput);
    let prevented = false;
    p.elements.closeInviteModal.focus();
    p.documentListeners.keydown({ key: 'Tab', shiftKey: true, preventDefault() { prevented = true; } });
    assert(prevented);
    assert.equal(p.context.document.activeElement, p.elements.sendInvitationBtn);
    p.documentListeners.keydown({ key: 'Tab', shiftKey: false, preventDefault() {} });
    assert.equal(p.context.document.activeElement, p.elements.closeInviteModal);
    p.elements.sendInvitationBtn.disabled = true;
    p.elements.cancelInviteModal.focus();
    p.documentListeners.keydown({ key: 'Tab', shiftKey: false, preventDefault() {} });
    assert.equal(p.context.document.activeElement, p.elements.closeInviteModal);
    p.documentListeners.keydown({ key: 'Escape' });
    assert(!p.elements.inviteModalOverlay.classList.contains('show'));
    assert.equal(p.context.document.activeElement, p.elements.openInviteModal);
});

test('net card changes together with refreshed backend values and resets after calculation errors', async () => {
    const p = await page(sharedSummary());
    assert.equal(p.elements.yourNetBalanceCard.className, 'personal-net balance-positive');
    const negative = sharedSummary();
    negative.summary.users[0].paidPaise = 0;
    negative.summary.users[0].netPaise = -5000;
    negative.summary.users[1].paidPaise = 10000;
    negative.summary.users[1].netPaise = 5000;
    p.respond(negative);
    await p.elements.expenseForm.fire('submit');
    assert.equal(p.elements.yourNetBalanceCard.className, 'personal-net balance-negative');
    assert.equal(p.elements.yourNetBalance.textContent, 'You owe ₹50.00');
    p.respond(payload());
    await p.refresh();
    assert.equal(p.elements.yourNetBalanceCard.className, 'personal-net balance-neutral');
    assert.equal(p.elements.yourNetBalance.textContent, 'All settled');
    p.respond({ ...payload(), summary: null, calculationError: { message: 'Invalid historical expense' } });
    await p.refresh();
    assert.equal(p.elements.yourNetBalanceCard.className, 'personal-net balance-neutral');
    assert.equal(p.elements.yourNetBalance.textContent, '—');
    assert.match(p.elements.balanceStatus.textContent, /Invalid historical expense/);
});

test('expense cards display recorded participant usernames and backend-rounded shares', async () => {
    const data = payload();
    data.expenses[0].splitBetween = [member(A, 'Owner'), member(B, 'Admin'), member(C, 'Third')];
    data.summary.allocations = [{ payerId: B, amountPaise: 10000, shares: [
        { userId: A, sharePaise: 3334 }, { userId: B, sharePaise: 3333 }, { userId: C, sharePaise: 3333 }
    ] }];
    const p = await page(data);
    const split = p.elements.expensesContainer.children[0].children[0].children[2];
    assert.equal(split.children[0].textContent, 'Split between 3 members');
    assert.deepEqual(split.children.slice(1).map(row => row.children.map(n => n.textContent)),
        [['Owner', '₹33.34'], ['Admin', '₹33.33'], ['Third', '₹33.33']]);
});

test('missing or invalid allocations report unavailable shares without inventing amounts', async () => {
    for (const allocation of [undefined, { payerId: B, amountPaise: 200000, shares: [] },
        { payerId: A, amountPaise: 200000, shares: [{ userId: B, sharePaise: 200000 }] },
        { payerId: B, amountPaise: 200000, shares: [{ userId: C, sharePaise: 200000 }] },
        { payerId: B, amountPaise: 200000, shares: [{ userId: B, sharePaise: 1 }] }]) {
        const data = payload();
        if (allocation) data.summary.allocations = [allocation];
        const p = await page(data);
        const split = p.elements.expensesContainer.children[0].children[0].children[2];
        assert.match(split.children[0].textContent, /Allocated shares unavailable/);
        assert.equal(split.children[1].textContent, 'Admin');
        assert.equal(split.children.length, 2);
    }
});

test('historical self-only shares, zero allocations and unresolved identifiers stay visible', async () => {
    const data = payload();
    data.expenses[0].splitBetween = [member(B, 'Admin')];
    data.summary.allocations = [{ payerId: B, amountPaise: 200000, shares: [{ userId: B, sharePaise: 200000 }] }];
    const p = await page(data);
    assert.equal(p.elements.expensesContainer.children[0].children[0].children[2].children[0].textContent, 'Split between 1 member');
    assert.equal(p.elements.expensesContainer.children[0].children[0].children[2].children[1].children[1].textContent, '₹2,000.00');
    data.expenses[0].splitBetween = [member(B, 'Admin'), { _id: C, unresolved: true }];
    data.summary.allocations = [{ payerId: B, amountPaise: 1, shares: [{ userId: B, sharePaise: 1 }, { userId: C, sharePaise: 0 }] }];
    p.respond(data); await p.refresh();
    const split = p.elements.expensesContainer.children[0].children[0].children[2];
    assert.match(split.children[2].children[0].textContent, new RegExp(C));
    assert.equal(split.children[2].children[1].textContent, '₹0.00');
});

test('expense accordion defaults closed, opens only one row, and collapses on repeated activation', async () => {
    const data = payload(); data.expenses.push({ ...data.expenses[0], title: 'Dinner' });
    const p = await page(data);
    const [first, second] = p.elements.expensesContainer.children[0].children;
    for (const item of [first, second]) {
        assert.equal(item.children[0].tag, 'button');
        assert.equal(item.children[0].type, 'button');
        assert.equal(item.children[0].getAttribute('aria-expanded'), 'false');
        assert.equal(item.children[0].getAttribute('aria-controls'), item.children[2].id);
        assert.equal(item.children[2].getAttribute('aria-labelledby'), item.children[0].id);
        assert.equal(item.children[2].hidden, true);
    }
    await first.fire('click');
    assert.equal(first.children[2].hidden, false);
    assert.equal(first.children[0].getAttribute('aria-expanded'), 'true');
    await second.fire('click');
    assert.equal(first.children[2].hidden, true);
    assert.equal(second.children[2].hidden, false);
    await second.fire('click');
    assert.equal(second.children[2].hidden, true);
});

test('expanded expense shows only participants and missing-share message without redundant metadata', async () => {
    const p = await page();
    const item = p.elements.expensesContainer.children[0].children[0];
    await item.fire('click');
    const split = item.children[2];
    assert.equal(split.hidden, false);
    assert.match(split.children[0].textContent, /Allocated shares unavailable/);
    assert.equal(split.children.length, 2);
    assert.equal(split.children[1].textContent, 'Admin');
    assert(!split.children.some(child => child.tag === 'dl'));
    // Selecting/copying text within the breakdown must not collapse the row.
    await item.listeners.click({ target: split.children[1] });
    assert.equal(split.hidden, false);
});

test('Add Expense blocks duplicate submissions and restores controls after request failure', async () => {
    const p = await page(); let calls = 0, release;
    p.context.fetch = async () => { calls++; return new Promise(resolve => { release = resolve; }); };
    const pending = p.elements.expenseForm.fire('submit');
    await p.elements.expenseForm.fire('submit');
    assert.equal(calls, 1);
    assert.equal(p.elements.expenseForm.submit.disabled, true);
    assert.equal(p.elements.expenseForm.submit.textContent, 'Adding expense...');
    release({ ok: false, json: async () => ({ message: 'Invalid participants' }) }); await pending;
    assert.equal(p.elements.expenseForm.submit.disabled, false);
    assert(p.alerts.includes('Invalid participants'));
    assert.equal(p.elements.expenseForm.submit.textContent, 'Add Expense');
});

function managementPayload(viewer = A, balance = { available: true, netPaise: 0 }, ids = [A, B]) {
    return { groupId: G, ownerId: A, members: ids.map(id => ({ userId: id,
        username: id === A ? 'Owner' : 'Admin', role: id === A ? 'owner' : 'member',
        canLeave: id === viewer && viewer !== A, canRemove: viewer === A && id !== A, balance })) };
}

test('owner/member controls and dynamic count reflect verified API membership', async () => {
    const owner = await page(), memberPage = await page(payload(), B);
    assert.equal(owner.elements.leaveGroup.hidden, true);
    assert.equal(owner.elements.groupMemberCount.textContent, '2');
    const rows = owner.elements.groupMembersList.children;
    assert.equal(rows[0].children[1].children[0].textContent, 'Owner');
    assert.equal(rows[0].children[1].children[1].textContent, 'Owner · You');
    assert.equal(rows[0].children.length, 2);
    assert.equal(rows[1].children[2].textContent, 'Remove');
    assert.equal(memberPage.elements.leaveGroup.hidden, false);
    assert(memberPage.elements.groupMembersList.children.every(row => row.children.length === 2));
});

for (const [label, balance, pattern] of [
    ['positive', { available: true, netPaise: 5001 }, /owed ₹50\.01/],
    ['negative', { available: true, netPaise: -5001 }, /owes ₹50\.01/],
    ['zero', { available: true, netPaise: 0 }, /current balance is settled/],
    ['unavailable', { available: false, netPaise: null }, /could not be determined/]
]) test(`${label} fresh leave preview is shown before confirmation; cancel changes nothing`, async () => {
    const p = await page(payload(), B);
    p.respondMembers(managementPayload(B, balance));
    p.cancelConfirmation();
    await p.elements.leaveGroup.fire('click');
    assert.equal(p.confirmations.length, 1);
    assert.match(p.confirmations[0].message, pattern);
    assert(!p.requests.some(r => r.url.endsWith('/leave')));
    assert.equal(p.storage.get('groupId'), G);
});

test('successful leave sends authenticated self action, clears group context and navigates', async () => {
    const p = await page(payload(), B);
    p.storage.set('selectedGroupName', 'Thailand');
    p.respond({ message: 'You left the group', balance: { available: true, netPaise: -1 } });
    await p.elements.leaveGroup.fire('click');
    const request = p.requests.find(r => r.url.endsWith(`/api/groups/${G}/leave`));
    assert.equal(request.options.method, 'POST'); assert.equal(request.options.headers.authorization, 'test-token');
    assert.equal(p.storage.get('groupId'), undefined); assert.equal(p.storage.get('selectedGroupName'), undefined);
    assert.equal(p.context.window.location.href, './dashboard.html');
    assert.equal(p.elements.expenseForm.submit.disabled, true);
    assert(p.alerts.some(message => message.includes('₹0.01')));
});

test('owner remove confirmation can be cancelled without a DELETE', async () => {
    const p = await page(); p.storage.set('selectedGroupName', 'Thailand'); p.cancelConfirmation();
    await p.elements.groupMembersList.children[1].children[2].fire('click');
    assert.match(p.confirmations[0].message, /Remove Admin from "Thailand"/);
    assert(!p.requests.some(r => r.options.method === 'DELETE'));
});

test('kicking refreshes member list, participant selection and balances while retaining history', async () => {
    const p = await page();
    const remove = p.elements.groupMembersList.children[1].children[2];
    p.context.fetch = async (url, options) => {
        p.requests.push({ url, options });
        if (options.method === 'DELETE') {
            p.respondMembers(managementPayload(A, { available: true, netPaise: 0 }, [A]));
            return { ok: true, json: async () => ({ balance: { available: true, netPaise: 0 } }) };
        }
        if (url.endsWith('/members')) return { ok: true, json: async () => managementPayload(A, { available: true, netPaise: 0 },
            p.requests.some(r => r.options.method === 'DELETE') ? [A] : [A, B]) };
        return { ok: true, json: async () => ({ ...payload(), members: [member(A, 'Owner')] }) };
    };
    await remove.fire('click');
    assert.equal(p.elements.groupMemberCount.textContent, '1');
    assert.deepEqual(p.boxes().map(box => box.value), [A]);
    assert.equal(p.elements.expensesContainer.children[0].children[0].children[0].children[0].textContent, 'Hotel');
    assert(p.requests.some(r => r.options.method === 'DELETE' && r.url.endsWith(`/members/${B}`)));
    assert.equal(p.context.window.location.href, undefined);
});

test('access-loss member responses revoke controls and redirect; transient errors offer retry', async () => {
    for (const status of [401, 403, 404, 503]) {
        const p = await page(); p.respondMembers({ message: 'Member request failed' }, status);
        await p.elements.retryGroupMembers.fire('click');
        if (status === 503) {
            assert.equal(p.elements.retryGroupMembers.hidden, false);
            assert.equal(p.context.window.location.href, undefined);
            assert.equal(p.storage.get('groupId'), G);
        } else {
            assert.equal(p.elements.expenseForm.submit.disabled, true);
            assert.equal(p.storage.get('groupId'), undefined);
            assert.equal(p.context.window.location.href, status === 401 ? './login.html' : './dashboard.html');
        }
    }
});

test('fresh permission denial prevents stale owner controls from sending DELETE', async () => {
    const p = await page(); const remove = p.elements.groupMembersList.children[1].children[2];
    p.respondMembers({ ...managementPayload(), ownerId: B, members: managementPayload().members.map(m => ({ ...m, canRemove: false })) });
    await remove.fire('click');
    assert.equal(p.confirmations.length, 0);
    assert(!p.requests.some(r => r.options.method === 'DELETE'));
    assert(p.alerts.some(message => message.includes('permissions changed')));
});

test('failed removal shows backend error and preserves membership and group selection', async () => {
    const p = await page(); const remove = p.elements.groupMembersList.children[1].children[2];
    p.respond({ message: 'Removal failed' }, false);
    await remove.fire('click');
    assert(p.alerts.includes('Removal failed'));
    assert.equal(p.storage.get('groupId'), G);
    assert.equal(p.elements.groupMemberCount.textContent, '2');
});

test('duplicate management clicks do not open overlapping confirmations', async () => {
    const p = await page(); p.cancelConfirmation();
    const remove = p.elements.groupMembersList.children[1].children[2];
    let calls = 0, release;
    p.context.fetch = async () => { calls++; return new Promise(resolve => { release = resolve; }); };
    const pending = remove.fire('click');
    await remove.fire('click');
    assert.equal(calls, 1);
    release({ ok: true, json: async () => managementPayload() });
    // The final post-cancel refresh is a second request, not a duplicate removal.
    await new Promise(resolve => setImmediate(resolve));
    release({ ok: true, json: async () => managementPayload() });
    await pending;
    assert.equal(p.confirmations.length, 1);
    assert.equal(p.confirmations[0].confirmLabel, 'Remove Member');
});

test('focus revalidation detects a member kicked while the page was inactive', async () => {
    const p = await page(payload(), B);
    p.respondMembers({ message: 'Group not found or you are not a current member' }, 404);
    await p.windowListeners.focus();
    assert.equal(p.context.window.location.href, './dashboard.html');
    assert.equal(p.elements.leaveGroup.hidden, true);
    assert.equal(p.elements.openInviteModal.disabled, true);
});

test('Manage Group starts collapsed, toggles ARIA state, and refreshes members on every open', async () => {
    const html = fs.readFileSync(path.join(__dirname, '../group.html'), 'utf8');
    assert.match(html, /<button[^>]*type="button"[^>]*id="manageGroup"[^>]*aria-expanded="false"[^>]*aria-controls="groupMembersPanel"/);
    assert.match(html, /<section[^>]*id="groupMembersPanel"[^>]*hidden/);
    const p = await page();
    assert.equal(p.elements.groupMembersPanel.hidden, true);
    const before = p.requests.filter(r => r.url.endsWith('/members')).length;
    await p.elements.manageGroup.fire('click');
    assert.equal(p.elements.groupMembersPanel.hidden, false);
    assert.equal(p.elements.manageGroup.getAttribute('aria-expanded'), 'true');
    assert.equal(p.requests.filter(r => r.url.endsWith('/members')).length, before + 1);
    assert.equal(p.elements.groupMembersList.children[1].children[2].textContent, 'Remove');
    await p.elements.manageGroup.fire('click');
    assert.equal(p.elements.groupMembersPanel.hidden, true);
    assert.equal(p.elements.manageGroup.getAttribute('aria-expanded'), 'false');
    p.respondMembers(managementPayload(A, { available: true, netPaise: 0 }, [A]));
    await p.elements.manageGroup.fire('click');
    assert.equal(p.elements.groupMemberCount.textContent, '1');
});

test('expanded management preserves Leave confirmation and access loss closes the panel', async () => {
    const p = await page(payload(), B); p.cancelConfirmation();
    await p.elements.manageGroup.fire('click');
    assert.equal(p.elements.leaveGroup.hidden, false);
    await p.elements.leaveGroup.fire('click');
    assert.equal(p.confirmations[0].confirmLabel, 'Leave Group');
    assert.equal(p.elements.groupMembersPanel.hidden, false);
    p.respondMembers({ message: 'Membership revoked' }, 404);
    await p.windowListeners.focus();
    assert.equal(p.elements.groupMembersPanel.hidden, true);
    assert.equal(p.elements.manageGroup.disabled, true);
    assert.equal(p.elements.manageGroup.getAttribute('aria-expanded'), 'false');
});

test('group heading preserves user-created names and emojis without appending decoration', async () => {
    const p = await page();
    for (const name of ['Thailand', 'Dinner club', 'My trip ✈️', 'A very long group name '.repeat(15)]) {
        p.storage.set('selectedGroupName', name);
        p.documentListeners.DOMContentLoaded();
        assert.equal(p.elements.groupTitle.textContent, name);
    }
});
