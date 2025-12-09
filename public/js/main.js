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
    const listViewBtn = document.getElementById('list-view-btn');
    const printContainer = document.getElementById('receipt-container-print');
    const statusIndicator = document.getElementById('status-indicator');
    const statusText = document.getElementById('status-text');
    // Payment Modal Elements
    const paymentModal = document.getElementById('payment-modal');
    const closeModalBtn = document.getElementById('modal-close-btn');
    const paymentForm = document.getElementById('payment-form');
    const paymentTotalEl = document.getElementById('payment-total');
    const paymentMethodInput = document.getElementById('payment-method-input');
    const cashReceivedInput = document.getElementById('cash-received');
    const changeDueEl = document.getElementById('change-due');
    const exactCashBtn = document.getElementById('exact-cash-btn');
    const cashPaymentDetails = document.getElementById('cash-payment-details');
    const confirmPaymentBtn = paymentForm.querySelector('button[type="submit"]');

    let cart = [];
    let allProducts = []; // Cache all products to avoid re-fetching

    // --- Helper Functions ---
    function formatPrice(number) {
        // Formats a number with commas for thousands and ensures two decimal places.
        return number.toLocaleString('en-US', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
        });
    }
    // --- WebSocket Setup ---
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
    listViewBtn.addEventListener('click', () => {
        productList.classList.toggle('list-view');
        const isListView = productList.classList.contains('list-view');
        listViewBtn.classList.toggle('active', isListView);
        localStorage.setItem('posListView', isListView);
    });

    // Load saved UI mode or default to keyboard
    const savedMode = localStorage.getItem('uiMode') || 'keyboard-mode';
    setUIMode(savedMode);

    // Load saved list view state
    const savedListView = localStorage.getItem('posListView') === 'true';
    productList.classList.toggle('list-view', savedListView);
    listViewBtn.classList.toggle('active', savedListView);

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
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Failed to fetch products');
            }
            const { data } = await response.json();
            allProducts = data;
            displayProducts(allProducts);
        } catch (error) {
            console.error('Failed to fetch products:', error);
            productList.innerHTML = '<p>Error loading products.</p>';
        }
    }

    function displayProducts(products) {
        const fragment = document.createDocumentFragment();
        productList.innerHTML = ''; // Clear existing products
        if (products.length === 0) {
            productList.innerHTML = '<p class="no-results">No products found.</p>';
            return;
        }

        products.forEach(product => {
            const productEl = document.createElement('div');
            productEl.className = `product-item ${product.quantity <= 0 && product.quantity < 999 ? 'out-of-stock' : ''}`;
            productEl.tabIndex = 0; // Make it focusable
            productEl.dataset.productId = product.id; // Store product ID for delegation

            const nameDiv = document.createElement('div');
            nameDiv.className = 'product-name';
            nameDiv.textContent = product.name;

            const metaDiv = document.createElement('div');
            metaDiv.className = 'product-meta';

            const priceDiv = document.createElement('div');
            priceDiv.className = 'product-price';
            priceDiv.textContent = `₱${formatPrice(product.price)}`;
            
            const stockDiv = document.createElement('div');
            stockDiv.className = 'product-stock';
            
            // Handle services which might have very high stock numbers
            if (product.quantity > 999) {
                stockDiv.textContent = 'Service';
            } else {
                stockDiv.textContent = `Stock: ${product.quantity}`;
            }
    
            metaDiv.append(priceDiv, stockDiv);
            
            productEl.append(nameDiv, metaDiv);
            fragment.appendChild(productEl);
        });
        productList.appendChild(fragment);
    }

    function addToCart(product) {
        if (product.quantity <= 0 && product.quantity < 999) { // Don't block services
            alert(`'${product.name}' is out of stock.`);
            return;
        }

        const existingItemInCart = cart.find(item => item.id === product.id);
        if (existingItemInCart && existingItemInCart.quantity >= product.quantity) {
            alert(`No more stock available for '${product.name}'.`);
            return;
        }

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
            // Prevent increasing quantity beyond available stock
            if (change > 0) {
                const productInStock = allProducts.find(p => p.id === productId);
                if (item.quantity + change > productInStock.quantity) {
                    alert(`Not enough stock for '${item.name}'. Only ${productInStock.quantity} available.`);
                    return;
                }
            }

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

                const itemDetails = document.createElement('div');
                itemDetails.className = 'item-details';
                const itemName = document.createElement('span');
                itemName.className = 'item-name';
                itemName.textContent = item.name;
                const itemPriceSingle = document.createElement('span');
                itemPriceSingle.className = 'item-price-single';
                itemPriceSingle.textContent = `₱${formatPrice(item.price)} each`;
                itemDetails.append(itemName, itemPriceSingle);

                const itemControls = document.createElement('div');
                itemControls.className = 'item-controls';
                itemControls.innerHTML = `<button class="quantity-btn" data-id="${item.id}" data-change="-1">−</button><span class="item-quantity">${item.quantity}</span><button class="quantity-btn" data-id="${item.id}" data-change="1">+</button><span class="item-total-price">₱${formatPrice(item.price * item.quantity)}</span><button class="remove-item-btn" data-id="${item.id}">×</button>`;

                li.append(itemDetails, itemControls);
                fragment.appendChild(li);
                total += item.price * item.quantity;
            });
            cartItems.appendChild(fragment);
        }
        cartTotal.textContent = `Total: ₱${formatPrice(total)}`;

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

    function renderReceiptForPrinting(saleId, saleData, settings = {}) {
        const saleDate = new Date().toLocaleString();
        const cashierName = saleData.cashier_name || welcomeUser.textContent || 'N/A';
        const customerName = saleData.customer_name || 'Walk-in Customer';

        const receiptHeader = settings.receipt_header || 'Your Business Name';
        const receiptFooter = settings.receipt_footer || 'Thank you for your purchase!';

        const businessInfoHtml = `
            <p class="receipt-header">${receiptHeader}</p>
            <p>${settings.business_address || ''}</p>
            <p>${settings.business_phone || ''}</p>
            <p>TIN: ${settings.business_tin || ''}</p>
        `;
        // Enhanced item list
        let itemsHtml = '';
        saleData.items.forEach(item => {
            itemsHtml += `
                <tr>
                    <td>
                        <div class="item-name-line">${item.name}</div>
                        <div class="item-details-line">${item.quantity} x @ ${formatPrice(item.price)}</div>
                    </td>
                    <td class="price-col">₱${formatPrice(item.price * item.quantity)}</td>
                </tr>
            `;
        });

        const taxRate = parseFloat(settings.tax_rate || '0');
        const subtotal = saleData.items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
        const taxAmount = subtotal * (taxRate / 100);
        const totalAmount = subtotal + taxAmount;

        // Payment details section
        let paymentDetailsHtml = `<p><span>Paid via:</span> <span>${saleData.payment_method.charAt(0).toUpperCase() + saleData.payment_method.slice(1)}</span></p>`;
        if (saleData.payment_method === 'cash') {
            const cashReceived = saleData.cash_received || 0;
            const changeDue = cashReceived > saleData.total_amount ? cashReceived - saleData.total_amount : 0;
            paymentDetailsHtml += `
                <p><span>Cash Tendered:</span> <span>₱${formatPrice(cashReceived)}</span></p>
                <p><span>Change:</span> <span>₱${formatPrice(changeDue)}</span></p>
            `;
        }

        printContainer.innerHTML = `
            <div class="receipt-container">
                <div class="business-info">
                    ${businessInfoHtml}
                </div>
                <main>
                    <div class="receipt-info">
                        <p><strong>OR #:</strong> <span>${saleId}</span></p>
                        <p><strong>Cashier:</strong> <span>${cashierName}</span></p>
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
                        <p class="summary-total"><span>Total:</span> <span>₱${formatPrice(totalAmount)}</span></p>
                    </div>
                    <div class="payment-details-section">
                        ${paymentDetailsHtml}
                    </div>
                </main>
                <div class="receipt-footer">
                    ${receiptFooter}
                </div>
            </div>
        `;
    }

    async function completeSale(paymentMethod, customerName) {
        if (cart.length === 0) {
            alert('Cart is empty!');
            return;
        }

        // Fetch latest settings to get tax rate
        const settingsResponse = await fetch('/api/settings');
        const settingsData = settingsResponse.ok ? (await settingsResponse.json()).data : {};
        const taxRate = parseFloat(settingsData.tax_rate || '0');

        const subtotal = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
        const taxAmount = subtotal * (taxRate / 100);
        const totalAmount = subtotal + taxAmount;

        const cashReceived = parseFloat(cashReceivedInput.value) || 0;
        const changeDue = cashReceived > totalAmount ? cashReceived - totalAmount : 0;

        const salePayload = {
            total_amount: totalAmount,
            items: cart,
            payment_method: paymentMethod, // 'cash', 'gcash', etc.
            customer_name: customerName,
            cash_tendered: paymentMethod === 'cash' ? cashReceived : null,
            change_due: paymentMethod === 'cash' ? changeDue : null
        };

        try {
            const response = await fetch('/api/sales', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(salePayload),
            });

            if (!response.ok) {
                const errorData = await response.json();
                let errorMessage = errorData.error || 'Sale completion failed';
                if (errorData.details) {
                    errorMessage += `\n\nDetails: ${errorData.details}`;
                }
                throw new Error(errorMessage);
            }
            const result = await response.json();

            // Add new data to the object for receipt printing
            const receiptDataForPrint = { ...salePayload, cash_received: cashReceived };

            if (confirm(`Sale completed successfully! Print receipt?`)) {
                // Render receipt into the hidden div and print
                renderReceiptForPrinting(result.saleId, receiptDataForPrint, settingsData);
                window.print();
                printContainer.innerHTML = ''; // Clear after printing
            }

            cart = []; // Clear cart
            updateCart(); // Update UI
            searchInput.focus(); // Return focus to search for next transaction
        } catch (error) {
            console.error('Error completing sale:', error);
            alert(`Error completing sale: ${error.message}`);
        }
    }

    // Event Listeners
    completeSaleBtn.addEventListener('click', () => {
        if (cart.length === 0) {
            alert('Cart is empty!');
            return;
        }
        const total = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
        paymentTotalEl.textContent = `Total: ₱${formatPrice(total)}`;
        cashReceivedInput.value = '';
        changeDueEl.value = '₱0.00';
        confirmPaymentBtn.disabled = true;
        paymentModal.style.display = 'flex';
        cashReceivedInput.focus();
    });

    closeModalBtn.addEventListener('click', () => {
        paymentModal.style.display = 'none';
    });

    cashReceivedInput.addEventListener('input', () => {
        const total = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
        const cashReceived = parseFloat(cashReceivedInput.value) || 0;
        const change = cashReceived - total;
        confirmPaymentBtn.disabled = cashReceived < total;
        changeDueEl.value = `₱${formatPrice(Math.max(0, change))}`;
    });

    exactCashBtn.addEventListener('click', () => {
        const total = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
        cashReceivedInput.value = total.toFixed(2);
        // Manually trigger the input event to update the change
        cashReceivedInput.dispatchEvent(new Event('input'));
    });

    paymentModal.addEventListener('click', (e) => {
        if (e.target === paymentModal) {
            paymentModal.style.display = 'none';
        }
    });

    paymentModal.addEventListener('click', (e) => {
        if (e.target === paymentModal) {
            paymentModal.style.display = 'none';
        }
    });

    document.querySelectorAll('.payment-method-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.payment-method-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            paymentMethodInput.value = btn.dataset.method;
            cashPaymentDetails.style.display = btn.dataset.method === 'cash' ? 'block' : 'none';
            // Re-evaluate button state when switching payment method
            if (btn.dataset.method !== 'cash') {
                confirmPaymentBtn.disabled = false;
            } else {
                cashReceivedInput.dispatchEvent(new Event('input'));
            }
        });
    });

    document.querySelectorAll('.quick-cash-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const amount = btn.dataset.amount;
            const total = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
            let cashValue = 0;

            if (amount === 'next-bill') {
                const bills = [20, 50, 100, 200, 500, 1000];
                cashValue = bills.find(bill => bill >= total) || total;
            } else {
                cashValue = parseFloat(amount);
            }

            cashReceivedInput.value = cashValue.toFixed(2);
            // Manually trigger the input event to update the change and button state
            cashReceivedInput.dispatchEvent(new Event('input'));
        });
    });

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
        const searchTerm = e.target.value;
        const lowerCaseSearchTerm = searchTerm.toLowerCase();
        const filteredProducts = allProducts.filter(p => 
            p.name.toLowerCase().includes(lowerCaseSearchTerm) || 
            (p.barcode && p.barcode.includes(searchTerm))
        );
        displayProducts(filteredProducts);
    });

    // Optimized event delegation for product list
    productList.addEventListener('click', (e) => {
        const productItem = e.target.closest('.product-item');
        if (productItem) {
            if (productItem.classList.contains('out-of-stock')) {
                return; // Do not add out-of-stock items
            }
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
            const searchTerm = searchInput.value.trim();

            // Prioritize barcode scan
            const productByBarcode = allProducts.find(p => p.barcode === searchTerm);

            if (productByBarcode) {
                addToCart(productByBarcode);
                searchInput.value = ''; // Clear input for next scan
                // Trigger input event to reset the filtered list
                searchInput.dispatchEvent(new Event('input', { bubbles: true }));
            } else {
                // If no barcode match, default to focusing the first visible product
                const firstProduct = productList.querySelector('.product-item');
                if (firstProduct) firstProduct.focus();
            }
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
            completeSaleBtn.click(); // Open the payment modal
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

    paymentForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const paymentMethod = paymentMethodInput.value;
        const customerName = document.getElementById('customer-name').value.trim();
        completeSale(paymentMethod, customerName);
        paymentModal.style.display = 'none';
    });

    // Initial load
    // setUIMode is called above
    checkSession();
    connectWebSocket();
    fetchProducts();
    updateCart(); // Initialize cart view
});
