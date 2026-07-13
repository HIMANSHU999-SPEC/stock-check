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
                        <div className="grid grid-2">
                            <div className="form-group">
                                <label className="form-label">Title *</label>
                                <input
                                    type="text"
                                    className="form-control"
                                    value={formData.title}
                                    onChange={(e) => update('title', e.target.value)}
                                    required
                                    autoFocus
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
