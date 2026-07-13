const express = require('express');
const router = express.Router();
const db = require('../database');
const { generateBookNumber } = require('../utils/bookNumber');
const { logActivity } = require('../utils/activity');

function toCsv(rows) {
    if (!rows || rows.length === 0) return '';
    const headers = Object.keys(rows[0]);
    const escape = (value) => {
        const str = value === null || value === undefined ? '' : String(value);
        if (str.includes('"') || str.includes(',') || str.includes('\n')) {
            return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
    };
    const lines = [
        headers.join(','),
        ...rows.map((row) => headers.map((h) => escape(row[h])).join(','))
    ];
    return lines.join('\n');
}

function availableOf(book) {
    return Math.max(0, (book.quantity || 0) - (book.issued_quantity || 0));
}

// Fetch JSON with a timeout so a slow external service can't hang the request.
async function fetchJson(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
        const resp = await fetch(url, {
            signal: controller.signal,
            headers: { 'User-Agent': 'LAAT-Library/1.0 (library management)' }
        });
        if (!resp.ok) return null;
        return await resp.json();
    } finally {
        clearTimeout(timer);
    }
}

function parseYear(value) {
    if (!value) return null;
    const m = String(value).match(/\d{4}/);
    return m ? parseInt(m[0], 10) : null;
}

// Look up book metadata by ISBN from public catalogues (Open Library, then
// Google Books as a fallback). Returns normalized fields or null if not found.
async function lookupIsbnMetadata(isbn) {
    // Open Library
    try {
        const key = `ISBN:${isbn}`;
        const ol = await fetchJson(`https://openlibrary.org/api/books?bibkeys=${key}&format=json&jscmd=data`);
        if (ol && ol[key]) {
            const d = ol[key];
            return {
                isbn,
                title: d.title || '',
                author: (d.authors || []).map((a) => a.name).filter(Boolean).join(', '),
                publisher: (d.publishers || []).map((p) => p.name).filter(Boolean).join(', '),
                published_year: parseYear(d.publish_date),
                source: 'Open Library'
            };
        }
    } catch (e) {
        // fall through to Google Books
    }

    // Google Books
    try {
        const gb = await fetchJson(`https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}`);
        if (gb && gb.totalItems > 0 && Array.isArray(gb.items) && gb.items[0]) {
            const v = gb.items[0].volumeInfo || {};
            return {
                isbn,
                title: v.title || '',
                author: (v.authors || []).filter(Boolean).join(', '),
                publisher: v.publisher || '',
                published_year: parseYear(v.publishedDate),
                source: 'Google Books'
            };
        }
    } catch (e) {
        // no result
    }

    return null;
}

// Attach a derived status/available_quantity to a book row
function decorate(book) {
    if (!book) return book;
    const available = availableOf(book);
    return {
        ...book,
        available_quantity: available,
        availability: available > 0 ? 'available' : 'out_of_stock'
    };
}

// Library settings (loan limits) stored in the settings table. 0 = unlimited.
const LIBRARY_DEFAULTS = { student_limit: 3, staff_limit: 5, loan_days: 14 };

function getLibrarySettings() {
    try {
        const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('library');
        if (row) return { ...LIBRARY_DEFAULTS, ...JSON.parse(row.value) };
    } catch (e) {
        // fall through to defaults
    }
    return { ...LIBRARY_DEFAULTS };
}

// -----------------------------------------------------------------------------
// List books (with optional filters)
// -----------------------------------------------------------------------------
router.get('/', (req, res) => {
    try {
        const { search, category, campus, availability } = req.query;
        let query = 'SELECT * FROM books WHERE 1=1';
        const params = [];

        if (category) {
            query += ' AND LOWER(TRIM(COALESCE(category, ""))) = LOWER(TRIM(?))';
            params.push(category);
        }

        if (campus) {
            query += ' AND LOWER(TRIM(COALESCE(campus, ""))) = LOWER(TRIM(?))';
            params.push(campus);
        }

        if (search) {
            query += ' AND (title LIKE ? OR author LIKE ? OR book_number LIKE ? OR isbn LIKE ?)';
            const s = `%${search}%`;
            params.push(s, s, s, s);
        }

        query += ' ORDER BY created_at DESC';

        let books = db.prepare(query).all(...params).map(decorate);

        if (availability === 'available') {
            books = books.filter((b) => b.available_quantity > 0);
        } else if (availability === 'out_of_stock') {
            books = books.filter((b) => b.available_quantity === 0);
        }

        res.json(books);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// -----------------------------------------------------------------------------
// Look up a single book by its accession number (used by the QR / barcode scanner)
// -----------------------------------------------------------------------------
router.get('/lookup', (req, res) => {
    try {
        const raw = (req.query.number || req.query.book_number || '').trim();
        if (!raw) {
            return res.status(400).json({ error: 'A book number is required' });
        }
        // Match either our accession number or the book's own ISBN barcode
        // (so a handheld scanner can scan the printed ISBN directly).
        const digits = raw.replace(/[^0-9Xx]/g, '');
        const book = db.prepare(`
      SELECT * FROM books
      WHERE book_number = ? COLLATE NOCASE
         OR (? != '' AND REPLACE(REPLACE(COALESCE(isbn, ''), '-', ''), ' ', '') = ?)
    `).get(raw, digits, digits);
        if (!book) {
            return res.status(404).json({ error: `No book found for "${raw}"` });
        }
        res.json(decorate(book));
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// -----------------------------------------------------------------------------
// Look up book metadata by ISBN from public catalogues (for fast cataloguing).
// Also reports whether we already hold a copy of that ISBN.
// -----------------------------------------------------------------------------
router.get('/isbn/:isbn', async (req, res) => {
    try {
        const isbn = (req.params.isbn || '').replace(/[^0-9Xx]/g, '');
        if (!isbn) {
            return res.status(400).json({ error: 'A valid ISBN is required' });
        }

        const existing = db.prepare(`
      SELECT * FROM books WHERE REPLACE(REPLACE(COALESCE(isbn, ''), '-', ''), ' ', '') = ?
    `).get(isbn);

        const meta = await lookupIsbnMetadata(isbn);
        if (!meta) {
            return res.status(404).json({
                error: `No catalogue details found for ISBN ${isbn}. You can still add it manually.`,
                isbn,
                existing: existing ? decorate(existing) : null
            });
        }

        res.json({ ...meta, existing: existing ? decorate(existing) : null });
    } catch (error) {
        res.status(502).json({ error: 'ISBN lookup failed: ' + error.message });
    }
});

// -----------------------------------------------------------------------------
// All loans (filterable) — supports the "issued / overdue / returned" views
// -----------------------------------------------------------------------------
router.get('/loans', (req, res) => {
    try {
        const { status, overdue } = req.query;
        let query = `
      SELECT l.*, b.book_number, b.title, b.author,
             br.name as borrower_name, br.type as borrower_type, br.identifier as borrower_identifier,
             br.email as borrower_email
      FROM book_loans l
      JOIN books b ON l.book_id = b.id
      JOIN borrowers br ON l.borrower_id = br.id
      WHERE 1=1
    `;
        const params = [];

        if (status === 'issued' || status === 'returned') {
            query += ' AND l.status = ?';
            params.push(status);
        }

        if (overdue === '1' || overdue === 'true') {
            query += " AND l.status = 'issued' AND l.due_at IS NOT NULL AND l.due_at < datetime('now','localtime')";
        }

        query += ' ORDER BY l.issued_at DESC';

        const loans = db.prepare(query).all(...params).map((loan) => ({
            ...loan,
            is_overdue: loan.status === 'issued' && loan.due_at
                ? new Date(loan.due_at).getTime() < Date.now()
                : false
        }));

        res.json(loans);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// -----------------------------------------------------------------------------
// Library settings — loan limits per borrower type (admin-only to change)
// -----------------------------------------------------------------------------
router.get('/settings', (req, res) => {
    res.json(getLibrarySettings());
});

router.put('/settings', (req, res) => {
    try {
        if (!req.user || req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Only administrators can change library settings' });
        }
        const current = getLibrarySettings();
        const next = {
            student_limit: Math.max(0, parseInt(req.body.student_limit, 10) || 0),
            staff_limit: Math.max(0, parseInt(req.body.staff_limit, 10) || 0),
            loan_days: Math.max(1, parseInt(req.body.loan_days, 10) || current.loan_days)
        };
        db.prepare('REPLACE INTO settings (key, value) VALUES (?, ?)').run('library', JSON.stringify(next));
        logActivity(req, {
            action: 'library_settings_updated', entity_type: 'settings', entity_id: null,
            description: `Loan limits: students ${next.student_limit || 'unlimited'}, staff ${next.staff_limit || 'unlimited'}, period ${next.loan_days} days`
        });
        res.json(next);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// -----------------------------------------------------------------------------
// Rapid cataloguing: scan an ISBN — if we already hold it, add one copy;
// otherwise look it up online and create the book automatically.
// -----------------------------------------------------------------------------
router.post('/rapid', async (req, res) => {
    try {
        const isbn = (req.body.isbn || '').replace(/[^0-9Xx]/g, '');
        if (!isbn) {
            return res.status(400).json({ error: 'A valid ISBN is required' });
        }

        const existing = db.prepare(`
      SELECT * FROM books WHERE REPLACE(REPLACE(COALESCE(isbn, ''), '-', ''), ' ', '') = ?
    `).get(isbn);

        if (existing) {
            db.prepare('UPDATE books SET quantity = quantity + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
                .run(existing.id);
            const updated = db.prepare('SELECT * FROM books WHERE id = ?').get(existing.id);
            logActivity(req, {
                action: 'book_copy_added', entity_type: 'book', entity_id: existing.id,
                description: `Added a copy of "${existing.title}" (now ${updated.quantity})`
            });
            return res.json({ action: 'incremented', book: decorate(updated) });
        }

        const meta = await lookupIsbnMetadata(isbn);
        if (!meta || !meta.title) {
            return res.status(404).json({
                error: `ISBN ${isbn} not found in online catalogues — add it manually via Add New Book.`
            });
        }

        const bookNumber = generateBookNumber();
        const result = db.prepare(`
      INSERT INTO books (
        book_number, title, author, isbn, category, publisher, published_year,
        quantity, issued_quantity, shelf_location, campus, notes
      ) VALUES (?, ?, ?, ?, NULL, ?, ?, 1, 0, NULL, '', NULL)
    `).run(bookNumber, meta.title, meta.author || null, isbn, meta.publisher || null, meta.published_year);

        const created = db.prepare('SELECT * FROM books WHERE id = ?').get(result.lastInsertRowid);
        logActivity(req, {
            action: 'book_created', entity_type: 'book', entity_id: created.id,
            description: `Rapid-catalogued "${created.title}" (${created.book_number}) via ${meta.source}`
        });
        res.status(201).json({ action: 'created', book: decorate(created), source: meta.source });
    } catch (error) {
        res.status(502).json({ error: 'Rapid catalogue failed: ' + error.message });
    }
});

// -----------------------------------------------------------------------------
// Library summary stats
// -----------------------------------------------------------------------------
router.get('/summary', (req, res) => {
    try {
        const totals = db.prepare(`
      SELECT
        COUNT(*) as titles,
        COALESCE(SUM(quantity), 0) as total_copies,
        COALESCE(SUM(issued_quantity), 0) as issued_copies,
        COALESCE(SUM(quantity - issued_quantity), 0) as available_copies
      FROM books
    `).get();

        const activeLoans = db.prepare("SELECT COUNT(*) as count FROM book_loans WHERE status = 'issued'").get();
        const overdue = db.prepare(`
      SELECT COUNT(*) as count FROM book_loans
      WHERE status = 'issued' AND due_at IS NOT NULL AND due_at < datetime('now','localtime')
    `).get();
        const borrowers = db.prepare('SELECT COUNT(*) as count FROM borrowers').get();

        res.json({
            titles: totals.titles || 0,
            total_copies: totals.total_copies || 0,
            issued_copies: totals.issued_copies || 0,
            available_copies: totals.available_copies || 0,
            active_loans: activeLoans.count || 0,
            overdue_loans: overdue.count || 0,
            borrowers: borrowers.count || 0
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// -----------------------------------------------------------------------------
// Export books inventory (CSV)
// -----------------------------------------------------------------------------
router.get('/export', (req, res) => {
    try {
        const rows = db.prepare(`
      SELECT book_number, title, author, isbn, category, publisher, published_year,
             quantity, issued_quantity, (quantity - issued_quantity) as available,
             shelf_location, campus
      FROM books
      ORDER BY title
    `).all();
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename="books-inventory.csv"');
        return res.send(toCsv(rows));
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// -----------------------------------------------------------------------------
// Bulk issue — the "temporary list" (cart) checkout to a single borrower
// body: { borrower_id, due_at?, notes?, items: [{ book_id, quantity }] }
// -----------------------------------------------------------------------------
router.post('/issue', (req, res) => {
    try {
        const { borrower_id, due_at, notes, items = [] } = req.body;

        if (!borrower_id) {
            return res.status(400).json({ error: 'A borrower is required' });
        }
        if (!Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ error: 'No books in the issue list' });
        }

        const borrower = db.prepare('SELECT * FROM borrowers WHERE id = ?').get(borrower_id);
        if (!borrower) {
            return res.status(404).json({ error: 'Borrower not found' });
        }

        // Enforce the configurable loan limit for this borrower type (0 = unlimited).
        const settings = getLibrarySettings();
        const limit = borrower.type === 'staff' ? settings.staff_limit : settings.student_limit;
        if (limit > 0) {
            const active = db.prepare(
                "SELECT COALESCE(SUM(quantity), 0) as c FROM book_loans WHERE borrower_id = ? AND status = 'issued'"
            ).get(borrower_id).c;
            const requested = items.reduce((sum, i) => sum + Math.max(1, parseInt(i.quantity, 10) || 1), 0);
            if (active + requested > limit) {
                return res.status(400).json({
                    error: `${borrower.name} already has ${active} book(s) on loan; the ${borrower.type} limit is ${limit}. Return some first or adjust the limit in library settings.`
                });
            }
        }

        const issuedBy = req.user?.id || null;

        const runIssue = db.transaction(() => {
            const results = [];
            for (const item of items) {
                const qty = Math.max(1, parseInt(item.quantity, 10) || 1);
                const book = db.prepare('SELECT * FROM books WHERE id = ?').get(item.book_id);
                if (!book) {
                    throw new Error(`Book (id ${item.book_id}) not found`);
                }
                const available = availableOf(book);
                if (qty > available) {
                    throw new Error(`"${book.title}" has only ${available} copy(ies) available`);
                }

                const loan = db.prepare(`
          INSERT INTO book_loans (book_id, borrower_id, quantity, due_at, status, issued_by, notes)
          VALUES (?, ?, ?, ?, 'issued', ?, ?)
        `).run(book.id, borrower_id, qty, due_at || null, issuedBy, notes || null);

                db.prepare('UPDATE books SET issued_quantity = issued_quantity + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
                    .run(qty, book.id);

                results.push({ loan_id: loan.lastInsertRowid, book_id: book.id, title: book.title, quantity: qty });
            }
            return results;
        });

        const issued = runIssue();
        logActivity(req, {
            action: 'books_issued', entity_type: 'borrower', entity_id: borrower_id,
            description: `Issued ${issued.length} title(s) to ${borrower.name} (${borrower.type})`
        });
        res.status(201).json({
            message: `Issued ${issued.length} title(s) to ${borrower.name}`,
            borrower,
            loans: issued
        });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// -----------------------------------------------------------------------------
// Return a specific loan
// -----------------------------------------------------------------------------
router.post('/loans/:loanId/return', (req, res) => {
    try {
        const { notes } = req.body;
        const loan = db.prepare('SELECT * FROM book_loans WHERE id = ?').get(req.params.loanId);
        if (!loan) {
            return res.status(404).json({ error: 'Loan not found' });
        }
        if (loan.status === 'returned') {
            return res.status(400).json({ error: 'This loan has already been returned' });
        }

        const runReturn = db.transaction(() => {
            db.prepare(`
        UPDATE book_loans
        SET status = 'returned', returned_at = datetime('now','localtime'),
            notes = COALESCE(?, notes)
        WHERE id = ?
      `).run(notes || null, loan.id);

            db.prepare('UPDATE books SET issued_quantity = MAX(0, issued_quantity - ?), updated_at = CURRENT_TIMESTAMP WHERE id = ?')
                .run(loan.quantity || 1, loan.book_id);
        });

        runReturn();

        const updated = db.prepare(`
      SELECT l.*, b.book_number, b.title, br.name as borrower_name
      FROM book_loans l
      JOIN books b ON l.book_id = b.id
      JOIN borrowers br ON l.borrower_id = br.id
      WHERE l.id = ?
    `).get(loan.id);

        logActivity(req, {
            action: 'book_returned', entity_type: 'book', entity_id: loan.book_id,
            description: `Returned "${updated.title}" (${updated.book_number}) from ${updated.borrower_name}`
        });

        res.json({ message: 'Book returned', loan: updated });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// -----------------------------------------------------------------------------
// Single book by id (with loan history)
// -----------------------------------------------------------------------------
router.get('/:id', (req, res) => {
    try {
        const book = db.prepare('SELECT * FROM books WHERE id = ?').get(req.params.id);
        if (!book) {
            return res.status(404).json({ error: 'Book not found' });
        }

        const loans = db.prepare(`
      SELECT l.*, br.name as borrower_name, br.type as borrower_type, br.identifier as borrower_identifier
      FROM book_loans l
      JOIN borrowers br ON l.borrower_id = br.id
      WHERE l.book_id = ?
      ORDER BY l.issued_at DESC
    `).all(req.params.id).map((loan) => ({
            ...loan,
            is_overdue: loan.status === 'issued' && loan.due_at
                ? new Date(loan.due_at).getTime() < Date.now()
                : false
        }));

        res.json({ ...decorate(book), loans });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// -----------------------------------------------------------------------------
// Create book
// -----------------------------------------------------------------------------
router.post('/', (req, res) => {
    try {
        const {
            title, author, isbn, category, publisher, published_year,
            quantity = 1, shelf_location, campus = '', notes
        } = req.body;

        if (!title || !title.trim()) {
            return res.status(400).json({ error: 'Title is required' });
        }

        const bookNumber = generateBookNumber();
        const safeQuantity = Math.max(1, parseInt(quantity, 10) || 1);
        const year = published_year ? parseInt(published_year, 10) || null : null;

        const result = db.prepare(`
      INSERT INTO books (
        book_number, title, author, isbn, category, publisher, published_year,
        quantity, issued_quantity, shelf_location, campus, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
    `).run(
            bookNumber, title.trim(), author || null, isbn || null, category || null,
            publisher || null, year, safeQuantity, shelf_location || null, campus || '', notes || null
        );

        const created = db.prepare('SELECT * FROM books WHERE id = ?').get(result.lastInsertRowid);
        logActivity(req, {
            action: 'book_created', entity_type: 'book', entity_id: created.id,
            description: `Added book "${created.title}" (${created.book_number})`
        });
        res.status(201).json(decorate(created));
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// -----------------------------------------------------------------------------
// Bulk import books (parsed on the client)
// -----------------------------------------------------------------------------
router.post('/import', (req, res) => {
    try {
        const { items = [] } = req.body;
        if (!Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ error: 'No items provided for import' });
        }

        const insertStmt = db.prepare(`
      INSERT INTO books (
        book_number, title, author, isbn, category, publisher, published_year,
        quantity, issued_quantity, shelf_location, campus, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
    `);

        const importResult = db.transaction(() => {
            let inserted = 0;
            for (const item of items) {
                const qty = Math.max(1, parseInt(item.quantity, 10) || 1);
                const year = item.published_year ? parseInt(item.published_year, 10) || null : null;
                insertStmt.run(
                    generateBookNumber(),
                    item.title || 'Untitled',
                    item.author || null,
                    item.isbn || null,
                    item.category || null,
                    item.publisher || null,
                    year,
                    qty,
                    item.shelf_location || null,
                    item.campus || '',
                    item.notes || null
                );
                inserted += 1;
            }
            return { inserted };
        })();

        res.json({ message: 'Import completed', ...importResult });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// -----------------------------------------------------------------------------
// Update book
// -----------------------------------------------------------------------------
router.put('/:id', (req, res) => {
    try {
        const {
            title, author, isbn, category, publisher, published_year,
            quantity = 1, shelf_location, campus = '', notes
        } = req.body;

        const current = db.prepare('SELECT * FROM books WHERE id = ?').get(req.params.id);
        if (!current) {
            return res.status(404).json({ error: 'Book not found' });
        }

        const safeQuantity = Math.max(1, parseInt(quantity, 10) || 1);
        if (safeQuantity < current.issued_quantity) {
            return res.status(400).json({ error: `Quantity cannot be lower than currently issued copies (${current.issued_quantity})` });
        }
        const year = published_year ? parseInt(published_year, 10) || null : null;

        db.prepare(`
      UPDATE books SET
        title = ?, author = ?, isbn = ?, category = ?, publisher = ?, published_year = ?,
        quantity = ?, shelf_location = ?, campus = ?, notes = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
            title, author || null, isbn || null, category || null, publisher || null, year,
            safeQuantity, shelf_location || null, campus || '', notes || null, req.params.id
        );

        const updated = db.prepare('SELECT * FROM books WHERE id = ?').get(req.params.id);
        logActivity(req, {
            action: 'book_updated', entity_type: 'book', entity_id: updated.id,
            description: `Updated book "${updated.title}" (${updated.book_number})`
        });
        res.json(decorate(updated));
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// -----------------------------------------------------------------------------
// Delete book (blocked while copies are on loan)
// -----------------------------------------------------------------------------
router.delete('/:id', (req, res) => {
    try {
        const book = db.prepare('SELECT * FROM books WHERE id = ?').get(req.params.id);
        if (!book) {
            return res.status(404).json({ error: 'Book not found' });
        }
        if (book.issued_quantity > 0) {
            return res.status(400).json({ error: 'Cannot delete a book that still has copies on loan' });
        }

        db.transaction(() => {
            db.prepare("DELETE FROM book_loans WHERE book_id = ? AND status = 'returned'").run(book.id);
            db.prepare('DELETE FROM books WHERE id = ?').run(book.id);
        })();

        logActivity(req, {
            action: 'book_deleted', entity_type: 'book', entity_id: book.id,
            description: `Deleted book "${book.title}" (${book.book_number})`
        });

        res.json({ message: 'Book deleted successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
