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
        const qty = db.prepare(`
      SELECT
        COALESCE(SUM(quantity), 0) as total_quantity,
        COALESCE(SUM(assigned_quantity), 0) as assigned_quantity,
        COALESCE(SUM(
          CASE
            WHEN status IN ('lost','stolen','damaged','retired') THEN 0
            WHEN (quantity - COALESCE(assigned_quantity, 0)) > 0 THEN (quantity - COALESCE(assigned_quantity, 0))
            ELSE 0
          END
        ), 0) as available_quantity,
        COALESCE(SUM(CASE WHEN status = 'maintenance' THEN quantity ELSE 0 END), 0) as maintenance_quantity
      FROM assets
      WHERE deleted_at IS NULL
    `).get();
        const totalValue = db.prepare('SELECT SUM(purchase_price) as total FROM assets WHERE deleted_at IS NULL').get();
        const totalIntuneValue = db.prepare('SELECT SUM(intune_price) as total FROM assets WHERE deleted_at IS NULL').get();

        res.json({
            total: qty.total_quantity || 0,
            assigned: qty.assigned_quantity || 0,
            available: qty.available_quantity || 0,
            maintenance: qty.maintenance_quantity || 0,
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
      LEFT JOIN assets a ON c.id = a.category_id AND a.deleted_at IS NULL
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
      WHERE deleted_at IS NULL
      GROUP BY status
    `).all();

        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get assets grouped by supplier
router.get('/by-supplier', (req, res) => {
    try {
        const data = db.prepare(`
      SELECT
        CASE WHEN supplier_name IS NULL OR TRIM(supplier_name) = '' THEN 'Unspecified' ELSE supplier_name END AS supplier_name,
        COUNT(*) as asset_count,
        SUM(quantity) as total_quantity,
        SUM(COALESCE(quantity,0) - COALESCE(assigned_quantity,0)) as available_quantity,
        SUM(purchase_price) as total_value
      FROM assets
      WHERE deleted_at IS NULL
      GROUP BY supplier_name
      ORDER BY supplier_name
    `).all();

        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Assets grouped by campus
router.get('/by-campus', (req, res) => {
    try {
        const data = db.prepare(`
      SELECT
        CASE WHEN campus IS NULL OR TRIM(campus) = '' THEN 'Unspecified' ELSE campus END AS campus,
        COUNT(*) as asset_count,
        SUM(quantity) as total_quantity,
        SUM(COALESCE(quantity,0) - COALESCE(assigned_quantity,0)) as available_quantity,
        SUM(purchase_price) as total_value
      FROM assets
      WHERE deleted_at IS NULL
      GROUP BY campus
      ORDER BY campus
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
      WHERE a.intune_price IS NOT NULL AND a.deleted_at IS NULL
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
      WHERE intune_price IS NOT NULL AND deleted_at IS NULL
    `).get();

        res.json({ assets, summary });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
