// public/js/main.js
document.addEventListener('DOMContentLoaded', () => {
    const productList = document.getElementById('product-list');
    const cartItems = document.getElementById('cart-items');
    const cartTotal = document.getElementById('cart-total');
    const completeSaleBtn = document.getElementById('complete-sale-btn');
    const clearCartBtn = document.getElementById('clear-cart-btn');
    const searchInput = document.getElementById('product-search');
    const logoutBtn = document.getElementById('logout-btn');
    const welcomeUser = document.getElementById('welcome-user');
    const keyboardModeBtn = document.getElementById('keyboard-mode-btn');
    const touchModeBtn = document.getElementById('touch-mode-btn');
    const printContainer = document.getElementById('receipt-container-print');

    let cart = [];
    let allProducts = []; // Cache all products to avoid re-fetching

    // --- UI Mode ---
    function setUIMode(mode) {
        document.body.classList.remove('keyboard-mode', 'touch-mode');
        document.body.classList.add(mode);

        keyboardModeBtn.classList.toggle('active', mode === 'keyboard-mode');
        touchModeBtn.classList.toggle('active', mode === 'touch-mode');

        localStorage.setItem('uiMode', mode);
    }

    keyboardModeBtn.addEventListener('click', () => setUIMode('keyboard-mode'));
    touchModeBtn.addEventListener('click', () => setUIMode('touch-mode'));

    // Load saved UI mode or default to keyboard
    const savedMode = localStorage.getItem('uiMode') || 'keyboard-mode';
    setUIMode(savedMode);

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

    // Fetch and display products
    async function fetchProducts() {
        try {
            const response = await fetch('/api/products');
            const { data } = await response.json();
            allProducts = data;
            renderProducts(allProducts);
        } catch (error) {
            console.error('Failed to fetch products:', error);
            productList.innerHTML = '<p>Error loading products.</p>';
        }
    }

    function renderProducts(products) {
        const fragment = document.createDocumentFragment();
        productList.innerHTML = ''; // Clear existing products
        if (products.length === 0) {
            productList.innerHTML = '<p class="no-results">No products found.</p>';
            return;
        }
        products.forEach(product => {
            const productEl = document.createElement('div');
            productEl.className = 'product-item';
            productEl.tabIndex = 0; // Make it focusable
            productEl.dataset.productId = product.id; // Store product ID for delegation
            productEl.innerHTML = `
                <div class="product-name">${product.name}</div>
                <div class="product-price">₱${product.price.toFixed(2)}</div>
            `;
            fragment.appendChild(productEl);
        });
        productList.appendChild(fragment);
    }

    function addToCart(product) {
        const existingItem = cart.find(item => item.id === product.id);
        if (existingItem) {
            existingItem.quantity++;
        } else {
            cart.push({ ...product, quantity: 1 });
        }
        updateCart();
        searchInput.focus(); // Return focus to search for the next item
    }

    function updateCartItem(productId, change) {
        const item = cart.find(i => i.id === productId);
        if (item) {
            item.quantity += change;
            if (item.quantity <= 0) {
                // If quantity is 0 or less, remove it from the cart
                cart = cart.filter(i => i.id !== productId);
            }
        }
        updateCart();
    }

    function updateCart() {
        const fragment = document.createDocumentFragment();
        cartItems.innerHTML = '';
        let total = 0;

        if (cart.length === 0) {
            cartItems.innerHTML = '<li class="cart-empty">Cart is empty</li>';
        } else {
            cart.forEach(item => {
                const li = document.createElement('li');
                li.className = 'cart-item';
                li.tabIndex = -1; // Make it focusable programmatically
                li.innerHTML = `
                    <div class="item-details">
                        <span class="item-name">${item.name}</span>
                        <span class="item-price-single">₱${item.price.toFixed(2)} each</span>
                    </div>
                    <div class="item-controls">
                        <button class="quantity-btn" data-id="${item.id}" data-change="-1">−</button>
                        <span class="item-quantity">${item.quantity}</span>
                        <button class="quantity-btn" data-id="${item.id}" data-change="1">+</button>
                        <span class="item-total-price">₱${(item.price * item.quantity).toFixed(2)}</span>
                        <button class="remove-item-btn" data-id="${item.id}">×</button>
                    </div>
                `;
                fragment.appendChild(li);
                total += item.price * item.quantity;
            });
            cartItems.appendChild(fragment);
        }
        cartTotal.textContent = `Total: ₱${total.toFixed(2)}`;

        // Auto-scroll to the bottom of the cart
        cartItems.scrollTop = cartItems.scrollHeight;

        // Disable sale button if cart is empty
        completeSaleBtn.disabled = cart.length === 0;
        clearCartBtn.disabled = cart.length === 0;
    }

    function clearCart() {
        if (confirm('Are you sure you want to clear the cart?')) {
            cart = [];
            updateCart();
            searchInput.focus(); // Return focus to search for next transaction
        }
    }

    function renderReceiptForPrinting(saleId, saleData) {
        const saleDate = new Date().toLocaleString();

        let itemsHtml = '';
        saleData.items.forEach(item => {
            itemsHtml += `
                <tr>
                    <td class="item-col">${item.name}</td>
                    <td class="qty-col">${item.quantity}</td>
                    <td class="price-col">₱${(item.price * item.quantity).toFixed(2)}</td>
                </tr>
            `;
        });

        printContainer.innerHTML = `
            <div class="receipt-container">
                <header>
                    <h1>Sale Receipt</h1>
                    <p>Your Store Name</p>
                </header>
                <main id="receipt-details">
                    <div class="receipt-info">
                        <p><strong>Sale ID:</strong> ${saleId}</p>
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
                        Total: ₱${saleData.total_amount.toFixed(2)}
                    </div>
                </main>
                <footer>
                    <p>Thank you for your purchase!</p>
                </footer>
            </div>
        `;
    }

    async function completeSale() {
        if (cart.length === 0) {
            alert('Cart is empty!');
            return;
        }

        const totalAmount = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);

        try {
            const response = await fetch('/api/sales', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ total_amount: totalAmount, items: cart }),
            });

            if (!response.ok) {
                throw new Error('Sale completion failed');
            }

            const result = await response.json();

            if (confirm(`Sale completed successfully! Print receipt?`)) {
                // Render receipt into the hidden div and print
                renderReceiptForPrinting(result.saleId, { total_amount: totalAmount, items: cart });
                window.print();
                printContainer.innerHTML = ''; // Clear after printing
            }

            cart = []; // Clear cart
            updateCart(); // Update UI
            searchInput.focus(); // Return focus to search for next transaction
        } catch (error) {
            console.error('Error completing sale:', error);
            alert('Error completing sale. Please try again.');
        }
    }

    // Event Listeners
    completeSaleBtn.addEventListener('click', completeSale);
    clearCartBtn.addEventListener('click', clearCart);

    cartItems.addEventListener('click', (e) => {
        const target = e.target;
        if (target.classList.contains('quantity-btn')) {
            const id = parseInt(e.target.dataset.id);
            const change = parseInt(e.target.dataset.change);
            updateCartItem(id, change);
        } else if (target.classList.contains('remove-item-btn')) {
            const id = parseInt(e.target.dataset.id);
            cart = cart.filter(i => i.id !== id);
            updateCart();
        }
    });

    searchInput.addEventListener('input', (e) => {
        const searchTerm = e.target.value.toLowerCase();
        const filteredProducts = allProducts.filter(p => p.name.toLowerCase().includes(searchTerm));
        renderProducts(filteredProducts);
    });

    // Optimized event delegation for product list
    productList.addEventListener('click', (e) => {
        const productItem = e.target.closest('.product-item');
        if (productItem) {
            const productId = parseInt(productItem.dataset.productId);
            const product = allProducts.find(p => p.id === productId);
            if (product) {
                addToCart(product);

                // Visual feedback
                productItem.classList.add('added');
                setTimeout(() => {
                    productItem.classList.remove('added');
                }, 500); // Duration of the animation
            }
        }
    });

    productList.addEventListener('keydown', (e) => {
        if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('product-item')) {
            e.target.click(); // Trigger the click event handler
        }
    });

    cartItems.addEventListener('keydown', (e) => {
        if (e.key === 'Delete' && document.activeElement.classList.contains('cart-item')) {
            document.activeElement.querySelector('.remove-item-btn')?.click();
        }
    });
    function handleCartNavigation(e) {
        const { key } = e;
        if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(key)) {
            return;
        }
        e.preventDefault();

        const activeElement = document.activeElement;
        const currentItem = activeElement.closest('.cart-item');

        if (!currentItem) return; // Should not happen if called correctly

        const items = Array.from(cartItems.querySelectorAll('.cart-item'));
        const currentIndex = items.indexOf(currentItem);

        if (key === 'ArrowUp' && currentIndex > 0) {
            items[currentIndex - 1].focus();
        } else if (key === 'ArrowDown' && currentIndex < items.length - 1) {
            items[currentIndex + 1].focus();
        } else if (key === 'ArrowLeft' || key === 'ArrowRight') {
            const controls = Array.from(currentItem.querySelectorAll('.item-controls button'));
            let activeControlIndex = -1;

            // Check if focus is already on a button inside the item
            if (activeElement.tagName === 'BUTTON') {
                activeControlIndex = controls.indexOf(activeElement);
            }

            let nextControlIndex;
            if (key === 'ArrowRight') {
                nextControlIndex = activeControlIndex < controls.length - 1 ? activeControlIndex + 1 : 0;
            } else { // ArrowLeft
                nextControlIndex = activeControlIndex > 0 ? activeControlIndex - 1 : controls.length - 1;
            }

            if (controls[nextControlIndex]) {
                controls[nextControlIndex].focus();
            }
        }
    }

    function handleProductNavigation(e) {
        const { key } = e;
        if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(key)) {
            return;
        }

        e.preventDefault();

        const currentItem = document.activeElement;
        const isProductItem = currentItem && currentItem.classList.contains('product-item');

        if (!isProductItem && productList.contains(currentItem)) {
             // Focus might be on a child element, find the parent product-item
             currentItem = currentItem.closest('.product-item');
        }

        const items = Array.from(productList.querySelectorAll('.product-item'));
        if (items.length === 0) return;

        const isListMode = document.body.classList.contains('keyboard-mode');
        const currentIndex = items.indexOf(currentItem);
        const itemsPerRow = isListMode ? 1 : getComputedStyle(productList).gridTemplateColumns.split(' ').length;

        let nextIndex = -1;

        if (isListMode) {
            // In list mode, left/right have special functions
            if (key === 'ArrowLeft') { searchInput.focus(); return; }
            if (key === 'ArrowRight') { cartItems.querySelector('.cart-item')?.focus(); return; }
        }

        switch (key) {
            case 'ArrowDown':
                nextIndex = currentIndex + itemsPerRow;
                break;
            case 'ArrowUp':
                nextIndex = currentIndex - itemsPerRow;
                break;
            case 'ArrowRight': // Only for grid mode now
                nextIndex = (currentIndex + 1);
                break;
            case 'ArrowLeft': // Only for grid mode now
                nextIndex = (currentIndex - 1);
                break;
        }

        if (nextIndex >= 0 && nextIndex < items.length) {
            items[nextIndex].focus();
        }
    }

    document.addEventListener('keydown', (e) => {
        // Global Tab navigation between panels
        if (e.key === 'Tab') {
            const activeEl = document.activeElement;
            if (e.shiftKey) { // Shift+Tab (moving backwards)
                if (cartItems.contains(activeEl)) {
                    e.preventDefault();
                    productList.querySelector('.product-item')?.focus();
                } else if (productList.contains(activeEl)) {
                    e.preventDefault();
                    searchInput.focus();
                }
            } else { // Tab (moving forwards)
                if (activeEl === searchInput) {
                    e.preventDefault();
                    productList.querySelector('.product-item')?.focus();
                } else if (productList.contains(activeEl)) {
                    e.preventDefault();
                    cartItems.querySelector('.cart-item')?.focus();
                }
            }
        }

        // When Enter is pressed in the search input, focus the product list
        if (e.key === 'Enter' && document.activeElement === searchInput) {
            e.preventDefault();
            productList.querySelector('.product-item')?.focus();
        }

        // Shortcut to focus search: Alt + S
        if (e.altKey && e.key.toLowerCase() === 's') {
            e.preventDefault();
            searchInput.focus();
        }

        // Shortcut to focus cart: Alt + C
        if (e.altKey && e.key.toLowerCase() === 'c') {
            e.preventDefault();
            cartItems.querySelector('.cart-item')?.focus();
        }

        // Shortcut to complete sale: F9
        if (e.key === 'F9') {
            e.preventDefault();
            completeSale();
        }

        // Shortcut to clear cart: F4
        if (e.key === 'F4') {
            e.preventDefault();
            clearCart();
        }

        // Handle product grid navigation if focus is within the product list
        if (productList.contains(document.activeElement)) {
            handleProductNavigation(e);
        } else if (cartItems.contains(document.activeElement)) {
            // Handle cart item navigation
            handleCartNavigation(e);
        }
    });

    // Initial load
    // setUIMode is called above
    checkSession();
    fetchProducts();
    updateCart(); // Initialize cart view
});
