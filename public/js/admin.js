// public/js/admin.js
document.addEventListener('DOMContentLoaded', () => {
    const logoutBtn = document.getElementById('logout-btn');
    const welcomeUser = document.getElementById('welcome-user');
    const statusIndicator = document.getElementById('status-indicator');
    const statusText = document.getElementById('status-text');

    // --- Dashboard Summary ---
    const totalRevenueEl = document.getElementById('summary-total-revenue');
    const salesCountEl = document.getElementById('summary-sales-count');
    const totalProductsEl = document.getElementById('summary-total-products');
    const lowStockCountEl = document.getElementById('summary-low-stock-count');

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
            // Refresh data if another user makes a change
            if (message.type === 'PRODUCTS_UPDATED' || message.type === 'SALES_UPDATED' || message.type === 'LOGS_UPDATED') {
                console.log(`${message.type} event received, refreshing dashboard...`);
                // Re-fetch all dashboard data
                fetchDashboardSummary();
                fetchSalesHistory(currentPage, searchSalesInput.value);
                fetchAllReports();
                fetchLowStock();
            }
        };

        ws.onclose = () => {
            console.log('WebSocket disconnected. Attempting to reconnect...');
            statusIndicator.classList.remove('connected');
            statusIndicator.classList.add('disconnected');
            statusText.textContent = 'Offline';
            setTimeout(connectWebSocket, 5000);
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

    async function fetchDashboardSummary() {
        try {
            const response = await fetch('/api/reports/dashboard-summary');
            if (!response.ok) throw new Error('Failed to fetch summary');
            const { data } = await response.json();

            totalRevenueEl.textContent = `₱${formatPrice(data.totalRevenue)}`;
            salesCountEl.textContent = data.salesCount;
            totalProductsEl.textContent = data.totalProducts;
            lowStockCountEl.textContent = data.lowStockCount;

            if (data.lowStockCount > 0) {
                document.getElementById('low-stock-card').classList.add('card-alert');
            }

        } catch (error) {
            console.error('Error fetching dashboard summary:', error);
        }
    }

    // --- Sales History ---
    const salesHistoryList = document.getElementById('sales-history-list');
    const paginationControls = document.getElementById('sales-history-pagination');
    const prevPageBtn = document.getElementById('prev-page');
    const nextPageBtn = document.getElementById('next-page');
    const pageInfo = document.getElementById('page-info');
    const searchSalesInput = document.getElementById('search-sales');

    let currentPage = 1;

    async function fetchSalesHistory(page = 1, search = '') {
        try {
            const response = await fetch(`/api/sales/history?page=${page}&limit=5&search=${search}`);
            if (!response.ok) throw new Error('Failed to fetch sales history');
            const { data, pagination } = await response.json();

            renderSalesHistory(data);
            renderPagination(pagination);
        } catch (error) {
            console.error('Error fetching sales history:', error);
            salesHistoryList.innerHTML = '<p class="no-results">Error loading sales history.</p>';
        }
    }

    function renderSalesHistory(sales) {
        salesHistoryList.innerHTML = '';
        if (sales.length === 0) {
            salesHistoryList.innerHTML = '<p class="no-results">No sales found.</p>';
            return;
        }

        sales.forEach(sale => {
            const saleItem = document.createElement('details');
            saleItem.className = 'sale-history-item';
            saleItem.dataset.saleId = sale.id;

            const summary = document.createElement('summary');
            summary.innerHTML = `
                <div class="summary-main">
                    <span>Sale #${sale.id} - <strong>₱${formatPrice(sale.total_amount)}</strong></span>
                    <small>${new Date(sale.sale_date).toLocaleString()} by ${sale.cashier_name || 'N/A'}</small>
                </div>
                <div class="sale-actions">
                    <button class="reprint-btn action-btn">Reprint</button>
                    <button class="void-btn action-btn">Void</button>
                </div>
            `;

            const itemsList = document.createElement('ul');
            itemsList.className = 'sale-items-list';
            sale.items.forEach(item => {
                const li = document.createElement('li');
                li.textContent = `${item.quantity}x ${item.product_name} @ ₱${formatPrice(item.price_at_sale)}`;
                itemsList.appendChild(li);
            });

            saleItem.append(summary, itemsList);
            salesHistoryList.appendChild(saleItem);
        });
    }

    function renderPagination(pagination) {
        currentPage = pagination.currentPage;
        pageInfo.textContent = `Page ${pagination.currentPage} of ${pagination.totalPages}`;
        prevPageBtn.disabled = pagination.currentPage <= 1;
        nextPageBtn.disabled = pagination.currentPage >= pagination.totalPages;
    }

    prevPageBtn.addEventListener('click', () => fetchSalesHistory(currentPage - 1, searchSalesInput.value));
    nextPageBtn.addEventListener('click', () => fetchSalesHistory(currentPage + 1, searchSalesInput.value));
    searchSalesInput.addEventListener('input', () => fetchSalesHistory(1, searchSalesInput.value));

    // Event delegation for void/reprint
    salesHistoryList.addEventListener('click', async (e) => {
        const target = e.target;
        const saleId = target.closest('.sale-history-item')?.dataset.saleId;

        if (!saleId) return;

        if (target.classList.contains('void-btn')) {
            if (confirm(`Are you sure you want to void Sale #${saleId}? This action cannot be undone.`)) {
                try {
                    const response = await fetch(`/api/sales/${saleId}`, { method: 'DELETE' });
                    if (!response.ok) throw new Error('Failed to void sale');
                    alert('Sale voided successfully.');
                    fetchSalesHistory(currentPage, searchSalesInput.value); // Refresh list
                    fetchDashboardSummary(); // Refresh summary
                } catch (error) {
                    console.error('Error voiding sale:', error);
                    alert('Error voiding sale. Please try again.');
                }
            }
        }

        if (target.classList.contains('reprint-btn')) {
            window.open(`/receipt/${saleId}`, '_blank');
        }
    });

    // --- Reports ---
    const reportsContainer = document.getElementById('reports-container');
    const reportDateFilter = document.getElementById('report-date-filter');
    const startDateInput = document.getElementById('start-date');
    const endDateInput = document.getElementById('end-date');
    const exportCsvBtn = document.getElementById('export-csv-btn');
    const salesChartCanvas = document.getElementById('sales-chart');
    let salesChart; // To hold the chart instance
    let currentDailyReportData = []; // Store current report data for export

    // Set default dates
    const today = new Date().toISOString().split('T')[0];
    startDateInput.value = today;
    endDateInput.value = today;

    function setDateRange(range) {
        const today = new Date();
        let start = new Date();
        let end = new Date();

        switch (range) {
            case 'today':
                // Already set
                break;
            case 'week':
                const dayOfWeek = today.getDay(); // 0=Sunday, 1=Monday...
                start.setDate(today.getDate() - dayOfWeek);
                end.setDate(start.getDate() + 6);
                break;
            case 'month':
                start = new Date(today.getFullYear(), today.getMonth(), 1);
                end = new Date(today.getFullYear(), today.getMonth() + 1, 0);
                break;
        }

        // Format to YYYY-MM-DD
        const toYYYYMMDD = (d) => d.toISOString().split('T')[0];
        startDateInput.value = toYYYYMMDD(start);
        endDateInput.value = toYYYYMMDD(end);

        // Trigger the report fetch
        fetchAllReports();
    }

    document.querySelectorAll('.quick-filter-btn').forEach(button => {
        button.addEventListener('click', (e) => {
            // Remove active class from all buttons
            document.querySelectorAll('.quick-filter-btn').forEach(btn => btn.classList.remove('active'));
            // Add active class to the clicked button
            e.target.classList.add('active');
            
            const range = e.target.dataset.range;
            setDateRange(range);
        });
    });

    async function fetchAllReports() {
        const startDate = startDateInput.value;
        const endDate = endDateInput.value;
        const query = `?startDate=${startDate}&endDate=${endDate}`;

        // Fetch and render all different reports
        fetchAndRenderReport(`/api/sales/daily-report${query}`, 'daily-sales-table', renderDailySalesReport);
        fetchAndRenderReport(`/api/reports/top-selling${query}`, 'top-selling-list', renderTopSellingReport);
        fetchAndRenderReport(`/api/reports/cashier-performance${query}`, 'cashier-performance-table', renderCashierPerformanceReport);
    }

    async function fetchAndRenderReport(url, elementId, renderer) {
        const targetElement = document.getElementById(elementId);
        try {
            const response = await fetch(url);
            if (!response.ok) throw new Error(`Failed to fetch ${url}`);
            const { data } = await response.json();
            renderer(data, targetElement);
        } catch (error) {
            console.error(`Error fetching report for ${elementId}:`, error);
            targetElement.innerHTML = '<li>Error loading report.</li>';
        }
    }

    function renderDailySalesReport(data, element) {
        const tbody = element.querySelector('tbody');
        tbody.innerHTML = '';

        currentDailyReportData = data; // Store data for export
        exportCsvBtn.style.display = data.length > 0 ? 'inline-block' : 'none';

        // Also clear/destroy the chart if no data
        if (data.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" class="no-results">No sales data for this period.</td></tr>';
            if (salesChart) {
                salesChart.destroy();
                salesChart = null;
            }
            return;
        }

        data.slice().reverse().forEach(row => { // Reverse to show oldest date first in table
            const tr = document.createElement('tr');
            const avgSale = row.number_of_sales > 0 ? row.total_revenue / row.number_of_sales : 0;
            tr.innerHTML = `
                <td>${new Date(row.report_date).toLocaleDateString()}</td>
                <td>${row.number_of_sales}</td>
                <td>${row.total_items_sold}</td>
                <td>₱${formatPrice(avgSale)}</td>
                <td><strong>₱${formatPrice(row.total_revenue)}</strong></td>
            `;
            tbody.appendChild(tr);
        });

        renderSalesChart(data);
    }

    function renderSalesChart(data) {
        if (salesChart) {
            salesChart.destroy();
        }

        const chartData = data.slice().reverse(); // Reverse for chronological order on the chart
        const labels = chartData.map(row => new Date(row.report_date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }));
        const revenueData = chartData.map(row => row.total_revenue);

        const ctx = salesChartCanvas.getContext('2d');
        salesChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Total Revenue',
                    data: revenueData,
                    backgroundColor: 'rgba(0, 123, 255, 0.6)',
                    borderColor: 'rgba(0, 123, 255, 1)',
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: {
                            callback: function(value) {
                                return '₱' + formatPrice(value);
                            }
                        }
                    }
                }
            }
        });
    }

    function renderTopSellingReport(data, element) {
        element.innerHTML = '';
        if (data.length === 0) {
            element.innerHTML = '<li>No top selling products for this period.</li>';
            return;
        }
        data.forEach(row => {
            const li = document.createElement('li');
            li.innerHTML = `<span>${row.name}</span> <strong>${row.total_sold} sold</strong>`;
            element.appendChild(li);
        });
    }

    function renderCashierPerformanceReport(data, element) {
        const tbody = element.querySelector('tbody');
        tbody.innerHTML = '';
        if (data.length === 0) {
            tbody.innerHTML = '<tr><td colspan="3" class="no-results">No cashier data for this period.</td></tr>';
            return;
        }
        data.forEach(row => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${row.username}</td>
                <td>${row.number_of_sales}</td>
                <td>₱${formatPrice(row.total_revenue)}</td>
            `;
            tbody.appendChild(tr);
        });
    }

    reportDateFilter.addEventListener('submit', (e) => {
        e.preventDefault();
        fetchAllReports();
    });

    function exportDailyReportToCsv() {
        if (currentDailyReportData.length === 0) {
            alert('No data to export.');
            return;
        }

        const headers = ['Date', 'NumberOfSales', 'ItemsSold', 'AverageSale', 'TotalRevenue'];
        const csvRows = [headers.join(',')];

        for (const row of currentDailyReportData) {
            const avgSale = row.number_of_sales > 0 ? (row.total_revenue / row.number_of_sales).toFixed(2) : '0.00';
            const values = [
                row.report_date,
                row.number_of_sales,
                row.total_items_sold,
                avgSale,
                row.total_revenue
            ];
            csvRows.push(values.join(','));
        }

        const fileName = `daily-sales-report_${startDateInput.value}_to_${endDateInput.value}.csv`;
        window.downloadCsv(csvRows.join('\n'), fileName);
    }

    exportCsvBtn.addEventListener('click', exportDailyReportToCsv);

    // --- Low Stock Report ---
    async function fetchLowStock() {
        const listEl = document.getElementById('low-stock-list');
        try {
            const response = await fetch('/api/reports/low-stock?threshold=10');
            if (!response.ok) throw new Error('Failed to fetch low stock');
            const { data } = await response.json();
            listEl.innerHTML = '';
            if (data.length === 0) {
                listEl.innerHTML = '<li>All products are well-stocked!</li>';
                return;
            }
            data.forEach(product => {
                const li = document.createElement('li');
                li.innerHTML = `<a href="/manage-products#product-${product.id}">${product.name}</a> <span class="stock-level">${product.quantity} left</span>`;
                listEl.appendChild(li);
            });
        } catch (error) {
            console.error('Error fetching low stock:', error);
            listEl.innerHTML = '<li>Error loading stock levels.</li>';
        }
    }

    // Initial data fetch
    checkSession();
    connectWebSocket();
    fetchDashboardSummary();
    fetchSalesHistory();
    fetchAllReports();
    fetchLowStock();

    // Set "Today" as the default active filter
    document.querySelector('.quick-filter-btn[data-range="today"]').classList.add('active');
});