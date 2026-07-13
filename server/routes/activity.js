const express = require('express');
const router = express.Router();
const db = require('../database');

// List activity log entries with optional filtering and pagination.
// Query: action, entity_type, page (1-based), page_size
router.get('/', (req, res) => {
    try {
        const { action, entity_type } = req.query;
        const page = Math.max(1, parseInt(req.query.page, 10) || 1);
        const pageSize = Math.min(200, Math.max(1, parseInt(req.query.page_size, 10) || 25));

        let where = ' WHERE 1=1';
        const params = [];
        if (action) {
            where += ' AND action = ?';
            params.push(action);
        }
        if (entity_type) {
            where += ' AND entity_type = ?';
            params.push(entity_type);
        }

        const total = db.prepare(`SELECT COUNT(*) as count FROM activity_log${where}`).get(...params).count;

        const rows = db.prepare(`
      SELECT * FROM activity_log${where}
      ORDER BY timestamp DESC, id DESC
      LIMIT ? OFFSET ?
    `).all(...params, pageSize, (page - 1) * pageSize);

        // Distinct actions for the filter dropdown
        const actions = db.prepare('SELECT DISTINCT action FROM activity_log ORDER BY action').all().map(r => r.action);

        res.json({
            items: rows,
            page,
            page_size: pageSize,
            total,
            total_pages: Math.max(1, Math.ceil(total / pageSize)),
            actions
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
