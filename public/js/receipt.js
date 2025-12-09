function formatPrice(number) {
    return Number(number).toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    });
}

document.addEventListener('DOMContentLoaded', async () => {
    const receiptHeader = document.getElementById('receipt-header');
    const receiptDetails = document.getElementById('receipt-details');
    const receiptFooter = document.getElementById('receipt-footer');
    const saleId = window.location.pathname.split('/').pop();

    if (!saleId) {
        receiptDetails.innerHTML = '<p>Error: No Sale ID provided.</p>';
        return;
    }

    try {
        // Fetch both sale data and settings data concurrently
        const [saleResponse, settingsResponse] = await Promise.all([
            fetch(`/api/sales/${saleId}`),
            fetch('/api/settings')
        ]);

        if (!saleResponse.ok) {
            throw new Error('Failed to fetch receipt data.');
        }
        if (!settingsResponse.ok) {
            // Don't fail completely, just log it. The receipt can render with defaults.
            console.error('Failed to fetch settings data.');
        }

        const { data: saleData } = await saleResponse.json();
        const { data: settingsData } = settingsResponse.ok ? await settingsResponse.json() : {};

        renderReceipt(saleData, settingsData);

        window.print();

    } catch (error) {
        console.error(error);
        receiptDetails.innerHTML = `<p>Error loading receipt: ${error.message}</p>`;
    }
});

/*
    NOTE: For this to work, your /public/receipt.html should have the following structure:

    <head>
        ...
        <link rel="stylesheet" href="/css/receipt.css">
    </head>
    <body>
        <div class="receipt-container">
            <div id="receipt-header"></div>
            <main id="receipt-details"></main>
            <div id="receipt-footer"></div>
        </div>
        <script src="/js/receipt.js"></script>
    </body>
*/
function renderReceipt(sale, settings = {}) {
    const receiptHeader = document.getElementById('receipt-header');
    const receiptDetails = document.getElementById('receipt-details');
    const receiptFooter = document.getElementById('receipt-footer');

    if (receiptHeader) {
        receiptHeader.innerHTML = `
            <div class="business-info">
                <p class="receipt-header">${settings.receipt_header || 'Your Business Name'}</p>
                <p>${settings.business_address || ''}</p>
                <p>${settings.business_phone || ''}</p>
                <p>TIN: ${settings.business_tin || ''}</p>
            </div>
        `;
    }

    const saleDate = new Date(sale.sale_date).toLocaleString();
    const customerName = sale.customer_name || 'Walk-in Customer';
    const paymentMethod = sale.payment_method ? sale.payment_method.charAt(0).toUpperCase() + sale.payment_method.slice(1) : 'N/A';
    
    let itemsHtml = '';
    let subtotal = 0;
    sale.items.forEach(item => {
        subtotal += item.price_at_sale * item.quantity;
    });
    const taxRate = parseFloat(settings.tax_rate || '0');
    const taxAmount = subtotal * (taxRate / 100);

    sale.items.forEach(item => {
        itemsHtml += `
            <tr>
                <td>
                    <div class="item-name-line">${item.product_name}</div>
                    <div class="item-details-line">${item.quantity} x @ ${formatPrice(item.price_at_sale)}</div>
                </td>
                <td class="price-col">₱${formatPrice(item.price_at_sale * item.quantity)}</td>
            </tr>
        `;
    });

    receiptDetails.innerHTML = `
        <div class="receipt-info">
            <p><strong>OR #:</strong> <span>${sale.sale_id}</span></p>
            <p><strong>Cashier:</strong> <span>${sale.cashier_name}</span></p>
            <p><strong>Customer:</strong> <span>${customerName}</span></p>
            <p><strong>Date:</strong> <span>${saleDate}</span></p>
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
            <p class="summary-total"><span>Total:</span> <span>₱${formatPrice(sale.total_amount)}</span></p>
        </div>
        <div class="payment-details-section">
             <p><span>Paid via:</span> <span>${paymentMethod}</span></p>
             ${sale.payment_method === 'cash' && sale.cash_tendered ? `
                <p><span>Cash Tendered:</span> <span>₱${formatPrice(sale.cash_tendered)}</span></p>
                <p><span>Change:</span> <span>₱${formatPrice(sale.change_due)}</span></p>
             ` : ''}
        </div>
    `;

    if (receiptFooter) {
        receiptFooter.classList.add('receipt-footer'); // Ensure styles are applied
        receiptFooter.textContent = settings.receipt_footer || 'Thank you for your purchase!';
    }
}