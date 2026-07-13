const db = require('../database');

// Record an entry in the audit trail. Best-effort: logging must never break the
// request it is attached to, so any error is swallowed.
function logActivity(req, { action, entity_type = null, entity_id = null, description = '' }) {
    try {
        const user = req && req.user ? req.user : null;
        db.prepare(`
      INSERT INTO activity_log (user_id, user_email, action, entity_type, entity_id, description)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
            user ? user.id : null,
            user ? user.email : null,
            action,
            entity_type,
            entity_id,
            description
        );
    } catch (err) {
        // Never let audit logging interfere with the primary operation.
        console.error('activity log failed:', err.message);
    }
}

module.exports = { logActivity };
