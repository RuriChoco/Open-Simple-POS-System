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
    },
    {
        version: 5,
        script: `
            ALTER TABLE sales ADD COLUMN payment_method TEXT NOT NULL DEFAULT 'cash';
            ALTER TABLE sales ADD COLUMN customer_name TEXT;
        `
    },
    {
        version: 6,
        script: `
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY NOT NULL,
                value TEXT
            );
            INSERT INTO settings (key, value) VALUES 
                ('receipt_header', 'Your Business Name'), 
                ('receipt_footer', 'Thank you for your purchase!'), 
                ('pos_theme', 'light'),
                ('business_address', '123 Main St, Anytown, USA'),
                ('business_phone', '(555) 123-4567'),
                ('business_tin', '000-000-000-000'),
                ('tax_rate', '12');
        `
    },
    {
        version: 7,
        script: `
            ALTER TABLE sales ADD COLUMN cash_tendered REAL;
            ALTER TABLE sales ADD COLUMN change_due REAL;
        `
    }
];
const LATEST_VERSION = migrations.length;

function runMigrations(db, fromVersion, onComplete) {
    db.serialize(() => {
        for (let i = fromVersion; i < migrations.length; i++) {
            const migration = migrations[i];
            console.log(`- Running migration version ${migration.version}...`);
            db.exec(migration.script, (err) => {
                if (err) {
                    console.error(`Error running migration ${migration.version}:`, err.message);
                    process.exit(1);
                }
            });
            db.run(`PRAGMA user_version = ${migration.version}`);
        }
        // Add a final command to the queue. When it executes, all previous ones are done.
        db.run('SELECT 1', (err) => {
            if (err) {
                console.error('Migration finalization failed', err);
                process.exit(1);
            }
            console.log('Database migration complete.');
            onComplete();
        });
    });
}

function cleanupOldLogs(db) {
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

function performSchemaSanityChecks(db, onComplete) {
    db.all('PRAGMA table_info(sales)', (err, columns) => {
        if (err) {
            // This can happen if the db is brand new and 'sales' doesn't exist.
            // The migrations will handle it, so we can safely continue.
            console.log("Sanity check: 'sales' table not found, assuming new database, skipping patch.");
            return onComplete();
        }

        const hasCashTendered = columns.some(c => c.name === 'cash_tendered');
        if (!hasCashTendered) {
            console.warn('SCHEMA SANITY CHECK: `cash_tendered` column is missing from `sales` table. Applying patch...');
            const patchScript = `
                ALTER TABLE sales ADD COLUMN cash_tendered REAL;
                ALTER TABLE sales ADD COLUMN change_due REAL;
            `;
            db.exec(patchScript, (patchErr) => {
                if (patchErr) {
                    console.error('FATAL: Failed to apply schema patch for sales table.', patchErr.message);
                    return process.exit(1);
                }
                console.log('SCHEMA SANITY CHECK: Successfully patched `sales` table.');
                onComplete();
            });
        } else {
            // Schema looks ok for this specific check.
            onComplete();
        }
    });
}

const dbPromise = new Promise((resolve, reject) => {
    const db = new sqlite3.Database('./pos.sqlite', (err) => {
        if (err) {
            console.error('Error opening database', err.message);
            return reject(err);
        }
        console.log('Connected to the SQLite database.');
        
        // Run a sanity check first to fix potential schema drift issues from previous versions.
        performSchemaSanityChecks(db, () => {
            db.get('PRAGMA user_version', (err, row) => {
                if (err) {
                    console.error('Error getting db version', err);
                    return reject(err);
                }
                let currentVersion = row ? row.user_version : 0;
                console.log(`Database version: ${currentVersion}`);
                if (currentVersion < LATEST_VERSION) {
                    console.log(`Migrating database from version ${currentVersion} to ${LATEST_VERSION}...`);
                    runMigrations(db, currentVersion, () => {
                        cleanupOldLogs(db);
                        resolve(db);
                    });
                } else {
                    cleanupOldLogs(db);
                    resolve(db);
                }
            });
        });
    });
});

module.exports = dbPromise;
