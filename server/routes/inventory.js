const express = require('express');
const router = express.Router();
const db = require('../database');

// Stock position per campus, broken down by category. Quantities, not row
// counts, so 40 chairs registered as one line count as 40.
router.get('/summary', (req, res) => {
    try {
        const rows = db.prepare(`
      SELECT
        CASE WHEN a.campus IS NULL OR TRIM(a.campus) = '' THEN '' ELSE TRIM(a.campus) END AS campus,
        c.id AS category_id,
        COALESCE(c.name, 'Uncategorised') AS category,
        COUNT(*) AS lines,
        SUM(a.quantity) AS total,
        SUM(COALESCE(a.assigned_quantity, 0)) AS assigned,
        SUM(CASE WHEN a.status IN ('available', 'assigned')
                 THEN MAX(a.quantity - COALESCE(a.assigned_quantity, 0), 0) ELSE 0 END) AS available,
        SUM(CASE WHEN a.status IN ('maintenance', 'repair')
                 THEN a.quantity - COALESCE(a.assigned_quantity, 0) ELSE 0 END) AS in_repair,
        SUM(CASE WHEN a.status IN ('damaged', 'lost', 'stolen', 'retired', 'sold')
                 THEN a.quantity - COALESCE(a.assigned_quantity, 0) ELSE 0 END) AS written_off,
        SUM(COALESCE(a.purchase_price, 0) * a.quantity) AS value
      FROM assets a
      LEFT JOIN categories c ON a.category_id = c.id
      WHERE a.deleted_at IS NULL
      GROUP BY 1, c.id
      ORDER BY 1, category
    `).all();

        const blank = () => ({ lines: 0, total: 0, assigned: 0, available: 0, in_repair: 0, written_off: 0, value: 0 });
        const add = (target, row) => {
            for (const key of Object.keys(blank())) target[key] += row[key] || 0;
        };

        const campuses = new Map();
        const categories = new Map();
        const totals = blank();
        for (const row of rows) {
            if (!campuses.has(row.campus)) campuses.set(row.campus, { campus: row.campus, ...blank(), categories: [] });
            const campus = campuses.get(row.campus);
            campus.categories.push(row);
            add(campus, row);

            if (!categories.has(row.category)) {
                categories.set(row.category, { category_id: row.category_id, category: row.category, ...blank() });
            }
            add(categories.get(row.category), row);
            add(totals, row);
        }

        res.json({
            totals,
            // Named campuses first, then anything not yet given one.
            campuses: [...campuses.values()].sort((a, b) => (a.campus === '') - (b.campus === '') || a.campus.localeCompare(b.campus)),
            categories: [...categories.values()].sort((a, b) => b.total - a.total)
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// How many of each kind of thing there are, and of which makes: the
// dashboard's "laptops -> HP / Dell / Lenovo" drill-down. Quantities, with
// brands grouped whatever their capitalisation.
router.get('/categories', (req, res) => {
    try {
        const rows = db.prepare(`
      SELECT
        c.id AS category_id,
        COALESCE(c.name, 'Uncategorised') AS category,
        COALESCE(NULLIF(TRIM(MIN(a.brand)), ''), '') AS brand,
        COUNT(*) AS lines,
        SUM(a.quantity) AS total,
        SUM(COALESCE(a.assigned_quantity, 0)) AS assigned,
        SUM(CASE WHEN a.status IN ('available', 'assigned')
                 THEN MAX(a.quantity - COALESCE(a.assigned_quantity, 0), 0) ELSE 0 END) AS available
      FROM assets a
      LEFT JOIN categories c ON a.category_id = c.id
      WHERE a.deleted_at IS NULL
      GROUP BY c.id, LOWER(TRIM(COALESCE(a.brand, '')))
    `).all();

        const byCategory = new Map();
        for (const row of rows) {
            const key = row.category_id === null ? 'none' : row.category_id;
            if (!byCategory.has(key)) {
                byCategory.set(key, {
                    category_id: row.category_id, category: row.category,
                    lines: 0, total: 0, assigned: 0, available: 0, brands: []
                });
            }
            const group = byCategory.get(key);
            for (const field of ['lines', 'total', 'assigned', 'available']) group[field] += row[field] || 0;
            group.brands.push({
                brand: row.brand, lines: row.lines, total: row.total, assigned: row.assigned, available: row.available
            });
        }

        const result = [...byCategory.values()];
        // Named makes by size, with "no brand recorded" last.
        result.forEach((group) => group.brands.sort((a, b) => (a.brand === '') - (b.brand === '') || b.total - a.total));
        result.sort((a, b) => b.total - a.total || a.category.localeCompare(b.category));
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Rooms / locations currently holding stock, for one campus or all
router.get('/locations', (req, res) => {
    try {
        const params = [];
        let where = '';
        if (req.query.campus !== undefined) {
            where = "AND LOWER(TRIM(COALESCE(a.campus, ''))) = LOWER(TRIM(?))";
            params.push(req.query.campus);
        }
        const rows = db.prepare(`
      SELECT x.location_label AS location, TRIM(COALESCE(a.campus, '')) AS campus,
             COUNT(DISTINCT a.id) AS lines, SUM(x.quantity) AS quantity
      FROM asset_assignments x JOIN assets a ON x.asset_id = a.id
      WHERE x.returned_at IS NULL AND x.employee_id IS NULL AND a.deleted_at IS NULL ${where}
      GROUP BY LOWER(TRIM(x.location_label)), TRIM(COALESCE(a.campus, ''))
      ORDER BY campus, location
    `).all(...params);
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
