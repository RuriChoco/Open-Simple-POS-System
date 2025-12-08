document.addEventListener('DOMContentLoaded', () => {
    // --- Element Cache ---
    const logoutBtn = document.getElementById('logout-btn');
    const welcomeUser = document.getElementById('welcome-user');
    const userManagementList = document.getElementById('user-management-list');
    const addUserBtn = document.getElementById('add-user-btn');
    const statusIndicator = document.getElementById('status-indicator');
    const statusText = document.getElementById('status-text');

    // --- WebSocket Setup ---
    function connectWebSocket() {
        const ws = new WebSocket(`ws://${window.location.host}`);

        ws.onopen = () => {
            console.log('WebSocket connected');
            statusIndicator.classList.remove('disconnected');
            statusIndicator.classList.add('connected');
            statusText.textContent = 'Live';
            fetchUsersForManagement(); // Fetch latest on connect
        };

        ws.onmessage = (event) => {
            const message = JSON.parse(event.data);
            if (message.type === 'USERS_UPDATED') {
                console.log('Users updated, refreshing management list...');
                fetchUsersForManagement();
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

            const userInfo = document.createElement('div');
            const usernameStrong = document.createElement('strong');
            usernameStrong.textContent = user.username;
            userInfo.appendChild(usernameStrong);

            const userActions = document.createElement('div');
            userActions.className = 'user-mgmt-actions';
            userActions.innerHTML = `<select class="role-select" data-id="${user.id}" ${isCurrentUser ? 'disabled title="Cannot change your own role"' : ''}><option value="cashier" ${user.role === 'cashier' ? 'selected' : ''}>Cashier</option><option value="admin" ${user.role === 'admin' ? 'selected' : ''}>Admin</option></select><button class="change-password-btn action-btn" data-id="${user.id}" data-username="${user.username}">Change Password</button><button class="delete-user-btn action-btn" data-id="${user.id}" ${isCurrentUser ? 'disabled title="You cannot delete yourself"' : ''}>Delete</button>`;

            userEl.append(userInfo, userActions);
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
                        fetchUsersForManagement();
                    }
                } else {
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

    async function createUser(username, password, role) {
        try {
            await fetchWithAuth('/api/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password, role }) });
            alert(`User '${username}' created successfully as a ${role}.`);
            fetchUsersForManagement();
        } catch (error) {
            alert(`Failed to create user: ${error.message}`);
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
                        <div class="form-group"><label for="new-username">Username</label><input type="text" id="new-username" required></div>
                        <div class="form-group"><label for="new-user-password">Password</label><input type="password" id="new-user-password" required minlength="8"></div>
                        <div class="form-group"><label for="new-user-role">Role</label><select id="new-user-role" required><option value="cashier" selected>Cashier</option><option value="admin">Admin</option></select></div>
                        <button type="submit" class="btn-primary btn-block">Create User</button>
                    </form>
                </div>
            </div>`;
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

    function createChangePasswordModal() {
        const modalHTML = `
            <div id="change-password-modal" class="modal-overlay" style="display: none;">
                <div class="modal-content">
                    <button class="modal-close-btn">&times;</button>
                    <h2>Change Password for <span id="change-password-username"></span></h2>
                    <form id="change-password-form">
                        <input type="hidden" id="change-password-userid">
                        <div class="form-group"><label for="new-password">New Password</label><input type="password" id="new-password" required minlength="8"></div>
                        <button type="submit" class="btn-primary btn-block">Update Password</button>
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
        const usernameSpan = document.getElementById('change-password-username');
        if(usernameSpan) usernameSpan.textContent = username;
        document.getElementById('change-password-form').reset();
        document.getElementById('change-password-modal').style.display = 'flex';
    }

    // --- EVENT LISTENERS ---
    logoutBtn.addEventListener('click', async () => {
        await fetch('/api/users/logout', { method: 'POST' });
        window.location.href = '/login';
    });

    addUserBtn.addEventListener('click', () => {
        const modal = document.getElementById('add-user-modal');
        modal.querySelector('form').reset();
        modal.style.display = 'flex';
    });

    // --- Initial Load ---
    checkSession();
    connectWebSocket();
    createAddUserModal();
    createChangePasswordModal();
    fetchUsersForManagement();
});