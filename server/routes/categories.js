const express = require('express');
const router = express.Router();
const db = require('../database');

// Get all categories
router.get('/', (req, res) => {
    try {
        const categories = db.prepare('SELECT * FROM categories ORDER BY name').all();
        res.json(categories);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get single category
router.get('/:id', (req, res) => {
    try {
        const category = db.prepare('SELECT * FROM categories WHERE id = ?').get(req.params.id);

        if (!category) {
            return res.status(404).json({ error: 'Category not found' });
        }

        // Get asset count for this category
        const assetCount = db.prepare('SELECT COUNT(*) as count FROM assets WHERE category_id = ?').get(req.params.id);

        res.json({ ...category, asset_count: assetCount.count });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// A category name as it will be stored, and any other category that
// already has it (ignoring case), so "laptop" cannot sit beside "Laptop".
function categoryName(body = {}) {
    return typeof body.name === 'string' ? body.name.trim().slice(0, 100) : '';
}
function nameTaken(name, exceptId = 0) {
    return Boolean(db.prepare('SELECT 1 FROM categories WHERE LOWER(name) = LOWER(?) AND id != ?').get(name, exceptId));
}

// Create category
router.post('/', (req, res) => {
    try {
        const { description } = req.body || {};
        const name = categoryName(req.body);
        if (!name) return res.status(400).json({ error: 'Give the category a name.' });
        if (nameTaken(name)) return res.status(400).json({ error: 'Category name already exists' });

        const result = db.prepare(`
      INSERT INTO categories (name, description)
      VALUES (?, ?)
    `).run(name, description);

        const newCategory = db.prepare('SELECT * FROM categories WHERE id = ?').get(result.lastInsertRowid);
        res.status(201).json(newCategory);
    } catch (error) {
        if (error.message.includes('UNIQUE constraint failed')) {
            res.status(400).json({ error: 'Category name already exists' });
        } else {
            res.status(500).json({ error: error.message });
        }
    }
});

// Update category
router.put('/:id', (req, res) => {
    try {
        const { description } = req.body || {};
        const name = categoryName(req.body);
        if (!name) return res.status(400).json({ error: 'Give the category a name.' });
        if (nameTaken(name, req.params.id)) return res.status(400).json({ error: 'Category name already exists' });

        db.prepare(`
      UPDATE categories SET name = ?, description = ?
      WHERE id = ?
    `).run(name, description, req.params.id);

        const updatedCategory = db.prepare('SELECT * FROM categories WHERE id = ?').get(req.params.id);
        res.json(updatedCategory);
    } catch (error) {
        if (error.message.includes('UNIQUE constraint failed')) {
            res.status(400).json({ error: 'Category name already exists' });
        } else {
            res.status(500).json({ error: error.message });
        }
    }
});

// Delete category
router.delete('/:id', (req, res) => {
    try {
        // Check if category has assets
        const assetCount = db.prepare('SELECT COUNT(*) as count FROM assets WHERE category_id = ?').get(req.params.id);

        if (assetCount.count > 0) {
            const live = db.prepare('SELECT COUNT(*) as count FROM assets WHERE category_id = ? AND deleted_at IS NULL').get(req.params.id).count;
            const binned = assetCount.count - live;
            const what = [live ? `${live} asset${live === 1 ? '' : 's'}` : '', binned ? `${binned} in the recycle bin` : ''].filter(Boolean).join(' and ');
            return res.status(400).json({ error: `This category still has ${what}. Move ${assetCount.count === 1 ? 'it' : 'them'} to another category first.` });
        }

        // Auto-categorising rules that point at it go with it.
        db.prepare('DELETE FROM category_rules WHERE category_id = ?').run(req.params.id);
        db.prepare('DELETE FROM categories WHERE id = ?').run(req.params.id);
        res.json({ message: 'Category deleted successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
