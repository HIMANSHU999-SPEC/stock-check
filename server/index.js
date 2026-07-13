const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const db = require('./database');
const { router: authRouter, getUserFromToken, licenseStatus } = require('./routes/auth');

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

// Daily purge for recycle bin (assets older than 90 days)
function purgeRecycleBin() {
    try {
        const expired = db.prepare(`
      SELECT id, entity_id FROM recycle_bin
      WHERE entity_type = 'asset' AND can_restore_until <= datetime('now','localtime')
    `).all();

        const deleteHistoryStmt = db.prepare('DELETE FROM asset_history WHERE asset_id = ?');
        const deleteAssetStmt = db.prepare('DELETE FROM assets WHERE id = ?');
        const deleteBinStmt = db.prepare('DELETE FROM recycle_bin WHERE id = ?');

        db.transaction(() => {
            expired.forEach((item) => {
                deleteHistoryStmt.run(item.entity_id);
                deleteAssetStmt.run(item.entity_id);
                deleteBinStmt.run(item.id);
            });
        })();

        if (expired.length > 0) {
            console.log(`Purged ${expired.length} expired recycle bin item(s)`);
        }
    } catch (err) {
        console.error('Recycle bin purge failed', err);
    }
}

purgeRecycleBin();
setInterval(purgeRecycleBin, 24 * 60 * 60 * 1000);

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

// Serve static files in production
if (process.env.NODE_ENV === 'production') {
    app.use(express.static(path.join(__dirname, '../dist')));

    // SPA catch-all. Express 5 (path-to-regexp v8) no longer accepts a bare '*'
    // string wildcard, so use a RegExp to serve index.html for all non-API paths.
    app.get(/.*/, (req, res) => {
        res.sendFile(path.join(__dirname, '../dist/index.html'));
    });
}

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`API available at http://localhost:${PORT}/api`);
});
