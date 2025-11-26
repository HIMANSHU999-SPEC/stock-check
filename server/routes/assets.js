const express = require('express');
const router = express.Router();
const db = require('../database');
const { generateAssetNumber } = require('../utils/assetNumber');

// Get all assets with optional filtering
router.get('/', (req, res) => {
    try {
        const { status, category, search } = req.query;
        let query = `
      SELECT a.*, c.name as category_name, e.name as employee_name, e.email as employee_email
      FROM assets a
      LEFT JOIN categories c ON a.category_id = c.id
      LEFT JOIN employees e ON a.assigned_to = e.id
      WHERE 1=1
    `;
        const params = [];

        if (status) {
            query += ' AND a.status = ?';
            params.push(status);
        }

        if (category) {
            query += ' AND a.category_id = ?';
            params.push(category);
        }

        if (search) {
            query += ' AND (a.name LIKE ? OR a.asset_number LIKE ? OR a.model LIKE ? OR a.serial_number LIKE ?)';
            const searchParam = `%${search}%`;
            params.push(searchParam, searchParam, searchParam, searchParam);
        }

        query += ' ORDER BY a.created_at DESC';

        const assets = db.prepare(query).all(...params);
        res.json(assets);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get single asset by ID
router.get('/:id', (req, res) => {
    try {
        const asset = db.prepare(`
      SELECT a.*, c.name as category_name, e.name as employee_name, e.email as employee_email, e.department
      FROM assets a
      LEFT JOIN categories c ON a.category_id = c.id
      LEFT JOIN employees e ON a.assigned_to = e.id
      WHERE a.id = ?
    `).get(req.params.id);

        if (!asset) {
            return res.status(404).json({ error: 'Asset not found' });
        }

        // Get asset history
        const history = db.prepare(`
      SELECT ah.*, e.name as employee_name
      FROM asset_history ah
      LEFT JOIN employees e ON ah.employee_id = e.id
      WHERE ah.asset_id = ?
      ORDER BY ah.timestamp DESC
    `).all(req.params.id);

        res.json({ ...asset, history });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Create new asset
router.post('/', (req, res) => {
    try {
        const assetNumber = generateAssetNumber();
        const {
            name,
            category_id,
            model,
            serial_number,
            purchase_date,
            purchase_price,
            intune_price,
            location,
            notes
        } = req.body;

        const result = db.prepare(`
      INSERT INTO assets (
        asset_number, name, category_id, model, serial_number,
        purchase_date, purchase_price, intune_price, location, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
            assetNumber, name, category_id, model, serial_number,
            purchase_date, purchase_price, intune_price, location, notes
        );

        // Add to history
        db.prepare(`
      INSERT INTO asset_history (asset_id, action, notes)
      VALUES (?, 'created', 'Asset registered in system')
    `).run(result.lastInsertRowid);

        const newAsset = db.prepare('SELECT * FROM assets WHERE id = ?').get(result.lastInsertRowid);
        res.status(201).json(newAsset);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Bulk import assets (expects parsed Excel/JSON on client)
router.post('/import', (req, res) => {
    try {
        const { items = [], createMissingCategories = true } = req.body;
        if (!Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ error: 'No items provided for import' });
        }

        const allowedStatuses = ['available', 'assigned', 'maintenance', 'retired'];
        const categoryCache = new Map();

        function resolveCategoryId(categoryName) {
            const name = categoryName?.trim();
            if (!name) return null;
            if (categoryCache.has(name)) return categoryCache.get(name);

            const existing = db.prepare('SELECT id FROM categories WHERE LOWER(name) = LOWER(?)').get(name);
            if (existing) {
                categoryCache.set(name, existing.id);
                return existing.id;
            }

            if (!createMissingCategories) {
                throw new Error(`Category "${name}" does not exist`);
            }

            const result = db.prepare('INSERT INTO categories (name, description) VALUES (?, ?)').run(name, '');
            categoryCache.set(name, result.lastInsertRowid);
            return result.lastInsertRowid;
        }

        const insertStmt = db.prepare(`
      INSERT INTO assets (
        asset_number, name, category_id, model, serial_number,
        purchase_date, purchase_price, intune_price, status, location, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

        const importResult = db.transaction(() => {
            let inserted = 0;
            for (const item of items) {
                const status = allowedStatuses.includes(item.status) ? item.status : 'available';
                const categoryId = resolveCategoryId(item.category);

                insertStmt.run(
                    generateAssetNumber(),
                    item.name || 'Unnamed Asset',
                    categoryId,
                    item.model || null,
                    item.serial_number || null,
                    item.purchase_date || null,
                    item.purchase_price || null,
                    null, // intune_price removed from input
                    status,
                    item.location || null,
                    item.notes || null
                );
                inserted += 1;
            }
            return { inserted };
        })();

        res.json({ message: 'Import completed', ...importResult });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Update asset
router.put('/:id', (req, res) => {
    try {
        const {
            name,
            category_id,
            model,
            serial_number,
            purchase_date,
            purchase_price,
            intune_price,
            status,
            location,
            notes
        } = req.body;

        db.prepare(`
      UPDATE assets SET
        name = ?, category_id = ?, model = ?, serial_number = ?,
        purchase_date = ?, purchase_price = ?, intune_price = ?,
        status = ?, location = ?, notes = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
            name, category_id, model, serial_number,
            purchase_date, purchase_price, intune_price,
            status, location, notes, req.params.id
        );

        // Add to history
        db.prepare(`
      INSERT INTO asset_history (asset_id, action, notes)
      VALUES (?, 'updated', 'Asset information updated')
    `).run(req.params.id);

        const updatedAsset = db.prepare('SELECT * FROM assets WHERE id = ?').get(req.params.id);
        res.json(updatedAsset);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Delete asset
router.delete('/:id', (req, res) => {
    try {
        db.prepare('DELETE FROM asset_history WHERE asset_id = ?').run(req.params.id);
        db.prepare('DELETE FROM assets WHERE id = ?').run(req.params.id);
        res.json({ message: 'Asset deleted successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Assign asset to employee
router.post('/:id/assign', (req, res) => {
    try {
        const { employee_id, notes } = req.body;

        db.prepare(`
      UPDATE assets SET
        assigned_to = ?, status = 'assigned', updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(employee_id, req.params.id);

        db.prepare(`
      INSERT INTO asset_history (asset_id, action, employee_id, notes)
      VALUES (?, 'assigned', ?, ?)
    `).run(req.params.id, employee_id, notes || 'Asset assigned to employee');

        const updatedAsset = db.prepare('SELECT * FROM assets WHERE id = ?').get(req.params.id);
        res.json(updatedAsset);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Return asset from employee
router.post('/:id/return', (req, res) => {
    try {
        const { notes } = req.body;
        const asset = db.prepare('SELECT assigned_to FROM assets WHERE id = ?').get(req.params.id);

        db.prepare(`
      UPDATE assets SET
        assigned_to = NULL, status = 'available', updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(req.params.id);

        db.prepare(`
      INSERT INTO asset_history (asset_id, action, employee_id, notes)
      VALUES (?, 'returned', ?, ?)
    `).run(req.params.id, asset.assigned_to, notes || 'Asset returned');

        const updatedAsset = db.prepare('SELECT * FROM assets WHERE id = ?').get(req.params.id);
        res.json(updatedAsset);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
