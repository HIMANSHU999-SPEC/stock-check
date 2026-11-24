const db = require('../database');
const { defaults } = require('../config');

// Non-secret integration settings an administrator can change from the
// Settings page. Environment variables provide the starting values; anything
// saved in the app overrides them. Credentials are never stored here.
const SETTINGS_KEY = 'integrations';

const FIELDS = {
    org_name: { type: 'string', fallback: () => 'London Academy for Applied Technology' },
    mail_from: { type: 'email', fallback: () => defaults.mailFrom },
    mail_cc: { type: 'emails', fallback: () => defaults.mailCc },
    // Where staff reports about their own assets are sent. Empty means the
    // sending mailbox itself.
    support_email: { type: 'email', fallback: () => '' },
    // Who is told when someone who has left still holds equipment.
    leaver_alert_to: { type: 'emails', fallback: () => '' },
    // Whether items marked lost, stolen or retired still count in Total
    // Assets and Total Value. Sold items never do.
    count_written_off: { type: 'boolean', fallback: () => true },
    mail_on_assign: { type: 'boolean', fallback: () => true },
    mail_on_return: { type: 'boolean', fallback: () => true },
    sharepoint_enabled: { type: 'boolean', fallback: () => Boolean(defaults.sharepointSite) },
    sharepoint_site: { type: 'string', fallback: () => defaults.sharepointSite },
    sharepoint_list: { type: 'string', fallback: () => defaults.sharepointList }
};

const EMAIL_RE = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;

function readStored() {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(SETTINGS_KEY);
    if (!row) return {};
    try {
        return JSON.parse(row.value) || {};
    } catch (err) {
        return {};
    }
}

function getSettings() {
    const stored = readStored();
    const result = {};
    for (const [key, field] of Object.entries(FIELDS)) {
        result[key] = stored[key] !== undefined ? stored[key] : field.fallback();
    }
    return result;
}

// Validate and persist a partial update. Throws an Error with a message fit
// to show the user when a value is not acceptable.
function saveSettings(changes) {
    const stored = readStored();
    for (const [key, field] of Object.entries(FIELDS)) {
        if (changes[key] === undefined) continue;
        let value = changes[key];
        if (field.type === 'boolean') {
            value = Boolean(value);
        } else {
            value = String(value || '').trim();
            // A blanked organisation name would leave gaps in every email
            // ("the property of  and must be returned").
            if (key === 'org_name' && !value) value = field.fallback();
            if (field.type === 'email' && value && !EMAIL_RE.test(value)) {
                throw new Error(`"${value}" is not a valid email address`);
            }
            if (field.type === 'emails') {
                const list = value.split(/[,;]/).map((v) => v.trim()).filter(Boolean);
                const bad = list.find((v) => !EMAIL_RE.test(v));
                if (bad) throw new Error(`"${bad}" is not a valid email address`);
                value = list.join(', ');
            }
        }
        stored[key] = value;
    }
    db.prepare('REPLACE INTO settings (key, value) VALUES (?, ?)').run(SETTINGS_KEY, JSON.stringify(stored));
    return getSettings();
}

module.exports = { getSettings, saveSettings, EMAIL_RE };
