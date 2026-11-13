const express = require('express');
const router = express.Router();
const db = require('../database');
const config = require('../config');
const { usingDefaultSecret } = require('../utils/token');
const { logActivity } = require('../utils/activity');
const { getSettings, saveSettings, EMAIL_RE } = require('../services/appSettings');
const mailer = require('../services/mailer');
const sharepoint = require('../services/sharepoint');
const sso = require('../services/sso');
const { ssoEnabled, passwordLoginEnabled } = require('./auth');

function requireAdmin(req, res, next) {
    if (!req.user || req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Only administrators can change settings' });
    }
    next();
}

// What every signed-in user's screens need to know (no secrets, no admin detail)
router.get('/public', (req, res) => {
    const settings = getSettings();
    const mail = mailer.mailStatus();
    res.json({
        app_base_url: config.appBaseUrl,
        org_name: settings.org_name,
        mail: {
            configured: mail.configured,
            from: mail.from,
            on_assign: settings.mail_on_assign,
            on_return: settings.mail_on_return
        }
    });
});

router.use(requireAdmin);

// Integration status for the Settings page. Reports which pieces are in place
// — never the credential values themselves.
router.get('/integrations', (req, res) => {
    const missing = [];
    if (!config.entra.tenantId) missing.push('ENTRA_TENANT_ID');
    if (!config.entra.clientId) missing.push('ENTRA_CLIENT_ID');
    if (!config.entra.clientSecret) missing.push('ENTRA_CLIENT_SECRET');

    const ssoProblems = [];
    if (missing.length) ssoProblems.push(`Missing on the server: ${missing.join(', ')}`);
    if (!config.appBaseUrl) ssoProblems.push('APP_BASE_URL is not set (the public address of this system)');
    if (usingDefaultSecret) ssoProblems.push('AUTH_SECRET is not set — sessions use the public default secret');

    res.json({
        settings: getSettings(),
        microsoft: { configured: config.entra.configured, missing },
        auth_secret_default: usingDefaultSecret,
        app_base_url: config.appBaseUrl,
        sso: {
            enabled: ssoEnabled,
            password_login: passwordLoginEnabled,
            redirect_uri: config.appBaseUrl ? sso.redirectUri() : '',
            problems: ssoEnabled ? [] : ssoProblems
        },
        mail: mailer.mailStatus(),
        sharepoint: sharepoint.getStatus()
    });
});

router.put('/integrations', (req, res) => {
    try {
        const before = getSettings();
        const settings = saveSettings(req.body || {});
        if (before.sharepoint_site !== settings.sharepoint_site || before.sharepoint_list !== settings.sharepoint_list) {
            sharepoint.resetTarget();
        }
        logActivity(req, { action: 'settings_updated', entity_type: 'settings', description: 'Updated integration settings' });
        res.json({ settings });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// ---------------------------------------------------------------------------
// Email templates
// ---------------------------------------------------------------------------
router.get('/email-templates', (req, res) => {
    res.json(mailer.listTemplates());
});

router.put('/email-templates/:key', (req, res) => {
    try {
        const template = mailer.saveTemplate(req.params.key, req.body || {}, req.user.id);
        logActivity(req, {
            action: 'email_template_updated', entity_type: 'settings',
            description: `Edited the "${template.name}" email template`
        });
        res.json(template);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

router.post('/email-templates/:key/reset', (req, res) => {
    try {
        const template = mailer.resetTemplate(req.params.key);
        logActivity(req, {
            action: 'email_template_updated', entity_type: 'settings',
            description: `Reset the "${template.name}" email template to the default wording`
        });
        res.json(template);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

router.post('/email-templates/:key/preview', (req, res) => {
    try {
        res.json(mailer.preview(req.params.key, req.body || {}));
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// Send a template (filled with sample details) to check delivery and wording
router.post('/email-test', async (req, res) => {
    try {
        const to = String(req.body?.to || req.user.email || '').trim();
        if (!EMAIL_RE.test(to)) {
            return res.status(400).json({ error: 'Enter a valid email address to send the test to' });
        }
        const key = req.body?.template || 'asset_assigned';
        if (!mailer.getTemplate(key)) {
            return res.status(400).json({ error: 'Unknown template' });
        }
        const { subject, body } = req.body?.subject !== undefined
            ? mailer.preview(key, { subject: req.body.subject, body: req.body.body })
            : mailer.render(key, mailer.sampleContext(key));
        const result = await mailer.sendMail({
            to, subject: `[TEST] ${subject}`, body, templateKey: key, user: req.user
        });
        res.json(result);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

router.get('/email-log', (req, res) => {
    const limit = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 100));
    const rows = db.prepare(`
      SELECT id, template_key, to_email, cc_email, subject, status, error, entity_type, entity_id, user_email, created_at
      FROM email_log ORDER BY id DESC LIMIT ?
    `).all(limit);
    res.json(rows);
});

// ---------------------------------------------------------------------------
// SharePoint sync
// ---------------------------------------------------------------------------
router.post('/sharepoint/test', async (req, res) => {
    res.json({ ...(await sharepoint.testConnection()), status: sharepoint.getStatus() });
});

router.post('/sharepoint/sync-all', async (req, res) => {
    if (!sharepoint.isEnabled()) {
        return res.status(400).json({ error: 'SharePoint sync is not switched on' });
    }
    const queued = sharepoint.enqueueAll();
    logActivity(req, { action: 'sharepoint_sync', entity_type: 'settings', description: `Queued ${queued} asset(s) for SharePoint` });
    // Start straight away rather than waiting for the next timer tick.
    sharepoint.processOutbox().catch((err) => console.error('sharepoint sync failed:', err.message));
    res.json({ queued, status: sharepoint.getStatus() });
});

router.post('/sharepoint/retry-failed', (req, res) => {
    const retried = sharepoint.retryFailed();
    sharepoint.resetTarget();
    sharepoint.processOutbox().catch((err) => console.error('sharepoint sync failed:', err.message));
    res.json({ retried, status: sharepoint.getStatus() });
});

module.exports = router;
