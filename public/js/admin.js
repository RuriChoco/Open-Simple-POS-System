// public/js/admin.js
document.addEventListener('DOMContentLoaded', () => {
    const addProductForm = document.getElementById('add-product-form');
    const productManagementList = document.getElementById('product-management-list');
    const salesHistoryList = document.getElementById('sales-history-list');
    const createCashierForm = document.getElementById('create-cashier-form');
    const salesHistorySearch = document.getElementById('sales-history-search');
    const dailySalesContainer = document.getElementById('daily-sales-report');
    const logoutBtn = document.getElementById('logout-btn');
    const topSellingContainer = document.getElementById('top-selling-report');
    const cashierPerformanceContainer = document.getElementById('cashier-performance-report');
    const startDateInput = document.getElementById('start-date');
    const endDateInput = document.getElementById('end-date');
    const filterReportBtn = document.getElementById('filter-report-btn');
    const resetFilterBtn = document.getElementById('reset-filter-btn');
    const exportCsvBtn = document.getElementById('export-csv-btn');
    const welcomeUser = document.getElementById('welcome-user');
    const productMgmtSearch = document.getElementById('product-mgmt-search');

    let allProducts = []; // Cache products for editing
    let salesChartInstance = null; // To hold the chart instance

    // --- Centralized API Fetching with Auth Handling ---
    async function fetchWithAuth(url, options = {}) {
        const response = await fetch(url, options);
        if (response.status === 401) {
            // Session expired or invalid, redirect to login
            window.location.href = '/login';
            // Throw an error to stop further execution in the calling function
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
            window.location.href = '/login'; // Redirect if not logged in
        }
    }

    logoutBtn.addEventListener('click', async () => {
        await fetchWithAuth('/api/users/logout', { method: 'POST' });
        window.location.href = '/login';
    });




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
        productManagementList.innerHTML = ''; // Clear list
        if (products.length === 0) {
            productManagementList.innerHTML = '<p class="no-results">No products found.</p>';
            return;
        }
        products.forEach(product => {
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
    }

    addProductForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = document.getElementById('product-name').value;
        const price = parseFloat(document.getElementById('product-price').value);
        const barcode = document.getElementById('product-barcode').value;

        try {
            const response = await fetchWithAuth('/api/products', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, price, barcode }) });
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

    async function deleteProduct(productId, elementToDelete) {
        if (confirm('Are you sure you want to delete this product?')) {
            try {
                // Find the next element to focus before deleting
                const nextFocusElement = elementToDelete.nextElementSibling || elementToDelete.previousElementSibling;

                await fetchWithAuth(`/api/products/${productId}`, { method: 'DELETE' });
                await fetchProductsForManagement(); // Re-render the list

                // Restore focus
                if (nextFocusElement && productManagementList.contains(nextFocusElement)) {
                    nextFocusElement.focus();
                } else {
                    // If no sibling, focus the first item in the list
                    productManagementList.querySelector('.product-mgmt-item')?.focus();
                }
            } catch (error) {
                console.error('Error deleting product:', error);
            }
        }
    }

    productManagementList.addEventListener('click', (e) => {
        const target = e.target;
        if (target.classList.contains('delete-btn')) {
            const itemElement = target.closest('.product-mgmt-item');
            deleteProduct(target.dataset.id, itemElement);
        } else if (target.classList.contains('edit-btn')) {
            openEditModal(target.dataset.id);
        }
    });

    productManagementList.addEventListener('keydown', (e) => {
        const currentItem = e.target;
        if (!currentItem.classList.contains('product-mgmt-item')) return;

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            currentItem.nextElementSibling?.focus();
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            currentItem.previousElementSibling?.focus();
        } else if (e.key === 'Enter') {
            e.preventDefault();
            currentItem.querySelector('.edit-btn')?.click();
        } else if (e.key === 'Delete') {
            const deleteButton = e.target.querySelector('.delete-btn');
            if (deleteButton) {
                deleteProduct(deleteButton.dataset.id);
            }
        }
    });

    productMgmtSearch.addEventListener('input', (e) => {
        const searchTerm = e.target.value.toLowerCase();
        const filteredProducts = allProducts.filter(p => p.name.toLowerCase().includes(searchTerm) || p.barcode?.includes(searchTerm));
        renderProductsForManagement(filteredProducts);
    });

    // --- Cashier Creation ---
    createCashierForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = document.getElementById('cashier-username').value;
        const password = document.getElementById('cashier-password').value;

        try {
            await fetchWithAuth('/api/users/create-cashier', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password }),
            });
            alert('Cashier account created successfully.');
            createCashierForm.reset();
        } catch (error) { console.error('Error creating cashier:', error); }
    });

    // --- Sales History ---

    async function fetchSalesHistory(page = 1, searchTerm = '') {
        try {
            const params = new URLSearchParams({ page, limit: 10 });
            if (searchTerm) params.append('search', searchTerm);

            const { data, pagination } = await fetchWithAuth(`/api/sales/history?${params.toString()}`);
            renderSalesHistory(data, pagination);

        } catch (error) {
            console.error('Failed to fetch sales history:', error);
            salesHistoryList.innerHTML = '<p>Error loading sales history.</p>';
        }
    }

    function renderSalesHistory(sales, pagination) {
        salesHistoryList.innerHTML = '';
        if (!sales || sales.length === 0) {
            const searchTerm = salesHistorySearch.value;
            const message = document.createElement('p');
            message.textContent = searchTerm
                ? `No sale found for ID "${searchTerm}".`
                : 'No sales have been recorded yet.';
            salesHistoryList.appendChild(message);
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
                    <div class="summary-main">
                        <span>Sale #${sale.sale_id} - <strong>₱${sale.total_amount.toFixed(2)}</strong></span>
                        <span class="cashier-name">Cashier: ${sale.cashier_name || 'N/A'}</span>
                        <time>${saleDate}</time>
                    </div>
                    <div class="sale-actions">
                        <button class="reprint-btn" data-id="${sale.sale_id}" title="Reprint Receipt">Reprint</button>
                        <button class="void-btn" data-id="${sale.sale_id}" title="Void Sale">Void</button>
                    </div>
                </summary>
                <ul class="sale-items-list">${itemsHtml}</ul>
            `;
            salesHistoryList.appendChild(saleElement);
        });

        // Add event listeners for the new action buttons
        salesHistoryList.querySelectorAll('.sale-actions button').forEach(button => {
            button.addEventListener('click', async (e) => {
                e.stopPropagation(); // Prevent the <details> from toggling when a button is clicked
                const saleId = button.dataset.id;

                if (button.classList.contains('void-btn')) {
                if (confirm(`Are you sure you want to void Sale #${saleId}? This action cannot be undone.`)) {
                        await fetchWithAuth(`/api/sales/${saleId}`, { method: 'DELETE' });
                        fetchSalesHistory(); // Refresh sales history
                        fetchDailySalesReport(); // Refresh daily report and chart
                    }
                } else if (button.classList.contains('reprint-btn')) {
                    window.open(`/receipt/${saleId}`, '_blank');
                }
            });
        });

        // Render pagination controls
        const salesHistoryCard = document.getElementById('sales-history-list').parentElement;
        salesHistoryCard.querySelector('.pagination-controls')?.remove(); // Remove old controls
        if (!pagination || !pagination.totalPages) return; // Don't render controls if no pages

        const paginationControls = document.createElement('div');
        paginationControls.className = 'pagination-controls';

        const prevButton = document.createElement('button');
        prevButton.textContent = 'Previous';
        prevButton.disabled = pagination.currentPage === 1;
        prevButton.addEventListener('click', () => fetchSalesHistory(pagination.currentPage - 1));

        const nextButton = document.createElement('button');
        nextButton.textContent = 'Next';
        nextButton.disabled = pagination.currentPage === pagination.totalPages;
        nextButton.addEventListener('click', () => fetchSalesHistory(pagination.currentPage + 1));

        const pageInfo = document.createElement('span');
        pageInfo.textContent = `Page ${pagination.currentPage} of ${pagination.totalPages}`;

        paginationControls.appendChild(prevButton);
        paginationControls.appendChild(pageInfo);
        paginationControls.appendChild(nextButton);

        salesHistoryCard.appendChild(paginationControls);
    }

    // Debounce function to limit how often fetchSalesHistory is called
    function debounce(func, delay) {
        let timeout;
        return function(...args) {
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(this, args), delay);
        };
    }

    const debouncedSearch = debounce((searchTerm) => {
        fetchSalesHistory(1, searchTerm);
    }, 300); // 300ms delay

    salesHistorySearch.addEventListener('input', (e) => {
        debouncedSearch(e.target.value);
    });

    async function fetchDailySalesReport(startDate, endDate) {
        try {
            const params = new URLSearchParams();
            if (startDate && endDate) {
                params.append('startDate', startDate);
                params.append('endDate', endDate);
            }
            const url = `/api/sales/daily-report?${params.toString()}`;
            const { data: reportData } = await fetchWithAuth(url);
            
            renderDailySalesReport(reportData); // This renders the table
            if (reportData && reportData.length > 0) {
                renderSalesReportChart(reportData); // Only render chart if there's data
            }
            fetchTopSellingProducts(startDate, endDate); // Also update top selling products
            fetchCashierPerformance(startDate, endDate); // Also update cashier performance
        } catch (error) {
            console.error('Failed to fetch daily sales report:', error);
            dailySalesContainer.innerHTML = '<p>Error loading daily report.</p>';
        }
    }

    function renderDailySalesReport(reportData) {
        exportCsvBtn.style.display = 'none'; // Hide by default

        if (!reportData || reportData.length === 0) {
            dailySalesContainer.innerHTML = '<p>No sales data available for the report.</p>';
            document.querySelector('.chart-container').style.display = 'none';
            return;
        }
        exportCsvBtn.style.display = 'inline-block'; // Show button if data exists
        document.querySelector('.chart-container').style.display = 'block';

        const table = document.createElement('table');
        table.className = 'report-table';
        table.innerHTML = `
            <thead>
                <tr>
                    <th>Date</th>
                    <th>Sales Count</th>
                    <th>Items Sold</th>
                    <th>Total Revenue</th>
                </tr>
            </thead>
            <tbody>
                ${reportData.map(row => `
                    <tr>
                        <td>${new Date(row.report_date).toLocaleDateString()}</td>
                        <td>${row.number_of_sales}</td>
                        <td>${row.total_items_sold}</td>
                        <td>₱${row.total_revenue.toFixed(2)}</td>
                    </tr>
                `).join('')}
            </tbody>
        `;
        dailySalesContainer.innerHTML = '';
        dailySalesContainer.appendChild(table);

        // Attach event listener for exporting
        exportCsvBtn.onclick = () => exportReportToCsv(reportData);
    }

    async function fetchTopSellingProducts(startDate, endDate) {
        try {
            const params = new URLSearchParams();
            if (startDate && endDate) {
                params.append('startDate', startDate);
                params.append('endDate', endDate);
            }
            const { data: topProducts } = await fetchWithAuth(`/api/reports/top-selling?${params.toString()}`);
            renderTopSellingProducts(topProducts);
        } catch (error) {
            console.error('Failed to fetch top selling products:', error);
            topSellingContainer.innerHTML = '<p>Error loading report.</p>';
        }
    }

    function renderTopSellingProducts(products) {
        if (!products || products.length === 0) {
            topSellingContainer.innerHTML = '<p>No sales data for this period.</p>';
            return;
        }

        const list = document.createElement('ol');
        list.className = 'top-selling-list';
        products.forEach(product => {
            const item = document.createElement('li');
            item.innerHTML = `
                <span>${product.name}</span>
                <strong>${product.total_sold} sold</strong>
            `;
            list.appendChild(item);
        });
        topSellingContainer.innerHTML = '';
        topSellingContainer.appendChild(list);
    }

    async function fetchCashierPerformance(startDate, endDate) {
        try {
            const params = new URLSearchParams();
            if (startDate && endDate) {
                params.append('startDate', startDate);
                params.append('endDate', endDate);
            }
            const { data: performanceData } = await fetchWithAuth(`/api/reports/cashier-performance?${params.toString()}`);
            renderCashierPerformance(performanceData);
        } catch (error) {
            console.error('Failed to fetch cashier performance:', error);
            cashierPerformanceContainer.innerHTML = '<p>Error loading report.</p>';
        }
    }

    function renderCashierPerformance(data) {
        if (!data || data.length === 0) {
            cashierPerformanceContainer.innerHTML = '<p>No sales data for this period.</p>';
            return;
        }

        const table = document.createElement('table');
        table.className = 'report-table';
        table.innerHTML = `
            <thead>
                <tr>
                    <th>Cashier</th>
                    <th>Sales</th>
                    <th>Revenue</th>
                </tr>
            </thead>
            <tbody>
                ${data.map(row => `
                    <tr><td>${row.username}</td><td>${row.number_of_sales}</td><td>₱${row.total_revenue.toFixed(2)}</td></tr>
                `).join('')}
            </tbody>`;
        cashierPerformanceContainer.innerHTML = '';
        cashierPerformanceContainer.appendChild(table);
    }

    filterReportBtn.addEventListener('click', () => {
        const startDate = startDateInput.value;
        const endDate = endDateInput.value;
        if (startDate && endDate) {
            fetchDailySalesReport(startDate, endDate);
            resetFilterBtn.style.display = 'inline-block';
        } else {
            alert('Please select both a start and end date.');
        }
    });

    resetFilterBtn.addEventListener('click', () => {
        startDateInput.value = '';
        endDateInput.value = '';
        fetchDailySalesReport();
        resetFilterBtn.style.display = 'none';
    });


    function renderSalesReportChart(reportData) {
        const ctx = document.getElementById('sales-chart').getContext('2d');
        
        // Sort data ascending by date for correct chart progression
        const sortedData = [...reportData].reverse();

        const labels = sortedData.map(row => new Date(row.report_date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }));
        const revenues = sortedData.map(row => row.total_revenue);
        const salesCounts = sortedData.map(row => row.number_of_sales);

        if (salesChartInstance) {
            salesChartInstance.destroy();
        }

        salesChartInstance = new Chart(ctx, {
            type: 'bar', // Set base type to bar
            data: {
                labels: labels,
                datasets: [
                    {
                        label: 'Number of Sales',
                        data: salesCounts,
                        backgroundColor: 'rgba(255, 159, 64, 0.5)',
                        borderColor: 'rgba(255, 159, 64, 1)',
                        borderWidth: 1,
                        yAxisID: 'y-sales', // Assign to the right axis
                    },
                    {
                        label: 'Total Revenue',
                        data: revenues,
                        type: 'line', // Override to be a line chart
                        fill: true,
                        backgroundColor: 'rgba(0, 123, 255, 0.2)',
                        borderColor: 'rgba(0, 123, 255, 1)',
                        borderWidth: 2,
                        tension: 0.1,
                        yAxisID: 'y-revenue', // Assign to the left axis
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    mode: 'index',
                    intersect: false,
                },
                scales: {
                    'y-revenue': { // Left Y-axis for Revenue
                        type: 'linear',
                        position: 'left',
                        beginAtZero: true,
                        ticks: { callback: value => `₱${value}` }
                    },
                    'y-sales': { // Right Y-axis for Sales Count
                        type: 'linear',
                        position: 'right',
                        beginAtZero: true,
                        ticks: { stepSize: 1 }, // Ensure whole numbers for sales count
                        grid: {
                            drawOnChartArea: false, // Only draw grid for the left axis
                        },
                    },
                }
            }
        });
    }

    function exportReportToCsv(reportData) {
        const headers = ['Date', 'Sales Count', 'Items Sold', 'Total Revenue'];
        const csvRows = [headers.join(',')];

        for (const row of reportData) {
            const values = [
                new Date(row.report_date).toLocaleDateString(),
                row.number_of_sales,
                row.total_items_sold,
                row.total_revenue.toFixed(2)
            ];
            csvRows.push(values.join(','));
        }

        const csvString = csvRows.join('\n');
        const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', `daily-sales-report-${new Date().toISOString().split('T')[0]}.csv`);
        link.click();
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
                await fetchWithAuth(`/api/products/${id}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name, price, barcode }),
                });
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

        document.getElementById('edit-product-modal').style.display = 'flex';
    }

    // --- Initial Load ---
    async function initializeDashboard() {
        await checkSession(); // Ensure user is authenticated first
        createEditModal(); // Create and append the modal to the DOM
        fetchProductsForManagement();
        fetchDailySalesReport();
        fetchSalesHistory();
    }

    initializeDashboard();
});