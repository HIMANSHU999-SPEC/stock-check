import React, { useState, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { booksAPI } from '../services/api';

// Rapid cataloguing: scan ISBN -> auto-fetch -> auto-save -> ready for the next
// scan. New ISBNs are created from online catalogue data; scanning a book we
// already hold adds one more copy. Designed for working through a large
// backlog of physical books with a handheld scanner.
export default function RapidCatalogue() {
    const [isbn, setIsbn] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [session, setSession] = useState([]);
    const inputRef = useRef(null);

    useEffect(() => {
        inputRef.current?.focus();
    }, []);

    function refocus() {
        setTimeout(() => inputRef.current?.focus(), 0);
    }

    async function handleScan(e) {
        e.preventDefault();
        const value = isbn.trim();
        setIsbn('');
        if (!value || busy) {
            refocus();
            return;
        }
        setBusy(true);
        setError('');
        try {
            const res = await booksAPI.rapidAdd(value);
            setSession((prev) => [{
                key: Date.now(),
                action: res.action,
                title: res.book.title,
                book_number: res.book.book_number,
                quantity: res.book.quantity,
                id: res.book.id
            }, ...prev]);
        } catch (err) {
            setError(`${value}: ${err.message}`);
        } finally {
            setBusy(false);
            refocus();
        }
    }

    const created = session.filter((s) => s.action === 'created').length;
    const copies = session.filter((s) => s.action === 'incremented').length;

    return (
        <div>
            <div className="flex justify-between items-center mb-3">
                <h2>⚡ Rapid Catalogue</h2>
                <Link to="/books" className="btn btn-secondary">Back to Books</Link>
            </div>

            <div className="card mb-3">
                <div className="card-body">
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
                </div>
            </div>

            <div className="card">
                <div className="card-header">
                    <div className="flex justify-between items-center">
                        <h3 className="card-title">This session</h3>
                        <span className="badge badge-primary">
                            {created} new · {copies} extra cop{copies === 1 ? 'y' : 'ies'}
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
                                <th>Copies now</th>
                            </tr>
                        </thead>
                        <tbody>
                            {session.length === 0 ? (
                                <tr>
                                    <td colSpan="4" className="text-center text-muted">
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
                                        <td>{s.quantity}</td>
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
