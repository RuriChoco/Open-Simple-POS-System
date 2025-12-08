document.addEventListener('DOMContentLoaded', () => {
    const registerForm = document.getElementById('register-form');
    registerForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = document.getElementById('username').value;
        const password = document.getElementById('password').value;
        const errorMessage = document.getElementById('error-message');

        try {
            const response = await fetch('/api/users/register-admin', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password }),
            });
            const result = await response.json();
            if (response.ok) {
                alert('Admin account created! Please log in.');
                window.location.href = '/login';
            } else {
                errorMessage.textContent = result.error || 'Registration failed.';
                errorMessage.style.display = 'block';
                registerForm.classList.add('shake');
                setTimeout(() => {
                    registerForm.classList.remove('shake');
                }, 500);
            }
        } catch (error) {
            errorMessage.textContent = 'An unexpected error occurred.';
            errorMessage.style.display = 'block';
        }
    });
});