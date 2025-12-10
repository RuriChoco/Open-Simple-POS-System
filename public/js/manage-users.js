document.addEventListener('DOMContentLoaded', async () => {
    // Dynamically load password helpers if not present to prevent ReferenceError.
    // This is a robust workaround for incorrect script loading order in the HTML.
    if (typeof setupPasswordFeatures === 'undefined') {
        try {
            await new Promise((resolve, reject) => {
                const script = document.createElement('script');
                script.src = '/js/password-helpers.js';
                script.onload = resolve;
                script.onerror = () => reject(new Error('Script load error for /js/password-helpers.js'));
                document.head.appendChild(script);
            });
        } catch (error) {
            console.error('FATAL: Could not load password-helpers.js. Password-related features will be disabled.', error);
            // Define a dummy function to prevent further crashes, making the app more resilient.
            window.setupPasswordFeatures = () => {
                console.error('Password features are disabled due to a script loading failure.');
            };
        }
    }

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
            userActions.className = 'user-mgmt-actions'; // Use a consistent class name
            userActions.innerHTML = `<select class="role-select" data-id="${user.id}" ${isCurrentUser ? 'disabled title="Cannot change your own role"' : ''}><option value="cashier" ${user.role === 'cashier' ? 'selected' : ''}>Cashier</option><option value="admin" ${user.role === 'admin' ? 'selected' : ''}>Admin</option></select><button class="change-password-btn action-btn" data-id="${user.id}" data-username="${user.username}">Change Password</button><button class="delete-user-btn action-btn btn-danger" data-id="${user.id}" data-username="${user.username}" ${isCurrentUser ? 'disabled title="You cannot delete yourself"' : ''}>Delete</button>`;

            userEl.append(userInfo, userActions);
            userManagementList.appendChild(userEl);
        });
    }

    // Refactored deleteUser to use the global confirmation modal
    async function deleteUser(userId) {
        const userToDelete = userManagementList.querySelector(`.user-mgmt-item .delete-user-btn[data-id="${userId}"]`).closest('.user-mgmt-item');
        const username = userToDelete.querySelector('strong').textContent;

        window.showConfirmationModal({
            title: 'Confirm User Deletion',
            message: `Are you sure you want to permanently delete user <strong>${username}</strong>? This action cannot be undone.`,
            confirmText: 'Delete User',
            onConfirm: async () => {
                try {
                    const response = await fetchWithAuth(`/api/users/${userId}`, { method: 'DELETE' });
                    if (response.message) { // Assuming success message is in 'message' field
                        alert(response.message);
                    } else {
                        alert('User deleted successfully.');
                    }
                    fetchUsersForManagement();
                } catch (error) {
                    alert(`Failed to delete user: ${error.message}`);
                }
            }
        });
    }

    async function createUser(username, password, password_confirmation, role) {
        try {
            await fetchWithAuth('/api/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password, password_confirmation, role }) });
            alert(`User '${username}' created successfully as a ${role}.`);
            fetchUsersForManagement();
        } catch (error) {
            console.error('Create user error:', error);
            alert(`Failed to create user: ${error.message}`);
        }
    }

    // --- Event Delegation for User Actions ---
    let originalRoleValue = null;

    // Store the original role when the select box is focused
    userManagementList.addEventListener('focusin', (e) => {
        if (e.target.classList.contains('role-select')) {
            originalRoleValue = e.target.value;
        }
    });

    // Handle role changes
    userManagementList.addEventListener('change', (e) => {
        const select = e.target;
        if (select.classList.contains('role-select')) {
            const userId = select.dataset.id;
            const newRole = select.value;
            const username = select.closest('.user-mgmt-item').querySelector('strong').textContent;

            window.showConfirmationModal({
                title: 'Confirm Role Change',
                message: `Are you sure you want to change <strong>${username}</strong>'s role to <strong>${newRole}</strong>?`,
                confirmText: 'Change Role',
                onConfirm: async () => {
                    try {
                        await fetchWithAuth(`/api/users/${userId}/role`, {
                            method: 'PUT',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ newRole }),
                        });
                        // The USERS_UPDATED broadcast will trigger a refresh, no need to call fetchUsersForManagement() here.
                    } catch (error) {
                        alert(`Failed to update role: ${error.message}`);
                        select.value = originalRoleValue; // Revert on failure
                    }
                },
                onCancel: () => {
                    select.value = originalRoleValue; // Revert on cancel
                }
            });
        }
    });

    // Handle button clicks (Change Password, Delete)
    userManagementList.addEventListener('click', (e) => {
        const button = e.target.closest('button.action-btn');
        if (!button || button.disabled) return;

        const userId = button.dataset.id;
        if (button.classList.contains('change-password-btn')) {
            openChangePasswordModal(userId, button.dataset.username);
        } else if (button.classList.contains('delete-user-btn')) {
            deleteUser(userId);
        }
    });

    // --- Modals ---
    function createAddUserModal() {
        const modalHTML = `
            <div id="add-user-modal" class="modal-overlay" style="display: none;">
                <div class="modal-content" style="max-width: 450px;">
                    <button class="modal-close-btn">&times;</button>
                    <h2>Add New User</h2>
                    <form id="add-user-form">
                        <div class="form-group">
                            <label for="new-username">Username</label>
                            <input type="text" id="new-username" required>
                        </div>
                        <div class="form-group">
                            <label for="new-user-password">Password</label>
                            <div class="input-with-button">
                                <input type="password" id="new-user-password" required minlength="8">
                                <button type="button" id="toggle-add-user-password-btn" class="btn" aria-label="Show password" style="padding: 0.5rem 1rem;">Show</button>
                            </div>
                            <div id="add-user-password-strength" class="password-strength-indicator" style="display: none;"></div>
                        </div>
                        <div class="form-group">
                            <label for="new-user-password-confirmation">Confirm Password</label>
                            <input type="password" id="new-user-password-confirmation" required>
                        </div>
                        <div class="form-group">
                            <label for="new-user-role">Role</label>
                            <select id="new-user-role" required>
                                <option value="cashier" selected>Cashier</option>
                                <option value="admin">Admin</option>
                            </select>
                        </div>
                        <button type="submit" class="btn btn-block">Create User</button>
                    </form>
                </div>
            </div>`;
        document.body.insertAdjacentHTML('beforeend', modalHTML);

        const modal = document.getElementById('add-user-modal');
        const form = document.getElementById('add-user-form');

        // Setup password features for the "Add User" modal
        setupPasswordFeatures({
            passwordInput: document.getElementById('new-user-password'),
            confirmPasswordInput: document.getElementById('new-user-password-confirmation'),
            strengthIndicator: document.getElementById('add-user-password-strength'),
            toggleButton: document.getElementById('toggle-add-user-password-btn')
        });
        
        modal.querySelector('.modal-close-btn').addEventListener('click', () => modal.style.display = 'none');
        modal.addEventListener('click', (e) => { if (e.target === modal) modal.style.display = 'none'; });

        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const username = document.getElementById('new-username').value;
            const password = document.getElementById('new-user-password').value;
            const password_confirmation = document.getElementById('new-user-password-confirmation').value;
            const role = document.getElementById('new-user-role').value;

            if (password !== password_confirmation) {
                alert("Passwords do not match.");
                return;
            }

            await createUser(username, password, password_confirmation, role);
            modal.style.display = 'none';
        });
    }

    function createChangePasswordModal() {
        const modalHTML = `
            <div id="change-password-modal" class="modal-overlay" style="display: none;">
                <div class="modal-content" style="max-width: 450px;">
                    <button class="modal-close-btn">&times;</button>
                    <h2>Change Password for <span id="change-password-username"></span></h2>
                    <form id="change-password-form">
                        <input type="hidden" id="change-password-userid">
                        <div class="form-group">
                            <label for="new-password">New Password</label>
                            <div class="input-with-button">
                                <input type="password" id="new-password" required minlength="8">
                                <button type="button" id="toggle-change-password-btn" class="btn" aria-label="Show password" style="padding: 0.5rem 1rem;">Show</button>
                            </div>
                            <div id="change-password-strength" class="password-strength-indicator" style="display: none;"></div>
                        </div>
                        <div class="form-group">
                            <label for="new-password-confirmation">Confirm New Password</label>
                            <input type="password" id="new-password-confirmation" required>
                        </div>
                        <button type="submit" class="btn btn-block">Update Password</button>
                    </form>
                </div>
            </div>`;
        document.body.insertAdjacentHTML('beforeend', modalHTML);

        const modal = document.getElementById('change-password-modal');
        const form = document.getElementById('change-password-form');

        // Setup password features for the "Change Password" modal
        setupPasswordFeatures({
            passwordInput: document.getElementById('new-password'),
            confirmPasswordInput: document.getElementById('new-password-confirmation'),
            strengthIndicator: document.getElementById('change-password-strength'),
            toggleButton: document.getElementById('toggle-change-password-btn')
        });
        
        modal.querySelector('.modal-close-btn').addEventListener('click', () => modal.style.display = 'none');
        modal.addEventListener('click', (e) => { if (e.target === modal) modal.style.display = 'none'; });

        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const userId = document.getElementById('change-password-userid').value;
            const newPassword = document.getElementById('new-password').value;
            const newPasswordConfirmation = document.getElementById('new-password-confirmation').value;

            if (newPassword !== newPasswordConfirmation) {
                alert("Passwords do not match.");
                return;
            }

            try {
                await fetchWithAuth(`/api/users/${userId}/password`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ newPassword, newPasswordConfirmation })
                });
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

        // Also reset the strength indicator
        const strengthIndicator = document.getElementById('change-password-strength');
        if (strengthIndicator) {
            strengthIndicator.style.display = 'none';
            strengthIndicator.className = 'password-strength-indicator';
        }

        document.getElementById('change-password-modal').style.display = 'flex';
        document.getElementById('new-password').focus();
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