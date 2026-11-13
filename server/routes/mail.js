const express = require('express');
const router = express.Router();
const db = require('../database');
const mailer = require('../services/mailer');
const { logActivity } = require('../utils/activity');

// Remind a borrower about every library book they have overdue
router.post('/library-overdue', async (req, res) => {
    try {
        const borrower = db.prepare('SELECT * FROM borrowers WHERE id = ?').get(req.body?.borrower_id);
        if (!borrower) {
            return res.status(404).json({ error: 'Borrower not found' });
        }
        const loans = db.prepare(`
      SELECT l.due_at, b.book_number, b.title
      FROM book_loans l JOIN books b ON l.book_id = b.id
      WHERE l.borrower_id = ? AND l.status = 'issued'
        AND l.due_at IS NOT NULL AND l.due_at < datetime('now','localtime')
      ORDER BY l.due_at
    `).all(borrower.id);
        if (loans.length === 0) {
            return res.status(400).json({ error: `${borrower.name} has nothing overdue` });
        }

        const items = loans.map((loan) => {
            const due = new Date(loan.due_at);
            const dueText = Number.isNaN(due.getTime())
                ? 'unknown date'
                : due.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
            return `- "${loan.title}" (${loan.book_number}) — due ${dueText}`;
        }).join('\n');
        const context = mailer.libraryContext({ borrowerName: borrower.name, items, user: req.user });

        // No mailbox configured: hand the wording back so the client can open
        // it in the user's own mail app.
        if (!mailer.mailStatus().configured) {
            return res.json({ status: 'not_configured', to: borrower.email || '', ...mailer.render('library_overdue', context) });
        }
        const result = await mailer.sendTemplate('library_overdue', {
            to: borrower.email, context, entity: { type: 'borrower', id: borrower.id }, user: req.user
        });
        if (result.status === 'sent') {
            logActivity(req, {
                action: 'email_sent', entity_type: 'borrower', entity_id: borrower.id,
                description: `Sent overdue reminder to ${borrower.name} (${loans.length} book(s))`
            });
        }
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
