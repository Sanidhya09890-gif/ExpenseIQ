const token = localStorage.getItem('token');

const groupId = localStorage.getItem('groupId');


// ===============================
// PROTECT PAGE
// ===============================

if (!token) {

    window.location.href = './login.html';

}


// ===============================
// GROUP TITLE
// ===============================

document.addEventListener(

    "DOMContentLoaded",

    () => {

        const currentGroupName =

            localStorage.getItem(
                "selectedGroupName"
            ) || "Trip";

        const groupTitleElement =

            document.getElementById(
                "groupTitle"
            );

        if (groupTitleElement) {

            groupTitleElement.innerHTML =
                `${currentGroupName} ✈️`;

        }

    }

);


// ===============================
// DOM ELEMENTS
// ===============================

const expenseForm =

    document.getElementById(
        'expenseForm'
    );

const expensesContainer =

    document.getElementById(
        'expensesContainer'
    );

const titleInput =

    document.getElementById(
        'expenseTitle'
    );

const amountInput =

    document.getElementById(
        'expenseAmount'
    );

const totalSpendElement =

    document.getElementById(
        'totalGroupSpend'
    );


// ===============================
// FETCH EXPENSES
// ===============================

const fetchExpenses = async () => {

    try {

        const response = await fetch(

            `https://expenseiq-backend-xkmu.onrender.com/api/expenses/group/${groupId}`,

            {
                method: 'GET',

                headers: {
                    authorization: token
                }
            }

        );

        const data =
            await response.json();

        console.log(data);

        // CLEAR OLD DATA
        expensesContainer.innerHTML = '';

        // TOTAL VARIABLE
        let totalAmount = 0;

        // EMPTY STATE
        if (
            !data.expenses ||
            data.expenses.length === 0
        ) {

            expensesContainer.innerHTML = `

                <p class="empty-state">
                    No expenses added yet.
                </p>

            `;

            // UPDATE TOTAL
            if (totalSpendElement) {

                totalSpendElement.innerText =
                    '₹0';

            }

            return;

        }

        // ===============================
        // RENDER EXPENSES
        // ===============================

        data.expenses.forEach(

            (expense) => {

                // ADD TOTAL
                totalAmount += Number(
                    expense.amount
                );

                const div =
                    document.createElement(
                        'div'
                    );

                div.classList.add(
                    'expense-item'
                );

                div.innerHTML = `

                    <div class="expense-top">

                        <h4>
                            ${expense.title}
                        </h4>

                        <span class="expense-price">
                            ₹${expense.amount}
                        </span>

                    </div>

                    <p class="expense-user">

                        Paid by:
                        ${expense.paidBy?.name || 'User'}

                    </p>

                    <hr>

                `;

                expensesContainer.appendChild(
                    div
                );

            }

        );

        // ===============================
        // UPDATE TOTAL UI
        // ===============================

        if (totalSpendElement) {

            totalSpendElement.innerText =
                `₹${totalAmount}`;

        }

    } catch (error) {

        console.log(error);

    }

};


// ===============================
// ADD EXPENSE
// ===============================

if (expenseForm) {

    expenseForm.addEventListener(

        'submit',

        async (e) => {

            e.preventDefault();

            const title =
                titleInput.value.trim();

            const amount =
                parseFloat(
                    amountInput.value
                );

            // VALIDATION
            if (

                !title ||

                isNaN(amount) ||

                amount <= 0

            ) {

                alert(
                    'Please enter valid details'
                );

                return;

            }

            try {

                const response =
                    await fetch(

                        'https://expenseiq-backend-xkmu.onrender.com/api/expenses/add',

                        {
                            method: 'POST',

                            headers: {

                                'Content-Type':
                                    'application/json',

                                authorization:
                                    token

                            },

                            body: JSON.stringify({

                                title,

                                amount,

                                paidBy:
                                    localStorage.getItem(
                                        'userId'
                                    ),

                                groupId,

                                splitBetween: [

                                    localStorage.getItem(
                                        'userId'
                                    )

                                ]

                            })

                        }

                    );

                const data =
                    await response.json();

                console.log(data);

                // RESET FORM
                expenseForm.reset();

                // RELOAD EXPENSES
                await fetchExpenses();

            } catch (error) {

                console.log(error);

            }

        }

    );

}


// ===============================
// LOGOUT
// ===============================

function logout() {

    localStorage.clear();

    window.location.href =
        './login.html';

}


// ===============================
// INITIAL FETCH
// ===============================

fetchExpenses();