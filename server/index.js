// Must come first: loads the optional .env file before anything reads it.
require('./config');
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const db = require('./database');
const sharepoint = require('./services/sharepoint');
const { router: authRouter, getUserFromToken, getPersonFromToken, licenseStatus } = require('./routes/auth');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});
app.use(express.json());

// Auth & license routes
app.use('/api/auth', authRouter);

// "My assets": the one part of the API open to every member of staff, so it
// sits in front of the gate below and checks the licence and the person
// itself. Everything it returns is limited to the person signed in.
app.use('/api/my', (req, res, next) => {
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    const license = licenseStatus();
    if (license.expired) {
        return res.status(403).json({ error: 'License expired or not activated' });
    }
    const person = getPersonFromToken(req);
    if (!person) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    req.person = person;
    // For the audit trail: staff have no user id, only their email.
    req.user = person.user || { id: null, name: person.employee.name, email: person.employee.email, role: 'staff' };
    next();
}, require('./routes/my'));

// License and auth gate for all other API routes
app.use((req, res, next) => {
    if (!req.path.startsWith('/api/')) {
        return next();
    }

    // Allow CORS preflight without auth/license
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }

    // Skip gate for auth endpoints (handled above)
    if (req.path.startsWith('/api/auth')) {
        return next();
    }

    const license = licenseStatus();
    if (license.expired) {
        return res.status(403).json({ error: 'License expired or not activated', license });
    }

    const user = getUserFromToken(req);
    if (!user) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    req.user = user;
    next();
});

// API Routes
app.use('/api/assets', require('./routes/assets'));
app.use('/api/employees', require('./routes/employees'));
app.use('/api/categories', require('./routes/categories'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api/books', require('./routes/books'));
app.use('/api/borrowers', require('./routes/borrowers'));
app.use('/api/users', require('./routes/users'));
app.use('/api/activity', require('./routes/activity'));
app.use('/api/inventory', require('./routes/inventory'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/mail', require('./routes/mail'));
app.use('/api/staff-reports', require('./routes/staffReports'));

// Deleted assets stay in the recycle bin for good. Nothing is purged
// automatically: an asset's history, past holders and documents are part of
// the audit record and must outlive the asset being taken off the register.

// Nightly database backup: one snapshot per day kept for 14 days.
// Uses better-sqlite3's online backup API, which is safe while the app runs.
// Keep the path logic in sync with server/database.js.
const DB_FILE = process.env.DB_PATH || path.join(__dirname, 'stock-management.db');
const BACKUP_DIR = path.join(path.dirname(DB_FILE), 'backups');
const BACKUP_RETENTION_DAYS = 14;

async function runDailyBackup() {
    try {
        fs.mkdirSync(BACKUP_DIR, { recursive: true });
        const stamp = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
        const target = path.join(BACKUP_DIR, `stock-management-${stamp}.db`);

        if (!fs.existsSync(target)) {
            await db.backup(target);
            console.log(`Database backed up to ${target}`);
        }

        // Prune backups older than the retention window.
        const cutoff = Date.now() - BACKUP_RETENTION_DAYS * 24 * 60 * 60 * 1000;
        for (const file of fs.readdirSync(BACKUP_DIR)) {
            if (!/^stock-management-\d{4}-\d{2}-\d{2}\.db$/.test(file)) continue;
            const full = path.join(BACKUP_DIR, file);
            if (fs.statSync(full).mtimeMs < cutoff) {
                fs.unlinkSync(full);
                console.log(`Pruned old backup ${file}`);
            }
        }
    } catch (err) {
        console.error('Daily backup failed', err);
    }
}

runDailyBackup();
setInterval(runDailyBackup, 24 * 60 * 60 * 1000);

// Push queued asset changes to SharePoint (no-op until it is switched on).
sharepoint.startWorker();

// Serve static files in production
if (process.env.NODE_ENV === 'production') {
    app.use(express.static(path.join(__dirname, '../dist')));

    // SPA catch-all. Express 5 (path-to-regexp v8) no longer accepts a bare '*'
    // string wildcard, so use a RegExp to serve index.html for all non-API paths.
    app.get(/.*/, (req, res) => {
        res.sendFile(path.join(__dirname, '../dist/index.html'));
    });
}

// Express 5 reports a failed listen (e.g. the port is already taken) to this
// callback instead of throwing. Exit so a second copy can never sit alive
// without the port, quietly running the nightly backup job against the
// live database.
app.listen(PORT, (error) => {
    if (error) {
        console.error(`Could not listen on port ${PORT}: ${error.message}`);
        process.exit(1);
    }
    console.log(`Server running on port ${PORT}`);
    console.log(`API available at http://localhost:${PORT}/api`);
});
