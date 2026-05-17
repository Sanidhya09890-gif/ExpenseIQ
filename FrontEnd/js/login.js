const loginForm = document.getElementById('loginForm');

loginForm.addEventListener(
    'submit',
    async (e) => {
        e.preventDefault();

        const email = document.getElementById('email').value;
        const password = document.getElementById('password').value;

        try {
            const response = await fetch(
                'http://localhost:3000/api/auth/login',
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ email, password })
                }
            );

            const data = await response.json();
            console.log("Backend Response:", data);

            // If the login request failed on the server side
            if (!response.ok) {
                alert(data.message || 'Login failed');
                return;
            }

            // ===============================
            // SAVE TOKEN
            // ===============================
            localStorage.setItem('token', data.token);

            // ===============================
            // SAVE USER NAME (Safe & Bulletproof)
            // ===============================
            const finalName = data.user?.name || data.name || data.username || data.user?.username || 'User';
            localStorage.setItem('userName', finalName);

            // ===============================
            // SAVE USER ID (Safe)
            // ===============================
            const finalId = data.user?._id || data.userId || data.id || '';
            localStorage.setItem('userId', finalId);

            alert('Login Successful');
            window.location.href = './dashboard.html';

        } catch (error) {
            console.error("Login process error:", error);
            alert("Something went wrong connecting to the server.");
        }
    }
);