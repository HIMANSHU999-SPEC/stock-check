const express = require('express');
const router = express.Router();
const db = require('../database');
const { logActivity } = require('../utils/activity');

const ALLOWED_TYPES = ['student', 'staff'];

// Get all borrowers (with optional type / search filters) plus active loan counts
router.get('/', (req, res) => {
    try {
        const { type, search } = req.query;
        let query = 'SELECT * FROM borrowers WHERE 1=1';
        const params = [];

        if (type && ALLOWED_TYPES.includes(type)) {
            query += ' AND type = ?';
            params.push(type);
        }

        if (search) {
            query += ' AND (name LIKE ? OR identifier LIKE ? OR email LIKE ? OR class_dept LIKE ?)';
            const s = `%${search}%`;
            params.push(s, s, s, s);
        }

        query += ' ORDER BY name';

        const borrowers = db.prepare(query).all(...params);

        const withCounts = borrowers.map((b) => {
            const active = db.prepare(
                "SELECT COUNT(*) as count FROM book_loans WHERE borrower_id = ? AND status = 'issued'"
            ).get(b.id);
            return { ...b, active_loans: active.count };
        });

        res.json(withCounts);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get single borrower with loan history
router.get('/:id', (req, res) => {
    try {
        const borrower = db.prepare('SELECT * FROM borrowers WHERE id = ?').get(req.params.id);
        if (!borrower) {
            return res.status(404).json({ error: 'Borrower not found' });
        }

        const loans = db.prepare(`
      SELECT l.*, b.book_number, b.title, b.author
      FROM book_loans l
      JOIN books b ON l.book_id = b.id
      WHERE l.borrower_id = ?
      ORDER BY l.issued_at DESC
    `).all(req.params.id);

        res.json({ ...borrower, loans });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Create borrower
router.post('/', (req, res) => {
    try {
        const { name, type = 'student', identifier, email, class_dept, phone, campus = '' } = req.body;
        if (!name || !name.trim()) {
            return res.status(400).json({ error: 'Name is required' });
        }
        const safeType = ALLOWED_TYPES.includes(type) ? type : 'student';

        const result = db.prepare(`
      INSERT INTO borrowers (name, type, identifier, email, class_dept, phone, campus)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(name.trim(), safeType, identifier || null, email || null, class_dept || null, phone || null, campus || '');

        const created = db.prepare('SELECT * FROM borrowers WHERE id = ?').get(result.lastInsertRowid);
        logActivity(req, {
            action: 'borrower_created', entity_type: 'borrower', entity_id: created.id,
            description: `Added ${created.type} borrower ${created.name}`
        });
        res.status(201).json(created);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Update borrower
router.put('/:id', (req, res) => {
    try {
        const { name, type = 'student', identifier, email, class_dept, phone, campus = '' } = req.body;
        const existing = db.prepare('SELECT id FROM borrowers WHERE id = ?').get(req.params.id);
        if (!existing) {
            return res.status(404).json({ error: 'Borrower not found' });
        }
        const safeType = ALLOWED_TYPES.includes(type) ? type : 'student';

        db.prepare(`
      UPDATE borrowers SET name = ?, type = ?, identifier = ?, email = ?, class_dept = ?, phone = ?, campus = ?
      WHERE id = ?
    `).run(name, safeType, identifier || null, email || null, class_dept || null, phone || null, campus || '', req.params.id);

        const updated = db.prepare('SELECT * FROM borrowers WHERE id = ?').get(req.params.id);
        res.json(updated);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Delete borrower (blocked while books are still out)
router.delete('/:id', (req, res) => {
    try {
        const active = db.prepare(
            "SELECT COUNT(*) as count FROM book_loans WHERE borrower_id = ? AND status = 'issued'"
        ).get(req.params.id);

        if (active.count > 0) {
            return res.status(400).json({ error: 'Cannot delete a borrower with books still on loan' });
        }

        const borrower = db.prepare('SELECT * FROM borrowers WHERE id = ?').get(req.params.id);
        db.prepare('DELETE FROM book_loans WHERE borrower_id = ?').run(req.params.id);
        db.prepare('DELETE FROM borrowers WHERE id = ?').run(req.params.id);
        logActivity(req, {
            action: 'borrower_deleted', entity_type: 'borrower', entity_id: Number(req.params.id),
            description: `Deleted borrower ${borrower ? borrower.name : req.params.id}`
        });
        res.json({ message: 'Borrower deleted successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
