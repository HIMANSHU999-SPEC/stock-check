import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { booksAPI } from '../services/api';

const EMPTY = {
    title: '',
    author: '',
    isbn: '',
    category: '',
    publisher: '',
    published_year: '',
    quantity: 1,
    shelf_location: '',
    campus: '',
    notes: ''
};

export default function BookForm() {
    const { id } = useParams();
    const navigate = useNavigate();
    const isEdit = Boolean(id);
    const [formData, setFormData] = useState(EMPTY);
    const [loading, setLoading] = useState(isEdit);
    const [saving, setSaving] = useState(false);
    const [showMore, setShowMore] = useState(false);
    const [isbnQuery, setIsbnQuery] = useState('');
    const [lookingUp, setLookingUp] = useState(false);
    const [lookupMsg, setLookupMsg] = useState('');
    const [lookupOk, setLookupOk] = useState(false);

    async function handleIsbnLookup(e) {
        if (e) e.preventDefault();
        const isbn = isbnQuery.replace(/[^0-9Xx]/g, '');
        if (!isbn) {
            setLookupOk(false);
            setLookupMsg('Scan or type an ISBN first.');
            return;
        }
        setLookingUp(true);
        setLookupMsg('');
        try {
            const meta = await booksAPI.lookupIsbn(isbn);
            setFormData((prev) => ({
                ...prev,
                title: meta.title || prev.title,
                author: meta.author || prev.author,
                isbn: meta.isbn || isbn,
                publisher: meta.publisher || prev.publisher,
                published_year: meta.published_year || prev.published_year
            }));
            setShowMore(true);
            setLookupOk(true);
            setLookupMsg(
                `Found via ${meta.source}: "${meta.title}"` +
                (meta.existing ? ` — note: already in library as ${meta.existing.book_number}` : '')
            );
        } catch (err) {
            setLookupOk(false);
            setLookupMsg(err.message);
        } finally {
            setLookingUp(false);
        }
    }

    useEffect(() => {
        if (isEdit) {
            loadBook();
        }
    }, [id]);

    async function loadBook() {
        try {
            const data = await booksAPI.getById(id);
            setFormData({
                title: data.title || '',
                author: data.author || '',
                isbn: data.isbn || '',
                category: data.category || '',
                publisher: data.publisher || '',
                published_year: data.published_year || '',
                quantity: data.quantity || 1,
                shelf_location: data.shelf_location || '',
                campus: data.campus || '',
                notes: data.notes || ''
            });
        } catch (error) {
            alert('Error loading book: ' + error.message);
            navigate('/books');
        } finally {
            setLoading(false);
        }
    }

    function update(field, value) {
        setFormData((prev) => ({ ...prev, [field]: value }));
    }

    async function handleSubmit(e) {
        e.preventDefault();
        setSaving(true);
        try {
            if (isEdit) {
                await booksAPI.update(id, formData);
            } else {
                await booksAPI.create(formData);
            }
            navigate('/books');
        } catch (error) {
            alert('Error saving book: ' + error.message);
        } finally {
            setSaving(false);
        }
    }

    if (loading) {
        return <div className="spinner"></div>;
    }

    return (
        <div>
            <h2 className="mb-3">{isEdit ? 'Edit Book' : 'Add New Book'}</h2>
            <div className="card">
                <form onSubmit={handleSubmit}>
                    <div className="card-body">
                        <div className="card mb-3" style={{ background: 'var(--bg-tertiary)' }}>
                            <div className="card-body">
                                <label className="form-label">
                                    📷 Scan or type the ISBN to auto-fill details
                                </label>
                                <div className="flex gap-2">
                                    <input
                                        type="text"
                                        className="form-control"
                                        placeholder="e.g. 978-0-19-964299-1"
                                        value={isbnQuery}
                                        onChange={(e) => setIsbnQuery(e.target.value)}
                                        onKeyDown={(e) => { if (e.key === 'Enter') handleIsbnLookup(e); }}
                                        autoFocus={!isEdit}
                                    />
                                    <button
                                        type="button"
                                        className="btn btn-primary"
                                        onClick={handleIsbnLookup}
                                        disabled={lookingUp}
                                    >
                                        {lookingUp ? 'Looking up…' : 'Look up'}
                                    </button>
                                </div>
                                {lookupMsg && (
                                    <p style={{ marginTop: '0.5rem', color: lookupOk ? 'var(--success)' : 'var(--danger)' }}>
                                        {lookupMsg}
                                    </p>
                                )}
                                <p className="text-muted" style={{ fontSize: '0.8rem', marginTop: '0.35rem' }}>
                                    A handheld scanner reads the barcode and presses Enter automatically. Details come from
                                    Open Library / Google Books — check and adjust before saving.
                                </p>
                            </div>
                        </div>

                        <div className="grid grid-2">
                            <div className="form-group">
                                <label className="form-label">Title *</label>
                                <input
                                    type="text"
                                    className="form-control"
                                    value={formData.title}
                                    onChange={(e) => update('title', e.target.value)}
                                    required
                                />
                            </div>
                            <div className="form-group">
                                <label className="form-label">Number of Copies *</label>
                                <input
                                    type="number"
                                    min="1"
                                    className="form-control"
                                    value={formData.quantity}
                                    onChange={(e) => update('quantity', parseInt(e.target.value, 10) || 1)}
                                    required
                                />
                            </div>
                        </div>

                        <p className="text-muted" style={{ fontSize: '0.85rem', marginTop: '-0.25rem' }}>
                            Only a title is required — a book number and QR code are generated automatically.
                        </p>

                        <div className="form-group">
                            <button
                                type="button"
                                className="btn btn-sm btn-secondary"
                                onClick={() => setShowMore((v) => !v)}
                            >
                                {showMore ? 'Hide extra details' : '+ More details (optional)'}
                            </button>
                        </div>

                        {showMore && (
                            <>
                                <div className="grid grid-2">
                                    <div className="form-group">
                                        <label className="form-label">Author</label>
                                        <input
                                            type="text"
                                            className="form-control"
                                            value={formData.author}
                                            onChange={(e) => update('author', e.target.value)}
                                        />
                                    </div>
                                    <div className="form-group">
                                        <label className="form-label">Category / Genre</label>
                                        <input
                                            type="text"
                                            className="form-control"
                                            value={formData.category}
                                            onChange={(e) => update('category', e.target.value)}
                                        />
                                    </div>
                                </div>

                                <div className="grid grid-3">
                                    <div className="form-group">
                                        <label className="form-label">ISBN</label>
                                        <input
                                            type="text"
                                            className="form-control"
                                            value={formData.isbn}
                                            onChange={(e) => update('isbn', e.target.value)}
                                        />
                                    </div>
                                    <div className="form-group">
                                        <label className="form-label">Publisher</label>
                                        <input
                                            type="text"
                                            className="form-control"
                                            value={formData.publisher}
                                            onChange={(e) => update('publisher', e.target.value)}
                                        />
                                    </div>
                                    <div className="form-group">
                                        <label className="form-label">Published Year</label>
                                        <input
                                            type="number"
                                            className="form-control"
                                            value={formData.published_year}
                                            onChange={(e) => update('published_year', e.target.value)}
                                        />
                                    </div>
                                </div>

                                <div className="grid grid-2">
                                    <div className="form-group">
                                        <label className="form-label">Shelf Location</label>
                                        <input
                                            type="text"
                                            className="form-control"
                                            value={formData.shelf_location}
                                            onChange={(e) => update('shelf_location', e.target.value)}
                                        />
                                    </div>
                                    <div className="form-group">
                                        <label className="form-label">Campus</label>
                                        <input
                                            type="text"
                                            className="form-control"
                                            value={formData.campus}
                                            onChange={(e) => update('campus', e.target.value)}
                                        />
                                    </div>
                                </div>

                                <div className="form-group">
                                    <label className="form-label">Notes</label>
                                    <textarea
                                        className="form-control"
                                        rows="3"
                                        value={formData.notes}
                                        onChange={(e) => update('notes', e.target.value)}
                                    />
                                </div>
                            </>
                        )}
                    </div>
                    <div className="card-footer flex gap-2">
                        <button type="button" className="btn btn-secondary" onClick={() => navigate('/books')}>
                            Cancel
                        </button>
                        <button type="submit" className="btn btn-primary" disabled={saving}>
                            {saving ? 'Saving...' : isEdit ? 'Update Book' : 'Register Book'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
