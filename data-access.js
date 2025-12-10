// data-access.js
const util = require('util');
const bcrypt = require('bcrypt');
const dbPromise = require('./database.js'); // Import the promise that resolves to the initialized db

const saltRounds = 10;

module.exports = (async () => {
    const db = await dbPromise;

    // --- Product Logic ---
    const product = {
    getAll: () => {
        return db.all("SELECT * FROM products ORDER BY name", []);
    },
    create: ({ name, price, barcode, quantity }) => {
        const finalBarcode = barcode === '' ? null : barcode;
        const sql = 'INSERT INTO products (name, price, barcode, quantity) VALUES (?,?,?,?)';
        return db.run(sql, [name, price, finalBarcode, quantity || 0])
            .then(result => ({ id: result.lastID, name, price, barcode: finalBarcode }));
    },
    bulkCreate: async (csvString, userId) => {
        const lines = csvString.trim().split('\n');
        const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
        const productsToImport = [];
        const errors = [];

        // Basic header validation
        const requiredHeaders = ['name', 'price', 'quantity'];
        if (!requiredHeaders.every(h => headers.includes(h))) {
            throw new Error(`CSV must contain all required headers: ${requiredHeaders.join(', ')}`);
        }

        for (let i = 1; i < lines.length; i++) {
            // Skip empty lines
            if (lines[i].trim() === '') continue;

            const values = lines[i].split(',');
            if (values.length !== headers.length) {
                errors.push(`Row ${i + 1}: Mismatched column count.`);
                continue;
            }
            const productData = {};
            headers.forEach((header, index) => {
                productData[header] = values[index].trim();
            });

            const name = productData.name;
            const barcode = productData.barcode || null; // Allow empty barcode

            // Clean and parse the price first
            let cleanedPriceString = (productData.price || '').trim();
            cleanedPriceString = cleanedPriceString.replace(/[^0-9.]/g, ''); // Remove all non-numeric characters except '.'
            const parsedPrice = parseFloat(cleanedPriceString);

            // Clean and parse the quantity
            let cleanedQuantityString = (productData.quantity || '').trim();
            cleanedQuantityString = cleanedQuantityString.replace(/[^0-9]/g, ''); // Remove all non-numeric characters
            const parsedQuantity = parseInt(cleanedQuantityString, 10);

            // Now, validate all parsed data
            if (!name) { errors.push(`Row ${i + 1}: Product name is required.`); continue; }
            if (isNaN(parsedPrice) || parsedPrice <= 0) { errors.push(`Row ${i + 1}: Invalid price.`); continue; }
            if (isNaN(parsedQuantity) || parsedQuantity < 0) { errors.push(`Row ${i + 1}: Invalid quantity.`); continue; }

            productsToImport.push({ name, price: parsedPrice, barcode, quantity: parsedQuantity, originalRow: i + 1 });
        }

        let importedCount = 0;
        const insertionErrors = [];

        for (const product of productsToImport) {
            const finalBarcode = product.barcode === '' ? null : product.barcode;
            const sql = 'INSERT INTO products (name, price, barcode, quantity) VALUES (?,?,?,?)';
            try {
                await db.run(sql, [product.name, product.price, finalBarcode, product.quantity || 0]);
                importedCount++;
            } catch (err) {
                let errorMessage = `Row ${product.originalRow} (${product.name}): ${err.message}`;
                if (err.message.includes('UNIQUE constraint failed')) {
                    errorMessage = `Row ${product.originalRow} (${product.name}): Duplicate product name or barcode already exists.`;
                }
                insertionErrors.push(errorMessage);
            }
        }

        return {
            importedCount: importedCount,
            failedCount: productsToImport.length - importedCount + errors.length, // Products that couldn't be inserted + initial parsing errors
            errors: [...errors, ...insertionErrors]
        };
    },
    deleteById: (id) => {
        return db.run('DELETE FROM products WHERE id = ?', [id]);
    },
    updateById: (id, { name, price, barcode, quantity }) => {
        const sql = `UPDATE products SET name = ?, price = ?, barcode = ?, quantity = ? WHERE id = ?`;
        return db.run(sql, [name, price, barcode, quantity, id]);
    },
    findById: (id) => {
        return db.get('SELECT * FROM products WHERE id = ?', [id]);
    },
    adjustStock: (id, adjustment) => {
        const sql = `UPDATE products SET quantity = quantity + ? WHERE id = ?`;
        return db.run(sql, [adjustment, id]);
    },
    getLowStock: (threshold) => {
        const sql = `SELECT id, name, quantity FROM products WHERE quantity <= ? AND quantity > 0 ORDER BY quantity ASC`;
        return db.all(sql, [threshold]);
    }
};

// --- Sale Logic ---
    const sale = {
    create: async (userId, total_amount, items, paymentMethod, customerName, cashTendered, changeDue, referenceNumber) => {
        await db.run('BEGIN TRANSACTION');
        try {
            const saleResult = await db.run('INSERT INTO sales (user_id, total_amount, payment_method, customer_name, cash_tendered, change_due, reference_number) VALUES (?, ?, ?, ?, ?, ?, ?)', [userId, total_amount, paymentMethod, customerName, cashTendered, changeDue, referenceNumber]);
            const saleId = saleResult.lastID;

            const itemSql = 'INSERT INTO sale_items (sale_id, product_id, quantity, price_at_sale) VALUES (?, ?, ?, ?)';
            for (const item of items) {
                await db.run(itemSql, [saleId, item.id, item.quantity, item.price]);
                await db.run('UPDATE products SET quantity = quantity - ? WHERE id = ?', [item.quantity, item.id]);
            }

            await db.run('COMMIT');
            return saleId;
        } catch (err) {
            await db.run('ROLLBACK');
            throw err;
        }
    },
    voidById: async (id) => {
        await db.run('BEGIN TRANSACTION');
        try {
            const itemsToVoid = await db.all(
                'SELECT si.product_id, si.quantity, p.name FROM sale_items si JOIN products p ON si.product_id = p.id WHERE si.sale_id = ?',
                [id]
            );

            for (const item of itemsToVoid) {
                await db.run('UPDATE products SET quantity = quantity + ? WHERE id = ?', [item.quantity, item.product_id]);
            }

            await db.run('DELETE FROM sale_items WHERE sale_id = ?', [id]);
            const result = await db.run('DELETE FROM sales WHERE id = ?', [id]);
            await db.run('COMMIT');

            return { result, itemsToVoid };
        } catch (err) {
            await db.run('ROLLBACK');
            throw err;
        }
    },
    getHistory: async ({ page = 1, limit = 10, search = '' }) => {
        const offset = (page - 1) * limit;
        let whereClause = '';
        const params = [];

        if (search) {
            whereClause = 'WHERE s.id = ?';
            params.push(search);
        }

        const totalResult = await db.get(`SELECT COUNT(s.id) as count FROM sales s ${whereClause}`, params);
        const totalSales = totalResult.count;
        const totalPages = Math.ceil(totalSales / limit);

        const queryParams = [...params, limit, offset];
        const salesRows = await db.all(`
            SELECT s.id, s.total_amount, s.sale_date, s.payment_method, s.customer_name, u.username as cashier_name 
            FROM sales s
            LEFT JOIN users u ON s.user_id = u.id
            ${whereClause} 
            ORDER BY s.sale_date DESC, s.id DESC 
            LIMIT ? OFFSET ?`, queryParams);

        return { salesRows, pagination: { currentPage: page, totalPages, totalSales } };
    },
    getItemsForSales: (saleIds) => {
        if (!saleIds || saleIds.length === 0) return [];
        const placeholders = saleIds.map(() => '?').join(',');
        const sql = `SELECT si.sale_id, si.quantity, si.price_at_sale, p.name as product_name FROM sale_items si JOIN products p ON si.product_id = p.id WHERE si.sale_id IN (${placeholders})`;
        return db.all(sql, saleIds);
    },
    getById: (id) => {
        const sql = `
            SELECT s.id AS sale_id, s.total_amount, s.sale_date, s.payment_method, s.customer_name, s.cash_tendered, s.change_due, s.reference_number, u.username as cashier_name, si.quantity, si.price_at_sale, p.name AS product_name
            FROM sales s
            JOIN sale_items si ON s.id = si.sale_id
            JOIN products p ON si.product_id = p.id
            LEFT JOIN users u ON s.user_id = u.id
            WHERE s.id = ?
        `;
        return db.all(sql, [id]);
    }
};

// --- User Logic ---
    const user = {
    checkAdminExists: () => {
        return db.get("SELECT id FROM users WHERE role = 'admin' LIMIT 1", []);
    },
    registerAdmin: async ({ username, password }) => {
        const hashedPassword = await bcrypt.hash(password, saltRounds);
        return db.run('INSERT INTO users (username, password, role) VALUES (?, ?, ?)', [username, hashedPassword, 'admin']);
    },
    create: async ({ username, password, role }) => {
        const hashedPassword = await bcrypt.hash(password, saltRounds);
        return db.run('INSERT INTO users (username, password, role) VALUES (?, ?, ?)', [username, hashedPassword, role]);
    },
    findByUsername: (username) => {
        return db.get('SELECT * FROM users WHERE username = ?', [username]);
    },
    findById: (id) => {
        return db.get('SELECT * FROM users WHERE id = ?', [id]);
    },
    getAll: () => {
        return db.all("SELECT id, username, role FROM users ORDER BY username");
    },
    updateRole: (id, newRole) => {
        return db.run('UPDATE users SET role = ? WHERE id = ?', [newRole, id]);
    },
    updatePassword: (id, newHashedPassword) => {
        return db.run('UPDATE users SET password = ? WHERE id = ?', [newHashedPassword, id]);
    },
    countAdmins: () => {
        return db.get("SELECT COUNT(*) as count FROM users WHERE role = 'admin'");
    },
    deleteById: (id) => {
        return db.run('DELETE FROM users WHERE id = ?', [id]);
    }
};

// --- Log Logic ---
    const log = {
    create: async (userId, actionType, details = '') => {
        try {
            const sql = 'INSERT INTO action_logs (user_id, action_type, details) VALUES (?, ?, ?)';
            await db.run(sql, [userId, actionType, details]);
        } catch (error) {
            console.error('Failed to log admin action:', error);
        }
    },
    getAdminActionLogs: async ({ page = null, limit = 25, search = '' }) => {
        const offset = page ? (page - 1) * limit : 0;

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
            const countSql = `SELECT COUNT(l.id) as count FROM action_logs l JOIN users u ON l.user_id = u.id ${whereClause}`;
            const totalResult = await db.get(countSql, queryParams);
            const totalLogs = totalResult.count;
            const totalPages = Math.ceil(totalLogs / limit);

            sql += ` LIMIT ? OFFSET ?`;
            const rows = await db.all(sql, [...queryParams, limit, offset]);
            return { data: rows, pagination: { currentPage: page, totalPages } };
        } else {
            const rows = await db.all(sql, queryParams);
            return { data: rows };
        }
    }
};

// --- Raw DB Access for Reports ---
    const reports = {
    dailySales: (params) => {
        const sql = `
            SELECT
                DATE(s.sale_date) as report_date,
                COUNT(DISTINCT s.id) as number_of_sales,
                SUM(s.total_amount) as total_revenue,
                COALESCE(SUM(si.quantity), 0) as total_items_sold
            FROM sales s
            LEFT JOIN sale_items si ON s.id = si.sale_id
            ${params.whereClause}
            GROUP BY report_date
            ORDER BY report_date DESC
        `;
        return db.all(sql, params.queryParams);
    },
    dashboardSummary: async () => {
        const today = new Date().toISOString().slice(0, 10);
        const salesTodaySql = `
            SELECT 
                COALESCE(SUM(total_amount), 0) as totalRevenue, 
                COUNT(id) as salesCount 
            FROM sales 
            WHERE DATE(sale_date, 'localtime') = ?
        `;
        const salesToday = await db.get(salesTodaySql, [today]);
        const totalProducts = await db.get('SELECT COUNT(id) as count FROM products');
        const lowStockThreshold = 10;
        const lowStock = await db.get('SELECT COUNT(id) as count FROM products WHERE quantity <= ? AND quantity > 0', [lowStockThreshold]);

        return {
            ...salesToday,
            totalProducts: totalProducts.count,
            lowStockCount: lowStock.count
        };
    },
    topSelling: (params) => {
        const sql = `
            SELECT p.name, SUM(si.quantity) as total_sold
            FROM sale_items si
            JOIN products p ON si.product_id = p.id
            JOIN sales s ON si.sale_id = s.id
            ${params.whereClause}
            GROUP BY p.id, p.name
            ORDER BY total_sold DESC
            LIMIT 10
        `;
        return db.all(sql, params.queryParams);
    },
    cashierPerformance: (params) => {
        const sql = `
            SELECT u.username, COUNT(s.id) as number_of_sales, SUM(s.total_amount) as total_revenue
            FROM sales s
            JOIN users u ON s.user_id = u.id
            ${params.whereClause}
            GROUP BY u.id, u.username
            ORDER BY total_revenue DESC
        `;
        return db.all(sql, params.queryParams);
    }
};

// --- Settings Logic ---
    const settings = {
    getAll: () => {
        return db.all("SELECT key, value FROM settings", []);
    },
    update: async (settingsToUpdate) => {
        await db.run('BEGIN TRANSACTION');
        try {
            const sql = 'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)';
            for (const [key, value] of Object.entries(settingsToUpdate)) {
                await db.run(sql, [key, value]);
            }
            await db.run('COMMIT');
        } catch (err) {
            await db.run('ROLLBACK');
            throw err;
        }
    }
};

return {
    product,
    sale,
    user,
    log,
    reports,
    settings
};
})();