import React, { useState, useEffect } from 'react';

const API_BASE = 'http://localhost:3001/api';

export default function CategoryManagement() {
    const [categories, setCategories] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showModal, setShowModal] = useState(false);
    const [editingCategory, setEditingCategory] = useState(null);
    const [formData, setFormData] = useState({
        name: '',
        description: ''
    });

    useEffect(() => {
        loadCategories();
    }, []);

    async function loadCategories() {
        try {
            const response = await fetch(`${API_BASE}/categories`);
            const data = await response.json();
            setCategories(data);
        } catch (error) {
            console.error('Error loading categories:', error);
        } finally {
            setLoading(false);
        }
    }

    function openModal(category = null) {
        if (category) {
            setEditingCategory(category);
            setFormData({
                name: category.name,
                description: category.description || ''
            });
        } else {
            setEditingCategory(null);
            setFormData({ name: '', description: '' });
        }
        setShowModal(true);
    }

    async function handleSubmit(e) {
        e.preventDefault();

        try {
            const url = editingCategory
                ? `${API_BASE}/categories/${editingCategory.id}`
                : `${API_BASE}/categories`;

            const method = editingCategory ? 'PUT' : 'POST';

            const response = await fetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(formData)
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || 'Failed to save category');
            }

            setShowModal(false);
            loadCategories();
        } catch (error) {
            alert('Error saving category: ' + error.message);
        }
    }

    async function handleDelete(id) {
        if (!confirm('Are you sure you want to delete this category?')) return;

        try {
            const response = await fetch(`${API_BASE}/categories/${id}`, {
                method: 'DELETE'
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || 'Failed to delete category');
            }

            loadCategories();
        } catch (error) {
            alert('Error deleting category: ' + error.message);
        }
    }

    if (loading) {
        return <div className="spinner"></div>;
    }

    return (
        <div>
            <div className="flex justify-between items-center mb-3">
                <h2>Category Management</h2>
                <button onClick={() => openModal()} className="btn btn-primary">
                    + Add Category
                </button>
            </div>

            <div className="card">
                <div className="card-body">
                    <p className="text-muted mb-2">
                        Manage asset categories. Categories help organize your assets into logical groups.
                    </p>
                </div>

                <div className="table-container">
                    <table className="table">
                        <thead>
                            <tr>
                                <th>Name</th>
                                <th>Description</th>
                                <th>Created</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {categories.length === 0 ? (
                                <tr>
                                    <td colSpan="4" className="text-center text-muted">
                                        No categories found
                                    </td>
                                </tr>
                            ) : (
                                categories.map((category) => (
                                    <tr key={category.id}>
                                        <td><strong>{category.name}</strong></td>
                                        <td>{category.description || 'No description'}</td>
                                        <td>{new Date(category.created_at).toLocaleDateString()}</td>
                                        <td>
                                            <div className="flex gap-1">
                                                <button
                                                    onClick={() => openModal(category)}
                                                    className="btn btn-sm btn-secondary"
                                                >
                                                    Edit
                                                </button>
                                                <button
                                                    onClick={() => handleDelete(category.id)}
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

            {showModal && (
                <div className="modal-overlay" onClick={() => setShowModal(false)}>
                    <div className="modal" onClick={(e) => e.stopPropagation()}>
                        <h3>{editingCategory ? 'Edit Category' : 'Add New Category'}</h3>
                        <form onSubmit={handleSubmit}>
                            <div className="form-group mt-3">
                                <label className="form-label">Category Name *</label>
                                <input
                                    type="text"
                                    className="form-control"
                                    value={formData.name}
                                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                    required
                                    placeholder="e.g., Laptop, Desktop, Tablet"
                                />
                            </div>

                            <div className="form-group">
                                <label className="form-label">Description</label>
                                <textarea
                                    className="form-control"
                                    value={formData.description}
                                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                                    rows="3"
                                    placeholder="Brief description of this category..."
                                ></textarea>
                            </div>

                            <div className="flex gap-2 mt-3">
                                <button
                                    type="button"
                                    onClick={() => setShowModal(false)}
                                    className="btn btn-secondary"
                                >
                                    Cancel
                                </button>
                                <button type="submit" className="btn btn-primary">
                                    {editingCategory ? 'Update' : 'Create'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
