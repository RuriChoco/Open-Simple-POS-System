// server.js
const express = require('express');
const db = require('./database.js');
const util = require('util');
const path = require('path');
const bcrypt = require('bcrypt');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);

const app = express();
const PORT = 3000;
const saltRounds = 10;

// Promisify db methods for async/await
const dbAsync = {
    get: util.promisify(db.get.bind(db)),
    all: util.promisify(db.all.bind(db)),
    run: util.promisify(db.run.bind(db)),
};
// Middleware
app.use(express.json()); // To parse JSON bodies
app.use(express.urlencoded({ extended: true })); // To parse URL-encoded bodies

app.use(session({
    store: new SQLiteStore({
        db: 'sessions.db',
        dir: './'
    }),
    secret: process.env.SESSION_SECRET || 'a-very-secret-key-that-should-be-in-env-vars', // In production, use an environment variable
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000 } // 24 hours
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
        const { name, price, barcode } = req.body;
        const sql = 'INSERT INTO products (name, price, barcode) VALUES (?,?,?)';
        // We need the 'this' context from db.run, so we can't use the promisified version directly here without some adjustments.
        // Or we can re-query, but for simplicity, let's keep this one as is for now or use a specific promise wrapper.
        db.run(sql, [name, price, barcode], function(err) {
            if (err) return next(err);
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
        res.json({ message: "deleted", changes: result.changes });
    } catch (err) {
        next(err);
    }
});

// UPDATE a product
app.put('/api/products/:id', isAuthenticated, isAdmin, async (req, res, next) => {
    try {
        const { id } = req.params;
        const { name, price, barcode } = req.body;

        if (name === undefined || price === undefined || barcode === undefined) {
            return res.status(400).json({ "error": "Missing required fields: name, price, and barcode." });
        }

        const sql = `UPDATE products SET name = ?, price = ?, barcode = ? WHERE id = ?`;
        const result = await dbAsync.run(sql, [name, price, barcode, id]);

        if (result.changes === 0) {
            return res.status(404).json({ "error": "Product not found." });
        }
        res.json({ message: "Product updated successfully", changes: result.changes });
    } catch (err) {
        next(err);
    }
});

// SALES API
// POST a new sale
app.post('/api/sales', isAuthenticated, async (req, res, next) => {
    const { total_amount, items } = req.body;

    // Basic validation
    if (!items || items.length === 0 || !total_amount) {
        return res.status(400).json({ "error": "Invalid sale data." });
    }

    try {
        await dbAsync.run('BEGIN TRANSACTION');

        // Can't use promisified run if we need `this.lastID`
        const saleResult = await new Promise((resolve, reject) => {
            db.run('INSERT INTO sales (total_amount) VALUES (?)', [total_amount], function(err) {
                if (err) reject(err);
                else resolve(this);
            });
        });
        const saleId = saleResult.lastID;

        const itemSql = 'INSERT INTO sale_items (sale_id, product_id, quantity, price_at_sale) VALUES (?, ?, ?, ?)';
        for (const item of items) {
            await dbAsync.run(itemSql, [saleId, item.id, item.quantity, item.price]);
        }

        await dbAsync.run('COMMIT');

        res.json({ "message": "Sale completed successfully!", "saleId": saleId });

    } catch (err) {
        await dbAsync.run('ROLLBACK');
        next(err);
    }
});

// GET a single sale by ID
app.get('/api/sales/:id', isAuthenticated, async (req, res, next) => {
    try {
        const { id } = req.params;
        const sql = `
            SELECT s.id AS sale_id, s.total_amount, s.sale_date, si.quantity, si.price_at_sale, p.name AS product_name
            FROM sales s
            JOIN sale_items si ON s.id = si.sale_id
            JOIN products p ON si.product_id = p.id
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
            items: rows.map(r => ({ product_name: r.product_name, quantity: r.quantity, price_at_sale: r.price_at_sale }))
        };

        res.json({ message: "success", data: saleDetails });

    } catch (err) {
        next(err);
    }
});

// GET sales history
app.get('/api/sales/history', isAuthenticated, isAdmin, async (req, res, next) => {
    try {
        const sql = `
            SELECT s.id AS sale_id, s.total_amount, s.sale_date, si.quantity, si.price_at_sale, p.name AS product_name
            FROM sales s
            JOIN sale_items si ON s.id = si.sale_id
            JOIN products p ON si.product_id = p.id
            ORDER BY s.sale_date DESC, s.id DESC
        `;
        const rows = await dbAsync.all(sql, []);
        // Group items by sale_id
        const sales = {};
        rows.forEach(row => {
            if (!sales[row.sale_id]) {
                sales[row.sale_id] = {
                    sale_id: row.sale_id,
                    total_amount: row.total_amount,
                    sale_date: row.sale_date,
                    items: []
                };
            }
            sales[row.sale_id].items.push({ product_name: row.product_name, quantity: row.quantity, price_at_sale: row.price_at_sale });
        });

        res.json({ "message": "success", "data": Object.values(sales) });
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

// Create a cashier account (admin only)
app.post('/api/users/create-cashier', isAuthenticated, isAdmin, async (req, res, next) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) return res.status(400).json({ error: "Username and password are required." });

        const hashedPassword = await bcrypt.hash(password, saltRounds);
        await dbAsync.run('INSERT INTO users (username, password, role) VALUES (?, ?, ?)', [username, hashedPassword, 'cashier']);
        res.status(201).json({ message: "Cashier account created successfully." });
    } catch (err) {
        next(err);
    }
});

// Login
app.post('/api/users/login', async (req, res, next) => {
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

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
