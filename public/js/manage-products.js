// public/js/manage-products.js
document.addEventListener('DOMContentLoaded', () => {
    const productList = document.getElementById('product-management-list');
    const addProductForm = document.getElementById('add-product-form');
    const searchInput = document.getElementById('product-search');
    const logoutBtn = document.getElementById('logout-btn');
    const welcomeUser = document.getElementById('welcome-user');
    const statusIndicator = document.getElementById('status-indicator');
    const statusText = document.getElementById('status-text');

    // --- Modal Elements ---
    const modalOverlay = document.getElementById('edit-product-modal');
    const modalContent = document.querySelector('.modal-content');
    const closeModalBtn = document.getElementById('modal-close-btn');
    const editProductForm = document.getElementById('edit-product-form');
    const editProductId = document.getElementById('edit-product-id');
    const editProductName = document.getElementById('edit-product-name');
    const editProductPrice = document.getElementById('edit-product-price');
    const editProductBarcode = document.getElementById('edit-product-barcode');
    const editProductQuantity = document.getElementById('edit-product-quantity');

    let allProducts = [];

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
            // Refresh product list if another admin makes a change
            if (message.type === 'PRODUCTS_UPDATED') {
                console.log('Products updated, refreshing list...');
                fetchProducts();
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

    logoutBtn.addEventListener('click', async () => {
        await fetch('/api/users/logout', { method: 'POST' });
        window.location.href = '/login';
    });

    async function fetchProducts() {
        try {
            const response = await fetch('/api/products');
            if (!response.ok) throw new Error('Failed to fetch products');
            const { data } = await response.json();
            allProducts = data;
            displayProducts(allProducts);
        } catch (error) {
            console.error('Error fetching products:', error);
            productList.innerHTML = '<p class="no-results">Error loading products.</p>';
        }
    }

    function displayProducts(products) {
        productList.innerHTML = '';
        if (products.length === 0) {
            productList.innerHTML = '<p class="no-results">No products found.</p>';
            return;
        }

        products.forEach(product => {
            const item = document.createElement('div');
            item.className = 'product-mgmt-item';
            item.id = `product-${product.id}`;
            item.dataset.productId = product.id;
            item.tabIndex = 0;

            item.innerHTML = `
                <div>
                    <p>${product.name}</p>
                    <small>Price: ₱${formatPrice(product.price)} | Barcode: ${product.barcode || 'N/A'}</small>
                </div>
                <div class="product-mgmt-actions">
                    <span class="product-stock">Stock: ${product.quantity}</span>
                    <button class="edit-btn action-btn" data-product-id="${product.id}">Edit</button>
                    <button class="delete-btn action-btn" data-product-id="${product.id}">Delete</button>
                </div>
            `;
            productList.appendChild(item);
        });
    }

    // --- Add Product ---
    addProductForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const formData = new FormData(addProductForm);
        const productData = Object.fromEntries(formData.entries());

        try {
            const response = await fetch('/api/products', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(productData),
            });

            if (!response.ok) {
                const { error } = await response.json();
                throw new Error(error || 'Failed to add product');
            }

            addProductForm.reset();
            fetchProducts(); // Refresh the list
        } catch (error) {
            console.error('Error adding product:', error);
            alert(`Error: ${error.message}`);
        }
    });

    // --- Search/Filter ---
    searchInput.addEventListener('input', () => {
        const searchTerm = searchInput.value.toLowerCase();
        const filtered = allProducts.filter(p =>
            p.name.toLowerCase().includes(searchTerm) ||
            (p.barcode && p.barcode.includes(searchTerm))
        );
        displayProducts(filtered);
    });

    // --- Edit Modal Logic ---
    function openEditModal(product) {
        editProductId.value = product.id;
        editProductName.value = product.name;
        editProductPrice.value = product.price;
        editProductBarcode.value = product.barcode || '';
        editProductQuantity.value = product.quantity;
        modalOverlay.style.display = 'flex';
        editProductName.focus();
    }

    function closeEditModal() {
        modalOverlay.style.display = 'none';
    }

    productList.addEventListener('click', async (e) => {
        const target = e.target;
        const productId = target.dataset.productId;

        if (target.classList.contains('edit-btn')) {
            const product = allProducts.find(p => p.id == productId);
            if (product) {
                openEditModal(product);
            }
        } else if (target.classList.contains('delete-btn')) {
            if (!productId) return;

            const product = allProducts.find(p => p.id == productId);
            if (confirm(`Are you sure you want to delete "${product.name}"? This action cannot be undone.`)) {
                try {
                    const response = await fetch(`/api/products/${productId}`, {
                        method: 'DELETE'
                    });

                    if (!response.ok) {
                        const { error } = await response.json();
                        throw new Error(error || 'Failed to delete product');
                    }
                    fetchProducts(); // Refresh the list
                } catch (error) {
                    alert(`Error: ${error.message}`);
                }
            }
        }
    });

    closeModalBtn.addEventListener('click', closeEditModal);
    modalOverlay.addEventListener('click', (e) => {
        if (e.target === modalOverlay) {
            closeEditModal();
        }
    });

    editProductForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = editProductId.value;
        const productData = {
            name: editProductName.value,
            price: parseFloat(editProductPrice.value),
            barcode: editProductBarcode.value,
            quantity: parseInt(editProductQuantity.value, 10),
        };

        try {
            const response = await fetch(`/api/products/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(productData),
            });

            if (!response.ok) {
                const { error } = await response.json();
                throw new Error(error || 'Failed to update product');
            }

            closeEditModal();
            fetchProducts(); // Refresh list
        } catch (error) {
            console.error('Error updating product:', error);
            alert(`Error: ${error.message}`);
        }
    });

    // --- Stock Adjustment ---
    const adjustStockForm = document.getElementById('adjust-stock-form');
    adjustStockForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = editProductId.value;
        const adjustment = parseInt(document.getElementById('stock-adjustment-value').value, 10);

        if (!id || !adjustment) {
            alert('Please enter a valid adjustment value.');
            return;
        }

        try {
            const response = await fetch(`/api/products/${id}/adjust-stock`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ adjustment }),
            });

            if (!response.ok) {
                const { error } = await response.json();
                throw new Error(error || 'Failed to adjust stock');
            }

            // Update quantity in the modal without closing it
            editProductQuantity.value = parseInt(editProductQuantity.value, 10) + adjustment;
            document.getElementById('stock-adjustment-value').value = '';
            fetchProducts(); // Refresh list in the background

        } catch (error) {
            console.error('Error adjusting stock:', error);
            alert(`Error: ${error.message}`);
        }
    });

    // Initial Load
    checkSession();
    connectWebSocket();
    fetchProducts();
});