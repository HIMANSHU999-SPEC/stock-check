const db = require('../database');
const { entra, appBaseUrl } = require('../config');
const { graph, explainGraphError } = require('./graph');
const { getSettings, EMAIL_RE } = require('./appSettings');

// Outgoing email. Messages are sent by the server through Microsoft Graph
// from the mailbox configured as "mail_from" (e.g. the IT support shared
// mailbox). Wording lives in email_templates and is editable from the
// Settings page; the defaults below apply until a template is customised.

const ASSET_PLACEHOLDERS = [
    'employee_name', 'employee_email', 'department',
    'asset_number', 'asset_name', 'category', 'brand', 'model', 'serial_number',
    'campus', 'location', 'quantity', 'previous_holder', 'new_holder',
    'condition', 'notes', 'date', 'sent_by', 'asset_url', 'org_name', 'support_email'
];
const LIBRARY_PLACEHOLDERS = ['borrower_name', 'items', 'date', 'sent_by', 'org_name', 'support_email'];

const ASSET_BLOCK = `Asset number: {{asset_number}}
Item: {{asset_name}}
Category: {{category}}
Brand / model: {{brand}} {{model}}
Serial number: {{serial_number}}
Quantity: {{quantity}}
Campus: {{campus}}`;

const SIGN_OFF = `Kind regards,
IT Support
{{org_name}}
{{support_email}}`;

const DEFAULT_TEMPLATES = {
    asset_assigned: {
        name: 'Asset assigned',
        description: 'Sent to a member of staff when an item is assigned (or reassigned) to them.',
        placeholders: ASSET_PLACEHOLDERS,
        subject: 'Asset assigned to you: {{asset_number}} – {{asset_name}}',
        body: `Dear {{employee_name}},

The following item has been assigned to you on {{date}}:

${ASSET_BLOCK}

Please look after it and keep it secure. It remains the property of {{org_name}} and must be returned to IT Support when requested or when you leave.

If any of these details are wrong, or the item is lost or damaged, reply to this email straight away.

${SIGN_OFF}`
    },
    asset_returned: {
        name: 'Asset returned',
        description: 'Confirmation sent to a member of staff when IT books an item back in from them.',
        placeholders: ASSET_PLACEHOLDERS,
        subject: 'Asset returned: {{asset_number}} – {{asset_name}}',
        body: `Dear {{employee_name}},

This confirms that IT Support received the following item back from you on {{date}}:

${ASSET_BLOCK}
Condition on return: {{condition}}

It is no longer recorded against your name. Thank you.

${SIGN_OFF}`
    },
    asset_handed_over: {
        name: 'Asset reassigned (previous holder)',
        description: 'Sent to the previous holder when an item is reassigned from them to someone else.',
        placeholders: ASSET_PLACEHOLDERS,
        subject: 'Asset no longer assigned to you: {{asset_number}} – {{asset_name}}',
        body: `Dear {{employee_name}},

The following item was reassigned from you to {{new_holder}} on {{date}} and is no longer recorded against your name:

${ASSET_BLOCK}

If you still have this item, please reply to this email.

${SIGN_OFF}`
    },
    asset_return_request: {
        name: 'Return request',
        description: 'Sent on demand to ask a member of staff to bring an item back.',
        placeholders: ASSET_PLACEHOLDERS,
        subject: 'Please return: {{asset_number}} – {{asset_name}}',
        body: `Dear {{employee_name}},

Please return the following item to IT Support at your earliest convenience:

${ASSET_BLOCK}

If you no longer have it, reply to this email so we can update our records.

${SIGN_OFF}`
    },
    asset_maintenance: {
        name: 'Maintenance required',
        description: 'Sent on demand when an assigned item needs to come in for maintenance.',
        placeholders: ASSET_PLACEHOLDERS,
        subject: 'Maintenance required: {{asset_number}} – {{asset_name}}',
        body: `Dear {{employee_name}},

The following item assigned to you is due for maintenance:

${ASSET_BLOCK}

Please contact IT Support to arrange a convenient time to bring it in.

${SIGN_OFF}`
    },
    library_overdue: {
        name: 'Library overdue reminder',
        description: 'Sent from the Issue Desk to a borrower with overdue books.',
        placeholders: LIBRARY_PLACEHOLDERS,
        subject: 'Overdue library book reminder',
        body: `Dear {{borrower_name}},

Our records show the following library item(s) issued to you are now overdue:

{{items}}

Please return them to the library at your earliest convenience. If you have already returned them, kindly ignore this message.

Kind regards,
Library
{{org_name}}`
    }
};

const PLACEHOLDER_RE = /\{\{\s*([a-z_]+)\s*\}\}/g;

function templateKeys() {
    return Object.keys(DEFAULT_TEMPLATES);
}

function getTemplate(key) {
    const base = DEFAULT_TEMPLATES[key];
    if (!base) return null;
    const custom = db.prepare('SELECT subject, body, updated_at FROM email_templates WHERE key = ?').get(key);
    return {
        key,
        name: base.name,
        description: base.description,
        placeholders: base.placeholders,
        subject: custom ? custom.subject : base.subject,
        body: custom ? custom.body : base.body,
        customised: Boolean(custom),
        updated_at: custom ? custom.updated_at : null
    };
}

function listTemplates() {
    return templateKeys().map(getTemplate);
}

function saveTemplate(key, { subject, body }, userId) {
    const base = DEFAULT_TEMPLATES[key];
    if (!base) throw new Error('Unknown template');
    const cleanSubject = String(subject || '').replace(/[\r\n]+/g, ' ').trim();
    const cleanBody = String(body || '').replace(/\r\n/g, '\n').trim();
    if (!cleanSubject) throw new Error('The subject cannot be empty');
    if (!cleanBody) throw new Error('The message cannot be empty');

    // A mistyped placeholder would otherwise go out to staff as blank text.
    const unknown = new Set();
    for (const text of [cleanSubject, cleanBody]) {
        for (const match of text.matchAll(PLACEHOLDER_RE)) {
            if (!base.placeholders.includes(match[1])) unknown.add(`{{${match[1]}}}`);
        }
    }
    if (unknown.size) {
        throw new Error(`Unknown placeholder${unknown.size > 1 ? 's' : ''}: ${[...unknown].join(', ')}`);
    }

    db.prepare(`
      INSERT INTO email_templates (key, subject, body, updated_at, updated_by)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP, ?)
      ON CONFLICT(key) DO UPDATE SET
        subject = excluded.subject, body = excluded.body,
        updated_at = excluded.updated_at, updated_by = excluded.updated_by
    `).run(key, cleanSubject, cleanBody, userId || null);
    return getTemplate(key);
}

function resetTemplate(key) {
    if (!DEFAULT_TEMPLATES[key]) throw new Error('Unknown template');
    db.prepare('DELETE FROM email_templates WHERE key = ?').run(key);
    return getTemplate(key);
}

function fill(text, context) {
    return String(text || '').replace(PLACEHOLDER_RE, (match, name) => {
        const value = context[name];
        return value === undefined || value === null ? '' : String(value);
    });
}

function render(key, context) {
    const template = getTemplate(key);
    if (!template) throw new Error('Unknown template');
    return {
        subject: fill(template.subject, context).replace(/\s+/g, ' ').trim(),
        // Lines made only of an empty optional value ("Brand / model:  ") read
        // badly, so tidy doubled spaces left behind by blank placeholders.
        body: fill(template.body, context).replace(/[ \t]{2,}/g, ' ').replace(/[ \t]+\n/g, '\n')
    };
}

// Render unsaved subject/body text with sample values, for the editor's
// live preview.
function preview(key, { subject, body }) {
    if (!DEFAULT_TEMPLATES[key]) throw new Error('Unknown template');
    const context = sampleContext(key);
    return {
        subject: fill(subject, context).replace(/\s+/g, ' ').trim(),
        body: fill(body, context).replace(/[ \t]{2,}/g, ' ').replace(/[ \t]+\n/g, '\n')
    };
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// Templates are edited as plain text; send them as simple HTML so line
// breaks survive every mail client and links are clickable.
function toHtml(text) {
    const html = escapeHtml(text)
        .replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?)])/g, '<a href="$1">$1</a>')
        .replace(/\n/g, '<br>\n');
    return `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;line-height:1.5;color:#222">${html}</div>`;
}

function today() {
    return new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

function commonContext(user) {
    const settings = getSettings();
    return {
        date: today(),
        sent_by: user ? (user.name || user.email || '') : '',
        org_name: settings.org_name,
        support_email: settings.mail_from
    };
}

/** Placeholder values for the asset templates. */
function assetContext(asset, { employee, previousHolder, newHolder, quantity, condition, notes, user } = {}) {
    const category = asset.category_name !== undefined
        ? asset.category_name
        : (db.prepare('SELECT name FROM categories WHERE id = ?').get(asset.category_id) || {}).name;
    return {
        ...commonContext(user),
        employee_name: employee ? employee.name : '',
        employee_email: employee ? employee.email : '',
        department: employee ? (employee.department || '') : '',
        asset_number: asset.asset_number,
        asset_name: asset.name,
        category: category || '',
        brand: asset.brand || '',
        model: asset.model || '',
        serial_number: asset.serial_number || 'N/A',
        campus: asset.campus || 'N/A',
        location: asset.location || '',
        quantity: quantity || 1,
        previous_holder: previousHolder || '',
        new_holder: newHolder || '',
        condition: (condition || 'good').replace('_', ' '),
        notes: notes || '',
        asset_url: appBaseUrl ? `${appBaseUrl}/s/${encodeURIComponent(asset.asset_number)}` : ''
    };
}

function libraryContext({ borrowerName, items, user }) {
    return { ...commonContext(user), borrower_name: borrowerName || '', items: items || '' };
}

// Realistic values for previewing a template in the editor.
function sampleContext(key) {
    if (key === 'library_overdue') {
        return libraryContext({
            borrowerName: 'Alex Morgan',
            items: '- "Business Essentials" (LIB-2026-0042) — due 3 November 2026\n- "Networking Fundamentals" (LIB-2026-0107) — due 5 November 2026'
        });
    }
    return {
        ...commonContext(null),
        sent_by: 'IT Support',
        employee_name: 'Alex Morgan',
        employee_email: 'alex.morgan@example.ac.uk',
        department: 'Business School',
        asset_number: 'AST-2026-0123',
        asset_name: 'HP EliteBook 840 G10',
        category: 'Laptop',
        brand: 'HP',
        model: 'EliteBook 840 G10',
        serial_number: '5CG3412XYZ',
        campus: 'Towerhill',
        location: 'Room 204',
        quantity: 1,
        previous_holder: 'Sam Patel',
        new_holder: 'Sam Patel',
        condition: 'good',
        notes: '',
        asset_url: `${appBaseUrl || 'https://stock.example.ac.uk'}/s/AST-2026-0123`
    };
}

function mailStatus() {
    const settings = getSettings();
    const problems = [];
    if (!entra.configured) problems.push('Microsoft 365 app credentials are not set on the server');
    if (!settings.mail_from) problems.push('No sending mailbox has been chosen');
    return { configured: problems.length === 0, from: settings.mail_from, cc: settings.mail_cc, problems };
}

function logEmail({ templateKey, to, cc, subject, status, error, entity, user }) {
    try {
        db.prepare(`
          INSERT INTO email_log (template_key, to_email, cc_email, subject, status, error, entity_type, entity_id, user_id, user_email)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(templateKey || null, to, cc || null, subject || null, status, error || null,
            entity ? entity.type : null, entity ? entity.id : null, user ? user.id : null, user ? user.email : null);
    } catch (err) {
        console.error('email log failed:', err.message);
    }
}

const recipients = (value) => String(value || '')
    .split(/[,;]/)
    .map((v) => v.trim())
    .filter((v) => EMAIL_RE.test(v))
    .map((address) => ({ emailAddress: { address } }));

/**
 * Send one message. Never throws: resolves with
 *   { status: 'sent' | 'failed' | 'not_configured' | 'no_recipient', to, error? }
 * so callers can report the outcome without failing the action that
 * triggered the email.
 */
async function sendMail({ to, subject, body, templateKey, entity, user }) {
    const status = mailStatus();
    if (!status.configured) {
        return { status: 'not_configured', to, error: status.problems.join('; ') };
    }
    if (!to || !EMAIL_RE.test(String(to).trim())) {
        return { status: 'no_recipient', to: to || '', error: 'No valid email address on record' };
    }
    const toAddress = String(to).trim();
    // Don't copy the CC mailbox on a message already addressed to it.
    const cc = recipients(status.cc).filter((r) => r.emailAddress.address.toLowerCase() !== toAddress.toLowerCase());

    try {
        await graph('POST', `/users/${encodeURIComponent(status.from)}/sendMail`, {
            body: {
                message: {
                    subject,
                    body: { contentType: 'HTML', content: toHtml(body) },
                    toRecipients: [{ emailAddress: { address: toAddress } }],
                    ...(cc.length ? { ccRecipients: cc } : {})
                }
            }
        });
        logEmail({ templateKey, to: toAddress, cc: status.cc, subject, status: 'sent', entity, user });
        return { status: 'sent', to: toAddress };
    } catch (err) {
        const message = explainGraphError(err, 'Mail.Send');
        logEmail({ templateKey, to: toAddress, cc: status.cc, subject, status: 'failed', error: message, entity, user });
        return { status: 'failed', to: toAddress, error: message };
    }
}

/** Render a template with `context` and send it. Same result shape as sendMail. */
async function sendTemplate(key, { to, context, entity, user }) {
    const { subject, body } = render(key, context);
    return sendMail({ to, subject, body, templateKey: key, entity, user });
}

module.exports = {
    listTemplates,
    getTemplate,
    saveTemplate,
    resetTemplate,
    render,
    preview,
    assetContext,
    libraryContext,
    sampleContext,
    mailStatus,
    sendMail,
    sendTemplate,
    templateKeys
};
