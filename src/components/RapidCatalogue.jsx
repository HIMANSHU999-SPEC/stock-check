import React, { useState, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { booksAPI } from '../services/api';
import { CAMPUSES, BOOK_CATEGORIES } from '../constants';

// Rapid cataloguing: scan ISBN -> auto-fetch -> auto-save -> ready for the next
// scan. New ISBNs are created from online catalogue data; scanning a book we
// already hold adds one more copy. Designed for working through a large
// backlog of physical books with a handheld scanner.
export default function RapidCatalogue() {
    const [isbn, setIsbn] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [session, setSession] = useState([]);
    const [category, setCategory] = useState('');
    const [campus, setCampus] = useState('');
    const [copies, setCopies] = useState(1);
    // Set when an ISBN is not in the online catalogues: the user can type just
    // a title and add the book anyway without leaving this page.
    const [pending, setPending] = useState(null); // { isbn }
    const [pendingTitle, setPendingTitle] = useState('');
    const inputRef = useRef(null);

    useEffect(() => {
        inputRef.current?.focus();
    }, []);

    function refocus() {
        setTimeout(() => inputRef.current?.focus(), 0);
    }

    function recordResult(res) {
        setSession((prev) => [{
            key: Date.now(),
            action: res.action,
            title: res.book.title,
            book_number: res.book.book_number,
            quantity: res.book.quantity,
            category: res.book.category,
            campus: res.book.campus,
            id: res.book.id
        }, ...prev]);
    }

    async function addIsbn(value, extras = {}) {
        setBusy(true);
        setError('');
        try {
            const res = await booksAPI.rapidAdd(value, { category, campus, quantity: copies, ...extras });
            recordResult(res);
            setPending(null);
            setPendingTitle('');
        } catch (err) {
            if (err.message.includes('not found in the online catalogues')) {
                // Offer inline manual entry instead of a dead end.
                setPending({ isbn: value });
                setPendingTitle('');
                setError('');
            } else {
                setError(`${value}: ${err.message}`);
            }
        } finally {
            setBusy(false);
            refocus();
        }
    }

    async function handleScan(e) {
        e.preventDefault();
        const value = isbn.trim();
        setIsbn('');
        if (!value || busy) {
            refocus();
            return;
        }
        await addIsbn(value);
    }

    async function handleManualAdd(e) {
        e.preventDefault();
        if (!pending || !pendingTitle.trim()) return;
        await addIsbn(pending.isbn, { title: pendingTitle.trim() });
    }

    async function adjustRow(row, delta) {
        try {
            const res = await booksAPI.adjustQuantity(row.id, delta);
            setSession((prev) => prev.map((s) => (s.id === row.id ? { ...s, quantity: res.book.quantity } : s)));
        } catch (err) {
            alert('Could not adjust copies: ' + err.message);
        }
    }

    const created = session.filter((s) => s.action === 'created').length;
    const extraCopies = session.filter((s) => s.action === 'incremented').length;

    return (
        <div>
            <div className="flex justify-between items-center mb-3">
                <h2>⚡ Rapid Catalogue</h2>
                <Link to="/books" className="btn btn-secondary">Back to Books</Link>
            </div>

            <div className="card mb-3">
                <div className="card-body">
                    <div className="grid grid-3 mb-2">
                        <div className="form-group">
                            <label className="form-label">Copies per scan</label>
                            <input
                                type="number"
                                min="1"
                                max="999"
                                className="form-control"
                                value={copies}
                                onChange={(e) => setCopies(Math.max(1, parseInt(e.target.value, 10) || 1))}
                            />
                        </div>
                        <div className="form-group">
                            <label className="form-label">Category for these scans</label>
                            <input
                                type="text"
                                className="form-control"
                                list="rapid-categories"
                                placeholder="e.g. Business, IT (optional)"
                                value={category}
                                onChange={(e) => setCategory(e.target.value)}
                            />
                            <datalist id="rapid-categories">
                                {BOOK_CATEGORIES.map((c) => <option key={c} value={c} />)}
                            </datalist>
                        </div>
                        <div className="form-group">
                            <label className="form-label">Campus for these scans</label>
                            <select
                                className="form-control"
                                value={campus}
                                onChange={(e) => setCampus(e.target.value)}
                            >
                                <option value="">— No campus —</option>
                                {CAMPUSES.map((c) => <option key={c} value={c}>{c}</option>)}
                            </select>
                        </div>
                    </div>
                    <form onSubmit={handleScan}>
                        <label className="form-label" style={{ fontSize: '1.05rem' }}>
                            Scan the ISBN barcode — the book is saved automatically
                        </label>
                        <div className="flex gap-2">
                            <input
                                ref={inputRef}
                                type="text"
                                className="form-control"
                                style={{ fontSize: '1.2rem', padding: '0.75rem' }}
                                placeholder="Scan or type ISBN, then Enter"
                                value={isbn}
                                onChange={(e) => setIsbn(e.target.value)}
                                disabled={busy}
                                autoFocus
                            />
                            <button type="submit" className="btn btn-primary" disabled={busy}>
                                {busy ? 'Saving…' : 'Add'}
                            </button>
                        </div>
                    </form>
                    <p className="text-muted mt-2" style={{ fontSize: '0.85rem' }}>
                        New ISBN → book created with details from Open Library / Google Books.
                        Already in the library → one more copy is added. Keep scanning — no clicks needed.
                    </p>
                    {error && (
                        <p style={{ color: 'var(--danger)' }}>
                            {error}{' '}
                            <Link to="/books/new" className="text-primary">Add manually →</Link>
                        </p>
                    )}

                    {pending && (
                        <form onSubmit={handleManualAdd} className="card mt-2" style={{ background: 'var(--bg-tertiary)' }}>
                            <div className="card-body">
                                <p style={{ marginBottom: '0.5rem' }}>
                                    <strong>ISBN {pending.isbn}</strong> isn't in the online catalogues.
                                    Type the title from the cover and it will be added with this ISBN:
                                </p>
                                <div className="flex gap-2">
                                    <input
                                        type="text"
                                        className="form-control"
                                        placeholder="Book title"
                                        value={pendingTitle}
                                        onChange={(e) => setPendingTitle(e.target.value)}
                                        autoFocus
                                    />
                                    <button type="submit" className="btn btn-primary" disabled={busy || !pendingTitle.trim()}>
                                        Add book
                                    </button>
                                    <button
                                        type="button"
                                        className="btn btn-secondary"
                                        onClick={() => { setPending(null); setPendingTitle(''); refocus(); }}
                                    >
                                        Skip
                                    </button>
                                </div>
                            </div>
                        </form>
                    )}
                </div>
            </div>

            <div className="card">
                <div className="card-header">
                    <div className="flex justify-between items-center">
                        <h3 className="card-title">This session</h3>
                        <span className="badge badge-primary">
                            {created} new · {extraCopies} extra cop{extraCopies === 1 ? 'y' : 'ies'}
                        </span>
                    </div>
                </div>
                <div className="table-container">
                    <table className="table">
                        <thead>
                            <tr>
                                <th>Result</th>
                                <th>Book Number</th>
                                <th>Title</th>
                                <th>Category</th>
                                <th>Campus</th>
                                <th>Copies now</th>
                            </tr>
                        </thead>
                        <tbody>
                            {session.length === 0 ? (
                                <tr>
                                    <td colSpan="6" className="text-center text-muted">
                                        Nothing scanned yet — grab the scanner and go!
                                    </td>
                                </tr>
                            ) : (
                                session.map((s) => (
                                    <tr key={s.key}>
                                        <td>
                                            <span className={`badge badge-${s.action === 'created' ? 'success' : 'info'}`}>
                                                {s.action === 'created' ? 'NEW' : '+1 copy'}
                                            </span>
                                        </td>
                                        <td>
                                            <Link to={`/books/${s.id}`} className="text-primary">
                                                <strong>{s.book_number}</strong>
                                            </Link>
                                        </td>
                                        <td>{s.title}</td>
                                        <td>{s.category || '—'}</td>
                                        <td>{s.campus || '—'}</td>
                                        <td>
                                            <div className="flex items-center gap-1">
                                                <button
                                                    type="button"
                                                    className="btn btn-sm btn-secondary"
                                                    onClick={() => adjustRow(s, -1)}
                                                    title="Remove one copy"
                                                >
                                                    −
                                                </button>
                                                <strong style={{ minWidth: '1.5rem', textAlign: 'center' }}>{s.quantity}</strong>
                                                <button
                                                    type="button"
                                                    className="btn btn-sm btn-secondary"
                                                    onClick={() => adjustRow(s, 1)}
                                                    title="Add one copy"
                                                >
                                                    +
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
