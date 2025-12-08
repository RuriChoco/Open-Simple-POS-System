// data-access.js
const util = require('util');
const bcrypt = require('bcrypt');
const db = require('./database.js');

const saltRounds = 10;

// --- Promisified DB Methods ---
const dbAsync = {
    get: util.promisify(db.get.bind(db)),
    all: util.promisify(db.all.bind(db)),
    run: (sql, params = []) => {
        return new Promise((resolve, reject) => {
            db.run(sql, params, function (err) {
                if (err) reject(err);
                else resolve(this);
            });
        });
    }
};

// --- Product Logic ---
const product = {
    getAll: () => {
        return dbAsync.all("SELECT * FROM products ORDER BY name", []);
    },
    create: ({ name, price, barcode, quantity }) => {
        return new Promise((resolve, reject) => {
            const sql = 'INSERT INTO products (name, price, barcode, quantity) VALUES (?,?,?,?)';
            db.run(sql, [name, price, barcode, quantity || 0], function (err) {
                if (err) return reject(err);
                resolve({ id: this.lastID, name, price, barcode });
            });
        });
    },
    deleteById: (id) => {
        return dbAsync.run('DELETE FROM products WHERE id = ?', id);
    },
    updateById: (id, { name, price, barcode, quantity }) => {
        const sql = `UPDATE products SET name = ?, price = ?, barcode = ?, quantity = ? WHERE id = ?`;
        return dbAsync.run(sql, [name, price, barcode, quantity, id]);
    },
    findById: (id) => {
        return dbAsync.get('SELECT * FROM products WHERE id = ?', [id]);
    },
    adjustStock: (id, adjustment) => {
        const sql = `UPDATE products SET quantity = quantity + ? WHERE id = ?`;
        return dbAsync.run(sql, [adjustment, id]);
    },
    getLowStock: (threshold) => {
        const sql = `SELECT id, name, quantity FROM products WHERE quantity <= ? AND quantity > 0 ORDER BY quantity ASC`;
        return dbAsync.all(sql, [threshold]);
    }
};

// --- Sale Logic ---
const sale = {
    create: async (userId, total_amount, items, paymentMethod, customerName) => {
        await dbAsync.run('BEGIN TRANSACTION');
        try {
            const saleResult = await new Promise((resolve, reject) => {
                db.run('INSERT INTO sales (user_id, total_amount, payment_method, customer_name) VALUES (?, ?, ?, ?)', [userId, total_amount, paymentMethod, customerName], function (err) {
                    if (err) reject(err);
                    else resolve(this);
                });
            });
            const saleId = saleResult.lastID;

            const itemSql = 'INSERT INTO sale_items (sale_id, product_id, quantity, price_at_sale) VALUES (?, ?, ?, ?)';
            for (const item of items) {
                await dbAsync.run(itemSql, [saleId, item.id, item.quantity, item.price]);
                await dbAsync.run('UPDATE products SET quantity = quantity - ? WHERE id = ?', [item.quantity, item.id]);
            }

            await dbAsync.run('COMMIT');
            return saleId;
        } catch (err) {
            await dbAsync.run('ROLLBACK');
            throw err;
        }
    },
    voidById: async (id) => {
        await dbAsync.run('BEGIN TRANSACTION');
        try {
            const itemsToVoid = await dbAsync.all(
                'SELECT si.product_id, si.quantity, p.name FROM sale_items si JOIN products p ON si.product_id = p.id WHERE si.sale_id = ?',
                [id]
            );

            for (const item of itemsToVoid) {
                await dbAsync.run('UPDATE products SET quantity = quantity + ? WHERE id = ?', [item.quantity, item.product_id]);
            }

            await dbAsync.run('DELETE FROM sale_items WHERE sale_id = ?', id);
            const result = await dbAsync.run('DELETE FROM sales WHERE id = ?', id);
            await dbAsync.run('COMMIT');

            return { result, itemsToVoid };
        } catch (err) {
            await dbAsync.run('ROLLBACK');
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

        const totalResult = await dbAsync.get(`SELECT COUNT(s.id) as count FROM sales s ${whereClause}`, params);
        const totalSales = totalResult.count;
        const totalPages = Math.ceil(totalSales / limit);

        const queryParams = [...params, limit, offset];
        const salesRows = await dbAsync.all(`
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
        return dbAsync.all(sql, saleIds);
    },
    getById: (id) => {
        const sql = `
            SELECT s.id AS sale_id, s.total_amount, s.sale_date, s.payment_method, s.customer_name, u.username as cashier_name, si.quantity, si.price_at_sale, p.name AS product_name
            FROM sales s
            JOIN sale_items si ON s.id = si.sale_id
            JOIN products p ON si.product_id = p.id
            LEFT JOIN users u ON s.user_id = u.id
            WHERE s.id = ?
        `;
        return dbAsync.all(sql, [id]);
    }
};

// --- User Logic ---
const user = {
    checkAdminExists: () => {
        return dbAsync.get("SELECT id FROM users WHERE role = 'admin' LIMIT 1", []);
    },
    registerAdmin: async ({ username, password }) => {
        const hashedPassword = await bcrypt.hash(password, saltRounds);
        return dbAsync.run('INSERT INTO users (username, password, role) VALUES (?, ?, ?)', [username, hashedPassword, 'admin']);
    },
    create: async ({ username, password, role }) => {
        const hashedPassword = await bcrypt.hash(password, saltRounds);
        return dbAsync.run('INSERT INTO users (username, password, role) VALUES (?, ?, ?)', [username, hashedPassword, role]);
    },
    findByUsername: (username) => {
        return dbAsync.get('SELECT * FROM users WHERE username = ?', [username]);
    },
    findById: (id) => {
        return dbAsync.get('SELECT * FROM users WHERE id = ?', [id]);
    },
    getAll: () => {
        return dbAsync.all("SELECT id, username, role FROM users ORDER BY username");
    },
    updateRole: (id, newRole) => {
        return dbAsync.run('UPDATE users SET role = ? WHERE id = ?', [newRole, id]);
    },
    countAdmins: () => {
        return dbAsync.get("SELECT COUNT(*) as count FROM users WHERE role = 'admin'");
    }
};

// --- Log Logic ---
const log = {
    create: async (userId, actionType, details = '') => {
        try {
            const sql = 'INSERT INTO action_logs (user_id, action_type, details) VALUES (?, ?, ?)';
            await dbAsync.run(sql, [userId, actionType, details]);
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
            const totalResult = await dbAsync.get(countSql, queryParams);
            const totalLogs = totalResult.count;
            const totalPages = Math.ceil(totalLogs / limit);

            sql += ` LIMIT ? OFFSET ?`;
            const rows = await dbAsync.all(sql, [...queryParams, limit, offset]);
            return { data: rows, pagination: { currentPage: page, totalPages } };
        } else {
            const rows = await dbAsync.all(sql, queryParams);
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
        return dbAsync.all(sql, params.queryParams);
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
        const salesToday = await dbAsync.get(salesTodaySql, [today]);
        const totalProducts = await dbAsync.get('SELECT COUNT(id) as count FROM products');
        const lowStockThreshold = 10;
        const lowStock = await dbAsync.get('SELECT COUNT(id) as count FROM products WHERE quantity <= ? AND quantity > 0', [lowStockThreshold]);

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
        return dbAsync.all(sql, params.queryParams);
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
        return dbAsync.all(sql, params.queryParams);
    }
};

module.exports = {
    product,
    sale,
    user,
    log,
    reports
};