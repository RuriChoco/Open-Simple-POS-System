// public/js/password-helpers.js
/**
 * Sets up password strength indicator and show/hide toggle for a password input field.
 * @param {object} options - The options for setting up the password features.
 * @param {HTMLInputElement} options.passwordInput - The password input element.
 * @param {HTMLInputElement} [options.confirmPasswordInput] - The confirm password input element (optional).
 * @param {HTMLElement} options.strengthIndicator - The element to display password strength.
 * @param {HTMLButtonElement} options.toggleButton - The button to toggle password visibility.
 */
function setupPasswordFeatures({ passwordInput, confirmPasswordInput, strengthIndicator, toggleButton }) {
    const mediumRegex = /^(?=.*[a-zA-Z])(?=.*[0-9]).{8,}$/; // At least 8 chars, with letters and numbers
    const strongRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9])(?=.*[!@#$%^&*]).{8,}$/; // At least 8 chars, with lower, upper, number, and special char

    function checkStrength() {
        const password = passwordInput.value;
        let strength = '';
        let text = '';

        if (password.length === 0) {
            strengthIndicator.style.display = 'none';
            return;
        }

        if (strongRegex.test(password)) {
            strength = 'strong';
            text = 'Strong';
        } else if (mediumRegex.test(password)) {
            strength = 'medium';
            text = 'Medium';
        } else if (password.length >= 8) {
            strength = 'weak';
            text = 'Weak';
        } else {
            strength = 'weak';
            text = 'Too short (min 8 chars)';
        }

        strengthIndicator.className = `password-strength-indicator ${strength}`;
        strengthIndicator.textContent = text;
        strengthIndicator.style.display = 'block';
    }

    function checkMatch() {
        if (!confirmPasswordInput) return;
        // Use the browser's built-in validation UI
        if (passwordInput.value && confirmPasswordInput.value && passwordInput.value !== confirmPasswordInput.value) {
            confirmPasswordInput.setCustomValidity("Passwords do not match.");
        } else {
            confirmPasswordInput.setCustomValidity("");
        }
    }

    passwordInput.addEventListener('input', () => {
        checkStrength();
        checkMatch();
    });

    if (confirmPasswordInput) {
        confirmPasswordInput.addEventListener('input', checkMatch);
    }

    toggleButton.addEventListener('click', () => {
        const isPassword = passwordInput.type === 'password';
        const newType = isPassword ? 'text' : 'password';
        passwordInput.type = newType;
        if (confirmPasswordInput) {
            confirmPasswordInput.type = newType;
        }
        toggleButton.setAttribute('aria-label', isPassword ? 'Hide password' : 'Show password');
    });
}