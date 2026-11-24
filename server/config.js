const fs = require('fs');
const path = require('path');

// Optional .env file in the project root, so integration settings survive pm2
// restarts without exporting them in the shell each time. Real environment
// variables always win. The file is gitignored — the repository is public.
const ENV_FILE = process.env.ENV_FILE || path.join(__dirname, '..', '.env');
if (typeof process.loadEnvFile === 'function' && fs.existsSync(ENV_FILE)) {
    try {
        process.loadEnvFile(ENV_FILE);
    } catch (err) {
        console.error(`Could not read ${ENV_FILE}: ${err.message}`);
    }
}

const trim = (value) => (value || '').trim();
const stripSlash = (value) => trim(value).replace(/\/+$/, '');

// Microsoft Entra ID app registration, shared by single sign-on, outgoing
// email and the SharePoint sync. Secrets are only ever read from the
// environment; nothing here is stored in the database.
const entra = {
    tenantId: trim(process.env.ENTRA_TENANT_ID),
    clientId: trim(process.env.ENTRA_CLIENT_ID),
    clientSecret: trim(process.env.ENTRA_CLIENT_SECRET),
    // Overridable for sovereign clouds (and for the test suite's mock server).
    authorityHost: stripSlash(process.env.ENTRA_AUTHORITY_HOST) || 'https://login.microsoftonline.com',
    graphBaseUrl: stripSlash(process.env.GRAPH_BASE_URL) || 'https://graph.microsoft.com/v1.0',
    graphScope: trim(process.env.GRAPH_SCOPE) || 'https://graph.microsoft.com/.default'
};
entra.configured = Boolean(entra.tenantId && entra.clientId && entra.clientSecret);

// Public address of the app, e.g. https://stock.example.ac.uk — used for the
// SSO redirect URI and for the links encoded in printed QR stickers.
const appBaseUrl = stripSlash(process.env.APP_BASE_URL);

module.exports = {
    entra,
    appBaseUrl,
    sso: {
        enabled: entra.configured && Boolean(appBaseUrl) && trim(process.env.SSO_ENABLED).toLowerCase() !== 'false',
        // Once Microsoft sign-in works it is the only way in. This lets
        // passwords back in as well: an emergency measure, set from the
        // server's shell, for when Microsoft sign-in itself is broken.
        allowPasswordLogin: trim(process.env.ALLOW_PASSWORD_LOGIN).toLowerCase() === 'true'
    },
    // Defaults for the settings an administrator can change from the Settings
    // page (stored in the settings table once edited there).
    defaults: {
        mailFrom: trim(process.env.MAIL_FROM),
        mailCc: trim(process.env.MAIL_CC),
        sharepointSite: trim(process.env.SHAREPOINT_SITE_URL),
        sharepointList: trim(process.env.SHAREPOINT_LIST_NAME) || 'IT Asset Register'
    }
};
