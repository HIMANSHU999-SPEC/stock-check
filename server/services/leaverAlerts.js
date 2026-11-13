const db = require('../database');
const directory = require('./directory');
const mailer = require('./mailer');
const { getSettings } = require('./appSettings');
const { appBaseUrl } = require('../config');

// Leavers: people still active on the staff list whose Microsoft 365
// account is blocked, unlicensed or gone. When one of them still holds
// equipment, the people named in the "leaver_alert_to" setting are emailed
// once, so the items get collected, reassigned or written off.

const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;
const FIRST_CHECK_AFTER_MS = 2 * 60 * 1000;

/** Everyone active (departments excluded) with their Microsoft account state. */
async function findLeavers({ refresh = false } = {}) {
    const staff = db.prepare(`
      SELECT e.id AS employee_id, e.name, e.email, e.department,
             COUNT(a.id) AS held, COALESCE(SUM(CASE WHEN a.id IS NOT NULL THEN x.quantity END), 0) AS units
      FROM employees e
      LEFT JOIN asset_assignments x ON x.employee_id = e.id AND x.returned_at IS NULL
      LEFT JOIN assets a ON a.id = x.asset_id AND a.deleted_at IS NULL
      WHERE e.status != 'inactive' AND e.kind != 'shared'
      GROUP BY e.id
      ORDER BY e.name
    `).all();
    const result = await directory.accountStates(staff.map((s) => s.email), { refresh });
    const all = staff.map((s) => ({ ...s, account: result.states.get(String(s.email).trim().toLowerCase()) || 'unknown' }));
    return {
        available: result.available,
        checked_at: result.checked_at,
        checked: staff.length,
        unknown: all.filter((s) => s.account === 'unknown').length,
        staff_licence: directory.STAFF_LICENCE,
        people: all.filter((s) => ['disabled', 'no_licence', 'not_found'].includes(s.account))
    };
}

const REASON = {
    disabled: 'Microsoft 365 account is blocked',
    no_licence: 'Microsoft 365 account has no staff licence',
    not_found: 'No Microsoft 365 account with this email'
};

function heldItems(employeeId) {
    return db.prepare(`
      SELECT a.asset_number, a.name, a.serial_number, x.quantity
      FROM asset_assignments x JOIN assets a ON a.id = x.asset_id
      WHERE x.employee_id = ? AND x.returned_at IS NULL AND a.deleted_at IS NULL
      ORDER BY x.assigned_at
    `).all(employeeId);
}

/**
 * Bring the record of leavers-with-equipment up to date and email about
 * any not yet reported. Never throws. Resolves with a short summary.
 */
async function run({ refresh = true } = {}) {
    try {
        const result = await findLeavers({ refresh });
        if (!result.available) return { skipped: 'Microsoft 365 is not connected' };
        // A partial answer must not clear anyone: only act on a full check.
        if (result.unknown > 0) return { skipped: `${result.unknown} account(s) could not be checked` };

        const holding = result.people.filter((p) => p.held > 0);
        db.transaction(() => {
            const keep = new Set(holding.map((p) => p.employee_id));
            for (const row of db.prepare('SELECT employee_id FROM leaver_alerts').all()) {
                if (!keep.has(row.employee_id)) db.prepare('DELETE FROM leaver_alerts WHERE employee_id = ?').run(row.employee_id);
            }
            for (const p of holding) {
                db.prepare('INSERT OR IGNORE INTO leaver_alerts (employee_id, reason) VALUES (?, ?)').run(p.employee_id, p.account);
            }
        })();

        const pending = holding.filter((p) => !db.prepare(
            'SELECT notified_at FROM leaver_alerts WHERE employee_id = ?'
        ).get(p.employee_id).notified_at);
        const recipients = String(getSettings().leaver_alert_to || '').split(/[,;]/).map((v) => v.trim()).filter(Boolean);
        if (pending.length === 0 || recipients.length === 0) {
            return { holding: holding.length, pending: pending.length, sent: 0 };
        }

        const lines = [
            pending.length === 1
                ? 'A member of staff who has left still has equipment recorded against them:'
                : `${pending.length} members of staff who have left still have equipment recorded against them:`
        ];
        for (const p of pending) {
            lines.push('', `${p.name} (${p.email}) — ${REASON[p.account]}`);
            for (const item of heldItems(p.employee_id)) {
                lines.push(`  - ${item.asset_number}  ${item.name}${item.quantity > 1 ? ` × ${item.quantity}` : ''}${item.serial_number ? `  (serial ${item.serial_number})` : ''}`);
            }
        }
        lines.push('',
            'Please collect each item and record what happened to it: return it to inventory, reassign it, or mark it lost or damaged. Once nothing is left against their name, mark the person inactive.');
        if (appBaseUrl) lines.push('', `Open the list: ${appBaseUrl}/staff-reports`);
        lines.push('', 'You are receiving this because you are named under Settings to be told about leavers with equipment.');

        const subject = pending.length === 1
            ? `Leaver still holds equipment: ${pending[0].name}`
            : `${pending.length} leavers still hold equipment`;
        let sent = 0;
        for (const to of recipients) {
            const mail = await mailer.sendMail({ to, subject, body: lines.join('\n'), templateKey: 'leaver_alert' });
            if (mail.status === 'sent') sent++;
        }
        // Only counts as told once at least one person actually got it;
        // otherwise the next run tries again.
        if (sent > 0) {
            for (const p of pending) {
                db.prepare('UPDATE leaver_alerts SET notified_at = CURRENT_TIMESTAMP WHERE employee_id = ?').run(p.employee_id);
            }
        }
        return { holding: holding.length, pending: pending.length, sent };
    } catch (err) {
        console.error('Leaver check failed:', err.message);
        return { error: err.message };
    }
}

function startWorker() {
    setTimeout(run, FIRST_CHECK_AFTER_MS).unref();
    setInterval(run, CHECK_EVERY_MS).unref();
}

/** How many leavers currently hold equipment, as of the last check. */
function holdingCount() {
    return db.prepare('SELECT COUNT(*) AS n FROM leaver_alerts').get().n;
}

module.exports = { findLeavers, run, startWorker, holdingCount };
