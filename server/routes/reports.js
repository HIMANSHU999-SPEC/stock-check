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

// Get summary statistics
router.get('/summary', (req, res) => {
    try {
        const totalAssets = db.prepare('SELECT COUNT(*) as count FROM assets').get();
        const assignedAssets = db.prepare("SELECT COUNT(*) as count FROM assets WHERE status = 'assigned'").get();
        const availableAssets = db.prepare("SELECT COUNT(*) as count FROM assets WHERE status = 'available'").get();
        const maintenanceAssets = db.prepare("SELECT COUNT(*) as count FROM assets WHERE status = 'maintenance'").get();
        const totalValue = db.prepare('SELECT SUM(purchase_price) as total FROM assets').get();
        const totalIntuneValue = db.prepare('SELECT SUM(intune_price) as total FROM assets').get();

        res.json({
            total: totalAssets.count,
            assigned: assignedAssets.count,
            available: availableAssets.count,
            maintenance: maintenanceAssets.count,
            total_value: totalValue.total || 0,
            total_intune_value: totalIntuneValue.total || 0
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get assets by category
router.get('/by-category', (req, res) => {
    try {
        const data = db.prepare(`
      SELECT c.id, c.name, COUNT(a.id) as count, SUM(a.purchase_price) as total_value
      FROM categories c
      LEFT JOIN assets a ON c.id = a.category_id
      GROUP BY c.id, c.name
      ORDER BY count DESC
    `).all();

        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get assets by status
router.get('/by-status', (req, res) => {
    try {
        const data = db.prepare(`
      SELECT status, COUNT(*) as count
      FROM assets
      GROUP BY status
    `).all();

        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get Intune pricing report
router.get('/pricing', (req, res) => {
    try {
        const assets = db.prepare(`
      SELECT a.asset_number, a.name, a.model, c.name as category,
             a.purchase_price, a.intune_price,
             (a.intune_price - a.purchase_price) as price_difference
      FROM assets a
      LEFT JOIN categories c ON a.category_id = c.id
      WHERE a.intune_price IS NOT NULL
      ORDER BY a.intune_price DESC
    `).all();

        const summary = db.prepare(`
      SELECT 
        COUNT(*) as total_devices,
        SUM(purchase_price) as total_purchase,
        SUM(intune_price) as total_intune,
        SUM(intune_price - purchase_price) as total_difference,
        AVG(intune_price) as avg_intune_price
      FROM assets
      WHERE intune_price IS NOT NULL
    `).get();

        res.json({ assets, summary });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
