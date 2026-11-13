#!/usr/bin/env node
/*
 * Show or set the application licence. This is the ONLY way to change it:
 * the web app has no activation screen and no activation endpoint, so the
 * licence can only be changed by someone with shell access to the server.
 *
 * Run from the project directory on the server:
 *
 *   node scripts/set-licence.js               # show the current licence
 *   node scripts/set-licence.js 2027-11-11    # valid to the end of that day (UTC)
 *
 * The change takes effect immediately; no restart is needed. Only the
 * "license" row in the settings table is touched.
 */
const path = require('path');

// Picks up DB_PATH from the project's .env, exactly as the server does.
require('../server/config');
const Database = require('better-sqlite3');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'server', 'stock-management.db');

function describe(license) {
    if (!license || !license.expires_at) return 'not activated';
    const until = new Date(license.expires_at);
    const state = Date.now() > license.expires_at ? 'EXPIRED' : 'valid';
    return `${license.status || 'unknown'}, ${state}, until ${until.toISOString().slice(0, 10)}`;
}

function main() {
    const arg = process.argv[2];
    const db = new Database(DB_PATH, { fileMustExist: true });
    try {
        const row = db.prepare("SELECT value FROM settings WHERE key = 'license'").get();
        let current = null;
        try { current = row ? JSON.parse(row.value) : null; } catch (e) { current = null; }

        if (!arg) {
            console.log(`Licence: ${describe(current)}`);
            console.log('To change it: node scripts/set-licence.js YYYY-MM-DD');
            return;
        }

        if (!/^\d{4}-\d{2}-\d{2}$/.test(arg)) {
            throw new Error('Give the last valid day as YYYY-MM-DD, for example 2027-11-11');
        }
        const expiresAt = Date.parse(`${arg}T23:59:59.999Z`);
        // Reject impossible dates such as 2027-02-31, which Date would roll over.
        if (!Number.isFinite(expiresAt) || new Date(expiresAt).toISOString().slice(0, 10) !== arg) {
            throw new Error(`"${arg}" is not a real date`);
        }

        const next = {
            status: 'active',
            activated_at: (current && current.activated_at) || Date.now(),
            expires_at: expiresAt
        };
        db.prepare("INSERT INTO settings (key, value) VALUES ('license', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
            .run(JSON.stringify(next));

        console.log(`Was: ${describe(current)}`);
        console.log(`Now: ${describe(next)}`);
        if (Date.now() > expiresAt) console.log('Note: that date is in the past, so the app is now locked.');
    } finally {
        db.close();
    }
}

try {
    main();
} catch (err) {
    console.error(`Could not update the licence: ${err.message}`);
    process.exit(1);
}
