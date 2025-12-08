// server.js
const express = require('express');
const db = require('./database.js');
const path = require('path');
const bcrypt = require('bcrypt');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);

const app = express();
const PORT = 3000;
const saltRounds = 10;

// Middleware
app.use(express.json()); // To parse JSON bodies
app.use(express.urlencoded({ extended: true })); // To parse URL-encoded bodies

app.use(session({
    store: new SQLiteStore({
        db: 'sessions.db',
        dir: './'
    }),
    secret: 'a-very-secret-key-that-should-be-in-env-vars', // In production, use an environment variable
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000 } // 24 hours
}));

app.use(express.static(path.join(__dirname, 'public'))); // Serve static files from 'public'

// --- API Endpoints ---

// PRODUCTS API
// GET all products
app.get('/api/products', (req, res) => {
    db.all("SELECT * FROM products ORDER BY name", [], (err, rows) => {
        if (err) {
            res.status(400).json({ "error": err.message });
            return;
        }
        res.json({ "message": "success", "data": rows });
    });
});

// POST a new product
app.post('/api/products', isAuthenticated, isAdmin, (req, res) => {
    const { name, price, barcode } = req.body;
    const sql = 'INSERT INTO products (name, price, barcode) VALUES (?,?,?)';
    db.run(sql, [name, price, barcode], function(err) {
        if (err) {
            res.status(400).json({ "error": err.message });
            return;
        }
        res.json({ "message": "success", "data": { id: this.lastID, name, price, barcode } });
    });
});

// DELETE a product
app.delete('/api/products/:id', isAuthenticated, isAdmin, (req, res) => {
    const { id } = req.params;
    db.run('DELETE FROM products WHERE id = ?', id, function(err) {
        if (err) {
            res.status(400).json({ "error": res.message });
            return;
        }
        res.json({ message: "deleted", changes: this.changes });
    });
});


// SALES API
// POST a new sale
app.post('/api/sales', isAuthenticated, async (req, res) => {
    const { total_amount, items } = req.body;

    // Basic validation
    if (!items || items.length === 0 || !total_amount) {
        return res.status(400).json({ "error": "Invalid sale data." });
    }
    
    // Helper to run database commands with promises
    const run = (sql, params = []) => new Promise((resolve, reject) => {
        db.run(sql, params, function (err) {
            if (err) reject(err);
            else resolve(this);
        });
    });

    try {
        await run('BEGIN TRANSACTION');

        const saleResult = await run('INSERT INTO sales (total_amount) VALUES (?)', [total_amount]);
        const saleId = saleResult.lastID;

        const itemSql = 'INSERT INTO sale_items (sale_id, product_id, quantity, price_at_sale) VALUES (?, ?, ?, ?)';
        for (const item of items) {
            await run(itemSql, [saleId, item.id, item.quantity, item.price]);
        }

        await run('COMMIT');

        res.json({ "message": "Sale completed successfully!", "saleId": saleId });

    } catch (error) {
        await run('ROLLBACK');
        console.error('Transaction failed:', error.message);
        res.status(500).json({ "error": "Failed to complete sale.", "details": error.message });
    }
});

// GET sales history
app.get('/api/sales/history', isAuthenticated, isAdmin, (req, res) => {
    const sql = `
        SELECT
            s.id AS sale_id,
            s.total_amount,
            s.sale_date,
            si.quantity,
            si.price_at_sale,
            p.name AS product_name
        FROM sales s
        JOIN sale_items si ON s.id = si.sale_id
        JOIN products p ON si.product_id = p.id
        ORDER BY s.sale_date DESC, s.id DESC
    `;

    db.all(sql, [], (err, rows) => {
        if (err) {
            res.status(500).json({ "error": err.message });
            return;
        }

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
    });
});

// --- USER & AUTH API ---

// Check if an admin account exists
app.get('/api/users/check-admin', (req, res) => {
    db.get("SELECT id FROM users WHERE role = 'admin' LIMIT 1", [], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ adminExists: !!row });
    });
});

// Register the first admin
app.post('/api/users/register-admin', async (req, res) => {
    db.get("SELECT id FROM users WHERE role = 'admin' LIMIT 1", [], async (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (row) return res.status(403).json({ error: "An admin account already exists." });

        const { username, password } = req.body;
        if (!username || !password) return res.status(400).json({ error: "Username and password are required." });

        const hashedPassword = await bcrypt.hash(password, saltRounds);
        db.run('INSERT INTO users (username, password, role) VALUES (?, ?, ?)', [username, hashedPassword, 'admin'], function(err) {
            if (err) return res.status(400).json({ error: "Username may already be taken." });
            res.status(201).json({ message: "Admin account created successfully." });
        });
    });
});

// Create a cashier account (admin only)
app.post('/api/users/create-cashier', isAuthenticated, isAdmin, async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: "Username and password are required." });

    const hashedPassword = await bcrypt.hash(password, saltRounds);
    db.run('INSERT INTO users (username, password, role) VALUES (?, ?, ?)', [username, hashedPassword, 'cashier'], function(err) {
        if (err) return res.status(400).json({ error: "Username may already be taken." });
        res.status(201).json({ message: "Cashier account created successfully." });
    });
});

// Login
app.post('/api/users/login', (req, res) => {
    const { username, password } = req.body;
    db.get('SELECT * FROM users WHERE username = ?', [username], async (err, user) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!user) return res.status(401).json({ error: "Invalid credentials." });

        const match = await bcrypt.compare(password, user.password);
        if (!match) return res.status(401).json({ error: "Invalid credentials." });

        // Store user in session, but not the password
        req.session.user = {
            id: user.id,
            username: user.username,
            role: user.role
        };
        res.json({ message: "Login successful", user: req.session.user });
    });
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

// --- Page Routing ---

// Main POS page
app.get('/', isAuthenticated, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Admin page
app.get('/admin', isAuthenticated, isAdmin, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
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
