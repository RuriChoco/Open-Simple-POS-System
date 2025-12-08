// server.js
const express = require('express');
const db = require('./database.js');
const util = require('util');
const path = require('path');
const bcrypt = require('bcrypt');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const WebSocket = require('ws');

const app = express();
const PORT = 3000;
const saltRounds = 10;

// Create HTTP server to attach WebSocket server to
const server = app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});

// WebSocket server setup
const wss = new WebSocket.Server({ server });

// Promisify db methods for async/await
const dbAsync = {
    get: util.promisify(db.get.bind(db)),
    all: util.promisify(db.all.bind(db)),
    // util.promisify doesn't handle the `this` context for `lastID` or `changes`.
    // We need a custom wrapper for db.run.
    run: (sql, params = []) => {
        return new Promise((resolve, reject) => {
            db.run(sql, params, function (err) {
                if (err) reject(err);
                else resolve(this); // Resolve with the `this` context
            });
        });
    }
};

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
    try {
        const sql = 'INSERT INTO action_logs (user_id, action_type, details) VALUES (?, ?, ?)';
        await dbAsync.run(sql, [userId, actionType, details]);
    } catch (error) {
        console.error('Failed to log admin action:', error);
    }
    broadcast({ type: 'LOGS_UPDATED' });
}

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

// Rate limiter for authentication routes
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10, // Limit each IP to 10 requests per windowMs
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many login attempts from this IP, please try again after 15 minutes' }
});

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

// --- API Endpoints ---

// PRODUCTS API
// GET all products
app.get('/api/products', async (req, res, next) => {
    try {
        const rows = await dbAsync.all("SELECT * FROM products ORDER BY name", []);
        res.json({ "message": "success", "data": rows });
    } catch (err) {
        next(err); // Pass error to the error handler
    }
});

// POST a new product
app.post('/api/products', isAuthenticated, isAdmin, async (req, res, next) => {
    try {
        const { name, price, barcode, quantity } = req.body;
        const sql = 'INSERT INTO products (name, price, barcode, quantity) VALUES (?,?,?,?)';
        // We need the 'this' context from db.run, so we can't use the promisified version directly here without some adjustments.
        db.run(sql, [name, price, barcode, quantity || 0], function (err) {
            if (err) return next(err);
            logAdminAction(req.session.user.id, 'CREATE_PRODUCT', `Created product '${name}' (ID: ${this.lastID})`);
            broadcast({ type: 'PRODUCTS_UPDATED' });
            res.json({ "message": "success", "data": { id: this.lastID, name, price, barcode } });
        });
    } catch (err) {
        next(err);
    }
});

// DELETE a product
app.delete('/api/products/:id', isAuthenticated, isAdmin, async (req, res, next) => {
    try {
        const { id } = req.params;
        const result = await dbAsync.run('DELETE FROM products WHERE id = ?', id);
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

        const sql = `UPDATE products SET name = ?, price = ?, barcode = ?, quantity = ? WHERE id = ?`;
        const result = await dbAsync.run(sql, [name, price, barcode, quantity, id]);

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
            const product = await dbAsync.get('SELECT quantity FROM products WHERE id = ?', [id]);
            if (product && (product.quantity + adjustment < 0)) {
                return res.status(400).json({ error: `Adjustment would result in negative stock. Current stock: ${product.quantity}` });
            }
        }

        const sql = `UPDATE products SET quantity = quantity + ? WHERE id = ?`;
        const result = await dbAsync.run(sql, [adjustment, id]);

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
    const { total_amount, items } = req.body;
    const userId = req.session.user.id;

    // Basic validation
    if (!items || items.length === 0 || !total_amount) {
        return res.status(400).json({ "error": "Invalid sale data." });
    }

    try {
        // Check stock levels before starting transaction
        for (const item of items) {
            const product = await dbAsync.get('SELECT quantity FROM products WHERE id = ?', [item.id]);
            if (!product) {
                return res.status(400).json({ error: `Product with ID ${item.id} not found.` });
            }
            if (product.quantity < item.quantity) {
                return res.status(400).json({ error: `Not enough stock for product ID ${item.id}. Available: ${product.quantity}, Requested: ${item.quantity}` });
            }
        }

        await dbAsync.run('BEGIN TRANSACTION');

        // Can't use promisified run if we need `this.lastID`
        const saleResult = await new Promise((resolve, reject) => {
            db.run('INSERT INTO sales (user_id, total_amount) VALUES (?, ?)', [userId, total_amount], function (err) {
                if (err) reject(err);
                else resolve(this);
            });
        });
        const saleId = saleResult.lastID;

        const itemSql = 'INSERT INTO sale_items (sale_id, product_id, quantity, price_at_sale) VALUES (?, ?, ?, ?)';
        for (const item of items) {
            await dbAsync.run(itemSql, [saleId, item.id, item.quantity, item.price]);
            // Decrement stock
            await dbAsync.run('UPDATE products SET quantity = quantity - ? WHERE id = ?', [item.quantity, item.id]);
        }

        await dbAsync.run('COMMIT');

        broadcast({ type: 'PRODUCTS_UPDATED' }); // Stock levels changed
        broadcast({ type: 'SALES_UPDATED' });
        res.json({ "message": "Sale completed successfully!", "saleId": saleId });

    } catch (err) {
        await dbAsync.run('ROLLBACK');
        next(err);
    }
});

// DELETE a sale (void)
app.delete('/api/sales/:id', isAuthenticated, isAdmin, async (req, res, next) => {
    const { id } = req.params;
    try {
        // Before deleting, get the items for logging purposes
        const itemsToVoid = await dbAsync.all(
            'SELECT si.product_id, si.quantity, p.name FROM sale_items si JOIN products p ON si.product_id = p.id WHERE si.sale_id = ?',
            [id]
        );

        await dbAsync.run('BEGIN TRANSACTION');

        // Restore the stock for each item in the voided sale
        for (const item of itemsToVoid) {
            await dbAsync.run('UPDATE products SET quantity = quantity + ? WHERE id = ?', [item.quantity, item.product_id]);
        }

        // Delete items from the sale first
        await dbAsync.run('DELETE FROM sale_items WHERE sale_id = ?', id);
        // Then delete the sale itself
        const result = await dbAsync.run('DELETE FROM sales WHERE id = ?', id);
        await dbAsync.run('COMMIT');

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
        await dbAsync.run('ROLLBACK');
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

        let whereClause = '';
        const params = [];

        if (search) {
            // Assuming search is by sale ID
            whereClause = 'WHERE s.id = ?';
            params.push(search);
        }

        // Get total number of sales for pagination
        const totalResult = await dbAsync.get(`SELECT COUNT(s.id) as count FROM sales s ${whereClause}`, params);
        const totalSales = totalResult.count;
        const totalPages = Math.ceil(totalSales / limit);

        // Get paginated sales
        const queryParams = [...params, limit, offset];
        const salesRows = await dbAsync.all(`
            SELECT s.id, s.total_amount, s.sale_date, u.username as cashier_name 
            FROM sales s
            LEFT JOIN users u ON s.user_id = u.id
            ${whereClause} 
            ORDER BY s.sale_date DESC, s.id DESC 
            LIMIT ? OFFSET ?`, queryParams);

        if (salesRows.length === 0) {
            // If there are no sales on this page, return an empty array.
            // This is crucial to prevent an empty "IN ()" clause in the next query.
            return res.json({ message: "success", data: [], pagination: { currentPage: page, totalPages, totalSales } });
        }

        // Get items for the paginated sales
        const saleIds = salesRows.map(s => s.id);
        const placeholders = saleIds.map(() => '?').join(',');
        const itemsSql = `SELECT si.sale_id, si.quantity, si.price_at_sale, p.name as product_name FROM sale_items si JOIN products p ON si.product_id = p.id WHERE si.sale_id IN (${placeholders})`;
        const itemsRows = await dbAsync.all(itemsSql, saleIds);

        // Group items with their sales
        const salesMap = new Map(salesRows.map(s => [s.id, { ...s, sale_id: s.id, items: [] }]));
        itemsRows.forEach(item => {
            if (salesMap.has(item.sale_id)) {
                salesMap.get(item.sale_id).items.push(item);
            }
        });

        res.json({ message: "success", data: Array.from(salesMap.values()), pagination: { currentPage: page, totalPages, totalSales } });

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

        const sql = `
            SELECT
                DATE(s.sale_date) as report_date,
                COUNT(DISTINCT s.id) as number_of_sales,
                SUM(s.total_amount) as total_revenue,
                COALESCE(SUM(si.quantity), 0) as total_items_sold
            FROM 
                sales s
            LEFT JOIN sale_items si ON s.id = si.sale_id
            ${whereClause}
            GROUP BY 
                report_date
            ORDER BY report_date DESC
        `;
        const rows = await dbAsync.all(sql, params);
        res.json({ "message": "success", "data": rows });
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

        const sql = `
            SELECT
                p.name,
                SUM(si.quantity) as total_sold
            FROM sale_items si
            JOIN products p ON si.product_id = p.id
            JOIN sales s ON si.sale_id = s.id
            ${whereClause}
            GROUP BY p.id, p.name
            ORDER BY total_sold DESC
            LIMIT 10
        `;
        const rows = await dbAsync.all(sql, params);
        res.json({ "message": "success", "data": rows });
    } catch (err) {
        next(err);
    }
});

// GET low stock products report
app.get('/api/reports/low-stock', isAuthenticated, isAdmin, async (req, res, next) => {
    try {
        const threshold = req.query.threshold || 10;
        const sql = `
            SELECT id, name, quantity FROM products
            WHERE quantity <= ? AND quantity > 0
            ORDER BY quantity ASC
        `;
        const rows = await dbAsync.all(sql, [threshold]);
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

        const sql = `
            SELECT
                u.username,
                COUNT(s.id) as number_of_sales,
                SUM(s.total_amount) as total_revenue
            FROM sales s
            JOIN users u ON s.user_id = u.id
            ${whereClause}
            GROUP BY u.id, u.username
            ORDER BY total_revenue DESC
        `;
        const rows = await dbAsync.all(sql, params);
        res.json({ message: "success", data: rows });
    } catch (err) {
        next(err);
    }
});

// GET a single sale by ID
app.get('/api/sales/:id', isAuthenticated, async (req, res, next) => {
    try {
        const { id } = req.params;
        const sql = `
            SELECT s.id AS sale_id, s.total_amount, s.sale_date, u.username as cashier_name, si.quantity, si.price_at_sale, p.name AS product_name
            FROM sales s
            JOIN sale_items si ON s.id = si.sale_id
            JOIN products p ON si.product_id = p.id
            LEFT JOIN users u ON s.user_id = u.id
            WHERE s.id = ?
        `;
        const rows = await dbAsync.all(sql, [id]);

        if (rows.length === 0) {
            return res.status(404).json({ error: "Sale not found." });
        }

        const saleDetails = {
            sale_id: rows[0].sale_id,
            total_amount: rows[0].total_amount,
            sale_date: rows[0].sale_date,
            cashier_name: rows[0].cashier_name || 'N/A',
            items: rows.map(r => ({ product_name: r.product_name, quantity: r.quantity, price_at_sale: r.price_at_sale }))
        };

        res.json({ message: "success", data: saleDetails });

    } catch (err) {
        next(err);
    }
});

// --- USER & AUTH API ---

// Check if an admin account exists
app.get('/api/users/check-admin', async (req, res, next) => {
    try {
        const row = await dbAsync.get("SELECT id FROM users WHERE role = 'admin' LIMIT 1", []);
        res.json({ adminExists: !!row });
    } catch (err) {
        next(err);
    }
});

// Register the first admin
app.post('/api/users/register-admin', async (req, res, next) => {
    try {
        const row = await dbAsync.get("SELECT id FROM users WHERE role = 'admin' LIMIT 1", []);
        if (row) return res.status(403).json({ error: "An admin account already exists." });

        const { username, password } = req.body;
        if (!username || !password) return res.status(400).json({ error: "Username and password are required." });

        const hashedPassword = await bcrypt.hash(password, saltRounds);
        await dbAsync.run('INSERT INTO users (username, password, role) VALUES (?, ?, ?)', [username, hashedPassword, 'admin']);
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

        const hashedPassword = await bcrypt.hash(password, saltRounds);
        await dbAsync.run('INSERT INTO users (username, password, role) VALUES (?, ?, ?)', [username, hashedPassword, role]);
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
        const user = await dbAsync.get('SELECT * FROM users WHERE username = ?', [username]);
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
        // Exclude passwords from the result
        const users = await dbAsync.all("SELECT id, username, role FROM users ORDER BY username");
        res.json({ message: "success", data: users });
    } catch (err) {
        next(err);
    }
});

// GET admin action logs
app.get('/api/logs/admin-actions', isAuthenticated, isAdmin, async (req, res, next) => {
    try {
        const page = req.query.page ? parseInt(req.query.page, 10) : null;
        const limit = parseInt(req.query.limit) || 25; // Set a limit per page
        const offset = (page - 1) * limit;
        const search = req.query.search || '';

        let whereClause = '';
        const queryParams = [];

        if (search) {
            whereClause = `WHERE LOWER(u.username) LIKE ? OR LOWER(l.action_type) LIKE ? OR LOWER(l.details) LIKE ?`;
            const searchTerm = `%${search.toLowerCase()}%`;
            queryParams.push(searchTerm, searchTerm, searchTerm);
        }

        let sql = `
            SELECT
                l.id, l.action_type, l.details, l.timestamp, u.username
            FROM action_logs l
            JOIN users u ON l.user_id = u.id
            ${whereClause}
            ORDER BY l.timestamp DESC
        `;

        if (page) {
            // Get total count for pagination
            const countSql = `SELECT COUNT(l.id) as count FROM action_logs l JOIN users u ON l.user_id = u.id ${whereClause}`;
            const totalResult = await dbAsync.get(countSql, queryParams);
            const totalLogs = totalResult.count;
            const totalPages = Math.ceil(totalLogs / limit);

            sql += ` LIMIT ? OFFSET ?`;
            const rows = await dbAsync.all(sql, [...queryParams, limit, offset]);
            res.json({ message: "success", data: rows, pagination: { currentPage: page, totalPages } });
        } else {
            // No page specified, return all matching results for export
            const rows = await dbAsync.all(sql, queryParams);
            res.json({ message: "success", data: rows });
        }
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

        const userToUpdate = await dbAsync.get('SELECT role FROM users WHERE id = ?', [userIdToUpdate]);
        if (userToUpdate && userToUpdate.role === 'admin' && newRole === 'cashier') {
            const adminCountResult = await dbAsync.get("SELECT COUNT(*) as count FROM users WHERE role = 'admin'");
            if (adminCountResult.count <= 1) {
                return res.status(403).json({ error: "Cannot demote the last admin account." });
            }
        }

        const result = await dbAsync.run('UPDATE users SET role = ? WHERE id = ?', [newRole, userIdToUpdate]);
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

app.get('/admin-logs', isAuthenticated, isAdmin, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin-logs.html'));
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
