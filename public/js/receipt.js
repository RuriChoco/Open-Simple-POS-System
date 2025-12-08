document.addEventListener('DOMContentLoaded', async () => {
    const receiptDetails = document.getElementById('receipt-details');
    const saleId = window.location.pathname.split('/').pop();

    if (!saleId) {
        receiptDetails.innerHTML = '<p>Error: No Sale ID provided.</p>';
        return;
    }

    try {
        const response = await fetch(`/api/sales/${saleId}`);
        if (!response.ok) {
            throw new Error('Failed to fetch receipt data.');
        }
        const { data } = await response.json();

        renderReceipt(data);

        // Automatically trigger print dialog
        window.print();

    } catch (error) {
        console.error(error);
        receiptDetails.innerHTML = `<p>Error loading receipt: ${error.message}</p>`;
    }
});

function renderReceipt(sale) {
    const receiptDetails = document.getElementById('receipt-details');

    const saleDate = new Date(sale.sale_date).toLocaleString();
    const customerName = sale.customer_name || 'Walk-in Customer';
    const paymentMethod = sale.payment_method ? sale.payment_method.charAt(0).toUpperCase() + sale.payment_method.slice(1) : 'N/A';
    
    let itemsHtml = '';
    sale.items.forEach(item => {
        itemsHtml += `
            <tr>
                <td>
                    ${item.product_name}<br>
                    <small>${item.quantity} x @ ${(item.price_at_sale).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</small>
                </td>
                <td class="price-col">₱${(item.price_at_sale * item.quantity).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
            </tr>
        `;
    });

    receiptDetails.innerHTML = `
        <div class="receipt-info">
            <p><strong>OR #:</strong> ${sale.sale_id}</p>
            <p><strong>Cashier:</strong> ${sale.cashier_name}</p>
            <p><strong>Customer:</strong> ${customerName}</p>
            <p><strong>Date:</strong> ${saleDate}</p>
        </div>
        <table>
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
            <p><span>Total:</span> <strong>₱${(sale.total_amount).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</strong></p>
        </div>
        <div class="payment-details-section">
             <p><small>Paid via: ${paymentMethod}</small></p>
        </div>
    `;
}