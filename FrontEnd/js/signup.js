const signupForm = document.getElementById('signupForm');

signupForm.addEventListener('submit', async (e) => {

    e.preventDefault();
        const restore = ExpenseUI.busy(signupForm.querySelector('button[type="submit"]'), 'Creating account...');
        if (!restore) return;
        ExpenseUI.formError(signupForm);

    const username = document.getElementById('username').value;

    const email = document.getElementById('email').value;

    const password = document.getElementById('password').value;

    try {

        const response = await fetch(
            'https://expenseiq-backend-xkmu.onrender.com/api/auth/signup',
            {
                method: 'POST',

                headers: {
                    'Content-Type': 'application/json'
                },

                body: JSON.stringify({
                    username,
                    email,
                    password
                })
            }
        );

        const data = await response.json();

        if (!response.ok) throw new Error(data.message || 'Unable to create account.');



        window.location.href = './login.html';

    } catch (error) {

        ExpenseUI.formError(signupForm, error.message || 'Unable to create account. Please try again.');

    } finally {
        restore();
    }

});