document.addEventListener('DOMContentLoaded', () => {
    // --- Element Cache ---
    const addProductForm = document.getElementById('add-product-form');
    const productManagementList = document.getElementById('product-management-list');
    const productMgmtSearch = document.getElementById('product-mgmt-search');
    const logoutBtn = document.getElementById('logout-btn');
    const welcomeUser = document.getElementById('welcome-user');

    let allProducts = [];

    // --- WebSocket Setup ---
    function connectWebSocket() {
        const ws = new WebSocket(`ws://${window.location.host}`);

        ws.onmessage = (event) => {
            const message = JSON.parse(event.data);
            if (message.type === 'PRODUCTS_UPDATED') {
                console.log('Products updated, refreshing management list...');
                fetchProductsForManagement();
            }
        };

        ws.onclose = () => {
            setTimeout(connectWebSocket, 5000);
        };
    }

    // --- Centralized API Fetching with Auth Handling ---
    async function fetchWithAuth(url, options = {}) {
        const response = await fetch(url, options);
        if (response.status === 401) {
            window.location.href = '/login';
            throw new Error('Session expired. Redirecting to login.');
        }
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ error: `HTTP error! status: ${response.status}` }));
            throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
        }
        return response.json();
    }

    // --- Auth & Session ---
    async function checkSession() {
        try {
            const { user } = await fetchWithAuth('/api/users/session');
            welcomeUser.textContent = user.username;
        } catch (error) {
            window.location.href = '/login';
        }
    }

    // --- Product Management ---
    async function fetchProductsForManagement() {
        try {
            const { data } = await fetchWithAuth('/api/products');
            allProducts = data;
            renderProductsForManagement(allProducts);
        } catch (error) {
            console.error('Failed to fetch products:', error);
        }
    }

    function renderProductsForManagement(products) {
        productManagementList.innerHTML = '';
        if (products.length === 0) {
            productManagementList.innerHTML = '<p class="no-results">No products found.</p>';
            return;
        }
        products.forEach(product => {
            const itemEl = document.createElement('div');
            itemEl.className = 'product-mgmt-item';
            itemEl.tabIndex = 0;
            itemEl.innerHTML = `
                <div>
                    <strong>${product.name}</strong>
                    <p>₱${product.price.toFixed(2)}</p>
                    <p class="product-stock">Stock: ${product.quantity}</p>
                </div>
                <div class="product-mgmt-actions">
                    <button class="edit-btn action-btn" data-id="${product.id}">Edit</button>
                    <button class="adjust-stock-btn action-btn" data-id="${product.id}" data-name="${product.name}" data-quantity="${product.quantity}">Adjust Stock</button>
                    <button class="delete-btn action-btn" data-id="${product.id}">Delete</button>
                </div>
            `;
            productManagementList.appendChild(itemEl);
        });
    }

    async function addProduct(name, price, barcode) {
        try {
            const quantity = document.getElementById('product-quantity').value;
            await fetchWithAuth('/api/products', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, price, barcode, quantity }) });
            addProductForm.reset();
            fetchProductsForManagement();
        } catch (error) {
            alert(`Failed to add product: ${error.message}`);
        }
    }

    async function deleteProduct(productId, elementToDelete) {
        if (confirm('Are you sure you want to delete this product?')) {
            try {
                const nextFocusElement = elementToDelete.nextElementSibling || elementToDelete.previousElementSibling;
                await fetchWithAuth(`/api/products/${productId}`, { method: 'DELETE' });
                await fetchProductsForManagement();
                if (nextFocusElement && productManagementList.contains(nextFocusElement)) {
                    nextFocusElement.focus();
                } else {
                    productManagementList.querySelector('.product-mgmt-item')?.focus();
                }
            } catch (error) {
                console.error('Error deleting product:', error);
            }
        }
    }

    // --- Stock Adjustment Modal ---
    function createAdjustStockModal() {
        const modalHTML = `
            <div id="adjust-stock-modal" class="modal-overlay" style="display: none;">
                <div class="modal-content">
                    <button class="modal-close-btn">&times;</button>
                    <h2>Adjust Stock for <span id="adjust-stock-product-name"></span></h2>
                    <p>Current Stock: <strong id="current-stock-level"></strong></p>
                    <form id="adjust-stock-form">
                        <input type="hidden" id="adjust-stock-product-id">
                        <div class="form-group">
                            <label for="stock-adjustment">Adjustment</label>
                            <input type="number" id="stock-adjustment" placeholder="e.g., 5 or -2" required>
                            <small>Enter a positive number to add stock, or a negative number to remove it.</small>
                        </div>
                        <button type="submit" class="btn-primary btn-block">Apply Adjustment</button>
                    </form>
                </div>
            </div>`;
        document.body.insertAdjacentHTML('beforeend', modalHTML);

        const modal = document.getElementById('adjust-stock-modal');
        modal.querySelector('.modal-close-btn').addEventListener('click', () => modal.style.display = 'none');
        modal.addEventListener('click', (e) => { if (e.target === modal) modal.style.display = 'none'; });

        document.getElementById('adjust-stock-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const id = document.getElementById('adjust-stock-product-id').value;
            const adjustment = parseInt(document.getElementById('stock-adjustment').value, 10);

            try {
                await fetchWithAuth(`/api/products/${id}/adjust-stock`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ adjustment }) });
                modal.style.display = 'none';
                fetchProductsForManagement();
            } catch (error) {
                alert(`Failed to adjust stock: ${error.message}`);
            }
        });
    }

    function openAdjustStockModal(productId, productName, currentQuantity) {
        document.getElementById('adjust-stock-product-id').value = productId;
        document.getElementById('adjust-stock-product-name').textContent = productName;
        document.getElementById('current-stock-level').textContent = currentQuantity;
        document.getElementById('adjust-stock-form').reset();
        document.getElementById('adjust-stock-modal').style.display = 'flex';
    }

    // --- Modals ---
    function createEditModal() {
        const modalHTML = `
            <div id="edit-product-modal" class="modal-overlay" style="display: none;">
                <div class="modal-content">
                    <button class="modal-close-btn">&times;</button>
                    <h2>Edit Product</h2>
                    <form id="edit-product-form">
                        <input type="hidden" id="edit-product-id">
                        <div class="form-group"><label for="edit-product-name">Product Name</label><input type="text" id="edit-product-name" required></div>
                        <div class="form-group"><label for="edit-product-price">Price</label><input type="number" id="edit-product-price" step="0.01" required></div>
                        <div class="form-group"><label for="edit-product-barcode">Barcode</label><input type="text" id="edit-product-barcode"></div>
                        <div class="form-group"><label for="edit-product-quantity">Stock Quantity</label><input type="number" id="edit-product-quantity" min="0" required></div>
                        <button type="submit" class="btn-primary btn-block">Save Changes</button>
                    </form>
                </div>
            </div>`;
        document.body.insertAdjacentHTML('beforeend', modalHTML);
        const modal = document.getElementById('edit-product-modal');
        modal.querySelector('.modal-close-btn').addEventListener('click', () => modal.style.display = 'none');
        modal.addEventListener('click', (e) => { if (e.target === modal) modal.style.display = 'none'; });
        document.getElementById('edit-product-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const id = document.getElementById('edit-product-id').value;
            const name = document.getElementById('edit-product-name').value;
            const price = parseFloat(document.getElementById('edit-product-price').value);
            const barcode = document.getElementById('edit-product-barcode').value;
            const quantity = parseInt(document.getElementById('edit-product-quantity').value, 10);
            try {
                await fetchWithAuth(`/api/products/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, price, barcode, quantity }) });
                modal.style.display = 'none';
                fetchProductsForManagement();
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
        document.getElementById('edit-product-quantity').value = product.quantity;
        document.getElementById('edit-product-modal').style.display = 'flex';
    }

    // --- EVENT LISTENERS ---
    logoutBtn.addEventListener('click', async () => {
        await fetch('/api/users/logout', { method: 'POST' });
        window.location.href = '/login';
    });

    addProductForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const name = document.getElementById('product-name').value;
        const price = parseFloat(document.getElementById('product-price').value);
        const barcode = document.getElementById('product-barcode').value;
        addProduct(name, price, barcode);
    });

    productManagementList.addEventListener('click', (e) => {
        const target = e.target;
        const itemElement = target.closest('.product-mgmt-item');
        if (!itemElement) return;
        const productId = itemElement.querySelector('.edit-btn').dataset.id;
        if (target.classList.contains('delete-btn')) {
            deleteProduct(productId, itemElement);
        } else if (target.classList.contains('edit-btn')) {
            openEditModal(productId);
        } else if (target.classList.contains('adjust-stock-btn')) {
            const productName = target.dataset.name;
            const currentQuantity = target.dataset.quantity;
            openAdjustStockModal(productId, productName, currentQuantity);
        }
    });

    productMgmtSearch.addEventListener('input', (e) => {
        const searchTerm = e.target.value.toLowerCase();
        const filteredProducts = allProducts.filter(p => p.name.toLowerCase().includes(searchTerm) || p.barcode?.includes(searchTerm));
        renderProductsForManagement(filteredProducts);
    });

    // --- Initial Load ---
    checkSession();
    connectWebSocket();
    createAdjustStockModal();
    createEditModal();
    fetchProductsForManagement();
});