import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { booksAPI } from '../services/api';
import QRCode from 'react-qr-code';

export default function BookDetails() {
    const { id } = useParams();
    const navigate = useNavigate();
    const [book, setBook] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        loadBook();
    }, [id]);

    async function loadBook() {
        try {
            const data = await booksAPI.getById(id);
            setBook(data);
        } catch (error) {
            alert('Error loading book: ' + error.message);
            navigate('/books');
        } finally {
            setLoading(false);
        }
    }

    async function handleReturn(loanId) {
        if (!confirm('Mark this copy as returned?')) return;
        try {
            await booksAPI.returnLoan(loanId, 'Returned from book details');
            loadBook();
        } catch (error) {
            alert('Error returning book: ' + error.message);
        }
    }

    if (loading) {
        return <div className="spinner"></div>;
    }

    if (!book) return null;

    const activeLoans = (book.loans || []).filter((l) => l.status === 'issued');

    return (
        <div>
            <div className="flex justify-between items-center mb-3">
                <h2>{book.title}</h2>
                <div className="flex gap-2">
                    <Link to="/books" className="btn btn-secondary">Back to Books</Link>
                    <Link to={`/books/${book.id}/edit`} className="btn btn-secondary">Edit</Link>
                    <Link
                        to={`/library/issue?book=${encodeURIComponent(book.book_number)}`}
                        className="btn btn-primary"
                    >
                        Issue this Book
                    </Link>
                </div>
            </div>

            <div className="grid grid-2 mb-3">
                <div className="card">
                    <div className="card-header">
                        <h3 className="card-title">Details</h3>
                    </div>
                    <div className="card-body">
                        <p><strong>Book Number:</strong> {book.book_number}</p>
                        <p><strong>Author:</strong> {book.author || 'N/A'}</p>
                        <p><strong>ISBN:</strong> {book.isbn || 'N/A'}</p>
                        <p><strong>Category:</strong> {book.category || 'N/A'}</p>
                        <p><strong>Publisher:</strong> {book.publisher || 'N/A'}</p>
                        <p><strong>Published Year:</strong> {book.published_year || 'N/A'}</p>
                        <p><strong>Shelf Location:</strong> {book.shelf_location || 'N/A'}</p>
                        <p><strong>Campus:</strong> {book.campus || 'N/A'}</p>
                        <p>
                            <strong>Availability:</strong>{' '}
                            <span className={`badge badge-${book.available_quantity > 0 ? 'success' : 'danger'}`}>
                                {book.available_quantity} of {book.quantity} available
                            </span>
                        </p>
                        {book.notes && <p><strong>Notes:</strong> {book.notes}</p>}
                    </div>
                </div>

                <div className="card">
                    <div className="card-header">
                        <h3 className="card-title">QR Code</h3>
                    </div>
                    <div className="card-body text-center">
                        <div style={{ background: 'white', padding: '1rem', display: 'inline-block', borderRadius: '8px' }}>
                            <QRCode value={book.book_number} size={140} />
                        </div>
                        <p className="text-muted mt-2">{book.book_number}</p>
                        <Link to="/library/tags" className="btn btn-sm btn-secondary mt-2">
                            Print Book Tags
                        </Link>
                    </div>
                </div>
            </div>

            <div className="card">
                <div className="card-header">
                    <h3 className="card-title">Loan History</h3>
                </div>
                <div className="table-container">
                    <table className="table">
                        <thead>
                            <tr>
                                <th>Borrower</th>
                                <th>Type</th>
                                <th>Qty</th>
                                <th>Issued</th>
                                <th>Due</th>
                                <th>Returned</th>
                                <th>Status</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {(book.loans || []).length === 0 ? (
                                <tr>
                                    <td colSpan="8" className="text-center text-muted">No loan history</td>
                                </tr>
                            ) : (
                                book.loans.map((loan) => (
                                    <tr key={loan.id}>
                                        <td>{loan.borrower_name}</td>
                                        <td>{loan.borrower_type}</td>
                                        <td>{loan.quantity}</td>
                                        <td>{formatDate(loan.issued_at)}</td>
                                        <td>{formatDate(loan.due_at)}</td>
                                        <td>{formatDate(loan.returned_at)}</td>
                                        <td>
                                            {loan.status === 'returned' ? (
                                                <span className="badge badge-success">returned</span>
                                            ) : loan.is_overdue ? (
                                                <span className="badge badge-danger">overdue</span>
                                            ) : (
                                                <span className="badge badge-info">issued</span>
                                            )}
                                        </td>
                                        <td>
                                            {loan.status === 'issued' && (
                                                <button
                                                    onClick={() => handleReturn(loan.id)}
                                                    className="btn btn-sm btn-primary"
                                                >
                                                    Return
                                                </button>
                                            )}
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {activeLoans.length > 0 && (
                <p className="text-muted mt-2">
                    {activeLoans.length} copy(ies) currently on loan.
                </p>
            )}
        </div>
    );
}

function formatDate(value) {
    if (!value) return '-';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return value;
    return d.toLocaleDateString();
}
