document.addEventListener('DOMContentLoaded', () => {
    const registerForm = document.getElementById('register-form');
    const passwordInput = document.getElementById('password');
    const confirmPasswordInput = document.getElementById('password-confirmation');
    const strengthIndicator = document.getElementById('password-strength');
    const toggleButton = document.getElementById('toggle-password-btn');
    const errorMessage = document.getElementById('error-message');

    // Check if password helper is loaded and setup features
    if (typeof setupPasswordFeatures === 'function') {
        setupPasswordFeatures({
            passwordInput,
            confirmPasswordInput,
            strengthIndicator,
            toggleButton
        });
    } else {
        console.error('CRITICAL: password-helpers.js is not loaded. Password features will not work.');
    }

    registerForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = document.getElementById('username').value;
        const password = passwordInput.value;
        const password_confirmation = confirmPasswordInput.value;
        
        errorMessage.style.display = 'none'; // Hide previous errors

        try {
            const response = await fetch('/api/users/register-admin', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password, password_confirmation }),
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