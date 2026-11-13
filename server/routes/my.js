const express = require('express');
const router = express.Router();
const db = require('../database');
const mailer = require('../services/mailer');
const { getSettings } = require('../services/appSettings');
const { addHistory } = require('../services/assignments');
const { logActivity } = require('../utils/activity');
const { appBaseUrl } = require('../config');

// "My assets": what is recorded against the person signed in, and nothing
// else. Open to every member of staff (see the mount in index.js, which sets
// req.person). Every query here is tied to req.person.employee.id — no id
// from the request is ever trusted to say whose data to read.

const REASONS = {
    not_mine: 'I do not have this item',
    wrong_details: 'The details shown are wrong',
    faulty: 'The item is faulty or damaged',
    missing: 'I have an item that is not on my list',
    other: 'Something else'
};
// These are about one particular item on the list.
const ITEM_REASONS = ['not_mine', 'wrong_details', 'faulty'];
const MAX_MESSAGE_LENGTH = 2000;
const MAX_OPEN_REPORTS = 10;

const HELD_SQL = `
  SELECT x.id AS assignment_id, x.quantity, x.assigned_at, x.confirmed_at,
         (a.quantity > 1) AS bulk,
         a.id AS asset_id, a.asset_number, a.name, a.brand, a.model, a.serial_number, a.campus,
         c.name AS category_name,
         (SELECT COUNT(*) FROM staff_reports r WHERE r.assignment_id = x.id AND r.status = 'open') AS open_reports
  FROM asset_assignments x
  JOIN assets a ON x.asset_id = a.id
  LEFT JOIN categories c ON a.category_id = c.id
  WHERE x.employee_id = ? AND x.returned_at IS NULL AND a.deleted_at IS NULL
  ORDER BY x.assigned_at DESC, x.id DESC
`;

function supportAddress() {
    const settings = getSettings();
    return settings.support_email || settings.mail_from || '';
}

function heldRow(employeeId, assignmentId) {
    return db.prepare(`${HELD_SQL.replace('ORDER BY', 'AND x.id = ? ORDER BY')}`)
        .get(employeeId, Number(assignmentId) || 0);
}

router.get('/assets', (req, res) => {
    try {
        const { employee, role } = req.person;
        const base = {
            person: {
                name: employee ? employee.name : (req.user.name || req.user.email),
                email: employee ? employee.email : req.user.email,
                department: employee ? (employee.department || '') : '',
                role,
                // Administrators without a staff record of their own have no list.
                on_staff_list: Boolean(employee)
            },
            support_email: supportAddress(),
            reasons: REASONS
        };
        if (!employee) {
            return res.json({ ...base, items: [], returned: [], reports: [] });
        }

        const items = db.prepare(HELD_SQL).all(employee.id);
        const returned = db.prepare(`
          SELECT x.id AS assignment_id, x.quantity, x.assigned_at, x.returned_at,
                 a.asset_number, a.name, a.serial_number
          FROM asset_assignments x JOIN assets a ON x.asset_id = a.id
          WHERE x.employee_id = ? AND x.returned_at IS NOT NULL
          ORDER BY x.returned_at DESC, x.id DESC
          LIMIT 25
        `).all(employee.id);
        const reports = db.prepare(`
          SELECT r.id, r.reason, r.message, r.status, r.created_at, r.resolved_at, r.resolution_note,
                 a.asset_number, a.name AS asset_name
          FROM staff_reports r LEFT JOIN assets a ON r.asset_id = a.id
          WHERE r.employee_id = ?
          ORDER BY r.created_at DESC, r.id DESC
          LIMIT 25
        `).all(employee.id);

        res.json({ ...base, items, returned, reports });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// "Yes, I have this." Recorded against the assignment and in the asset's
// history, with who confirmed and when.
router.post('/assets/:assignmentId/confirm', (req, res) => {
    try {
        const { employee } = req.person;
        if (!employee) {
            return res.status(404).json({ error: 'Nothing is recorded against your name' });
        }
        const row = heldRow(employee.id, req.params.assignmentId);
        if (!row) {
            return res.status(404).json({ error: 'That item is no longer on your list — refresh the page' });
        }
        // Shared stock is counted by IT, not confirmed by each holder.
        if (row.bulk) {
            return res.status(400).json({ error: 'This is bulk stock — IT Support confirms it. Use "Report a problem" if it is wrong.' });
        }
        if (!row.confirmed_at) {
            db.transaction(() => {
                db.prepare(`
                  UPDATE asset_assignments SET confirmed_at = CURRENT_TIMESTAMP, confirmed_by = ? WHERE id = ?
                `).run(employee.email, row.assignment_id);
                addHistory(row.asset_id, 'confirmed', employee.id,
                    `${employee.name} confirmed they hold ${row.quantity > 1 ? `${row.quantity} of ` : ''}this item`,
                    { email: employee.email });
            })();
            logActivity(req, {
                action: 'asset_confirmed', entity_type: 'asset', entity_id: row.asset_id,
                description: `${employee.name} confirmed holding ${row.asset_number} (${row.name})`
            });
        }
        res.json(heldRow(employee.id, row.assignment_id));
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Tell IT Support something on the list is wrong. Always stored, so it shows
// under Staff reports even when the email cannot be sent.
router.post('/reports', async (req, res) => {
    try {
        const { employee } = req.person;
        if (!employee) {
            return res.status(400).json({ error: 'You are not on the staff list, so there is nothing to report against' });
        }
        const reason = String(req.body?.reason || '');
        const message = String(req.body?.message || '').trim().slice(0, MAX_MESSAGE_LENGTH);
        if (!Object.prototype.hasOwnProperty.call(REASONS, reason)) {
            return res.status(400).json({ error: 'Choose what the problem is' });
        }

        let item = null;
        if (ITEM_REASONS.includes(reason)) {
            item = heldRow(employee.id, req.body?.assignment_id);
            if (!item) {
                return res.status(404).json({ error: 'That item is no longer on your list — refresh the page' });
            }
        } else if (message.length < 5) {
            return res.status(400).json({ error: 'Please describe the problem so IT Support can help' });
        }

        const open = db.prepare(
            "SELECT COUNT(*) AS n FROM staff_reports WHERE employee_id = ? AND status = 'open'"
        ).get(employee.id).n;
        if (open >= MAX_OPEN_REPORTS) {
            return res.status(429).json({
                error: 'You already have several reports waiting with IT Support. Please contact them directly.'
            });
        }
        if (item && item.open_reports > 0) {
            return res.status(409).json({ error: 'You have already reported this item — IT Support will be in touch' });
        }

        const reportId = db.transaction(() => {
            const id = db.prepare(`
              INSERT INTO staff_reports (employee_id, employee_name, employee_email, assignment_id, asset_id, reason, message)
              VALUES (?, ?, ?, ?, ?, ?, ?)
            `).run(employee.id, employee.name, employee.email,
                item ? item.assignment_id : null, item ? item.asset_id : null, reason, message || null).lastInsertRowid;
            if (item) {
                addHistory(item.asset_id, 'reported', employee.id,
                    `${employee.name} reported: ${REASONS[reason]}${message ? ` — ${message}` : ''}`,
                    { email: employee.email });
            }
            return id;
        })();
        logActivity(req, {
            action: 'staff_report', entity_type: item ? 'asset' : 'employee', entity_id: item ? item.asset_id : employee.id,
            description: `${employee.name} reported "${REASONS[reason]}"${item ? ` about ${item.asset_number}` : ''}`
        });

        const lines = [
            `${employee.name} (${employee.email}) has reported a problem with the assets recorded against them.`,
            '',
            `Problem: ${REASONS[reason]}`
        ];
        if (item) {
            lines.push(
                `Asset number: ${item.asset_number}`,
                `Item: ${item.name}`,
                `Serial number: ${item.serial_number || 'N/A'}`,
                `Quantity recorded: ${item.quantity}`
            );
        }
        if (message) lines.push('', 'Their message:', message);
        if (appBaseUrl) lines.push('', `Review and close this report: ${appBaseUrl}/staff-reports`);
        lines.push('', 'Reply to this email to answer them directly.');

        const mail = await mailer.sendMail({
            to: supportAddress(),
            subject: `Asset report from ${employee.name}: ${REASONS[reason]}${item ? ` (${item.asset_number})` : ''}`,
            body: lines.join('\n'),
            templateKey: 'staff_report',
            entity: { type: 'staff_report', id: reportId },
            user: req.user,
            replyTo: employee.email
        });
        db.prepare('UPDATE staff_reports SET email_status = ? WHERE id = ?').run(mail.status, reportId);

        res.status(201).json({ id: reportId, emailed: mail.status === 'sent' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
