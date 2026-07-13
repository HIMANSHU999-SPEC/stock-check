import React, { useState, useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { booksAPI, borrowersAPI } from '../services/api';
import CameraScanner from './CameraScanner';

const NEW_BORROWER = {
    name: '',
    type: 'student',
    identifier: '',
    email: '',
    class_dept: '',
    phone: '',
    campus: ''
};

// Default loan period: 14 days from today, formatted YYYY-MM-DD
function defaultDueDate() {
    const d = new Date();
    d.setDate(d.getDate() + 14);
    return d.toISOString().slice(0, 10);
}

export default function IssueDesk() {
    const location = useLocation();
    const scanRef = useRef(null);

    // Temporary issue list (the "cart")
    const [cart, setCart] = useState([]);
    const [scanValue, setScanValue] = useState('');
    const [scanError, setScanError] = useState('');
    const [showCamera, setShowCamera] = useState(false);

    // Borrowers
    const [borrowers, setBorrowers] = useState([]);
    const [selectedBorrower, setSelectedBorrower] = useState('');
    const [showNewBorrower, setShowNewBorrower] = useState(false);
    const [newBorrower, setNewBorrower] = useState(NEW_BORROWER);

    const [dueDate, setDueDate] = useState(defaultDueDate());
    const [notes, setNotes] = useState('');
    const [issuing, setIssuing] = useState(false);
    const [message, setMessage] = useState('');

    // Active loans (returns panel)
    const [loans, setLoans] = useState([]);

    useEffect(() => {
        loadBorrowers();
        loadLoans();
        focusScan();
    }, []);

    // Support ?book=<number> to preload a book (from Book details "Issue this Book")
    useEffect(() => {
        const params = new URLSearchParams(location.search);
        const bookNumber = params.get('book');
        if (bookNumber) {
            addByNumber(bookNumber);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [location.search]);

    function focusScan() {
        setTimeout(() => scanRef.current?.focus(), 0);
    }

    async function loadBorrowers() {
        try {
            const data = await borrowersAPI.getAll();
            setBorrowers(data);
        } catch (error) {
            console.error('Error loading borrowers:', error);
        }
    }

    async function loadLoans() {
        try {
            const data = await booksAPI.getLoans({ status: 'issued' });
            setLoans(data);
        } catch (error) {
            console.error('Error loading loans:', error);
        }
    }

    async function addByNumber(rawNumber) {
        const number = (rawNumber || '').trim();
        if (!number) return;
        setScanError('');
        try {
            const book = await booksAPI.lookup(number);
            addBookToCart(book);
        } catch (error) {
            setScanError(error.message);
        }
    }

    function addBookToCart(book) {
        setCart((prev) => {
            const existing = prev.find((item) => item.book_id === book.id);
            if (existing) {
                // Bump quantity but never beyond what's available
                const nextQty = Math.min(existing.quantity + 1, book.available_quantity);
                if (nextQty === existing.quantity) {
                    setScanError(`"${book.title}" — no more copies available`);
                    return prev;
                }
                return prev.map((item) =>
                    item.book_id === book.id ? { ...item, quantity: nextQty } : item
                );
            }
            if (book.available_quantity < 1) {
                setScanError(`"${book.title}" is out of stock`);
                return prev;
            }
            return [
                ...prev,
                {
                    book_id: book.id,
                    book_number: book.book_number,
                    title: book.title,
                    author: book.author,
                    available: book.available_quantity,
                    quantity: 1
                }
            ];
        });
    }

    function handleScanSubmit(e) {
        e.preventDefault();
        addByNumber(scanValue);
        setScanValue('');
        focusScan();
    }

    function updateQty(bookId, qty) {
        setCart((prev) =>
            prev.map((item) =>
                item.book_id === bookId
                    ? { ...item, quantity: Math.max(1, Math.min(qty, item.available)) }
                    : item
            )
        );
    }

    function removeFromCart(bookId) {
        setCart((prev) => prev.filter((item) => item.book_id !== bookId));
    }

    async function createBorrowerInline(e) {
        e.preventDefault();
        try {
            const created = await borrowersAPI.create(newBorrower);
            await loadBorrowers();
            setSelectedBorrower(String(created.id));
            setShowNewBorrower(false);
            setNewBorrower(NEW_BORROWER);
        } catch (error) {
            alert('Error creating borrower: ' + error.message);
        }
    }

    async function handleIssue() {
        setMessage('');
        if (!selectedBorrower) {
            alert('Please select a borrower.');
            return;
        }
        if (cart.length === 0) {
            alert('Scan or add at least one book to the list.');
            return;
        }
        setIssuing(true);
        try {
            const res = await booksAPI.issue({
                borrower_id: Number(selectedBorrower),
                due_at: dueDate || null,
                notes: notes || null,
                items: cart.map((item) => ({ book_id: item.book_id, quantity: item.quantity }))
            });
            setMessage(res.message);
            setCart([]);
            setNotes('');
            setSelectedBorrower('');
            await Promise.all([loadBorrowers(), loadLoans()]);
            focusScan();
        } catch (error) {
            alert('Error issuing books: ' + error.message);
        } finally {
            setIssuing(false);
        }
    }

    async function handleReturn(loanId) {
        try {
            await booksAPI.returnLoan(loanId, 'Returned at issue desk');
            await loadLoans();
        } catch (error) {
            alert('Error returning book: ' + error.message);
        }
    }

    const totalCopies = cart.reduce((sum, item) => sum + item.quantity, 0);

    return (
        <div>
            <h2 className="mb-3">Issue Desk</h2>

            {message && (
                <div className="card mb-3" style={{ borderLeft: '4px solid var(--success, #22c55e)' }}>
                    <div className="card-body">{message}</div>
                </div>
            )}

            <div className="grid grid-2 mb-3">
                {/* Left: scan + temporary list */}
                <div className="card">
                    <div className="card-header">
                        <h3 className="card-title">1. Scan / Add Books</h3>
                    </div>
                    <div className="card-body">
                        <form onSubmit={handleScanSubmit}>
                            <div className="form-group">
                                <label className="form-label">Scan book QR / barcode (or type the book number)</label>
                                <div className="flex gap-2">
                                    <input
                                        ref={scanRef}
                                        type="text"
                                        className="form-control"
                                        placeholder="e.g. LIB-2026-0001"
                                        value={scanValue}
                                        onChange={(e) => setScanValue(e.target.value)}
                                        autoFocus
                                    />
                                    <button type="submit" className="btn btn-primary">Add</button>
                                    <button
                                        type="button"
                                        className="btn btn-secondary"
                                        onClick={() => { setScanError(''); setShowCamera(true); }}
                                    >
                                        📷 Scan
                                    </button>
                                </div>
                                <div className="text-muted" style={{ fontSize: '0.85rem', marginTop: '0.35rem' }}>
                                    Scan the book's ISBN barcode or our QR tag (handheld scanner or 📷 camera), or type
                                    the book number / ISBN.
                                </div>
                            </div>
                        </form>
                        {scanError && (
                            <p className="text-danger" style={{ color: 'var(--danger, #ef4444)' }}>{scanError}</p>
                        )}

                        <div className="table-container mt-2">
                            <table className="table">
                                <thead>
                                    <tr>
                                        <th>Book</th>
                                        <th>Qty</th>
                                        <th></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {cart.length === 0 ? (
                                        <tr>
                                            <td colSpan="3" className="text-center text-muted">
                                                No books in the list yet
                                            </td>
                                        </tr>
                                    ) : (
                                        cart.map((item) => (
                                            <tr key={item.book_id}>
                                                <td>
                                                    <strong>{item.book_number}</strong>
                                                    <div className="text-muted" style={{ fontSize: '0.85rem' }}>
                                                        {item.title}
                                                    </div>
                                                </td>
                                                <td>
                                                    <input
                                                        type="number"
                                                        min="1"
                                                        max={item.available}
                                                        className="form-control"
                                                        style={{ width: '5rem' }}
                                                        value={item.quantity}
                                                        onChange={(e) =>
                                                            updateQty(item.book_id, parseInt(e.target.value, 10) || 1)
                                                        }
                                                    />
                                                    <div className="text-muted" style={{ fontSize: '0.75rem' }}>
                                                        {item.available} avail.
                                                    </div>
                                                </td>
                                                <td>
                                                    <button
                                                        onClick={() => removeFromCart(item.book_id)}
                                                        className="btn btn-sm btn-danger"
                                                    >
                                                        Remove
                                                    </button>
                                                </td>
                                            </tr>
                                        ))
                                    )}
                                </tbody>
                            </table>
                        </div>
                        {cart.length > 0 && (
                            <p className="text-muted mt-2">
                                {cart.length} title(s), {totalCopies} copy(ies) in list.
                            </p>
                        )}
                    </div>
                </div>

                {/* Right: borrower + issue */}
                <div className="card">
                    <div className="card-header">
                        <h3 className="card-title">2. Borrower &amp; Issue</h3>
                    </div>
                    <div className="card-body">
                        <div className="form-group">
                            <label className="form-label">Select borrower (student or staff)</label>
                            <select
                                className="form-control"
                                value={selectedBorrower}
                                onChange={(e) => setSelectedBorrower(e.target.value)}
                            >
                                <option value="">Choose a borrower already in the system...</option>
                                {borrowers.map((b) => (
                                    <option key={b.id} value={b.id}>
                                        {b.name} — {b.type}{b.identifier ? ` (${b.identifier})` : ''}
                                        {b.class_dept ? ` · ${b.class_dept}` : ''}
                                    </option>
                                ))}
                            </select>
                        </div>

                        <div className="form-group">
                            <button
                                type="button"
                                className="btn btn-secondary btn-sm"
                                onClick={() => setShowNewBorrower((v) => !v)}
                            >
                                {showNewBorrower ? 'Cancel new borrower' : '+ New borrower'}
                            </button>
                        </div>

                        {showNewBorrower && (
                            <form onSubmit={createBorrowerInline} className="card mb-2">
                                <div className="card-body">
                                    <div className="grid grid-2">
                                        <div className="form-group">
                                            <label className="form-label">Name *</label>
                                            <input
                                                type="text"
                                                className="form-control"
                                                value={newBorrower.name}
                                                onChange={(e) => setNewBorrower({ ...newBorrower, name: e.target.value })}
                                                required
                                            />
                                        </div>
                                        <div className="form-group">
                                            <label className="form-label">Type</label>
                                            <select
                                                className="form-control"
                                                value={newBorrower.type}
                                                onChange={(e) => setNewBorrower({ ...newBorrower, type: e.target.value })}
                                            >
                                                <option value="student">Student</option>
                                                <option value="staff">Staff</option>
                                            </select>
                                        </div>
                                    </div>
                                    <div className="grid grid-2">
                                        <div className="form-group">
                                            <label className="form-label">ID</label>
                                            <input
                                                type="text"
                                                className="form-control"
                                                value={newBorrower.identifier}
                                                onChange={(e) => setNewBorrower({ ...newBorrower, identifier: e.target.value })}
                                            />
                                        </div>
                                        <div className="form-group">
                                            <label className="form-label">Class / Dept</label>
                                            <input
                                                type="text"
                                                className="form-control"
                                                value={newBorrower.class_dept}
                                                onChange={(e) => setNewBorrower({ ...newBorrower, class_dept: e.target.value })}
                                            />
                                        </div>
                                    </div>
                                    <button type="submit" className="btn btn-primary btn-sm">
                                        Save &amp; select
                                    </button>
                                </div>
                            </form>
                        )}

                        <div className="form-group">
                            <label className="form-label">Due date</label>
                            <input
                                type="date"
                                className="form-control"
                                value={dueDate}
                                onChange={(e) => setDueDate(e.target.value)}
                            />
                        </div>

                        <div className="form-group">
                            <label className="form-label">Notes (optional)</label>
                            <textarea
                                className="form-control"
                                rows="2"
                                value={notes}
                                onChange={(e) => setNotes(e.target.value)}
                            />
                        </div>

                        <button
                            onClick={handleIssue}
                            className="btn btn-primary"
                            disabled={issuing || cart.length === 0 || !selectedBorrower}
                        >
                            {issuing ? 'Issuing...' : `Issue ${totalCopies || ''} book(s)`}
                        </button>
                    </div>
                </div>
            </div>

            {/* Returns panel */}
            <div className="card">
                <div className="card-header">
                    <h3 className="card-title">Currently Issued — Returns</h3>
                </div>
                <div className="table-container">
                    <table className="table">
                        <thead>
                            <tr>
                                <th>Book Number</th>
                                <th>Title</th>
                                <th>Borrower</th>
                                <th>Qty</th>
                                <th>Due</th>
                                <th>Status</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loans.length === 0 ? (
                                <tr>
                                    <td colSpan="7" className="text-center text-muted">No books currently on loan</td>
                                </tr>
                            ) : (
                                loans.map((loan) => (
                                    <tr key={loan.id}>
                                        <td><strong>{loan.book_number}</strong></td>
                                        <td>{loan.title}</td>
                                        <td>
                                            {loan.borrower_name}
                                            <span className="badge badge-info" style={{ marginLeft: '0.4rem' }}>
                                                {loan.borrower_type}
                                            </span>
                                        </td>
                                        <td>{loan.quantity}</td>
                                        <td>{loan.due_at ? new Date(loan.due_at).toLocaleDateString() : '-'}</td>
                                        <td>
                                            {loan.is_overdue ? (
                                                <span className="badge badge-danger">overdue</span>
                                            ) : (
                                                <span className="badge badge-info">issued</span>
                                            )}
                                        </td>
                                        <td>
                                            <button onClick={() => handleReturn(loan.id)} className="btn btn-sm btn-primary">
                                                Return
                                            </button>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {showCamera && (
                <CameraScanner
                    onScan={(text) => addByNumber(text)}
                    onClose={() => { setShowCamera(false); focusScan(); }}
                />
            )}
        </div>
    );
}
