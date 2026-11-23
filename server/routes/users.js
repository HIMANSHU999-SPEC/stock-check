const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const db = require('../database');
const { logActivity } = require('../utils/activity');
const { ssoEnabled } = require('./auth');

// admin: everything. subadmin: day-to-day work, no users or settings.
// inventory: look at everything and download it, change nothing.
// viewer: look only.
const ALLOWED_ROLES = ['admin', 'subadmin', 'inventory', 'viewer'];
// Stored in place of a hash for accounts that only sign in with Microsoft.
// It is not a valid SHA-256 digest, so no password can ever match it.
const NO_PASSWORD = '!sso-only';
const USER_COLUMNS = `id, name, email, role, created_at, (password_hash <> '${NO_PASSWORD}') as has_password`;

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
        const users = db.prepare(`SELECT ${USER_COLUMNS} FROM users ORDER BY role, name`).all();
        res.json(users);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// People on the staff list who have no account here yet. They can already
// sign in to see their own assets; picking one gives them more.
router.get('/staff-candidates', (req, res) => {
    try {
        const staff = db.prepare(`
          SELECT e.id, e.name, e.email, e.department
          FROM employees e
          WHERE e.status != 'inactive' AND e.kind != 'shared'
            AND NOT EXISTS (SELECT 1 FROM users u WHERE LOWER(u.email) = LOWER(e.email))
          ORDER BY e.name
        `).all();
        res.json(staff);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Create a user
router.post('/', (req, res) => {
    try {
        const { name, email, role = 'viewer', password } = req.body;
        if (!email) {
            return res.status(400).json({ error: 'Email is required' });
        }
        // Without single sign-on a password is the only way in.
        if (!password && !ssoEnabled) {
            return res.status(400).json({ error: 'Email and password are required' });
        }
        // An unrecognised role gets the least access, never more.
        const safeRole = ALLOWED_ROLES.includes(role) ? role : 'viewer';

        const existing = db.prepare('SELECT id FROM users WHERE LOWER(email) = LOWER(?)').get(email);
        if (existing) {
            return res.status(409).json({ error: 'A user with that email already exists' });
        }

        const result = db.prepare(
            'INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)'
        ).run(name || null, String(email).trim(), password ? hashPassword(password) : NO_PASSWORD, safeRole);

        logActivity(req, {
            action: 'user_created',
            entity_type: 'user',
            entity_id: result.lastInsertRowid,
            description: `Created ${safeRole} user ${email}`
        });

        const created = db.prepare(`SELECT ${USER_COLUMNS} FROM users WHERE id = ?`).get(result.lastInsertRowid);
        res.status(201).json(created);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Update a user's name / role, and optionally reset password
router.put('/:id', (req, res) => {
    try {
        const { name, role, password, remove_password } = req.body;
        const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        if (remove_password && !ssoEnabled) {
            return res.status(400).json({ error: 'Single sign-on must be working before a password can be removed' });
        }

        const safeRole = role && ALLOWED_ROLES.includes(role) ? role : user.role;

        // Changing your own role would lock you out of this page mid-way;
        // another administrator has to do it.
        if (String(user.id) === String(req.user?.id) && safeRole !== user.role) {
            return res.status(400).json({ error: 'You cannot change your own role. Ask another administrator.' });
        }

        // Don't allow demoting the last remaining admin.
        if (user.role === 'admin' && safeRole !== 'admin') {
            const adminCount = db.prepare("SELECT COUNT(*) as c FROM users WHERE role = 'admin'").get().c;
            if (adminCount <= 1) {
                return res.status(400).json({ error: 'Cannot change the role of the last administrator' });
            }
        }

        if (password || remove_password) {
            db.prepare('UPDATE users SET name = ?, role = ?, password_hash = ? WHERE id = ?')
                .run(name ?? user.name, safeRole, password ? hashPassword(password) : NO_PASSWORD, user.id);
        } else {
            db.prepare('UPDATE users SET name = ?, role = ? WHERE id = ?')
                .run(name ?? user.name, safeRole, user.id);
        }

        logActivity(req, {
            action: 'user_updated',
            entity_type: 'user',
            entity_id: user.id,
            description: `Updated user ${user.email}${safeRole !== user.role ? ` (role ${user.role} → ${safeRole})` : ''}${password ? ' (password reset)' : remove_password ? ' (password removed — Microsoft sign-in only)' : ''}`
        });

        const updated = db.prepare(`SELECT ${USER_COLUMNS} FROM users WHERE id = ?`).get(user.id);
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
