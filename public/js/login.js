document.addEventListener('DOMContentLoaded', () => {
    // This logic handles the initial redirect for the admin setup
    async function checkAdminAndRedirect() {
        try {
            const response = await fetch('/api/users/check-admin');
            const { adminExists } = await response.json();
            if (!adminExists && !window.location.pathname.includes('admin-register')) {
                // If no admin exists and we are not on the register page, go there.
                window.location.href = '/admin-register';
            }
        } catch (error) {
            console.error('Error checking for admin account:', error);
        }
    }

    const loginForm = document.getElementById('login-form');
    if (loginForm) {
        // Automatically focus the username field for faster keyboard entry
        document.getElementById('username').focus();

        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const username = document.getElementById('username').value;
            const password = document.getElementById('password').value;
            const errorMessage = document.getElementById('error-message');

            try {
                const response = await fetch('/api/users/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username, password }),
                });

                const result = await response.json();

                if (response.ok) {
                    // Redirect based on role
                    window.location.href = result.user.role === 'admin' ? '/admin' : '/';
                } else {
                    errorMessage.textContent = result.error || 'Login failed.';
                    errorMessage.style.display = 'block';
                    loginForm.classList.add('shake');
                    setTimeout(() => {
                        loginForm.classList.remove('shake');
                    }, 500);
                }
            } catch (error) {
                errorMessage.textContent = 'An unexpected error occurred.';
                errorMessage.style.display = 'block';
            }
        });
    }

    checkAdminAndRedirect();
});