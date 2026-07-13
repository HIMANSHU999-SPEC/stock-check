import React, { useState, useEffect } from 'react';
import { booksAPI } from '../services/api';
import QRCode from 'react-qr-code';

export default function BookTagPrinter() {
    const [books, setBooks] = useState([]);
    const [selected, setSelected] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        loadBooks();
    }, []);

    async function loadBooks() {
        try {
            const data = await booksAPI.getAll();
            setBooks(data);
        } catch (error) {
            console.error('Error loading books:', error);
        } finally {
            setLoading(false);
        }
    }

    function toggle(bookId) {
        setSelected((prev) =>
            prev.includes(bookId) ? prev.filter((id) => id !== bookId) : [...prev, bookId]
        );
    }

    function selectAll() {
        setSelected(books.map((b) => b.id));
    }

    function clearSelection() {
        setSelected([]);
    }

    const selectedData = books.filter((b) => selected.includes(b.id));

    if (loading) {
        return <div className="spinner"></div>;
    }

    return (
        <div>
            <div className="no-print">
                <h2>Print Book Tags</h2>

                <div className="card mb-3">
                    <div className="card-header">
                        <div className="flex justify-between items-center">
                            <h3 className="card-title">Select Books</h3>
                            <div className="flex gap-2">
                                <button onClick={selectAll} className="btn btn-sm btn-secondary">Select All</button>
                                <button onClick={clearSelection} className="btn btn-sm btn-secondary">Clear Selection</button>
                                <button
                                    onClick={() => window.print()}
                                    className="btn btn-sm btn-primary"
                                    disabled={selected.length === 0}
                                >
                                    Print {selected.length} Tag(s)
                                </button>
                            </div>
                        </div>
                    </div>

                    <div className="table-container">
                        <table className="table">
                            <thead>
                                <tr>
                                    <th>
                                        <input
                                            type="checkbox"
                                            checked={selected.length === books.length && books.length > 0}
                                            onChange={(e) => (e.target.checked ? selectAll() : clearSelection())}
                                        />
                                    </th>
                                    <th>Book Number</th>
                                    <th>Title</th>
                                    <th>Author</th>
                                    <th>Category</th>
                                </tr>
                            </thead>
                            <tbody>
                                {books.map((book) => (
                                    <tr key={book.id}>
                                        <td>
                                            <input
                                                type="checkbox"
                                                checked={selected.includes(book.id)}
                                                onChange={() => toggle(book.id)}
                                            />
                                        </td>
                                        <td><strong>{book.book_number}</strong></td>
                                        <td>{book.title}</td>
                                        <td>{book.author || 'N/A'}</td>
                                        <td>{book.category || 'N/A'}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            {selectedData.length > 0 && (
                <div className="print-only">
                    <style>{`
            @media print {
              @page {
                size: A4 portrait;
                margin: 0.5cm;
              }
              .no-print { display: none !important; }
              .print-only { display: block !important; }
              .asset-tag {
                page-break-inside: avoid;
                break-inside: avoid;
                border: 2px solid #000;
                padding: 0.35cm;
                width: 100%;
                height: 4.5cm;
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                background: white;
                color: black;
                border-radius: 6px;
                gap: 0.15cm;
              }
              .tag-grid {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(6.5cm, 1fr));
                gap: 0.35cm;
                padding: 0.2cm;
              }
              body { background: white; }
            }
            .print-only { display: none; }
          `}</style>

                    <div className="tag-grid">
                        {selectedData.map((book) => (
                            <div key={book.id} className="asset-tag">
                                <div style={{ marginBottom: '0.2cm' }}>
                                    <QRCode value={book.book_number} size={96} />
                                </div>
                                <div style={{ fontSize: '16px', fontWeight: 'bold', textAlign: 'center', marginBottom: '0.2cm' }}>
                                    {book.book_number}
                                </div>
                                <div style={{ fontSize: '11px', textAlign: 'center', marginBottom: '0.1cm' }}>
                                    {book.title}
                                </div>
                                <div style={{ fontSize: '10px', textAlign: 'center', color: '#666' }}>
                                    {book.author || ''}
                                </div>
                                <div style={{ fontSize: '8px', textAlign: 'center', marginTop: '0.2cm', color: '#999' }}>
                                    London Academy for Applied Technology
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
