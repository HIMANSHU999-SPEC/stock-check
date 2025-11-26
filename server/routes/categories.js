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

// Create category
router.post('/', (req, res) => {
    try {
        const { name, description } = req.body;

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
        const { name, description } = req.body;

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
            return res.status(400).json({ error: 'Cannot delete category with assigned assets' });
        }

        db.prepare('DELETE FROM categories WHERE id = ?').run(req.params.id);
        res.json({ message: 'Category deleted successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
