const signupForm = document.getElementById('signupForm');

signupForm.addEventListener('submit', async (e) => {

    e.preventDefault();

    const name = document.getElementById('name').value;

    const email = document.getElementById('email').value;

    const password = document.getElementById('password').value;

    try {

        const response = await fetch(
            'http://localhost:3000/api/auth/signup',
            {
                method: 'POST',

                headers: {
                    'Content-Type': 'application/json'
                },

                body: JSON.stringify({
                    name,
                    email,
                    password
                })
            }
        );

        const data = await response.json();

        console.log(data);

        alert('Signup Successful');

        window.location.href = './login.html';

    } catch (error) {

        console.log(error);

    }

});