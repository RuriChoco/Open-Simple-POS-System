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
    const businessAddressInput = document.getElementById('business_address');
    const businessPhoneInput = document.getElementById('business_phone');
    const businessTinInput = document.getElementById('business_tin');
    const taxRateInput = document.getElementById('tax_rate');
    const posHeaderTitleInput = document.getElementById('pos-header-title-input');

    // Live preview elements
    const previewHeader = document.getElementById('preview-header');
    const receiptFullPreview = document.querySelector('.receipt-preview'); // Select the container
    const previewPosHeader = document.getElementById('preview-pos-header');
    const previewFooter = document.getElementById('preview-footer');

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
            businessAddressInput.value = data.business_address || '';
            businessPhoneInput.value = data.business_phone || '';
            businessTinInput.value = data.business_tin || '';
            taxRateInput.value = data.tax_rate || '0';
            posHeaderTitleInput.value = data.pos_header_title || '';

            // Update UI
            updateReceiptPreview();
            updatePosHeaderPreview();

        } catch (error) {
            showMessage(error.message, 'error');
        }
    }

    // --- Handle POS Header Preview ---
    function updatePosHeaderPreview() {
        // Default to "Simple POS System" if input is empty
        previewPosHeader.textContent = posHeaderTitleInput.value || 'Simple POS System';
    }

    // --- Handle Receipt Preview ---
    function updateReceiptPreview() {
        const headerText = receiptHeaderInput.value || 'Your Business Name';
        const footerText = receiptFooterInput.value || 'Thank you for your purchase!';
        const address = businessAddressInput.value || '123 Main St, Anytown';
        const phone = businessPhoneInput.value || '(555) 123-4567';
        const tin = businessTinInput.value || '000-000-000-000';
        const taxRate = parseFloat(taxRateInput.value) || 0;

        // Sample data for preview
        const sampleItems = [
            { name: 'Sample Product A', quantity: 2, price: 50.00 },
            { name: 'Sample Product B', quantity: 1, price: 120.50 },
            { name: 'Long Product Name That Might Wrap Around', quantity: 3, price: 15.00 }
        ];
        const sampleSaleId = '12345';
        const sampleCashier = 'Admin';
        const sampleCustomer = 'Walk-in Customer';
        const sampleDate = new Date().toLocaleString();

        let itemsHtml = '';
        let subtotal = 0;
        sampleItems.forEach(item => {
            const itemTotal = item.price * item.quantity;
            subtotal += itemTotal;
            itemsHtml += `
                <tr>
                    <td>
                        <div class="item-name-line">${item.name}</div>
                        <div class="item-details-line">${item.quantity} x @ ${formatPrice(item.price)}</div>
                    </td>
                    <td class="price-col">₱${formatPrice(itemTotal)}</td>
                </tr>
            `;
        });

        const taxAmount = subtotal * (taxRate / 100);
        const totalAmount = subtotal + taxAmount;
        const cashTendered = totalAmount + 50; // Example cash tendered
        const changeDue = cashTendered - totalAmount;

        receiptFullPreview.innerHTML = `
            <div class="business-info">
                <p class="receipt-header">${headerText}</p>
                <p>${address}</p>
                <p>${phone}</p>
                <p>TIN: ${tin}</p>
            </div>
            <main>
                <div class="receipt-info">
                    <p><strong>OR #:</strong> <span>${sampleSaleId}</span></p>
                    <p><strong>Cashier:</strong> <span>${sampleCashier}</span></p>
                    <p><strong>Customer:</strong> <span>${sampleCustomer}</span></p>
                    <p><strong>Date:</strong> <span>${sampleDate}</span></p>
                </div>
                <table class="receipt-items-table">
                    <thead>
                        <tr>
                            <th>Item</th>
                            <th class="price-col">Subtotal</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${itemsHtml}
                    </tbody>
                </table>
                <div class="summary-section">
                    <p class="summary-item"><span>Subtotal:</span> <span>₱${formatPrice(subtotal)}</span></p>
                    <p class="summary-item"><span>Tax (${taxRate}%):</span> <span>₱${formatPrice(taxAmount)}</span></p>
                    <p class="summary-total"><span>Total:</span> <span>₱${formatPrice(totalAmount)}</span></p>
                </div>
                <div class="payment-details-section">
                    <p><span>Cash Tendered:</span> <span>₱${formatPrice(cashTendered)}</span></p>
                    <p><span>Change:</span> <span>₱${formatPrice(changeDue)}</span></p>
                </div>
            </main>
            <div class="receipt-footer">${footerText}</div>
        `;
    }

    receiptHeaderInput.addEventListener('input', updateReceiptPreview);
    receiptFooterInput.addEventListener('input', updateReceiptPreview);
    posHeaderTitleInput.addEventListener('input', updatePosHeaderPreview);

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