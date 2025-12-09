document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('customization-form');
    const messageBox = document.getElementById('message-box');
    const saveButton = document.getElementById('save-changes-btn');
    const statusIndicator = document.getElementById('status-indicator');
    const statusText = document.getElementById('status-text');
    const welcomeUser = document.getElementById('welcome-user');
    const logoutBtn = document.getElementById('logout-btn');

    // Form inputs
    const receiptHeaderInput = document.getElementById('receipt_header');
    const receiptFooterInput = document.getElementById('receipt_footer');
    const posThemeInput = document.getElementById('pos_theme');
    const businessAddressInput = document.getElementById('business_address');
    const businessPhoneInput = document.getElementById('business_phone');
    const businessTinInput = document.getElementById('business_tin');
    const taxRateInput = document.getElementById('tax_rate');

    // Live preview elements
    const previewHeader = document.getElementById('preview-header');
    const previewFooter = document.getElementById('preview-footer');

    // Theme selector
    const themeOptions = document.querySelectorAll('.theme-option');

    // --- WebSocket & Session Logic ---
    function connectWebSocket() {
        const ws = new WebSocket(`ws://${window.location.host}`);

        ws.onopen = () => {
            console.log('WebSocket connected');
            statusIndicator.classList.remove('disconnected');
            statusIndicator.classList.add('connected');
            statusText.textContent = 'Live';
        };

        ws.onmessage = (event) => {
            const message = JSON.parse(event.data);
            // If settings are updated by another client, reload this page's data
            // to show the most recent changes automatically.
            if (message.type === 'SETTINGS_UPDATED') {
                console.log('Settings updated by another client. Reloading to reflect changes.');
                showMessage('Settings were updated in another window. Page has been refreshed.', 'success');
                loadSettings();
            }
        };

        ws.onclose = () => {
            console.log('WebSocket disconnected. Attempting to reconnect...');
            statusIndicator.classList.remove('connected');
            statusIndicator.classList.add('disconnected');
            statusText.textContent = 'Offline';
            setTimeout(connectWebSocket, 5000);
        };

        ws.onerror = () => {
            statusIndicator.classList.remove('connected');
            statusIndicator.classList.add('disconnected');
            statusText.textContent = 'Error';
        };
    }

    async function checkSession() {
        try {
            const response = await fetch('/api/users/session');
            if (!response.ok) throw new Error('Not authenticated');
            const { user } = await response.json();
            welcomeUser.textContent = user.username;
        } catch (error) {
            window.location.href = '/login'; // Redirect if not logged in
        }
    }

    // --- Function to show messages ---
    function showMessage(msg, type = 'success') {
        messageBox.textContent = msg;
        messageBox.className = `message ${type}`;
        messageBox.style.display = 'block';
        window.scrollTo(0, 0); // Scroll to top to make message visible
        setTimeout(() => { messageBox.style.display = 'none'; }, 5000);
    }

    // --- Load initial settings ---
    async function loadSettings() {
        try {
            const response = await fetch('/api/settings');
            if (!response.ok) throw new Error('Failed to load settings.');
            const { data } = await response.json();

            // Populate form
            receiptHeaderInput.value = data.receipt_header || '';
            receiptFooterInput.value = data.receipt_footer || '';
            posThemeInput.value = data.pos_theme || 'light';
            businessAddressInput.value = data.business_address || '';
            businessPhoneInput.value = data.business_phone || '';
            businessTinInput.value = data.business_tin || '';
            taxRateInput.value = data.tax_rate || '0';

            // Update UI
            updateReceiptPreview();
            updateThemeSelection(data.pos_theme || 'light');

        } catch (error) {
            showMessage(error.message, 'error');
        }
    }

    // --- Handle Receipt Preview ---
    function updateReceiptPreview() {
        previewHeader.textContent = receiptHeaderInput.value || '(No Header)';
        previewFooter.textContent = receiptFooterInput.value || '(No Footer)';
    }

    receiptHeaderInput.addEventListener('input', updateReceiptPreview);
    receiptFooterInput.addEventListener('input', updateReceiptPreview);

    // --- Handle Theme Selection ---
    function updateThemeSelection(selectedTheme) {
        posThemeInput.value = selectedTheme;
        themeOptions.forEach(option => {
            option.classList.toggle('active', option.dataset.theme === selectedTheme);
        });
    }

    themeOptions.forEach(option => {
        option.addEventListener('click', () => {
            updateThemeSelection(option.dataset.theme);
        });
    });

    // --- Handle Form Submission ---
    async function saveChanges(e) {
        e.preventDefault();
        saveButton.disabled = true;
        saveButton.textContent = 'Saving...';

        const settings = Object.fromEntries(new FormData(form).entries());
        try {
            const response = await fetch('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(settings) });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || 'Failed to save settings.');
            showMessage(result.message, 'success');
        } catch (error) {
            showMessage(error.message, 'error');
        } finally {
            saveButton.disabled = false;
            saveButton.textContent = 'Save Changes';
        }
    }

    saveButton.addEventListener('click', saveChanges);

    logoutBtn.addEventListener('click', async () => {
        await fetch('/api/users/logout', { method: 'POST' });
        window.location.href = '/login';
    });

    // Initial Load
    checkSession();
    connectWebSocket();
    loadSettings();
});