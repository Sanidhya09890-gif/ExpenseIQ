
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
        groupTitle.textContent = `${groupName} ✈️`;
    }
});

// ===============================
// FETCH EXPENSES
// ===============================
async function fetchExpenses() {
    if (!expensesContainer || !groupId || !token) return;

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

        if (!response.ok) {
            throw new Error("Unable to load expenses.");
        }

        const data = await response.json();
        const expenses = Array.isArray(data.expenses)
            ? data.expenses
            : [];

        expensesContainer.replaceChildren();

        const totalAmount = expenses.reduce(
            (sum, expense) => sum + (Number(expense.amount) || 0),
            0
        );

        if (totalSpendElement) {
            totalSpendElement.textContent =
                moneyFormatter.format(totalAmount);
        }

        if (expenses.length === 0) {
            const emptyMessage = document.createElement("p");
            emptyMessage.className = "empty-state";
            emptyMessage.textContent = "No expenses added yet.";
            expensesContainer.appendChild(emptyMessage);
            return;
        }

        const fragment = document.createDocumentFragment();

        expenses.forEach((expense) => {
            const item = document.createElement("div");
            item.className = "expense-item";

            const top = document.createElement("div");
            top.className = "expense-top";

            const title = document.createElement("h4");
            title.textContent = expense.title || "Untitled Expense";

            const price = document.createElement("span");
            price.className = "expense-price";
            price.textContent = moneyFormatter.format(
                Number(expense.amount) || 0
            );

            const paidBy = document.createElement("p");
            paidBy.className = "expense-user";

            const payerName =
                expense.paidBy?.username ||
                expense.paidBy?.name ||
                "User";

            paidBy.textContent = `Paid by: ${payerName}`;

            top.append(title, price);
            item.append(top, paidBy);
            fragment.appendChild(item);
        });

        expensesContainer.appendChild(fragment);

    } catch (error) {
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

        const title = titleInput.value.trim();
        const amount = Number(amountInput.value);
        const userId = localStorage.getItem("userId");

        if (!title || !Number.isFinite(amount) || amount <= 0) {
            alert("Please enter valid expense details.");
            return;
        }

        const submitButton = expenseForm.querySelector(
            'button[type="submit"]'
        );

        if (submitButton) {
            submitButton.disabled = true;
            submitButton.textContent = "Adding...";
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
                        splitBetween: [userId]
                    })
                }
            );

            const data = await response.json();

            if (!response.ok) {
                throw new Error(
                    data.message || "Failed to add expense."
                );
            }

            expenseForm.reset();
            await fetchExpenses();

        } catch (error) {
            console.error("Add expense error:", error);
            alert(error.message || "Something went wrong.");

        } finally {
            if (submitButton) {
                submitButton.disabled = false;
                submitButton.textContent = "Add Expense";
            }
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

function openInviteModal() {
    if (!inviteModalOverlay) return;

    inviteModalOverlay.classList.add("show");

    inviteFeedback.textContent = "";
    inviteFeedback.className = "invite-feedback";
    inviteUserInput.value = "";

    setTimeout(() => inviteUserInput.focus(), 50);
}

function closeInviteModal() {
    if (!inviteModalOverlay) return;

    inviteModalOverlay.classList.remove("show");
    inviteMemberForm.reset();

    inviteFeedback.textContent = "";
    inviteFeedback.className = "invite-feedback";
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
        sendInvitationBtn.disabled = false;
        sendInvitationBtn.textContent = "Send Invitation";
    }
});
