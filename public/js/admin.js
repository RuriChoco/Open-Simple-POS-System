// public/js/admin.js
document.addEventListener('DOMContentLoaded', () => {
    const addProductForm = document.getElementById('add-product-form');
    const productManagementList = document.getElementById('product-management-list');
    const salesHistoryList = document.getElementById('sales-history-list');
    const createCashierForm = document.getElementById('create-cashier-form');
    const logoutBtn = document.getElementById('logout-btn');
    const welcomeUser = document.getElementById('welcome-user');

    let allProducts = []; // Cache products for editing

    // --- Auth & Session ---
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

    logoutBtn.addEventListener('click', async () => {
        await fetch('/api/users/logout', { method: 'POST' });
        window.location.href = '/login';
    });




    // --- Product Management ---

    async function fetchProductsForManagement() {
        try {
            const response = await fetch('/api/products');
            const { data } = await response.json();
            allProducts = data; // Cache for editing
            productManagementList.innerHTML = ''; // Clear list
            data.forEach(product => {
                const itemEl = document.createElement('div');
                itemEl.className = 'product-mgmt-item';
                itemEl.tabIndex = 0; // Make it focusable for keyboard navigation
                itemEl.innerHTML = `
                    <div>
                        <strong>${product.name}</strong>
                        <p>₱${product.price.toFixed(2)}</p>
                    </div>
                    <div class="product-mgmt-actions">
                        <button class="edit-btn" data-id="${product.id}">Edit</button>
                        <button class="delete-btn" data-id="${product.id}">Delete</button>
                    </div>
                `;
                productManagementList.appendChild(itemEl);
            });
        } catch (error) {
            console.error('Failed to fetch products:', error);
        }
    }

    addProductForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = document.getElementById('product-name').value;
        const price = parseFloat(document.getElementById('product-price').value);
        const barcode = document.getElementById('product-barcode').value;

        try {
            const response = await fetch('/api/products', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, price, barcode }),
            });
            if (response.ok) {
                addProductForm.reset();
                fetchProductsForManagement();
            } else {
                alert('Failed to add product.');
            }
        } catch (error) {
            console.error('Error adding product:', error);
        }
    });

    async function deleteProduct(productId) {
        if (confirm('Are you sure you want to delete this product?')) {
            try {
                const response = await fetch(`/api/products/${productId}`, { method: 'DELETE' });
                if (response.ok) {
                    fetchProductsForManagement();
                } else {
                    alert('Failed to delete product.');
                }
            } catch (error) {
                console.error('Error deleting product:', error);
            }
        }
    }

    productManagementList.addEventListener('click', async (e) => {
        const target = e.target;
        if (target.classList.contains('delete-btn')) {
            deleteProduct(e.target.dataset.id);
        } else if (target.classList.contains('edit-btn')) {
            openEditModal(target.dataset.id);
        }
    });

    productManagementList.addEventListener('keydown', async (e) => {
        if (e.key === 'Delete' && e.target.classList.contains('product-mgmt-item')) {
            const deleteButton = e.target.querySelector('.delete-btn');
            if (deleteButton) {
                deleteProduct(deleteButton.dataset.id);
            }
        }
    });

    // --- Cashier Creation ---
    createCashierForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = document.getElementById('cashier-username').value;
        const password = document.getElementById('cashier-password').value;

        try {
            const response = await fetch('/api/users/create-cashier', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password }),
            });
            if (response.ok) {
                alert('Cashier account created successfully.');
                createCashierForm.reset();
            } else {
                const { error } = await response.json();
                alert(`Failed to create cashier: ${error}`);
            }
        } catch (error) { console.error('Error creating cashier:', error); }
    });

    // --- Sales History ---

    async function fetchSalesHistory() {
        try {
            const response = await fetch('/api/sales/history');
            const { data } = await response.json();
            renderSalesHistory(data);
        } catch (error) {
            console.error('Failed to fetch sales history:', error);
            salesHistoryList.innerHTML = '<p>Error loading sales history.</p>';
        }
    }

    function renderSalesHistory(sales) {
        salesHistoryList.innerHTML = '';
        if (sales.length === 0) {
            salesHistoryList.innerHTML = '<p>No sales have been recorded yet.</p>';
            return;
        }

        sales.forEach(sale => {
            const saleDate = new Date(sale.sale_date).toLocaleString();
            const itemsHtml = sale.items.map(item => `
                <li>${item.product_name} (x${item.quantity}) - ₱${(item.price_at_sale * item.quantity).toFixed(2)}</li>
            `).join('');

            const saleElement = document.createElement('details');
            saleElement.className = 'sale-history-item';
            saleElement.innerHTML = `
                <summary>
                    <span>Sale #${sale.sale_id} - <strong>₱${sale.total_amount.toFixed(2)}</strong></span>
                    <time>${saleDate}</time>
                </summary>
                <ul class="sale-items-list">${itemsHtml}</ul>
            `;
            salesHistoryList.appendChild(saleElement);
        });
    }

    // --- Edit Product Modal Logic ---
    function createEditModal() {
        const modalHTML = `
            <div id="edit-product-modal" class="modal-overlay" style="display: none;">
                <div class="modal-content">
                    <button class="modal-close-btn">&times;</button>
                    <h2>Edit Product</h2>
                    <form id="edit-product-form">
                        <input type="hidden" id="edit-product-id">
                        <div class="form-group">
                            <label for="edit-product-name">Product Name</label>
                            <input type="text" id="edit-product-name" required>
                        </div>
                        <div class="form-group">
                            <label for="edit-product-price">Price</label>
                            <input type="number" id="edit-product-price" step="0.01" required>
                        </div>
                        <div class="form-group">
                            <label for="edit-product-barcode">Barcode</label>
                            <input type="text" id="edit-product-barcode">
                        </div>
                        <button type="submit" class="btn-primary">Save Changes</button>
                    </form>
                </div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', modalHTML);

        const modal = document.getElementById('edit-product-modal');
        modal.querySelector('.modal-close-btn').addEventListener('click', () => modal.style.display = 'none');
        modal.addEventListener('click', (e) => {
            if (e.target === modal) { // Click on overlay
                modal.style.display = 'none';
            }
        });

        document.getElementById('edit-product-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const id = document.getElementById('edit-product-id').value;
            const name = document.getElementById('edit-product-name').value;
            const price = parseFloat(document.getElementById('edit-product-price').value);
            const barcode = document.getElementById('edit-product-barcode').value;

            try {
                const response = await fetch(`/api/products/${id}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name, price, barcode }),
                });
                if (response.ok) {
                    modal.style.display = 'none';
                    fetchProductsForManagement();
                } else {
                    alert('Failed to update product.');
                }
            } catch (error) {
                console.error('Error updating product:', error);
            }
        });
    }

    function openEditModal(productId) {
        const product = allProducts.find(p => p.id == productId);
        if (!product) return;

        document.getElementById('edit-product-id').value = product.id;
        document.getElementById('edit-product-name').value = product.name;
        document.getElementById('edit-product-price').value = product.price;
        document.getElementById('edit-product-barcode').value = product.barcode;

        document.getElementById('edit-product-modal').style.display = 'flex';
    }

    // --- Initial Load ---
    checkSession();
    createEditModal(); // Create and append the modal to the DOM
    fetchProductsForManagement();
    fetchSalesHistory();
});