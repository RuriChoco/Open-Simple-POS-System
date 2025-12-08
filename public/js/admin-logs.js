document.addEventListener('DOMContentLoaded', () => {
    // --- Element Cache ---
    const logoutBtn = document.getElementById('logout-btn');
    const welcomeUser = document.getElementById('welcome-user');
    const logContainer = document.getElementById('log-container');
    const logSearchInput = document.getElementById('log-search');
    const exportCsvBtn = document.getElementById('export-csv-btn');

    // --- WebSocket Setup ---
    function connectWebSocket() {
        const ws = new WebSocket(`ws://${window.location.host}`);

        ws.onmessage = (event) => {
            const message = JSON.parse(event.data);
            if (message.type === 'LOGS_UPDATED') {
                console.log('Logs updated, refreshing list...');
                fetchAdminLogs(1, logSearchInput.value);
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

    // --- Log Fetching and Rendering ---
    async function fetchAdminLogs(page = 1, searchTerm = '') {
        try {
            const params = new URLSearchParams({ page });
            if (searchTerm) {
                params.append('search', searchTerm);
            }
            const { data, pagination } = await fetchWithAuth(`/api/logs/admin-actions?${params.toString()}`);
            renderAdminLogs(data, pagination);
        } catch (error) {
            console.error('Failed to fetch admin logs:', error);
            logContainer.innerHTML = '<p>Error loading logs.</p>';
        }
    }

    function renderAdminLogs(logs, pagination) {
        exportCsvBtn.style.display = 'none';
        if (!logs || logs.length === 0) {
            const searchTerm = logSearchInput.value;
            logContainer.innerHTML = searchTerm
                ? `<p class="no-results">No logs found for "${searchTerm}".</p>`
                : '<p>No admin actions have been logged yet.</p>';
            logContainer.parentElement.querySelector('.pagination-controls')?.remove();
            return;
        }
        exportCsvBtn.style.display = 'inline-block';

        const table = document.createElement('table');
        table.className = 'report-table';
        table.innerHTML = `
            <thead>
                <tr>
                    <th>Timestamp</th>
                    <th>Admin</th>
                    <th>Action</th>
                    <th>Details</th>
                </tr>
            </thead>
            <tbody>
                ${logs.map(log => `
                    <tr>
                        <td>${new Date(log.timestamp).toLocaleString()}</td>
                        <td>${log.username}</td>
                        <td><span class="log-action-type">${log.action_type.replace(/_/g, ' ')}</span></td>
                        <td>${log.details}</td>
                    </tr>
                `).join('')}
            </tbody>
        `;
        logContainer.innerHTML = '';
        logContainer.appendChild(table);

        // Render pagination controls
        const logCard = logContainer.parentElement;
        logCard.querySelector('.pagination-controls')?.remove(); // Remove old controls
        if (!pagination || !pagination.totalPages || pagination.totalPages <= 1) return;

        const paginationControls = document.createElement('div');
        paginationControls.className = 'pagination-controls';

        const prevButton = document.createElement('button');
        prevButton.textContent = 'Previous';
        prevButton.disabled = pagination.currentPage === 1;
        prevButton.addEventListener('click', () => fetchAdminLogs(pagination.currentPage - 1, logSearchInput.value));

        const nextButton = document.createElement('button');
        nextButton.textContent = 'Next';
        nextButton.disabled = pagination.currentPage === pagination.totalPages;
        nextButton.addEventListener('click', () => fetchAdminLogs(pagination.currentPage + 1, logSearchInput.value));

        const pageInfo = document.createElement('span');
        pageInfo.textContent = `Page ${pagination.currentPage} of ${pagination.totalPages}`;

        paginationControls.append(prevButton, pageInfo, nextButton);
        logCard.appendChild(paginationControls);
    }

    async function exportLogsToCsv() {
        const searchTerm = logSearchInput.value;
        const params = new URLSearchParams();
        if (searchTerm) {
            params.append('search', searchTerm);
        }

        try {
            const { data: allLogs } = await fetchWithAuth(`/api/logs/admin-actions?${params.toString()}`);

            const headers = ['Timestamp', 'Admin', 'Action', 'Details'];
            const csvRows = [headers.join(',')];

            for (const log of allLogs) {
                const values = [
                    `"${new Date(log.timestamp).toLocaleString()}"`,
                    `"${log.username}"`,
                    `"${log.action_type.replace(/_/g, ' ')}"`,
                    `"${log.details.replace(/"/g, '""')}"` // Escape double quotes
                ];
                csvRows.push(values.join(','));
            }

            downloadCsv(csvRows.join('\n'), 'admin-action-logs.csv');
        } catch (error) {
            alert('Failed to export logs. Please try again.');
            console.error('Export error:', error);
        }
    }

    function downloadCsv(csvString, fileName) {
        const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', fileName);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    // Debounce function to limit how often fetchAdminLogs is called
    function debounce(func, delay) {
        let timeout;
        return function(...args) {
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(this, args), delay);
        };
    }

    const debouncedSearch = debounce((searchTerm) => {
        fetchAdminLogs(1, searchTerm);
    }, 300); // 300ms delay

    // --- EVENT LISTENERS ---
    logoutBtn.addEventListener('click', async () => {
        await fetch('/api/users/logout', { method: 'POST' });
        window.location.href = '/login';
    });

    logSearchInput.addEventListener('input', (e) => {
        debouncedSearch(e.target.value);
    });

    exportCsvBtn.addEventListener('click', exportLogsToCsv);

    // --- Initial Load ---
    checkSession();
    connectWebSocket();
    fetchAdminLogs();
});