const express = require('express');
const router = express.Router();
const db = require('../database');
const { addHistory } = require('../services/assignments');
const { logActivity } = require('../utils/activity');
const directory = require('../services/directory');

// The IT side of "My assets": the problems staff have raised about their own
// lists, and who has (and has not) confirmed what they hold. For
// administrators and sub-administrators; staff sessions never get this far.

const REASON_LABELS = {
    not_mine: 'Does not have this item',
    wrong_details: 'Details are wrong',
    faulty: 'Faulty or damaged',
    missing: 'Has an item that is not listed',
    other: 'Other'
};

// How many are waiting, for the dashboard notice.
router.get('/count', (req, res) => {
    try {
        const open = db.prepare("SELECT COUNT(*) AS n FROM staff_reports WHERE status = 'open'").get().n;
        res.json({ open });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.get('/', (req, res) => {
    try {
        const reports = db.prepare(`
          SELECT r.*, a.asset_number, a.name AS asset_name, a.serial_number
          FROM staff_reports r LEFT JOIN assets a ON r.asset_id = a.id
          ORDER BY (r.status = 'open') DESC, r.created_at DESC, r.id DESC
          LIMIT 500
        `).all().map((row) => ({ ...row, reason_label: REASON_LABELS[row.reason] || row.reason }));

        // Per person: how much they hold and how much of it they have confirmed.
        const confirmations = db.prepare(`
          SELECT e.id AS employee_id, e.name, e.email, e.department,
                 COUNT(*) AS held,
                 SUM(CASE WHEN x.confirmed_at IS NOT NULL THEN 1 ELSE 0 END) AS confirmed,
                 MAX(x.confirmed_at) AS last_confirmed_at
          FROM asset_assignments x
          JOIN employees e ON x.employee_id = e.id
          JOIN assets a ON x.asset_id = a.id
          WHERE x.returned_at IS NULL AND a.deleted_at IS NULL
          GROUP BY e.id
          ORDER BY (COUNT(*) - SUM(CASE WHEN x.confirmed_at IS NOT NULL THEN 1 ELSE 0 END)) DESC, e.name
        `).all();

        res.json({ reports, confirmations });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// People still active on the staff list whose Microsoft 365 account is
// disabled or gone. They cannot sign in to confirm anything, so what is
// recorded against them needs collecting or reassigning by IT.
router.get('/leavers', async (req, res) => {
    try {
        const staff = db.prepare(`
          SELECT e.id AS employee_id, e.name, e.email, e.department,
                 COUNT(a.id) AS held, COALESCE(SUM(CASE WHEN a.id IS NOT NULL THEN x.quantity END), 0) AS units
          FROM employees e
          LEFT JOIN asset_assignments x ON x.employee_id = e.id AND x.returned_at IS NULL
          LEFT JOIN assets a ON a.id = x.asset_id AND a.deleted_at IS NULL
          WHERE e.status != 'inactive'
          GROUP BY e.id
          ORDER BY e.name
        `).all();
        const result = await directory.accountStates(staff.map((s) => s.email), { refresh: req.query.refresh === '1' });
        const people = staff
            .map((s) => ({ ...s, account: result.states.get(String(s.email).trim().toLowerCase()) || 'unknown' }))
            .filter((s) => s.account === 'disabled' || s.account === 'not_found');
        res.json({
            available: result.available,
            checked_at: result.checked_at,
            checked: staff.length,
            unknown: staff.length - [...result.states.values()].filter((v) => v !== 'unknown').length,
            people
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Close a report with a note saying what was done. The report is kept.
router.post('/:id/resolve', (req, res) => {
    try {
        const report = db.prepare('SELECT * FROM staff_reports WHERE id = ?').get(req.params.id);
        if (!report) {
            return res.status(404).json({ error: 'Report not found' });
        }
        if (report.status !== 'open') {
            return res.status(409).json({ error: 'This report has already been closed' });
        }
        const note = String(req.body?.note || '').trim().slice(0, 1000);
        if (!note) {
            return res.status(400).json({ error: 'Add a short note saying what was done' });
        }

        db.transaction(() => {
            db.prepare(`
              UPDATE staff_reports
              SET status = 'resolved', resolved_at = CURRENT_TIMESTAMP, resolved_by = ?, resolution_note = ?
              WHERE id = ?
            `).run(req.user.email, note, report.id);
            if (report.asset_id) {
                addHistory(report.asset_id, 'report_closed', report.employee_id,
                    `Report from ${report.employee_name} closed — ${note}`, req.user);
            }
        })();
        logActivity(req, {
            action: 'staff_report_closed', entity_type: 'staff_report', entity_id: report.id,
            description: `Closed report from ${report.employee_name}: ${note}`
        });
        res.json(db.prepare('SELECT * FROM staff_reports WHERE id = ?').get(report.id));
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
