// database.js
const sqlite3 = require('sqlite3').verbose();

// --- MIGRATIONS ---
// Add new schema changes to this array.
// The version number should be incremented for each new change.
const migrations = [
    {
        version: 1,
        script: `
            CREATE TABLE IF NOT EXISTS products (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                price REAL NOT NULL,
                barcode TEXT UNIQUE
            );
            CREATE TABLE IF NOT EXISTS sales (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                total_amount REAL NOT NULL,
                sale_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS sale_items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                sale_id INTEGER NOT NULL,
                product_id INTEGER NOT NULL,
                quantity INTEGER NOT NULL,
                price_at_sale REAL NOT NULL,
                FOREIGN KEY (sale_id) REFERENCES sales(id),
                FOREIGN KEY (product_id) REFERENCES products(id)
            );
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL,
                role TEXT NOT NULL CHECK(role IN ('admin', 'cashier'))
            );
        `
    },
    {
        version: 2,
        script: `
            ALTER TABLE sales ADD COLUMN user_id INTEGER REFERENCES users(id);
        `
    },
    {
        version: 3,
        script: `
            CREATE TABLE IF NOT EXISTS action_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                action_type TEXT NOT NULL,
                details TEXT,
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id)
            );
        `
    },
    {
        version: 4,
        script: `
            ALTER TABLE products ADD COLUMN quantity INTEGER NOT NULL DEFAULT 0;
        `
    }
];
const LATEST_VERSION = migrations.length;

const db = new sqlite3.Database('./pos.sqlite', (err) => {
    if (err) {
        console.error('Error opening database', err.message);
    } else {
        console.log('Connected to the SQLite database.');
        // Run migrations
        db.get('PRAGMA user_version', (err, row) => {
            if (err) return console.error('Error getting db version', err);
            
            let currentVersion = row ? row.user_version : 0;
            console.log(`Database version: ${currentVersion}`);
            
            if (currentVersion < LATEST_VERSION) {
                console.log(`Migrating database from version ${currentVersion} to ${LATEST_VERSION}...`);
                runMigrations(currentVersion);
            } else {
                cleanupOldLogs();
            }
        });
    }
});

function runMigrations(fromVersion) {
    db.serialize(() => {
        for (let i = fromVersion; i < migrations.length; i++) {
            const migration = migrations[i];
            console.log(`- Running migration version ${migration.version}...`);
            db.exec(migration.script, (err) => {
                if (err) {
                    console.error(`Error running migration ${migration.version}:`, err.message);
                    // If a migration fails, we should stop.
                    process.exit(1);
                }
            });
            db.run(`PRAGMA user_version = ${migration.version}`);
        }
        console.log('Database migration complete.');
        cleanupOldLogs();
    });
}

function cleanupOldLogs() {
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
    const timestampLimit = ninetyDaysAgo.toISOString();

    const sql = `DELETE FROM action_logs WHERE timestamp < ?`;
    db.run(sql, [timestampLimit], function(err) {
        if (err) {
            console.error('Error cleaning up old action logs:', err.message);
        } else if (this.changes > 0) {
            console.log(`Cleaned up ${this.changes} old action logs.`);
        }
    });
}

module.exports = db;
