document.addEventListener('DOMContentLoaded', () => {
    // --- Element Cache ---
    const salesHistoryList = document.getElementById('sales-history-list');
    const salesHistorySearch = document.getElementById('sales-history-search');
    const dailySalesContainer = document.getElementById('daily-sales-report');
    const logoutBtn = document.getElementById('logout-btn');
    const topSellingContainer = document.getElementById('top-selling-report');
    const cashierPerformanceContainer = document.getElementById('cashier-performance-report');
    const lowStockContainer = document.getElementById('low-stock-report');
    const startDateInput = document.getElementById('start-date');
    const endDateInput = document.getElementById('end-date');
    const filterReportBtn = document.getElementById('filter-report-btn');
    const resetFilterBtn = document.getElementById('reset-filter-btn');
    const exportCsvBtn = document.getElementById('export-csv-btn');
    const welcomeUser = document.getElementById('welcome-user');
    let salesChartInstance = null; // To hold the chart instance

    // --- WebSocket Setup ---
    function connectWebSocket() {
        const ws = new WebSocket(`ws://${window.location.host}`);

        ws.onmessage = (event) => {
            const message = JSON.parse(event.data);
            console.log('Admin dashboard received message:', message.type);

            switch (message.type) {
                case 'PRODUCTS_UPDATED':
                    fetchLowStockAlerts();
                    // Top selling might also change
                    fetchDailySalesReport(startDateInput.value, endDateInput.value);
                    break;
                case 'SALES_UPDATED':
                    fetchDailySalesReport(startDateInput.value, endDateInput.value);
                    fetchSalesHistory();
                    break;
            }
        };

        ws.onclose = () => {
            setTimeout(connectWebSocket, 5000);
        };
    }

    // --- FUNCTION DECLARATIONS ---

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
            message.textContent = searchTerm ? `No sale found for ID "${searchTerm}".` : 'No sales have been recorded yet.';
            salesHistoryList.appendChild(message);
            return;
        }

        sales.forEach(sale => {
            const saleDate = new Date(sale.sale_date).toLocaleString();
            const itemsHtml = sale.items.map(item => `<li>${item.quantity}x ${item.product_name}</li>`).join('');
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

        salesHistoryList.querySelectorAll('.sale-actions button').forEach(button => {
            button.addEventListener('click', async (e) => {
                e.stopPropagation();
                const saleId = button.dataset.id;
                if (button.classList.contains('void-btn')) {
                    if (confirm(`Are you sure you want to void Sale #${saleId}? This action cannot be undone.`)) {
                        await fetchWithAuth(`/api/sales/${saleId}`, { method: 'DELETE' });
                        fetchSalesHistory();
                        fetchDailySalesReport();
                    }
                } else if (button.classList.contains('reprint-btn')) {
                    window.open(`/receipt/${saleId}`, '_blank');
                }
            });
        });

        const salesHistoryCard = document.getElementById('sales-history-list').parentElement;
        salesHistoryCard.querySelector('.pagination-controls')?.remove();
        if (!pagination || !pagination.totalPages) return;

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

    // --- Reports ---
    async function fetchDailySalesReport(startDate, endDate) {
        try {
            const params = new URLSearchParams();
            if (startDate && endDate) {
                params.append('startDate', startDate);
                params.append('endDate', endDate);
            }
            const { data: reportData } = await fetchWithAuth(`/api/sales/daily-report?${params.toString()}`);
            renderDailySalesReport(reportData);
            if (reportData && reportData.length > 0) {
                renderSalesReportChart(reportData);
            }
            fetchTopSellingProducts(startDate, endDate);
            fetchCashierPerformance(startDate, endDate);
            fetchLowStockAlerts(); // Refresh low stock alerts too
        } catch (error) {
            console.error('Failed to fetch daily sales report:', error);
            dailySalesContainer.innerHTML = '<p>Error loading daily report.</p>';
        }
    }

    function renderDailySalesReport(reportData) {
        exportCsvBtn.style.display = 'none';
        if (!reportData || reportData.length === 0) {
            dailySalesContainer.innerHTML = '<p>No sales data available for the report.</p>';
            document.querySelector('.chart-container').style.display = 'none';
            return;
        }
        exportCsvBtn.style.display = 'inline-block';
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
        exportCsvBtn.onclick = () => exportReportToCsv(reportData);
    }

    function renderSalesReportChart(reportData) {
        const ctx = document.getElementById('sales-chart').getContext('2d');
        const sortedData = [...reportData].reverse();
        const labels = sortedData.map(row => new Date(row.report_date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }));
        const revenues = sortedData.map(row => row.total_revenue);
        const salesCounts = sortedData.map(row => row.number_of_sales);

        if (salesChartInstance) {
            salesChartInstance.destroy();
        }

        salesChartInstance = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: 'Number of Sales',
                        data: salesCounts,
                        backgroundColor: 'rgba(255, 159, 64, 0.5)',
                        borderColor: 'rgba(255, 159, 64, 1)',
                        borderWidth: 1,
                        yAxisID: 'y-sales',
                    },
                    {
                        label: 'Total Revenue',
                        data: revenues,
                        type: 'line',
                        fill: true,
                        backgroundColor: 'rgba(0, 123, 255, 0.2)',
                        borderColor: 'rgba(0, 123, 255, 1)',
                        borderWidth: 2,
                        tension: 0.1,
                        yAxisID: 'y-revenue',
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                scales: {
                    'y-revenue': {
                        type: 'linear',
                        position: 'left',
                        beginAtZero: true
                    },
                    'y-sales': {
                        type: 'linear',
                        position: 'right',
                        beginAtZero: true,
                        ticks: { stepSize: 1 },
                        grid: { drawOnChartArea: false },
                    },
                }
            }
        });
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
            item.innerHTML = `<span>${product.name}</span><strong>${product.total_sold} sold</strong>`;
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
                <tr><th>Cashier</th><th>Sales</th><th>Revenue</th></tr>
            </thead>
            <tbody>
                ${data.map(row => `<tr><td>${row.username}</td><td>${row.number_of_sales}</td><td>₱${row.total_revenue.toFixed(2)}</td></tr>`).join('')}
            </tbody>`;
        cashierPerformanceContainer.innerHTML = '';
        cashierPerformanceContainer.appendChild(table);
    }

    async function fetchLowStockAlerts() {
        try {
            const { data: lowStockProducts } = await fetchWithAuth('/api/reports/low-stock');
            renderLowStockAlerts(lowStockProducts);
        } catch (error) {
            console.error('Failed to fetch low stock alerts:', error);
            lowStockContainer.innerHTML = '<p>Error loading alerts.</p>';
        }
    }

    function renderLowStockAlerts(products) {
        if (!products || products.length === 0) {
            lowStockContainer.innerHTML = '<p>No products with low stock.</p>';
            return;
        }

        const list = document.createElement('ul');
        list.className = 'low-stock-list';
        products.forEach(product => {
            const item = document.createElement('li');
            item.innerHTML = `
                <a href="/manage-products">${product.name}</a>
                <span class="stock-level">${product.quantity} left</span>
            `;
            list.appendChild(item);
        });
        lowStockContainer.innerHTML = '';
        lowStockContainer.appendChild(list);
    }

    function exportReportToCsv(reportData) {
        const headers = ['Date', 'Sales Count', 'Items Sold', 'Total Revenue'];
        const csvRows = [headers.join(',')];
        for (const row of reportData) {
            const values = [new Date(row.report_date).toLocaleDateString(), row.number_of_sales, row.total_items_sold, row.total_revenue.toFixed(2)];
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

    // --- User Management ---
    async function fetchUsersForManagement() {
        try {
            const { data: users } = await fetchWithAuth('/api/users');
            renderUsersForManagement(users);
        } catch (error) {
            console.error('Failed to fetch users:', error);
            userManagementList.innerHTML = '<p>Error loading users.</p>';
        }
    }

    function renderUsersForManagement(users) {
        userManagementList.innerHTML = '';
        if (!users || users.length === 0) {
            userManagementList.innerHTML = '<p>No users found.</p>';
            return;
        }
        users.forEach(user => {
            const userEl = document.createElement('div');
            userEl.className = 'user-mgmt-item';
            const isCurrentUser = user.username === welcomeUser.textContent;
            userEl.innerHTML = `
                <div>
                    <strong>${user.username}</strong>
                </div>
                <div class="user-mgmt-actions">
                    <select class="role-select" data-id="${user.id}" ${isCurrentUser ? 'disabled title="Cannot change your own role"' : ''}>
                        <option value="cashier" ${user.role === 'cashier' ? 'selected' : ''}>Cashier</option>
                        <option value="admin" ${user.role === 'admin' ? 'selected' : ''}>Admin</option>
                    </select>
                    <button class="change-password-btn" data-id="${user.id}" data-username="${user.username}">Change Password</button>
                    <button class="delete-user-btn" data-id="${user.id}" ${isCurrentUser ? 'disabled title="You cannot delete yourself"' : ''}>Delete</button>
                </div>
            `;
            userManagementList.appendChild(userEl);
        });

        userManagementList.querySelectorAll('.user-mgmt-actions button').forEach(button => {
            button.addEventListener('click', (e) => {
                const userId = e.target.dataset.id;
                if (e.target.classList.contains('change-password-btn')) {
                    const username = e.target.dataset.username;
                    openChangePasswordModal(userId, username);
                } else if (e.target.classList.contains('delete-user-btn')) {
                    deleteUser(userId);
                }
            });
        });

        userManagementList.querySelectorAll('.role-select').forEach(select => {
            select.addEventListener('change', async (e) => {
                const userId = e.target.dataset.id;
                const newRole = e.target.value;
                if (confirm(`Are you sure you want to change this user's role to ${newRole}?`)) {
                    try {
                        await fetchWithAuth(`/api/users/${userId}/role`, {
                            method: 'PUT',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ newRole }),
                        });
                    } catch (error) {
                        alert(`Failed to update role: ${error.message}`);
                        fetchUsersForManagement(); // Re-fetch to revert the dropdown on error
                    }
                } else {
                    // If user cancels, revert the dropdown
                    fetchUsersForManagement();
                }
            });
        });
    }

    async function deleteUser(userId) {
        if (confirm('Are you sure you want to permanently delete this user? This action cannot be undone.')) {
            try {
                await fetchWithAuth(`/api/users/${userId}`, { method: 'DELETE' });
                fetchUsersForManagement();
            } catch (error) {
                alert(`Failed to delete user: ${error.message}`);
            }
        }
    }

    // --- Modals ---
    function createAddUserModal() {
        const modalHTML = `
            <div id="add-user-modal" class="modal-overlay" style="display: none;">
                <div class="modal-content">
                    <button class="modal-close-btn">&times;</button>
                    <h2>Add New User</h2>
                    <form id="add-user-form">
                        <div class="form-group">
                            <label for="new-username">Username</label>
                            <input type="text" id="new-username" required>
                        </div>
                        <div class="form-group">
                            <label for="new-user-password">Password</label>
                            <input type="password" id="new-user-password" required minlength="8">
                        </div>
                        <div class="form-group">
                            <label for="new-user-role">Role</label>
                            <select id="new-user-role" required>
                                <option value="cashier" selected>Cashier</option>
                                <option value="admin">Admin</option>
                            </select>
                        </div>
                        <button type="submit" class="btn-primary">Create User</button>
                    </form>
                </div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', modalHTML);

        const modal = document.getElementById('add-user-modal');
        modal.querySelector('.modal-close-btn').addEventListener('click', () => modal.style.display = 'none');
        modal.addEventListener('click', (e) => { if (e.target === modal) modal.style.display = 'none'; });

        document.getElementById('add-user-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const username = document.getElementById('new-username').value;
            const password = document.getElementById('new-user-password').value;
            const role = document.getElementById('new-user-role').value;
            await createUser(username, password, role);
            modal.style.display = 'none';
        });
    }

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
                        <button type="submit" class="btn-primary">Save Changes</button>
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
            try {
                await fetchWithAuth(`/api/products/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, price, barcode }) });
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

    function createChangePasswordModal() {
        const modalHTML = `
            <div id="change-password-modal" class="modal-overlay" style="display: none;">
                <div class="modal-content">
                    <button class="modal-close-btn">&times;</button>
                    <h2>Change Password for <span id="change-password-username"></span></h2>
                    <form id="change-password-form">
                        <input type="hidden" id="change-password-userid">
                        <div class="form-group"><label for="new-password">New Password</label><input type="password" id="new-password" required minlength="8"></div>
                        <button type="submit" class="btn-primary">Update Password</button>
                    </form>
                </div>
            </div>`;
        document.body.insertAdjacentHTML('beforeend', modalHTML);
        const modal = document.getElementById('change-password-modal');
        modal.querySelector('.modal-close-btn').addEventListener('click', () => modal.style.display = 'none');
        modal.addEventListener('click', (e) => { if (e.target === modal) modal.style.display = 'none'; });
        document.getElementById('change-password-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const userId = document.getElementById('change-password-userid').value;
            const newPassword = document.getElementById('new-password').value;
            try {
                await fetchWithAuth(`/api/users/${userId}/password`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ newPassword }) });
                alert('Password updated successfully.');
                modal.style.display = 'none';
            } catch (error) {
                alert(`Failed to update password: ${error.message}`);
            }
        });
    }

    function openChangePasswordModal(userId, username) {
        document.getElementById('change-password-userid').value = userId;
        document.getElementById('change-password-username').textContent = username;
        document.getElementById('change-password-form').reset();
        document.getElementById('change-password-modal').style.display = 'flex';
    }

    // Debounce function
    function debounce(func, delay) {
        let timeout;
        return function(...args) {
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(this, args), delay);
        };
    }

    // --- EVENT LISTENERS ---
    logoutBtn.addEventListener('click', async () => {
        await fetchWithAuth('/api/users/logout', { method: 'POST' });
        window.location.href = '/login';
    });

    const debouncedSearch = debounce((searchTerm) => fetchSalesHistory(1, searchTerm), 300);
    salesHistorySearch.addEventListener('input', (e) => debouncedSearch(e.target.value));

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

    // --- Initial Load ---
    async function initializeDashboard() {
        await checkSession();
        connectWebSocket();
        fetchDailySalesReport();
        fetchLowStockAlerts();
        fetchSalesHistory();
    }

    initializeDashboard();
});
