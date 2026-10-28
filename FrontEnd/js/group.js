
const token = localStorage.getItem("token");
const groupId = localStorage.getItem("groupId");

const API_BASE = "https://expenseiq-backend-xkmu.onrender.com";

// ===============================
// PROTECT PAGE
// ===============================
if (!token) {
    window.location.href = "./login.html";
}

// ===============================
// DOM ELEMENTS
// ===============================
const expenseForm = document.getElementById("expenseForm");
const expensesContainer = document.getElementById("expensesContainer");
const titleInput = document.getElementById("expenseTitle");
const amountInput = document.getElementById("expenseAmount");
const totalSpendElement = document.getElementById("totalGroupSpend");
const yourPaidElement = document.getElementById("yourTotalPaid");
const yourShareElement = document.getElementById("yourAllocatedShare");
const yourNetElement = document.getElementById("yourNetBalance");
const yourNetCard = document.getElementById("yourNetBalanceCard");
const memberBalances = document.getElementById("memberBalances");
const balanceStatus = document.getElementById("balanceStatus");

// Format integer paise without converting to floating-point rupees.
function formatPaise(paise) {
    if (!Number.isSafeInteger(paise)) throw new Error("Invalid monetary value in summary.");
    const value = BigInt(paise);
    const magnitude = value < 0n ? -value : value;
    return `${value < 0n ? "-" : ""}₹${new Intl.NumberFormat("en-IN").format(magnitude / 100n)}.${String(magnitude % 100n).padStart(2, "0")}`;
}

function balanceLabel(net, personal = false) {
    if (net === 0) return "All settled";
    return `${personal ? (net > 0 ? "You are owed" : "You owe") : (net > 0 ? "Owed" : "Owes")} ${formatPaise(Math.abs(net))}`;
}

function balanceClass(net) {
    return net > 0 ? "balance-positive" : net < 0 ? "balance-negative" : "balance-neutral";
}

function clearBalances(message) {
    for (const element of [totalSpendElement, yourPaidElement, yourShareElement, yourNetElement]) {
        element.textContent = "—";
    }
    yourNetElement.className = "balance-neutral";
    yourNetCard.className = "personal-net balance-neutral";
    memberBalances.replaceChildren();
    balanceStatus.textContent = message;
}

function renderBalances(data) {
    try {
        if (data.calculationError) throw new Error(data.calculationError.message || "Expense calculation failed.");
        const summary = data.summary;
        if (!summary || !Number.isSafeInteger(summary.totalAmountPaise) || summary.totalAmountPaise < 0 || !Array.isArray(summary.users)) {
            throw new Error("Missing or invalid balance summary.");
        }
        const seen = new Set();
        let paidTotal = 0n, shareTotal = 0n, netTotal = 0n;
        for (const user of summary.users) {
            if (!user || typeof user.userId !== "string" || !/^[a-fA-F0-9]{24}$/.test(user.userId) ||
                seen.has(user.userId.toLowerCase()) ||
                ![user.paidPaise, user.sharePaise, user.netPaise].every(Number.isSafeInteger) ||
                user.paidPaise < 0 || user.sharePaise < 0 ||
                BigInt(user.paidPaise) - BigInt(user.sharePaise) !== BigInt(user.netPaise)) {
                throw new Error("Invalid member balances in summary.");
            }
            seen.add(user.userId.toLowerCase());
            paidTotal += BigInt(user.paidPaise);
            shareTotal += BigInt(user.sharePaise);
            netTotal += BigInt(user.netPaise);
        }
        if (paidTotal !== BigInt(summary.totalAmountPaise) || shareTotal !== paidTotal || netTotal !== 0n) {
            throw new Error("Inconsistent balance summary.");
        }
        const currentUserId = (localStorage.getItem("userId") || "").toLowerCase();
        const yours = summary.users.find(user => user.userId.toLowerCase() === currentUserId);
        if (!yours) throw new Error("Your balance is missing from the summary. Please log in again or refresh.");
        const names = new Map();
        const remember = ref => {
            if (ref && typeof ref._id === "string" && typeof ref.username === "string" && ref.username.trim()) {
                names.set(ref._id.toLowerCase(), ref.username);
            }
        };
        (Array.isArray(data.members) ? data.members : []).forEach(remember);
        for (const expense of Array.isArray(data.expenses) ? data.expenses : []) {
            remember(expense.paidBy);
            if (Array.isArray(expense.splitBetween)) expense.splitBetween.forEach(remember);
        }
        // All displayed amounts come from the server; arithmetic above only checks integrity.
        totalSpendElement.textContent = formatPaise(summary.totalAmountPaise);
        yourPaidElement.textContent = formatPaise(yours.paidPaise);
        yourShareElement.textContent = formatPaise(yours.sharePaise);
        yourNetElement.textContent = balanceLabel(yours.netPaise, true);
        yourNetElement.className = balanceClass(yours.netPaise);
        yourNetCard.className = `personal-net ${balanceClass(yours.netPaise)}`;
        memberBalances.replaceChildren();
        let unresolved = false;
        for (const user of summary.users) {
            const id = user.userId.toLowerCase();
            const row = document.createElement("div");
            row.className = "member-balance-row";
            const name = document.createElement("span");
            name.textContent = names.get(id) || `Unavailable user (${id})`;
            if (!names.has(id)) unresolved = true;
            const amount = document.createElement("span");
            amount.className = balanceClass(user.netPaise);
            amount.textContent = balanceLabel(user.netPaise);
            row.append(name, amount);
            memberBalances.appendChild(row);
        }
        balanceStatus.textContent = unresolved || summary.unresolvedUserIds?.length
            ? "Some historical users could not be resolved. Their recorded balances are included." : "";
    } catch (error) {
        clearBalances(`Balances unavailable: ${error.message}`);
    }
}
const splitMembers = document.getElementById("splitMembers");
const splitMemberList = document.getElementById("splitMemberList");
const splitMemberStatus = document.getElementById("splitMemberStatus");
const retryMembers = document.getElementById("retryMembers");
const expenseSubmitButton = expenseForm?.querySelector('button[type="submit"]');
let currentMemberIds = new Set();
let selectedMemberIds = new Set();
let membersReady = false;
let addingExpense = false;
let expenseRequest = 0;
const groupMembersList = document.getElementById("groupMembersList");
const groupMembersStatus = document.getElementById("groupMembersStatus");
const groupMemberCount = document.getElementById("groupMemberCount");
const leaveGroupButton = document.getElementById("leaveGroup");
const retryGroupMembers = document.getElementById("retryGroupMembers");
let membershipLost = false;
let managementBusy = false;
let memberRequest = 0;
let memberData = null;
const memberActionButtons = new Map();
const manageGroupButton = document.getElementById("manageGroup");
const groupMembersPanel = document.getElementById("groupMembersPanel");
manageGroupButton.addEventListener("click", async () => {
    if (!currentGroupIsOpen()) return;
    const opening = groupMembersPanel.hidden;
    groupMembersPanel.hidden = !opening;
    manageGroupButton.setAttribute("aria-expanded", String(opening));
    if (opening) await fetchGroupMembers();
});

function loseGroupAccess(message, status = 404, kind = status === 401 ? "error" : "info") {
    if (membershipLost) return;
    membershipLost = true;
    manageGroupButton.disabled = true;
    manageGroupButton.setAttribute("aria-expanded", "false");
    groupMembersPanel.hidden = true;
    ++memberRequest; ++expenseRequest;
    membersReady = false;
    splitMembers.disabled = true;
    expenseSubmitButton.disabled = true;
    leaveGroupButton.hidden = true;
    groupMembersList.replaceChildren();
    memberActionButtons.clear();
    expensesContainer.replaceChildren();
    clearBalances(message);
    document.getElementById("openInviteModal").disabled = true;
    document.getElementById("sendInvitationBtn").disabled = true;
    if (localStorage.getItem("groupId") === groupId) {
        localStorage.removeItem("groupId");
        localStorage.removeItem("selectedGroupName");
    }
    ExpenseUI.flash(message, kind);
    window.location.href = status === 401 ? "./login.html" : "./dashboard.html";
}

function balanceWarning(balance) {
    if (!balance?.available || !Number.isSafeInteger(balance.netPaise)) {
        return "The outstanding amount could not be determined from historical data. Removal does not settle, cancel, or redistribute existing debts.";
    }
    if (balance.netPaise === 0) return "The current balance is settled. Historical expenses will be preserved.";
    return `${balance.netPaise > 0 ? "This member is owed" : "This member owes"} ${formatPaise(Math.abs(balance.netPaise))}. Removal does not settle, cancel, or redistribute existing debts. Historical balances remain unchanged.`;
}

async function fetchGroupMembers() {
    if (!currentGroupIsOpen()) return null;
    const request = ++memberRequest;
    memberData = null;
    leaveGroupButton.hidden = true;
    groupMembersList.replaceChildren();
    memberActionButtons.clear();
    groupMembersStatus.textContent = "Loading members...";
    retryGroupMembers.hidden = true;
    try {
        const response = await fetch(`${API_BASE}/api/groups/${encodeURIComponent(groupId)}/members`, {
            method: "GET", headers: { authorization: token }
        });
        const data = await response.json();
        if (request !== memberRequest || !currentGroupIsOpen()) return null;
        if (!response.ok) {
            if ([401, 403, 404].includes(response.status)) loseGroupAccess(data.message || "You no longer have access to this group.", response.status);
            throw new Error(data.message || "Unable to load group members.");
        }
        const userId = localStorage.getItem("userId");
        if (data.groupId !== groupId || !Array.isArray(data.members) || typeof data.ownerId !== "string") {
            throw new Error("Group member information is unavailable. Please retry.");
        }
        const current = data.members.find(member => member.userId === userId);
        if (!current) { loseGroupAccess("You are no longer a member of this group."); return null; }
        memberData = data;
        groupMemberCount.textContent = String(data.members.length);
        const owner = data.ownerId === userId && current.role === "owner";
        leaveGroupButton.hidden = owner || current.canLeave !== true;
        leaveGroupButton.disabled = managementBusy;
        groupMembersStatus.textContent = owner ? "Owner · Members rejoin only through a fresh invitation." : "Current group members";
        for (const member of data.members) {
            const row = document.createElement("div"); row.className = "group-member-row";
            const avatar = document.createElement("span"); avatar.className = "member-avatar";
            avatar.setAttribute("aria-hidden", "true");
            const username = member.username || `Unavailable user (${member.userId})`;
            avatar.textContent = member.username ? Array.from(member.username)[0].toUpperCase() : "?";
            const identity = document.createElement("div"); identity.className = "member-identity";
            const name = document.createElement("span"); name.textContent = username;
            const role = document.createElement("span"); role.className = "member-role";
            role.textContent = `${member.userId === data.ownerId ? "Owner" : "Member"}${member.userId === userId ? " · You" : ""}`;
            identity.append(name, role); row.append(avatar, identity);
            if (owner && member.userId !== userId && member.canRemove === true) {
                const remove = document.createElement("button"); remove.type = "button"; remove.className = "member-action";
                remove.textContent = "Remove"; remove.disabled = managementBusy;
                remove.setAttribute("aria-label", `Remove ${username} from group`);
                remove.addEventListener("click", () => manageMember(member.userId, false));
                memberActionButtons.set(member.userId, remove);
                row.appendChild(remove);
            }
            groupMembersList.appendChild(row);
        }
        return data;
    } catch (error) {
        if (!membershipLost && request === memberRequest) {
            groupMemberCount.textContent = "—";
            groupMembersStatus.textContent = error.message;
            retryGroupMembers.hidden = false;
        }
        return null;
    }
}

async function manageMember(targetId, leaving) {
    if (managementBusy || !currentGroupIsOpen()) return;
    managementBusy = true;
    leaveGroupButton.disabled = true;
    groupMembersStatus.textContent = "Checking current membership and balance...";
    try {
        const fresh = await fetchGroupMembers();
        if (!fresh) return;
        const userId = localStorage.getItem("userId");
        const target = fresh.members.find(member => member.userId === targetId);
        const permitted = target && (leaving ? targetId === userId && target.canLeave === true && fresh.ownerId !== userId :
            fresh.ownerId === userId && targetId !== userId && target.canRemove === true);
        if (!permitted) throw new Error("Membership or permissions changed. Refresh and try again.");
        const groupName = localStorage.getItem("selectedGroupName") || "this group";
        const targetName = target.username || `Unavailable user (${targetId})`;
        const accepted = await ExpenseUI.confirmAction({
            title: leaving ? "Leave group?" : "Remove member?",
            message: `${leaving ? "Leave" : `Remove ${targetName} from`} "${groupName}"? ${leaving ? "You" : "This member"} will lose group access and dashboard visibility. ${balanceWarning(target.balance)} Rejoining requires a fresh owner invitation.`,
            confirmLabel: leaving ? "Leave Group" : "Remove Member", pendingLabel: leaving ? "Leaving..." : "Removing..."
        }, async () => {
            if (!currentGroupIsOpen()) throw new Error("The selected group changed. Reopen it from Dashboard.");
            const url = leaving ? `${API_BASE}/api/groups/${encodeURIComponent(groupId)}/leave` :
                `${API_BASE}/api/groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(targetId)}`;
            const response = await fetch(url, { method: leaving ? "POST" : "DELETE", headers: { authorization: token } });
            const result = await response.json();
            if (!response.ok) {
                if (response.status === 401) loseGroupAccess(result.message || "Your session expired.", 401);
                else if ([403, 404, 409].includes(response.status)) await fetchGroupMembers();
                throw new Error(result.message || "Unable to change group membership.");
            }
            if (leaving) {
                loseGroupAccess(`You left ${groupName}. ${balanceWarning(result.balance)}`, 200, "success");
            } else {
                ExpenseUI.notify(`${targetName} was removed. ${balanceWarning(result.balance)}`, "success");
                await Promise.all([fetchGroupMembers(), fetchExpenses()]);
            }
        });
        if (!accepted && !membershipLost) groupMembersStatus.textContent = "No membership changes made.";
    } catch (error) {
        if (!membershipLost) {
            groupMembersStatus.textContent = error.message;
            ExpenseUI.notify(error.message, "error");
        }
    } finally {
        managementBusy = false;
        if (memberData && !membershipLost) {
            await fetchGroupMembers();
            const target = groupMembersPanel.hidden ? manageGroupButton :
                leaving && !leaveGroupButton.hidden ? leaveGroupButton :
                    memberActionButtons.get(targetId) || document.getElementById("groupMembersHeading");
            target?.focus();
        }
    }
}
leaveGroupButton.addEventListener("click", () => manageMember(localStorage.getItem("userId"), true));
retryGroupMembers.addEventListener("click", () => fetchGroupMembers());
window.addEventListener("focus", async () => {
    if (!managementBusy && !addingExpense && currentGroupIsOpen()) {
        await fetchGroupMembers();
        if (!membershipLost) await fetchExpenses();
    }
});

function currentGroupIsOpen() {
    return Boolean(!membershipLost && token && groupId && localStorage.getItem("groupId") === groupId);
}

function updateParticipantState() {
    if (expenseSubmitButton) {
        expenseSubmitButton.disabled = addingExpense || !membersReady ||
            !currentGroupIsOpen() || selectedMemberIds.size === 0;
    }
    if (membersReady) {
        splitMemberStatus.textContent = `${selectedMemberIds.size} of ${currentMemberIds.size} selected` +
            (selectedMemberIds.size ? "" : " — select at least one member.");
    }
}

function renderMembers(members, resetSelection) {
    if (!Array.isArray(members)) {
        throw new Error("Group member data is unavailable. Please refresh or retry.");
    }
    const selectable = members.filter(member => member && !member.unresolved &&
        typeof member._id === "string" && /^[a-fA-F0-9]{24}$/.test(member._id) &&
        typeof member.username === "string" && member.username.trim());
    const nextIds = new Set(selectable.map(member => member._id.toLowerCase()));
    const nextSelection = new Set([...nextIds].filter(id => resetSelection ||
        !currentMemberIds.has(id) || selectedMemberIds.has(id)));
    currentMemberIds = nextIds;
    selectedMemberIds = nextSelection;
    splitMemberList.replaceChildren();
    for (const member of selectable) {
        const id = member._id.toLowerCase();
        const label = document.createElement("label");
        label.className = "split-member";
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.value = id;
        checkbox.checked = selectedMemberIds.has(id);
        checkbox.defaultChecked = true;
        checkbox.addEventListener("change", () => {
            if (checkbox.checked) selectedMemberIds.add(id);
            else selectedMemberIds.delete(id);
            updateParticipantState();
        });
        const name = document.createElement("span");
        name.textContent = member.username;
        label.append(checkbox, name);
        splitMemberList.appendChild(label);
    }
    membersReady = nextIds.size > 0;
    splitMembers.disabled = !membersReady;
    retryMembers.hidden = membersReady;
    if (!membersReady) splitMemberStatus.textContent = "No available group members. Refresh or retry.";
    updateParticipantState();
}

retryMembers?.addEventListener("click", () => fetchExpenses());
window.addEventListener("storage", event => {
    if (event.key === "groupId" || event.key === null) updateParticipantState();
});

const moneyFormatter = new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2
});

// ===============================
// GROUP TITLE
// ===============================
document.addEventListener("DOMContentLoaded", () => {
    const groupName =
        localStorage.getItem("selectedGroupName") || "Trip";

    const groupTitle = document.getElementById("groupTitle");

    if (groupTitle) {
        groupTitle.textContent = groupName;
    }
});

// ===============================
// FETCH EXPENSES
// ===============================
async function fetchExpenses({ resetParticipants = false } = {}) {
    clearBalances("Loading balances...");
    membersReady = false;
    splitMembers.disabled = true;
    retryMembers.hidden = true;
    splitMemberStatus.textContent = "Loading group members...";
    updateParticipantState();
    if (!expensesContainer || !currentGroupIsOpen()) {
        splitMemberStatus.textContent = "Your session or group changed. Reopen the group from the dashboard.";
        clearBalances("Reopen the group from the dashboard to view balances.");
        return;
    }
    const request = ++expenseRequest;

    try {
        const response = await fetch(
            `${API_BASE}/api/expenses/group/${encodeURIComponent(groupId)}`,
            {
                method: "GET",
                headers: {
                    authorization: token
                }
            }
        );

        const data = await response.json();
        if (request !== expenseRequest || !currentGroupIsOpen()) return;
        if (!response.ok) {
            if ([401, 403, 404].includes(response.status)) { loseGroupAccess(data.message || "You no longer have access to this group.", response.status); return; }
            throw new Error(data.message || "Unable to load expenses.");
        }
        const expenses = Array.isArray(data.expenses)
            ? data.expenses
            : [];

        expensesContainer.replaceChildren();

        renderBalances(data);

        // Older APIs may omit members: keep history readable and disable adding.
        try {
            renderMembers(data.members, resetParticipants);
        } catch (error) {
            splitMemberStatus.textContent = error.message;
            retryMembers.hidden = false;
            updateParticipantState();
        }

        if (expenses.length === 0) {
            const emptyMessage = document.createElement("p");
            emptyMessage.className = "empty-state";
            emptyMessage.textContent = "No expenses added yet.";
            expensesContainer.appendChild(emptyMessage);
            return;
        }

        const fragment = document.createDocumentFragment();
        let expandedExpense = null;

        expenses.forEach((expense, index) => {
            const item = document.createElement("div");
            item.className = "expense-item";

            const top = document.createElement("button");
            top.type = "button";
            top.className = "expense-top";
            top.id = `expense-toggle-${index}`;
            top.setAttribute("aria-expanded", "false");
            top.setAttribute("aria-controls", `expense-breakdown-${index}`);

            const title = document.createElement("span");
            title.className = "expense-title";
            title.textContent = expense.title || "Untitled Expense";

            const price = document.createElement("span");
            price.className = "expense-price";
            const recordedAmount = Number(expense.amount);
            const amountLabel = (typeof expense.amount === "string" || typeof expense.amount === "number") &&
                Number.isFinite(recordedAmount) && recordedAmount > 0
                ? moneyFormatter.format(recordedAmount) : "Amount unavailable";
            price.textContent = amountLabel;

            const paidBy = document.createElement("p");
            paidBy.className = "expense-user";

            const payerName =
                expense.paidBy?.username ||
                expense.paidBy?.name ||
                "User";

            paidBy.textContent = `Paid by: ${payerName}`;

            top.append(title, price);
            item.append(top, paidBy);
            const participants = Array.isArray(expense.splitBetween) ? expense.splitBetween : [];
            const referenceId = ref => typeof ref === "string" ? ref.toLowerCase() :
                (typeof ref?._id === "string" ? ref._id.toLowerCase() : undefined);
            const names = new Map();
            for (const ref of [...(Array.isArray(data.members) ? data.members : []), ...participants]) {
                if (ref && ref.username && referenceId(ref)) names.set(referenceId(ref), ref.username);
            }
            const allocation = !data.calculationError && Array.isArray(data.summary?.allocations) &&
                data.summary.allocations.length === expenses.length && data.summary.allocations[index];
            const ids = participants.map(referenceId);
            const shares = allocation?.shares;
            const validShares = Array.isArray(shares) && shares.length > 0 &&
                shares.length === ids.length && new Set(ids).size === ids.length &&
                new Set(shares.map(share => share?.userId)).size === shares.length &&
                allocation.payerId === referenceId(expense.paidBy) &&
                Number.isSafeInteger(allocation.amountPaise) && allocation.amountPaise > 0 &&
                shares.every(share => share && ids.includes(share.userId) &&
                    Number.isSafeInteger(share.sharePaise) && share.sharePaise >= 0) &&
                shares.reduce((sum, share) => sum + BigInt(share.sharePaise), 0n) === BigInt(allocation.amountPaise);
            const split = document.createElement("div");
            split.className = "expense-split";
            split.id = `expense-breakdown-${index}`;
            split.hidden = true;
            split.setAttribute("role", "region");
            split.setAttribute("aria-labelledby", top.id);
            const heading = document.createElement("p");
            heading.className = "expense-split-label";
            heading.textContent = validShares
                ? `Split between ${shares.length} ${shares.length === 1 ? "member" : "members"}`
                : "Participants · Allocated shares unavailable";
            split.appendChild(heading);
            if (validShares) {
                for (const share of shares) {
                    const row = document.createElement("div");
                    row.className = "expense-share-row";
                    const name = document.createElement("span");
                    name.textContent = names.get(share.userId) || `Unavailable user (${share.userId})`;
                    const amount = document.createElement("span");
                    amount.textContent = formatPaise(share.sharePaise);
                    row.append(name, amount);
                    split.appendChild(row);
                }
            } else {
                const people = document.createElement("p");
                people.className = "expense-user";
                people.textContent = participants.length ? participants.map(ref => {
                    const id = referenceId(ref);
                    return names.get(id) || (id ? `Unavailable user (${id})` : "Unavailable participant");
                }).join(", ") : "Participant records unavailable.";
                split.appendChild(people);
            }
            item.appendChild(split);
            function setExpanded(open) {
                split.hidden = !open;
                top.setAttribute("aria-expanded", String(open));
            }
            const toggleExpense = () => {
                const opening = split.hidden;
                if (expandedExpense) expandedExpense(false);
                setExpanded(opening);
                expandedExpense = opening ? setExpanded : null;
            };
            // Native button handles Enter/Space; clicking the surrounding row also opens it.
            item.addEventListener("click", event => {
                if (!split.contains(event.target)) toggleExpense();
            });
            fragment.appendChild(item);
        });

        expensesContainer.appendChild(fragment);

    } catch (error) {
        if (request !== expenseRequest || !currentGroupIsOpen()) return;
        clearBalances(`Unable to load balances: ${error.message || "Please retry."}`);
        membersReady = false;
        splitMembers.disabled = true;
        splitMemberStatus.textContent = error.message || "Unable to load group members. Please retry.";
        retryMembers.hidden = false;
        updateParticipantState();
        console.error("Fetch expenses error:", error);

        expensesContainer.replaceChildren();

        const message = document.createElement("p");
        message.className = "empty-state";
        message.textContent =
            "Unable to load expenses. Please try refreshing.";

        expensesContainer.appendChild(message);
    }
}

// ===============================
// ADD EXPENSE
// ===============================
if (expenseForm) {
    expenseForm.addEventListener("submit", async (event) => {
        event.preventDefault();

        ExpenseUI.formError(expenseForm);
        const title = titleInput.value.trim();
        const amount = Number(amountInput.value);
        const userId = localStorage.getItem("userId");

        if (addingExpense) return;
        if (!membersReady || !currentGroupIsOpen() || !selectedMemberIds.size ||
            [...selectedMemberIds].some(id => !currentMemberIds.has(id))) {
            ExpenseUI.formError(expenseForm, "Select at least one member of the currently opened group before adding an expense.");
            updateParticipantState();
            return;
        }
        const participants = [...selectedMemberIds];

        if (!title || !Number.isFinite(amount) || amount <= 0) {
            ExpenseUI.formError(expenseForm, "Please enter valid expense details.");
            return;
        }

        const submitButton = expenseForm.querySelector(
            'button[type="submit"]'
        );

        addingExpense = true;
        splitMembers.disabled = true;
        if (submitButton) {
            submitButton.disabled = true;
            submitButton.textContent = "Adding expense...";
        }

        try {
            const response = await fetch(
                `${API_BASE}/api/expenses/add`,
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        authorization: token
                    },
                    body: JSON.stringify({
                        title,
                        amount,
                        paidBy: userId,
                        groupId,
                        splitBetween: participants
                    })
                }
            );

            const data = await response.json();

            if (!response.ok) {
                if (response.status === 401) loseGroupAccess(data.message || "Your session expired.", 401);
                else if ([403, 404].includes(response.status)) await fetchGroupMembers();
                throw new Error(
                    data.message || "Failed to add expense."
                );
            }

            ExpenseUI.notify("Expense added.", "success");
            expenseForm.reset();
            await fetchExpenses({ resetParticipants: true });

        } catch (error) {
            console.error("Add expense error:", error);
            ExpenseUI.formError(expenseForm, error.message || "Something went wrong.");

        } finally {
            addingExpense = false;
            splitMembers.disabled = !membersReady;
            if (submitButton) {
                submitButton.textContent = "Add Expense";
            }
            updateParticipantState();
        }
    });
}

// ===============================
// LOGOUT
// ===============================
function logout() {
    localStorage.clear();
    window.location.href = "./login.html";
}

// ===============================
// INITIAL LOAD
// ===============================
fetchExpenses();
fetchGroupMembers();

// ===============================
// INVITE MEMBER MODAL
// ===============================
const inviteModalOverlay =
    document.getElementById("inviteModalOverlay");

const openInviteModalBtn =
    document.getElementById("openInviteModal");

const closeInviteModalBtn =
    document.getElementById("closeInviteModal");

const cancelInviteModalBtn =
    document.getElementById("cancelInviteModal");

const inviteMemberForm =
    document.getElementById("inviteMemberForm");

const inviteUserInput =
    document.getElementById("inviteUserInput");

const inviteFeedback =
    document.getElementById("inviteFeedback");

const sendInvitationBtn =
    document.getElementById("sendInvitationBtn");
let inviteReturnFocus = null;

function openInviteModal() {
    if (!inviteModalOverlay) return;
    inviteReturnFocus = document.activeElement || openInviteModalBtn;

    inviteModalOverlay.classList.add("show");

    inviteFeedback.textContent = "";
    inviteFeedback.className = "invite-feedback";
    inviteUserInput.value = "";

    inviteUserInput.focus();
}

function closeInviteModal() {
    if (!inviteModalOverlay) return;

    inviteModalOverlay.classList.remove("show");
    inviteMemberForm.reset();

    inviteFeedback.textContent = "";
    inviteFeedback.className = "invite-feedback";
    (inviteReturnFocus || openInviteModalBtn)?.focus();
}

openInviteModalBtn?.addEventListener("click", openInviteModal);
closeInviteModalBtn?.addEventListener("click", closeInviteModal);
cancelInviteModalBtn?.addEventListener("click", closeInviteModal);

inviteModalOverlay?.addEventListener("click", (event) => {
    if (event.target === inviteModalOverlay) {
        closeInviteModal();
    }
});

document.addEventListener("keydown", (event) => {
    if (!inviteModalOverlay?.classList.contains("show")) return;
    if (event.key === "Tab") {
        const controls = [closeInviteModalBtn, inviteUserInput, cancelInviteModalBtn, sendInvitationBtn]
            .filter(control => control && !control.disabled);
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (event.shiftKey && (document.activeElement === first || !controls.includes(document.activeElement))) {
            event.preventDefault();
            last?.focus();
        } else if (!event.shiftKey && (document.activeElement === last || !controls.includes(document.activeElement))) {
            event.preventDefault();
            first?.focus();
        }
    }
    if (
        event.key === "Escape" &&
        inviteModalOverlay?.classList.contains("show")
    ) {
        closeInviteModal();
    }
});

// ===============================
// SEND GROUP INVITATION
// ===============================
inviteMemberForm?.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (sendInvitationBtn.disabled || !currentGroupIsOpen()) return;
    const searchValue = inviteUserInput.value.trim();

    if (!searchValue) {
        inviteFeedback.textContent =
            "Please enter a username or email address.";
        inviteFeedback.className = "invite-feedback error";
        return;
    }

    if (!groupId || !token) {
        inviteFeedback.textContent =
            "Your session or selected group is missing. Please log in again.";
        inviteFeedback.className = "invite-feedback error";
        return;
    }

    sendInvitationBtn.disabled = true;
    sendInvitationBtn.textContent = "Sending...";

    inviteFeedback.textContent = "";
    inviteFeedback.className = "invite-feedback";

    try {
        const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(searchValue);

        const response = await fetch(
            `${API_BASE}/api/groups/${encodeURIComponent(groupId)}/invite`,
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    authorization: token
                },
                body: JSON.stringify(
                    isEmail
                        ? { email: searchValue.toLowerCase() }
                        : { username: searchValue }
                )
            }
        );

        const data = await response.json();

        if (!response.ok) {
            if (response.status === 401) loseGroupAccess(data.message || "Your session expired.", 401);
            else if ([403, 404].includes(response.status)) await fetchGroupMembers();
            throw new Error(
                data.message || "Could not send the invitation."
            );
        }

        inviteFeedback.textContent =
            "Invitation sent successfully!";
        inviteFeedback.className = "invite-feedback success";
        inviteUserInput.value = "";

    } catch (error) {
        inviteFeedback.textContent =
            error.message || "Something went wrong. Please try again.";
        inviteFeedback.className = "invite-feedback error";

    } finally {
        sendInvitationBtn.disabled = membershipLost;
        sendInvitationBtn.textContent = "Send Invitation";
    }
});
