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

    let itemsHtml = '';
    sale.items.forEach(item => {
        itemsHtml += `
            <tr>
                <td class="item-col">${item.product_name}</td>
                <td class="qty-col">${item.quantity}</td>
                <td class="price-col">₱${(item.price_at_sale * item.quantity).toFixed(2)}</td>
            </tr>
        `;
    });

    receiptDetails.innerHTML = `
        <div class="receipt-info">
            <p><strong>Sale ID:</strong> ${sale.sale_id}</p>
            <p><strong>Cashier:</strong> ${sale.cashier_name}</p>
            <p><strong>Date:</strong> ${saleDate}</p>
        </div>
        <table>
            <thead>
                <tr>
                    <th class="item-col">Item</th>
                    <th class="qty-col">Qty</th>
                    <th class="price-col">Subtotal</th>
                </tr>
            </thead>
            <tbody>
                ${itemsHtml}
            </tbody>
        </table>
        <div class="total-section">
            Total: ₱${sale.total_amount.toFixed(2)}
        </div>
    `;
}