const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const db = require('../database');
const { logActivity } = require('../utils/activity');

const ALLOWED_ROLES = ['admin', 'subadmin'];

function hashPassword(password) {
    return crypto.createHash('sha256').update(password).digest('hex');
}

// Only full admins may manage user accounts.
function requireAdmin(req, res, next) {
    if (!req.user || req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Only administrators can manage users' });
    }
    next();
}

router.use(requireAdmin);

// List all users (no password hashes)
router.get('/', (req, res) => {
    try {
        const users = db.prepare('SELECT id, name, email, role, created_at FROM users ORDER BY role, name').all();
        res.json(users);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Create a user
router.post('/', (req, res) => {
    try {
        const { name, email, role = 'subadmin', password } = req.body;
        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required' });
        }
        const safeRole = ALLOWED_ROLES.includes(role) ? role : 'subadmin';

        const existing = db.prepare('SELECT id FROM users WHERE LOWER(email) = LOWER(?)').get(email);
        if (existing) {
            return res.status(409).json({ error: 'A user with that email already exists' });
        }

        const result = db.prepare(
            'INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)'
        ).run(name || null, email, hashPassword(password), safeRole);

        logActivity(req, {
            action: 'user_created',
            entity_type: 'user',
            entity_id: result.lastInsertRowid,
            description: `Created ${safeRole} user ${email}`
        });

        const created = db.prepare('SELECT id, name, email, role, created_at FROM users WHERE id = ?').get(result.lastInsertRowid);
        res.status(201).json(created);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Update a user's name / role, and optionally reset password
router.put('/:id', (req, res) => {
    try {
        const { name, role, password } = req.body;
        const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const safeRole = role && ALLOWED_ROLES.includes(role) ? role : user.role;

        // Don't allow demoting the last remaining admin.
        if (user.role === 'admin' && safeRole !== 'admin') {
            const adminCount = db.prepare("SELECT COUNT(*) as c FROM users WHERE role = 'admin'").get().c;
            if (adminCount <= 1) {
                return res.status(400).json({ error: 'Cannot change the role of the last administrator' });
            }
        }

        if (password) {
            db.prepare('UPDATE users SET name = ?, role = ?, password_hash = ? WHERE id = ?')
                .run(name ?? user.name, safeRole, hashPassword(password), user.id);
        } else {
            db.prepare('UPDATE users SET name = ?, role = ? WHERE id = ?')
                .run(name ?? user.name, safeRole, user.id);
        }

        logActivity(req, {
            action: 'user_updated',
            entity_type: 'user',
            entity_id: user.id,
            description: `Updated user ${user.email}${password ? ' (password reset)' : ''}`
        });

        const updated = db.prepare('SELECT id, name, email, role, created_at FROM users WHERE id = ?').get(user.id);
        res.json(updated);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Delete a user
router.delete('/:id', (req, res) => {
    try {
        const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        if (String(user.id) === String(req.user.id)) {
            return res.status(400).json({ error: 'You cannot delete your own account' });
        }

        if (user.role === 'admin') {
            const adminCount = db.prepare("SELECT COUNT(*) as c FROM users WHERE role = 'admin'").get().c;
            if (adminCount <= 1) {
                return res.status(400).json({ error: 'Cannot delete the last administrator' });
            }
        }

        db.prepare('DELETE FROM users WHERE id = ?').run(user.id);

        logActivity(req, {
            action: 'user_deleted',
            entity_type: 'user',
            entity_id: user.id,
            description: `Deleted user ${user.email}`
        });

        res.json({ message: 'User deleted successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
