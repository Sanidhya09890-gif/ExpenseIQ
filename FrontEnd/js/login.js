const loginForm = document.getElementById('loginForm');

loginForm.addEventListener(
    'submit',
    async (e) => {
        e.preventDefault();
        const restore = ExpenseUI.busy(loginForm.querySelector('button[type="submit"]'), 'Signing in...');
        if (!restore) return;
        ExpenseUI.formError(loginForm);

        const loginInput = document.getElementById('loginInput').value;
        const password = document.getElementById('password').value;

        try {
            const response = await fetch(
                'https://expenseiq-backend-xkmu.onrender.com/api/auth/login',
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ loginInput, password })
                }
            );

            const data = await response.json();

            // If the login request failed on the server side
            if (!response.ok) {
                throw new Error(data.message || 'Login failed');
            }

            // ===============================
            // SAVE TOKEN
            // ===============================
            localStorage.setItem('token', data.token);

            // ===============================
            // SAVE USER NAME (Safe & Bulletproof)
            // ===============================
            const finalName = data.user?.username || 'User';
            localStorage.setItem('userName', finalName);

            // ===============================
            // SAVE USER ID (Safe)
            // ===============================
            const finalId = data.user?._id || data.userId || data.id || '';
            localStorage.setItem('userId', finalId);
            window.location.href = './dashboard.html';

        } catch (error) {
            console.error("Login process error:", error);
            ExpenseUI.formError(loginForm, error.message || 'Unable to sign in. Please try again.');
        } finally {
            restore();
        }
    }
);
