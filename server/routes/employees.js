const express = require('express');
const router = express.Router();
const db = require('../database');
const PDFDocument = require('pdfkit');
const { logActivity } = require('../utils/activity');
const { confirmByStaff } = require('../services/assignments');

// What a person currently holds comes from the open assignment records, so an
// employee sharing bulk stock with others (or a room) is still counted.
const HELD_ASSETS_SQL = `
      SELECT a.*, c.name as category_name, x.id as assignment_id, x.quantity as held_quantity, x.assigned_at,
             x.confirmed_at, x.confirmed_by
      FROM asset_assignments x
      JOIN assets a ON x.asset_id = a.id
      LEFT JOIN categories c ON a.category_id = c.id
      WHERE x.employee_id = ? AND x.returned_at IS NULL AND a.deleted_at IS NULL
      ORDER BY x.assigned_at DESC
    `;
const HELD_COUNT_SQL = `
      SELECT COUNT(*) as count
      FROM asset_assignments x JOIN assets a ON x.asset_id = a.id
      WHERE x.employee_id = ? AND x.returned_at IS NULL AND a.deleted_at IS NULL
    `;

// Everything this person has handed back: kept for good, so the record of who
// used what survives them leaving.
const PAST_ASSETS_SQL = `
      SELECT x.id as assignment_id, x.quantity, x.assigned_at, x.returned_at, x.return_condition,
             a.id as asset_id, a.asset_number, a.name, a.serial_number, c.name as category_name
      FROM asset_assignments x
      JOIN assets a ON x.asset_id = a.id
      LEFT JOIN categories c ON a.category_id = c.id
      WHERE x.employee_id = ? AND x.returned_at IS NOT NULL
      ORDER BY x.returned_at DESC, x.id DESC
    `;
// Any trace of this person in the asset records, current or past.
const HAS_HISTORY_SQL = `
      SELECT (EXISTS (SELECT 1 FROM asset_assignments WHERE employee_id = ?)
           OR EXISTS (SELECT 1 FROM asset_history WHERE employee_id = ?)) as has_history
    `;

function hasHistory(employeeId) {
    return Boolean(db.prepare(HAS_HISTORY_SQL).get(employeeId, employeeId).has_history);
}

// Get all employees
router.get('/', (req, res) => {
    try {
        const employees = db.prepare('SELECT * FROM employees ORDER BY name').all();

        // Add asset count for each employee
        const employeesWithAssets = employees.map(emp => {
            const assetCount = db.prepare(HELD_COUNT_SQL).get(emp.id);
            return { ...emp, asset_count: assetCount.count, has_history: hasHistory(emp.id) };
        });

        res.json(employeesWithAssets);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get single employee with assets and history
router.get('/:id', (req, res) => {
    try {
        const employee = db.prepare('SELECT * FROM employees WHERE id = ?').get(req.params.id);

        if (!employee) {
            return res.status(404).json({ error: 'Employee not found' });
        }

        // Get assigned assets
        const assets = db.prepare(HELD_ASSETS_SQL).all(req.params.id);

        // Get history for this employee (any asset interactions)
        const history = db.prepare(`
      SELECT ah.*, a.asset_number, a.name as asset_name
      FROM asset_history ah
      LEFT JOIN assets a ON ah.asset_id = a.id
      WHERE ah.employee_id = ?
      ORDER BY ah.timestamp DESC
    `).all(req.params.id);

        const pastAssets = db.prepare(PAST_ASSETS_SQL).all(req.params.id);

        res.json({ ...employee, assets, past_assets: pastAssets, history });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Create employee
router.post('/', (req, res) => {
    try {
        const { name, email, department, phone } = req.body;

        const result = db.prepare(`
      INSERT INTO employees (name, email, department, phone)
      VALUES (?, ?, ?, ?)
    `).run(name, email, department, phone);

        const newEmployee = db.prepare('SELECT * FROM employees WHERE id = ?').get(result.lastInsertRowid);
        logActivity(req, {
            action: 'employee_created', entity_type: 'employee', entity_id: newEmployee.id,
            description: `Added employee ${newEmployee.name} (${newEmployee.email})`
        });
        res.status(201).json(newEmployee);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Update employee
router.put('/:id', (req, res) => {
    try {
        const { name, email, department, phone } = req.body;
        const before = db.prepare('SELECT * FROM employees WHERE id = ?').get(req.params.id);
        if (!before) {
            return res.status(404).json({ error: 'Employee not found' });
        }

        db.prepare(`
      UPDATE employees SET name = ?, email = ?, department = ?, phone = ?
      WHERE id = ?
    `).run(name, email, department, phone, req.params.id);

        const updatedEmployee = db.prepare('SELECT * FROM employees WHERE id = ?').get(req.params.id);
        const changed = ['name', 'email', 'department', 'phone']
            .filter((field) => (before[field] || '') !== (updatedEmployee[field] || ''))
            .map((field) => `${field}: "${before[field] || ''}" -> "${updatedEmployee[field] || ''}"`);
        if (changed.length > 0) {
            logActivity(req, {
                action: 'employee_updated', entity_type: 'employee', entity_id: updatedEmployee.id,
                description: `Updated employee ${updatedEmployee.name} (${changed.join('; ')})`
            });
        }
        res.json(updatedEmployee);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Mark someone inactive (left, or no longer issued equipment). Their record
// and every past assignment stay exactly as they are; they simply can no
// longer be given anything. Everything they hold has to come back first, so
// nothing is left assigned to a leaver.
// IT confirms everything recorded against a person or department in one go
router.post('/:id/confirm-assets', (req, res) => {
    try {
        const employee = db.prepare('SELECT * FROM employees WHERE id = ?').get(req.params.id);
        if (!employee) {
            return res.status(404).json({ error: 'Employee not found' });
        }
        const confirmed = confirmByStaff({ employeeId: employee.id }, req.user);
        if (confirmed.length > 0) {
            logActivity(req, {
                action: 'asset_confirmed', entity_type: 'employee', entity_id: employee.id,
                description: `Confirmed ${confirmed.length} item(s) are with ${employee.name}`
            });
        }
        res.json({ confirmed: confirmed.length });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.post('/:id/deactivate', (req, res) => {
    try {
        const employee = db.prepare('SELECT * FROM employees WHERE id = ?').get(req.params.id);
        if (!employee) {
            return res.status(404).json({ error: 'Employee not found' });
        }
        if (employee.status === 'inactive') {
            return res.status(400).json({ error: `${employee.name} is already inactive` });
        }
        const held = db.prepare(HELD_COUNT_SQL).get(employee.id).count;
        if (held > 0) {
            return res.status(400).json({
                error: `${employee.name} still holds ${held} asset${held === 1 ? '' : 's'} — return or reassign ${held === 1 ? 'it' : 'them'} first`
            });
        }

        const note = String(req.body?.note || '').trim().slice(0, 300) || null;
        db.prepare(`
      UPDATE employees
      SET status = 'inactive', deactivated_at = CURRENT_TIMESTAMP, deactivated_by = ?, deactivation_note = ?
      WHERE id = ?
    `).run(req.user?.email || null, note, employee.id);

        logActivity(req, {
            action: 'employee_deactivated', entity_type: 'employee', entity_id: employee.id,
            description: `Marked ${employee.name} (${employee.email}) inactive${note ? ` — ${note}` : ''}`
        });
        res.json(db.prepare('SELECT * FROM employees WHERE id = ?').get(employee.id));
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Bring someone back (rejoined, or marked inactive by mistake).
router.post('/:id/reactivate', (req, res) => {
    try {
        const employee = db.prepare('SELECT * FROM employees WHERE id = ?').get(req.params.id);
        if (!employee) {
            return res.status(404).json({ error: 'Employee not found' });
        }
        if (employee.status !== 'inactive') {
            return res.status(400).json({ error: `${employee.name} is already active` });
        }

        db.prepare(`
      UPDATE employees
      SET status = 'active', deactivated_at = NULL, deactivated_by = NULL, deactivation_note = NULL
      WHERE id = ?
    `).run(employee.id);

        logActivity(req, {
            action: 'employee_reactivated', entity_type: 'employee', entity_id: employee.id,
            description: `Marked ${employee.name} (${employee.email}) active again`
        });
        res.json(db.prepare('SELECT * FROM employees WHERE id = ?').get(employee.id));
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Delete employee. Only for a record added by mistake: anyone who has ever
// held an asset is kept, because deleting them would erase who used what.
// Nothing in the asset history is ever removed here.
router.delete('/:id', (req, res) => {
    try {
        const employee = db.prepare('SELECT * FROM employees WHERE id = ?').get(req.params.id);
        if (!employee) {
            return res.status(404).json({ error: 'Employee not found' });
        }
        if (hasHistory(employee.id)) {
            return res.status(400).json({
                error: `${employee.name} has asset history, so the record is kept for audit. Mark them inactive instead.`
            });
        }

        db.prepare('DELETE FROM employees WHERE id = ?').run(employee.id);
        logActivity(req, {
            action: 'employee_deleted', entity_type: 'employee', entity_id: employee.id,
            description: `Deleted employee ${employee.name} (${employee.email}) — no asset history`
        });
        res.json({ message: 'Employee deleted successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Export employee report as PDF
router.get('/:id/report', (req, res) => {
    try {
        const employee = db.prepare('SELECT * FROM employees WHERE id = ?').get(req.params.id);
        if (!employee) {
            return res.status(404).json({ error: 'Employee not found' });
        }

        const assets = db.prepare(HELD_ASSETS_SQL).all(req.params.id);

        const history = db.prepare(`
      SELECT ah.*, a.asset_number, a.name as asset_name
      FROM asset_history ah
      LEFT JOIN assets a ON ah.asset_id = a.id
      WHERE ah.employee_id = ?
      ORDER BY ah.timestamp DESC
    `).all(req.params.id);

        const doc = new PDFDocument({ margin: 40 });
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="employee-${employee.id}-report.pdf"`);
        doc.pipe(res);

        doc.fontSize(18).text('Employee Asset Report', { align: 'left' });
        doc.moveDown(0.5);
        doc.fontSize(12).text(`Name: ${employee.name}`);
        doc.text(`Email: ${employee.email}`);
        doc.text(`Department: ${employee.department || 'N/A'}`);
        doc.text(`Phone: ${employee.phone || 'N/A'}`);
        doc.text(employee.status === 'inactive'
            ? `Status: Inactive since ${employee.deactivated_at ? new Date(employee.deactivated_at).toLocaleDateString() : 'unknown'}${employee.deactivation_note ? ` (${employee.deactivation_note})` : ''}`
            : 'Status: Active');
        doc.moveDown();

        doc.fontSize(14).text('Assigned Assets', { underline: true });
        doc.moveDown(0.3);
        if (assets.length === 0) {
            doc.text('No assigned assets.');
        } else {
            assets.forEach((a) => {
                doc.fontSize(12).text(`${a.asset_number} - ${a.name} (${a.category_name || 'N/A'})`);
                doc.text(`Status: ${a.status} | Model: ${a.model || 'N/A'} | Serial: ${a.serial_number || 'N/A'}`);
                doc.moveDown(0.5);
            });
        }

        doc.moveDown();
        doc.fontSize(14).text('History', { underline: true });
        doc.moveDown(0.3);
        if (history.length === 0) {
            doc.text('No history entries.');
        } else {
            history.forEach((h) => {
                doc.fontSize(12).text(`${new Date(h.timestamp).toLocaleString()} - ${h.action.toUpperCase()}`);
                doc.text(`Asset: ${h.asset_number || 'N/A'} - ${h.asset_name || 'N/A'}`);
                doc.text(`Notes: ${h.notes || '-'}`);
                doc.moveDown(0.5);
            });
        }

        doc.end();
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
