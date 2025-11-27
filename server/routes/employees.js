const express = require('express');
const router = express.Router();
const db = require('../database');
const PDFDocument = require('pdfkit');

// Get all employees
router.get('/', (req, res) => {
    try {
        const employees = db.prepare('SELECT * FROM employees ORDER BY name').all();

        // Add asset count for each employee
        const employeesWithAssets = employees.map(emp => {
            const assetCount = db.prepare('SELECT COUNT(*) as count FROM assets WHERE assigned_to = ?').get(emp.id);
            return { ...emp, asset_count: assetCount.count };
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
        const assets = db.prepare(`
      SELECT a.*, c.name as category_name
      FROM assets a
      LEFT JOIN categories c ON a.category_id = c.id
      WHERE a.assigned_to = ?
    `).all(req.params.id);

        // Get history for this employee (any asset interactions)
        const history = db.prepare(`
      SELECT ah.*, a.asset_number, a.name as asset_name
      FROM asset_history ah
      LEFT JOIN assets a ON ah.asset_id = a.id
      WHERE ah.employee_id = ?
      ORDER BY ah.timestamp DESC
    `).all(req.params.id);

        res.json({ ...employee, assets, history });
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
        res.status(201).json(newEmployee);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Update employee
router.put('/:id', (req, res) => {
    try {
        const { name, email, department, phone } = req.body;

        db.prepare(`
      UPDATE employees SET name = ?, email = ?, department = ?, phone = ?
      WHERE id = ?
    `).run(name, email, department, phone, req.params.id);

        const updatedEmployee = db.prepare('SELECT * FROM employees WHERE id = ?').get(req.params.id);
        res.json(updatedEmployee);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Delete employee
router.delete('/:id', (req, res) => {
    try {
        // Check if employee has assigned assets
        const assignedAssets = db.prepare('SELECT COUNT(*) as count FROM assets WHERE assigned_to = ?').get(req.params.id);

        if (assignedAssets.count > 0) {
            return res.status(400).json({ error: 'Cannot delete employee with assigned assets' });
        }

        // Clean up history rows referencing this employee
        db.prepare('DELETE FROM asset_history WHERE employee_id = ?').run(req.params.id);

        db.prepare('DELETE FROM employees WHERE id = ?').run(req.params.id);
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

        const assets = db.prepare(`
      SELECT a.*, c.name as category_name
      FROM assets a
      LEFT JOIN categories c ON a.category_id = c.id
      WHERE a.assigned_to = ?
    `).all(req.params.id);

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
