const express = require('express');
const router = express.Router();
const db = require('../database');

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

// Get single employee
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

        res.json({ ...employee, assets });
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

        db.prepare('DELETE FROM employees WHERE id = ?').run(req.params.id);
        res.json({ message: 'Employee deleted successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
