import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import * as XLSX from 'xlsx';
import { booksAPI } from '../services/api';

export default function BookList() {
    const [books, setBooks] = useState([]);
    const [loading, setLoading] = useState(true);
    const [importing, setImporting] = useState(false);
    const [filters, setFilters] = useState({ search: '', category: '', availability: '' });

    useEffect(() => {
        loadBooks();
    }, [filters]);

    async function loadBooks() {
        try {
            setLoading(true);
            const params = {};
            if (filters.search) params.search = filters.search;
            if (filters.category) params.category = filters.category;
            if (filters.availability) params.availability = filters.availability;
            const data = await booksAPI.getAll(params);
            setBooks(data);
        } catch (error) {
            console.error('Error loading books:', error);
        } finally {
            setLoading(false);
        }
    }

    async function handleDelete(id) {
        if (!confirm('Are you sure you want to delete this book?')) return;
        try {
            await booksAPI.delete(id);
            loadBooks();
        } catch (error) {
            alert('Error deleting book: ' + error.message);
        }
    }

    async function handleExport() {
        try {
            await booksAPI.exportInventory();
        } catch (error) {
            alert('Export failed: ' + error.message);
        }
    }

    function normalizeRow(row) {
        const normalized = {};
        Object.keys(row).forEach((key) => {
            const safeKey = key ? key.toString().trim().toLowerCase() : '';
            normalized[safeKey] = row[key];
        });
        return normalized;
    }

    function mapRowToBook(row) {
        const data = normalizeRow(row);
        return {
            title: data['title'] || data['book title'] || data['name'] || '',
            author: data['author'] || '',
            isbn: data['isbn'] || '',
            category: data['category'] || data['genre'] || '',
            publisher: data['publisher'] || '',
            published_year: data['published year'] || data['year'] || '',
            quantity: data['quantity'] || data['copies'] || data['qty'] || '',
            shelf_location: data['shelf location'] || data['shelf'] || data['location'] || '',
            campus: data['campus'] || '',
            notes: data['notes'] || ''
        };
    }

    async function handleImportFile(file) {
        if (!file) return;
        setImporting(true);
        try {
            const buffer = await file.arrayBuffer();
            const workbook = XLSX.read(buffer, { type: 'array' });
            const sheet = workbook.Sheets[workbook.SheetNames[0]];
            const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
            const items = rows.map(mapRowToBook).filter((item) => item.title);
            if (items.length === 0) {
                alert('No valid rows found (a Title column is required).');
                return;
            }
            const result = await booksAPI.importBulk(items);
            alert(`Imported ${result.inserted} book(s) successfully.`);
            loadBooks();
        } catch (error) {
            alert('Import failed: ' + error.message);
        } finally {
            setImporting(false);
        }
    }

    return (
        <div>
            <div className="flex justify-between items-center mb-3">
                <h2>Library — Books</h2>
                <div className="flex gap-2">
                    <button onClick={handleExport} className="btn btn-secondary">
                        Export CSV
                    </button>
                    <Link to="/library/rapid" className="btn btn-secondary">
                        ⚡ Rapid Catalogue
                    </Link>
                    <Link to="/books/new" className="btn btn-primary">
                        + Add New Book
                    </Link>
                </div>
            </div>

            <div className="card mb-3">
                <div className="card-body">
                    <div className="grid grid-3">
                        <div className="form-group">
                            <input
                                type="text"
                                className="form-control"
                                placeholder="Search by title, author, ISBN or number..."
                                value={filters.search}
                                onChange={(e) => setFilters({ ...filters, search: e.target.value })}
                            />
                        </div>
                        <div className="form-group">
                            <input
                                type="text"
                                className="form-control"
                                placeholder="Filter by category / genre"
                                value={filters.category}
                                onChange={(e) => setFilters({ ...filters, category: e.target.value })}
                            />
                        </div>
                        <div className="form-group">
                            <select
                                className="form-control"
                                value={filters.availability}
                                onChange={(e) => setFilters({ ...filters, availability: e.target.value })}
                            >
                                <option value="">All Books</option>
                                <option value="available">Available Only</option>
                                <option value="out_of_stock">Out of Stock</option>
                            </select>
                        </div>
                    </div>
                </div>
            </div>

            <div className="card mb-3">
                <div className="card-header">
                    <h3 className="card-title">Import Books (Excel)</h3>
                </div>
                <div className="card-body">
                    <p className="text-muted">
                        Upload .xlsx or .xls with columns: Title, Author, ISBN, Category, Publisher, Year, Quantity,
                        Shelf Location, Campus, Notes. Each row becomes a new book with an auto-generated number.
                    </p>
                    <div className="flex gap-2 items-center">
                        <input
                            type="file"
                            accept=".xlsx,.xls"
                            onChange={(e) => handleImportFile(e.target.files?.[0])}
                            disabled={importing}
                        />
                        {importing && <span className="text-muted">Importing...</span>}
                    </div>
                </div>
            </div>

            {loading ? (
                <div className="spinner"></div>
            ) : (
                <div className="card">
                    <div className="table-container">
                        <table className="table">
                            <thead>
                                <tr>
                                    <th>Book Number</th>
                                    <th>Title</th>
                                    <th>Author</th>
                                    <th>Category</th>
                                    <th>Copies</th>
                                    <th>Available</th>
                                    <th>Shelf</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {books.length === 0 ? (
                                    <tr>
                                        <td colSpan="8" className="text-center text-muted">
                                            No books found
                                        </td>
                                    </tr>
                                ) : (
                                    books.map((book) => (
                                        <tr key={book.id}>
                                            <td>
                                                <Link to={`/books/${book.id}`} className="text-primary">
                                                    <strong>{book.book_number}</strong>
                                                </Link>
                                            </td>
                                            <td>{book.title}</td>
                                            <td>{book.author || 'N/A'}</td>
                                            <td>{book.category || 'N/A'}</td>
                                            <td>{book.quantity}</td>
                                            <td>
                                                <span className={`badge badge-${book.available_quantity > 0 ? 'success' : 'danger'}`}>
                                                    {book.available_quantity} / {book.quantity}
                                                </span>
                                            </td>
                                            <td>{book.shelf_location || '-'}</td>
                                            <td>
                                                <div className="flex gap-1">
                                                    <Link to={`/books/${book.id}`} className="btn btn-sm btn-secondary">
                                                        View
                                                    </Link>
                                                    <Link to={`/books/${book.id}/edit`} className="btn btn-sm btn-secondary">
                                                        Edit
                                                    </Link>
                                                    <button
                                                        onClick={() => handleDelete(book.id)}
                                                        className="btn btn-sm btn-danger"
                                                    >
                                                        Delete
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
            )}
        </div>
    );
}
