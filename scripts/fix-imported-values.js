#!/usr/bin/env node
/*
 * Find, and optionally put right, values that earlier Excel imports stored
 * wrongly:
 *
 *   - purchase dates held as an Excel day count (46037) or typed text
 *     (01/09/2025) instead of 2025-09-01
 *   - serial numbers, models and locations that were typed as numbers and
 *     gained ".0" (123456789012.0)
 *   - purchase prices stored as text ("£749.00")
 *   - book ISBNs with ".0" on the end
 *
 * Run from the project directory on the server:
 *
 *   node scripts/fix-imported-values.js            # report only, changes nothing
 *   node scripts/fix-imported-values.js --apply    # back up, then make the changes
 *
 * Without --apply the database is opened read-only. With it, a backup is
 * written to server/backups first, every change is made in one transaction,
 * and each asset's history records what was corrected. Run the report, read
 * it, then decide.
 */
const path = require('path');
const fs = require('fs');

// Picks up DB_PATH from the project's .env, exactly as the server does.
require('../server/config');
const Database = require('better-sqlite3');
const cells = require('../server/utils/importValues');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'server', 'stock-management.db');
const APPLY = process.argv.includes('--apply');
const BY = 'import clean-up script';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const TRAILING_ZERO = /^(\d+)\.0$/;

function findChanges(db) {
    const changes = [];
    const unreadable = [];
    const assets = db.prepare(`
      SELECT id, asset_number, name, serial_number, model, location, purchase_date, purchase_price,
             typeof(purchase_price) AS price_type
      FROM assets ORDER BY id
    `).all();

    for (const asset of assets) {
        const change = (column, label, before, after) =>
            changes.push({ table: 'assets', id: asset.id, ref: asset.asset_number, name: asset.name, column, label, before, after });

        // A value typed as a number picked up ".0" on its way into a text column.
        for (const [column, label, minDigits] of [['serial_number', 'serial number', 1], ['model', 'model', 3], ['location', 'location', 2]]) {
            const match = String(asset[column] ?? '').match(TRAILING_ZERO);
            if (match && match[1].length >= minDigits) change(column, label, asset[column], match[1]);
        }

        const stored = asset.purchase_date;
        if (stored !== null && stored !== '' && !ISO_DATE.test(String(stored))) {
            const numeric = typeof stored === 'number' || /^\d+(\.\d+)?$/.test(String(stored).trim());
            const read = cells.date(numeric ? Number(stored) : String(stored));
            if (read.ok && read.date) change('purchase_date', 'purchase date', stored, read.date);
            else unreadable.push({ ref: asset.asset_number, name: asset.name, value: stored });
        }

        if (asset.price_type === 'text' && String(asset.purchase_price).trim() !== '') {
            const amount = cells.money(asset.purchase_price);
            if (amount !== null) change('purchase_price', 'purchase price', asset.purchase_price, amount);
        }
    }

    const hasBooks = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'books'").get();
    if (hasBooks) {
        for (const book of db.prepare('SELECT id, book_number, title, isbn FROM books ORDER BY id').all()) {
            const match = String(book.isbn ?? '').match(TRAILING_ZERO);
            if (!match) continue;
            // Nine digits is a ten-digit ISBN whose leading zero Excel dropped.
            const fixed = match[1].length === 9 ? `0${match[1]}` : match[1];
            changes.push({ table: 'books', id: book.id, ref: book.book_number, name: book.title, column: 'isbn', label: 'ISBN', before: book.isbn, after: fixed });
        }
    }
    return { changes, unreadable };
}

function report({ changes, unreadable }) {
    if (changes.length === 0) {
        console.log('Nothing to correct.');
    } else {
        const byLabel = {};
        for (const c of changes) byLabel[c.label] = (byLabel[c.label] || 0) + 1;
        console.log(`${changes.length} value${changes.length === 1 ? '' : 's'} to correct: ${Object.entries(byLabel).map(([k, n]) => `${n} ${k}`).join(', ')}\n`);
        for (const c of changes) {
            console.log(`  ${String(c.ref).padEnd(15)} ${String(c.label).padEnd(15)} ${JSON.stringify(c.before)}  ->  ${JSON.stringify(c.after)}    (${String(c.name).slice(0, 40)})`);
        }
    }
    if (unreadable.length) {
        console.log(`\n${unreadable.length} purchase date${unreadable.length === 1 ? '' : 's'} could not be read and will be left as ${unreadable.length === 1 ? 'it is' : 'they are'}:`);
        for (const u of unreadable) console.log(`  ${String(u.ref).padEnd(15)} ${JSON.stringify(u.value)}    (${String(u.name).slice(0, 40)})`);
    }
    if (changes.some((c) => c.column === 'purchase_date' && typeof c.before === 'string' && /[/.]/.test(c.before))) {
        console.log('\nNote: dates such as 01/09/2025 are read day first (1 September), as written in the UK.');
    }
}

async function main() {
    if (!fs.existsSync(DB_PATH)) {
        console.error(`No database at ${DB_PATH}`);
        process.exit(1);
    }
    const db = new Database(DB_PATH, { readonly: !APPLY, fileMustExist: true });
    const found = findChanges(db);
    console.log(`Database: ${DB_PATH}\n`);
    report(found);

    if (!APPLY) {
        console.log('\nReport only: nothing was changed. Run again with --apply to make these corrections.');
        db.close();
        return;
    }
    if (found.changes.length === 0) {
        db.close();
        return;
    }

    const backupDir = path.join(path.dirname(DB_PATH), 'backups');
    fs.mkdirSync(backupDir, { recursive: true });
    const backup = path.join(backupDir, `stock-management-before-import-cleanup-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
    await db.backup(backup);
    console.log(`\nBackup written to ${backup}`);

    const historyColumns = db.prepare("PRAGMA table_info('asset_history')").all().map((col) => col.name);
    const addHistory = historyColumns.includes('performed_by')
        ? db.prepare("INSERT INTO asset_history (asset_id, action, notes, performed_by) VALUES (?, 'updated', ?, ?)")
        : null;

    db.transaction(() => {
        for (const c of found.changes) {
            // Table and column names come from the fixed lists above, never from data.
            const done = db.prepare(`UPDATE ${c.table} SET ${c.column} = ? WHERE id = ? AND ${c.column} IS ?`).run(c.after, c.id, c.before);
            if (done.changes !== 1) throw new Error(`${c.ref}: ${c.label} changed while the script was running; nothing was applied`);
            if (c.table === 'assets' && addHistory) {
                addHistory.run(c.id, `Corrected ${c.label} left by an Excel import: ${c.before} → ${c.after}`, BY);
            }
        }
    })();
    console.log(`Corrected ${found.changes.length} value${found.changes.length === 1 ? '' : 's'}. Each asset's history shows what changed.`);
    console.log('If the SharePoint list is in use, press "Sync everything now" in Settings to carry the corrections over.');
    db.close();
}

main().catch((error) => {
    console.error(`Failed: ${error.message}`);
    process.exit(1);
});
