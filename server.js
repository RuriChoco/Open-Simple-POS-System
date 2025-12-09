// server.js
const express = require('express');
const path = require('path');
const bcrypt = require('bcrypt');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const WebSocket = require('ws');
const dbPromise = require('./data-access.js');
const app = express();
const PORT = 3000;
const saltRounds = 10;
// Rate limiter for authentication routes
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10, // Limit each IP to 10 requests per windowMs
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many login attempts from this IP, please try again after 15 minutes' }
});

// --- Security Middleware ---
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            ...helmet.contentSecurityPolicy.getDefaultDirectives(),
            "script-src": ["'self'", "https://cdn.jsdelivr.net"],
            // Allow fonts from Google for potential future use
            "font-src": ["'self'", "https://fonts.gstatic.com"],
        }
    }
})); // Set security-related HTTP headers


// Middleware
app.use(express.json()); // To parse JSON bodies
app.use(express.urlencoded({ extended: true })); // To parse URL-encoded bodies

// Session secret management
let sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret) {
    console.warn('-----------------------------------------------------------------');
    console.warn('WARNING: SESSION_SECRET environment variable is not set.');
    console.warn('Using a default, insecure secret for development purposes only.');
    console.warn('For production, please set a strong, random secret.');
    console.warn('-----------------------------------------------------------------');
    sessionSecret = 'a-default-insecure-secret-for-dev-only';
}

app.use(session({
    store: new SQLiteStore({
        db: 'sessions.db',
        dir: './'
    }),
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: { 
        maxAge: 24 * 60 * 60 * 1000, // 24 hours
        httpOnly: true, // Prevents client-side JS from accessing the cookie
        secure: process.env.NODE_ENV === 'production', // Only send cookie over HTTPS in production
        sameSite: 'strict' // Mitigates CSRF attacks
    }
}));

app.use(express.static(path.join(__dirname, 'public'))); // Serve static files from 'public'

async function main() {
    const db = await dbPromise;
    // Create HTTP server to attach WebSocket server to
    const server = app.listen(PORT, () => {
        console.log(`Server running on http://localhost:${PORT}`);
    });

    // WebSocket server setup
    const wss = new WebSocket.Server({ server });

    wss.on('connection', ws => {
        console.log('Client connected');
        ws.on('close', () => console.log('Client disconnected'));
    });

    function broadcast(data) {
        wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify(data));
            }
        });
    }

    // --- Helper Functions ---
    async function logAdminAction(userId, actionType, details = '') {
        await db.log.create(userId, actionType, details);
        broadcast({ type: 'LOGS_UPDATED' });
    }

    // --- API Endpoints ---

    // PRODUCTS API
    // PRODUCTS API
    // GET all products
app.get('/api/products', async (req, res, next) => {
    try {
        const rows = await db.product.getAll();
        res.json({ "message": "success", "data": rows });
    } catch (err) {
        next(err); // Pass error to the error handler
    }
});

// POST a new product
app.post('/api/products', isAuthenticated, isAdmin, async (req, res, next) => {
    try {
        const { name, price, barcode, quantity } = req.body;
        const newProduct = await db.product.create({ name, price, barcode, quantity });
        logAdminAction(req.session.user.id, 'CREATE_PRODUCT', `Created product '${name}' (ID: ${newProduct.id})`);
        broadcast({ type: 'PRODUCTS_UPDATED' });
        res.json({ "message": "success", "data": newProduct });
    } catch (err) {
        next(err);
    }
});

// DELETE a product
app.delete('/api/products/:id', isAuthenticated, isAdmin, async (req, res, next) => {
    try {
        const { id } = req.params;
        const result = await db.product.deleteById(id);
        if (result.changes === 0) {
            return res.status(404).json({ error: "Product not found." });
        }
        logAdminAction(req.session.user.id, 'DELETE_PRODUCT', `Deleted product ID ${id}`);
        broadcast({ type: 'PRODUCTS_UPDATED' });
        res.json({ message: "deleted", changes: result.changes });
    } catch (err) {
        next(err);
    }
});

// UPDATE a product
app.put('/api/products/:id', isAuthenticated, isAdmin, async (req, res, next) => {
    try {
        const { id } = req.params;
        const { name, price, barcode, quantity } = req.body;

        if (name === undefined || price === undefined || quantity === undefined) {
            return res.status(400).json({ "error": "Missing required fields: name, price, and quantity." });
        }

        const result = await db.product.updateById(id, { name, price, barcode, quantity });

        if (result.changes === 0) {
            return res.status(404).json({ "error": "Product not found." });
        }
        logAdminAction(req.session.user.id, 'UPDATE_PRODUCT', `Updated product ID ${id} (name='${name}', quantity=${quantity})`);
        broadcast({ type: 'PRODUCTS_UPDATED' });
        res.json({ message: "Product updated successfully", changes: result.changes });
    } catch (err) {
        next(err);
    }
});

// ADJUST product stock
app.post('/api/products/:id/adjust-stock', isAuthenticated, isAdmin, async (req, res, next) => {
    try {
        const { id } = req.params;
        const { adjustment } = req.body;

        if (adjustment === undefined || typeof adjustment !== 'number' || adjustment === 0) {
            return res.status(400).json({ "error": "A non-zero numeric 'adjustment' value is required." });
        }

        // Prevent stock from going below zero
        if (adjustment < 0) {
            const product = await db.product.findById(id);
            if (product && (product.quantity + adjustment < 0)) {
                return res.status(400).json({ error: `Adjustment would result in negative stock. Current stock: ${product.quantity}` });
            }
        }

        const result = await db.product.adjustStock(id, adjustment);

        if (result.changes === 0) {
            return res.status(404).json({ "error": "Product not found." });
        }

        logAdminAction(req.session.user.id, 'ADJUST_STOCK', `Adjusted stock for product ID ${id} by ${adjustment > 0 ? '+' : ''}${adjustment}`);
        broadcast({ type: 'PRODUCTS_UPDATED' });
        res.json({ message: "Stock adjusted successfully." });
    } catch (err) {
        next(err);
    }
});

// SALES API
// POST a new sale
app.post('/api/sales', isAuthenticated, async (req, res, next) => {
    const { total_amount, items, payment_method, customer_name, cash_tendered, change_due } = req.body;
    const userId = req.session.user.id;

    // Basic validation
    if (!items || items.length === 0 || !total_amount || !payment_method) {
        return res.status(400).json({ "error": "Invalid sale data." });
    }

    try {
        // Check stock levels before starting transaction
        for (const item of items) {
            const product = await db.product.findById(item.id);
            if (!product) {
                return res.status(400).json({ error: `Product with ID ${item.id} not found.` });
            }
            if (product.quantity < item.quantity) {
                return res.status(400).json({ error: `Not enough stock for product ID ${item.id}. Available: ${product.quantity}, Requested: ${item.quantity}` });
            }
        }

        const saleId = await db.sale.create(userId, total_amount, items, payment_method, customer_name, cash_tendered, change_due);

        broadcast({ type: 'PRODUCTS_UPDATED' }); // Stock levels changed
        broadcast({ type: 'SALES_UPDATED' });
        res.json({ "message": "Sale completed successfully!", "saleId": saleId });

    } catch (err) {
        next(err);
    }
});

// DELETE a sale (void)
app.delete('/api/sales/:id', isAuthenticated, isAdmin, async (req, res, next) => {
    const { id } = req.params;
    try {
        // Before deleting, get the items for logging purposes
        const { result, itemsToVoid } = await db.sale.voidById(id);

        if (result.changes === 0) {
            return res.status(404).json({ error: "Sale not found to void." });
        }

        // Create a detailed log message with the voided items
        const itemDetails = itemsToVoid.map(item => `${item.quantity}x ${item.name}`).join(', ');
        const logDetails = `Voided sale ID ${id}. Items: ${itemDetails || 'None'}`;
        logAdminAction(req.session.user.id, 'VOID_SALE', logDetails);
        broadcast({ type: 'PRODUCTS_UPDATED' }); // Stock levels changed
        broadcast({ type: 'SALES_UPDATED' });

        res.json({ message: "Sale voided successfully." });
    } catch (err) {
        next(err);
    }
});

// GET sales history
app.get('/api/sales/history', isAuthenticated, isAdmin, async (req, res, next) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const offset = (page - 1) * limit;
        const search = req.query.search || '';

        const { salesRows, pagination } = await db.sale.getHistory({ page, limit, search });

        if (salesRows.length === 0) {
            // If there are no sales on this page, return an empty array.
            // This is crucial to prevent an empty "IN ()" clause in the next query.
            return res.json({ message: "success", data: [], pagination });
        }

        // Get items for the paginated sales
        const saleIds = salesRows.map(s => s.id);
        const itemsRows = await db.sale.getItemsForSales(saleIds);

        // Group items with their sales
        const salesMap = new Map(salesRows.map(s => [s.id, { ...s, sale_id: s.id, items: [] }]));
        itemsRows.forEach(item => {
            if (salesMap.has(item.sale_id)) {
                salesMap.get(item.sale_id).items.push(item);
            }
        });

        res.json({ message: "success", data: Array.from(salesMap.values()), pagination });

    } catch (err) {
        next(err);
    }
});

// GET daily sales report
app.get('/api/sales/daily-report', isAuthenticated, isAdmin, async (req, res, next) => {
    try {
        const { startDate, endDate } = req.query;
        let whereClause = '';
        const params = [];

        if (startDate && endDate) {
            whereClause = `WHERE DATE(s.sale_date) BETWEEN ? AND ?`;
            params.push(startDate, endDate);
        }

        const rows = await db.reports.dailySales({ whereClause: whereClause, queryParams: params });

        res.json({ message: "success", data: rows });
    } catch (err) {
        next(err);
    }
});

// GET dashboard summary report
app.get('/api/reports/dashboard-summary', isAuthenticated, isAdmin, async (req, res, next) => {
    try {
        const summaryData = await db.reports.dashboardSummary();
        res.json({ message: "success", data: summaryData });
    } catch (err) {
        next(err);
    }
});

// GET top selling products report
app.get('/api/reports/top-selling', isAuthenticated, isAdmin, async (req, res, next) => {
    try {
        const { startDate, endDate } = req.query;
        let whereClause = '';
        const params = [];

        if (startDate && endDate) {
            whereClause = `WHERE DATE(s.sale_date) BETWEEN ? AND ?`;
            params.push(startDate, endDate);
        }

        const rows = await db.reports.topSelling({ whereClause: whereClause, queryParams: params });
        res.json({ message: "success", data: rows });
    } catch (err) {
        next(err);
    }
});

// GET low stock products report
app.get('/api/reports/low-stock', isAuthenticated, isAdmin, async (req, res, next) => {
    try {
        const threshold = req.query.threshold || 10;
        const rows = await db.product.getLowStock(threshold);
        res.json({ message: "success", data: rows });
    } catch (err) {
        next(err);
    }
});

// GET cashier performance report
app.get('/api/reports/cashier-performance', isAuthenticated, isAdmin, async (req, res, next) => {
    try {
        const { startDate, endDate } = req.query;
        let whereClause = '';
        const params = [];

        if (startDate && endDate) {
            whereClause = `WHERE DATE(s.sale_date) BETWEEN ? AND ?`;
            params.push(startDate, endDate);
        }

        const rows = await db.reports.cashierPerformance({ whereClause: whereClause, queryParams: params });
        res.json({ message: "success", data: rows });
    } catch (err) {
        next(err);
    }
});

// GET a single sale by ID
app.get('/api/sales/:id', isAuthenticated, async (req, res, next) => {
    try {
        const { id } = req.params;
        const rows = await db.sale.getById(id);

        if (rows.length === 0) {
            return res.status(404).json({ error: "Sale not found." });
        }

        const saleDetails = {
            sale_id: rows[0].sale_id,
            total_amount: rows[0].total_amount,
            sale_date: rows[0].sale_date,
            payment_method: rows[0].payment_method,
            cash_tendered: rows[0].cash_tendered,
            change_due: rows[0].change_due,
            customer_name: rows[0].customer_name,
            cashier_name: rows[0].cashier_name || 'N/A',
            items: rows.map(r => ({ product_name: r.product_name, quantity: r.quantity, price_at_sale: r.price_at_sale }))
        };

        res.json({ message: "success", data: saleDetails });

    } catch (err) {
        next(err);
    }
});

// --- SETTINGS API ---
// GET all settings
app.get('/api/settings', isAuthenticated, async (req, res, next) => {
    try {
        const rows = await db.settings.getAll();
        // Convert array of {key, value} to a single object {key1: value1, key2: value2}
        const settings = rows.reduce((acc, row) => {
            acc[row.key] = row.value;
            return acc;
        }, {});
        res.json({ message: "success", data: settings });
    } catch (err) {
        next(err);
    }
});

// UPDATE settings
app.put('/api/settings', isAuthenticated, isAdmin, async (req, res, next) => {
    try {
        const settingsToUpdate = req.body;
        if (Object.keys(settingsToUpdate).length === 0) {
            return res.status(400).json({ error: 'No settings provided to update.' });
        }
        await db.settings.update(settingsToUpdate);
        logAdminAction(req.session.user.id, 'UPDATE_SETTINGS', `Updated system settings.`);
        broadcast({ type: 'SETTINGS_UPDATED' });
        res.json({ message: "Settings updated successfully." });
    } catch (err) {
        next(err);
    }
});

// --- USER & AUTH API ---

// Check if an admin account exists
app.get('/api/users/check-admin', async (req, res, next) => {
    try {
        const row = await db.user.checkAdminExists();
        res.json({ adminExists: !!row });
    } catch (err) {
        next(err);
    }
});

// Register the first admin
app.post('/api/users/register-admin', async (req, res, next) => {
    try {
        const row = await db.user.checkAdminExists();
        if (row) return res.status(403).json({ error: "An admin account already exists." });

        const { username, password } = req.body;
        if (!username || !password) return res.status(400).json({ error: "Username and password are required." });

        await db.user.registerAdmin({ username, password });
        res.status(201).json({ message: "Admin account created successfully." });
    } catch (err) {
        next(err);
    }
});

// Create a new user (admin only)
app.post('/api/users', isAuthenticated, isAdmin, async (req, res, next) => {
    try {
        const { username, password, role } = req.body;
        if (!username || !password || !role) return res.status(400).json({ error: "Username, password, and role are required." });
        if (!['admin', 'cashier'].includes(role)) return res.status(400).json({ error: "Invalid role specified." });
        if (password.length < 8) {
            return res.status(400).json({ error: "Password must be at least 8 characters long." });
        }

        await db.user.create({ username, password, role });
        logAdminAction(req.session.user.id, 'CREATE_USER', `Created user '${username}' with role '${role}'.`);
        broadcast({ type: 'USERS_UPDATED' });
        res.status(201).json({ message: `User '${username}' created successfully as a ${role}.` });
    } catch (err) {
        next(err); // The centralized error handler will catch UNIQUE constraint errors
    }
});

// Login
app.post('/api/users/login', authLimiter, async (req, res, next) => {
    try {
        const { username, password } = req.body;
        const user = await db.user.findByUsername(username);
        if (!user) return res.status(401).json({ error: "Invalid credentials." });

        const match = await bcrypt.compare(password, user.password);
        if (!match) return res.status(401).json({ error: "Invalid credentials." });

        req.session.user = { id: user.id, username: user.username, role: user.role };
        res.json({ message: "Login successful", user: req.session.user });
    } catch (err) {
        next(err);
    }
});

// Logout
app.post('/api/users/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) return res.status(500).json({ error: "Could not log out." });
        res.clearCookie('connect.sid'); // The default session cookie name
        res.json({ message: "Logout successful." });
    });
});

// Get current session
app.get('/api/users/session', (req, res) => {
    if (req.session.user) {
        res.json({ user: req.session.user });
    } else {
        res.status(401).json({ error: "Not authenticated" });
    }
});

// GET all users (for admin management)
app.get('/api/users', isAuthenticated, isAdmin, async (req, res, next) => {
    try {
        const users = await db.user.getAll();
        res.json({ message: "success", data: users });
    } catch (err) {
        next(err);
    }
});

// GET admin action logs
app.get('/api/logs/admin-actions', isAuthenticated, isAdmin, async (req, res, next) => {
    try {
        const page = req.query.page ? parseInt(req.query.page, 10) : null; // null for export
        const limit = parseInt(req.query.limit) || 25; // Set a limit per page
        const search = req.query.search || '';

        const result = await db.log.getAdminActionLogs({ page, limit, search });

        res.json({ message: "success", ...result });

    } catch (err) {
        next(err);
    }
});

// UPDATE a user's role (admin only)
app.put('/api/users/:id/role', isAuthenticated, isAdmin, async (req, res, next) => {
    try {
        const userIdToUpdate = parseInt(req.params.id, 10);
        const currentUserId = req.session.user.id;
        const { newRole } = req.body;

        if (!['admin', 'cashier'].includes(newRole)) {
            return res.status(400).json({ error: "Invalid role specified." });
        }

        if (userIdToUpdate === currentUserId) {
            return res.status(403).json({ error: "You cannot change your own role." });
        }

        const userToUpdate = await db.user.findById(userIdToUpdate);
        if (userToUpdate && userToUpdate.role === 'admin' && newRole === 'cashier') {
            const adminCountResult = await db.user.countAdmins();
            if (adminCountResult && adminCountResult.count <= 1) {
                return res.status(403).json({ error: "Cannot demote the last admin account." });
            }
        }
        const result = await db.user.updateRole(userIdToUpdate, newRole);
        if (result.changes === 0) {
            return res.status(404).json({ error: "User not found." });
        }
        logAdminAction(req.session.user.id, 'UPDATE_USER_ROLE', `Changed role for user ID ${userIdToUpdate} to '${newRole}'.`);
        broadcast({ type: 'USERS_UPDATED' });
        res.json({ message: "User role updated successfully." });
    } catch (err) {
        next(err);
    }
});

// --- Auth Middleware ---
function isAuthenticated(req, res, next) {
    if (req.session.user) {
        next();
    } else {
        // If it's an API request, send 401. Otherwise, redirect.
        if (req.originalUrl.startsWith('/api/')) {
            return res.status(401).json({ error: 'Not authenticated' });
        }
        res.redirect('/login');
    }
}

function isAdmin(req, res, next) {
    if (req.session.user && req.session.user.role === 'admin') {
        next();
    } else {
        if (req.originalUrl.startsWith('/api/')) {
            return res.status(403).json({ error: 'Forbidden: Admins only' });
        }
        res.status(403).send('Forbidden: You do not have permission to view this page.');
    }
}

// --- Central Error Handler ---
// --- Central Error Handler ---
app.use((err, req, res, next) => {
    console.error(err.stack);

    // Handle specific SQLite errors, like UNIQUE constraint
    if (err.code === 'SQLITE_CONSTRAINT') {
        return res.status(409).json({ error: 'Conflict: A record with that value already exists (e.g., username or barcode).' });
    }

    // Default to 500 server error
    res.status(500).json({
        error: 'An internal server error occurred.',
        details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
});

// --- Page Routing ---
// --- Page Routing ---

// Main POS page
app.get('/', isAuthenticated, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Admin page
app.get('/admin', isAuthenticated, isAdmin, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Management Pages
app.get('/manage-products', isAuthenticated, isAdmin, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'manage-products.html'));
});

app.get('/manage-users', isAuthenticated, isAdmin, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'manage-users.html'));
});

app.get('/admin-logs', isAuthenticated, isAdmin, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin-logs.html'));
});

app.get('/customization', isAuthenticated, isAdmin, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'customization.html'));
});

// Receipt page
app.get('/receipt/:id', isAuthenticated, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'receipt.html'));
});

// Login page
app.get('/login', (req, res) => {
    if (req.session.user) {
        // If already logged in, redirect based on role
        return res.redirect(req.session.user.role === 'admin' ? '/admin' : '/');
    }
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Admin registration page
app.get('/admin-register', (req, res) => {
    // This page should only be accessible if no admin exists.
    // The frontend JS will handle the redirect logic, but we can serve the file.
    res.sendFile(path.join(__dirname, 'public', 'admin-register.html'));
});

}

main().catch(err => {
    console.error("Failed to start server:", err);
    process.exit(1);
});
