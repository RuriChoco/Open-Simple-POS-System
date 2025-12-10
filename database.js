// database.js
const sqlite3 = require('sqlite3').verbose();
const util = require('util');

const DB_FILE = 'pos.db';

// This promise will resolve with the initialized database object
const dbPromise = new Promise((resolve, reject) => {
    const db = new sqlite3.Database(DB_FILE, async (err) => {
        if (err) {
            console.error('Error opening database:', err.message);
            return reject(err);
        }
        console.log(`Connected to the SQLite database: ${DB_FILE}`);

        // Promisify db.get and db.all
        db.get = util.promisify(db.get);
        db.all = util.promisify(db.all);

        // Manually promisify db.run to preserve `this` context for lastID and changes
        const originalRun = db.run;
        db.run = (sql, params = []) => {
            return new Promise((resolve, reject) => {
                originalRun.call(db, sql, params, function (err) {
                    if (err) reject(err);
                    else resolve(this);
                });
            });
        };

        try {
            await runMigrations(db); // Pass the db object to the migration function
            resolve(db); // Resolve the promise with the initialized db object
        } catch (migrationErr) {
            console.error('Database migration failed:', migrationErr.message);
            reject(migrationErr);
        }
    });
});

async function runMigrations(db) {
    console.log('Running database migrations...');

    // --- Migration 1: Initial Schema Creation (CREATE TABLE IF NOT EXISTS) ---
    // This ensures all tables exist before any ALTER TABLE statements are attempted.
    await db.run(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'cashier' -- 'admin' or 'cashier'
        );
    `);
    await db.run(`
        CREATE TABLE IF NOT EXISTS products (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE NOT NULL,
            price REAL NOT NULL,
            barcode TEXT UNIQUE, -- Barcode can be null, but if present, must be unique
            quantity INTEGER NOT NULL DEFAULT 0
        );
    `);
    await db.run(`
        CREATE TABLE IF NOT EXISTS sales (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            total_amount REAL NOT NULL,
            sale_date DATETIME DEFAULT CURRENT_TIMESTAMP,
            payment_method TEXT,
            customer_name TEXT,
            cash_tendered REAL,
            change_due REAL,
            reference_number TEXT,
            FOREIGN KEY (user_id) REFERENCES users(id)
        );
    `);
    await db.run(`
        CREATE TABLE IF NOT EXISTS sale_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sale_id INTEGER NOT NULL,
            product_id INTEGER NOT NULL,
            quantity INTEGER NOT NULL,
            price_at_sale REAL NOT NULL,
            FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE,
            FOREIGN KEY (product_id) REFERENCES products(id)
        );
    `);
    await db.run(`
        CREATE TABLE IF NOT EXISTS action_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            action_type TEXT NOT NULL,
            details TEXT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
        );
    `);
    await db.run(`
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT
        );
    `);

    // --- Migration 2: Add missing columns to sales table (if an older schema exists) ---
    // This specifically addresses the error you encountered.
    const salesColumns = await db.all("PRAGMA table_info(sales);");
    const hasCashTendered = salesColumns.some(col => col.name === 'cash_tendered');
    const hasChangeDue = salesColumns.some(col => col.name === 'change_due');
    const hasReferenceNumber = salesColumns.some(col => col.name === 'reference_number');

    if (!hasCashTendered) {
        console.log('Adding cash_tendered column to sales table...');
        await db.run('ALTER TABLE sales ADD COLUMN cash_tendered REAL;');
    }
    if (!hasChangeDue) {
        console.log('Adding change_due column to sales table...');
        await db.run('ALTER TABLE sales ADD COLUMN change_due REAL;');
    }
    if (!hasReferenceNumber) {
        console.log('Adding reference_number column to sales table...');
        await db.run('ALTER TABLE sales ADD COLUMN reference_number TEXT;');
    }

    console.log('Database migrations complete.');
}

module.exports = dbPromise; // Export the promise