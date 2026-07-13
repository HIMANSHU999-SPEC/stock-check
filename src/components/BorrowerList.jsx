import React, { useState, useEffect } from 'react';
import { borrowersAPI } from '../services/api';
import { CAMPUSES } from '../constants';

const EMPTY = {
    name: '',
    type: 'student',
    identifier: '',
    email: '',
    class_dept: '',
    phone: '',
    campus: ''
};

export default function BorrowerList() {
    const [borrowers, setBorrowers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showModal, setShowModal] = useState(false);
    const [editing, setEditing] = useState(null);
    const [formData, setFormData] = useState(EMPTY);
    const [typeFilter, setTypeFilter] = useState('');
    const [search, setSearch] = useState('');

    useEffect(() => {
        loadBorrowers();
    }, [typeFilter, search]);

    async function loadBorrowers() {
        try {
            setLoading(true);
            const params = {};
            if (typeFilter) params.type = typeFilter;
            if (search) params.search = search;
            const data = await borrowersAPI.getAll(params);
            setBorrowers(data);
        } catch (error) {
            console.error('Error loading borrowers:', error);
        } finally {
            setLoading(false);
        }
    }

    function openModal(borrower = null) {
        if (borrower) {
            setEditing(borrower);
            setFormData({
                name: borrower.name || '',
                type: borrower.type || 'student',
                identifier: borrower.identifier || '',
                email: borrower.email || '',
                class_dept: borrower.class_dept || '',
                phone: borrower.phone || '',
                campus: borrower.campus || ''
            });
        } else {
            setEditing(null);
            setFormData(EMPTY);
        }
        setShowModal(true);
    }

    async function handleSubmit(e) {
        e.preventDefault();
        try {
            if (editing) {
                await borrowersAPI.update(editing.id, formData);
            } else {
                await borrowersAPI.create(formData);
            }
            setShowModal(false);
            loadBorrowers();
        } catch (error) {
            alert('Error saving borrower: ' + error.message);
        }
    }

    async function handleDelete(id) {
        if (!confirm('Are you sure you want to delete this borrower?')) return;
        try {
            await borrowersAPI.delete(id);
            loadBorrowers();
        } catch (error) {
            alert('Error deleting borrower: ' + error.message);
        }
    }

    return (
        <div>
            <div className="flex justify-between items-center mb-3">
                <h2>Borrowers (Students &amp; Staff)</h2>
                <button onClick={() => openModal()} className="btn btn-primary">
                    + Add Borrower
                </button>
            </div>

            <div className="card mb-3">
                <div className="card-body">
                    <div className="grid grid-2">
                        <div className="form-group">
                            <input
                                type="text"
                                className="form-control"
                                placeholder="Search by name, ID, email or class/department..."
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                            />
                        </div>
                        <div className="form-group">
                            <select
                                className="form-control"
                                value={typeFilter}
                                onChange={(e) => setTypeFilter(e.target.value)}
                            >
                                <option value="">All Types</option>
                                <option value="student">Students</option>
                                <option value="staff">Staff</option>
                            </select>
                        </div>
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
                                    <th>Name</th>
                                    <th>Type</th>
                                    <th>ID</th>
                                    <th>Class / Dept</th>
                                    <th>Email</th>
                                    <th>Phone</th>
                                    <th>On Loan</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {borrowers.length === 0 ? (
                                    <tr>
                                        <td colSpan="8" className="text-center text-muted">No borrowers found</td>
                                    </tr>
                                ) : (
                                    borrowers.map((b) => (
                                        <tr key={b.id}>
                                            <td><strong>{b.name}</strong></td>
                                            <td>
                                                <span className={`badge badge-${b.type === 'staff' ? 'info' : 'primary'}`}>
                                                    {b.type}
                                                </span>
                                            </td>
                                            <td>{b.identifier || 'N/A'}</td>
                                            <td>{b.class_dept || 'N/A'}</td>
                                            <td>{b.email || 'N/A'}</td>
                                            <td>{b.phone || 'N/A'}</td>
                                            <td>
                                                <span className="badge badge-info">{b.active_loans || 0}</span>
                                            </td>
                                            <td>
                                                <div className="flex gap-1">
                                                    <button onClick={() => openModal(b)} className="btn btn-sm btn-secondary">
                                                        Edit
                                                    </button>
                                                    <button onClick={() => handleDelete(b.id)} className="btn btn-sm btn-danger">
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

            {showModal && (
                <div className="modal-overlay" onClick={() => setShowModal(false)}>
                    <div className="modal" onClick={(e) => e.stopPropagation()}>
                        <h3>{editing ? 'Edit Borrower' : 'Add New Borrower'}</h3>
                        <form onSubmit={handleSubmit}>
                            <div className="form-group mt-3">
                                <label className="form-label">Name *</label>
                                <input
                                    type="text"
                                    className="form-control"
                                    value={formData.name}
                                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                    required
                                />
                            </div>
                            <div className="grid grid-2">
                                <div className="form-group">
                                    <label className="form-label">Type *</label>
                                    <select
                                        className="form-control"
                                        value={formData.type}
                                        onChange={(e) => setFormData({ ...formData, type: e.target.value })}
                                    >
                                        <option value="student">Student</option>
                                        <option value="staff">Staff</option>
                                    </select>
                                </div>
                                <div className="form-group">
                                    <label className="form-label">
                                        {formData.type === 'staff' ? 'Staff ID' : 'Student ID'}
                                    </label>
                                    <input
                                        type="text"
                                        className="form-control"
                                        value={formData.identifier}
                                        onChange={(e) => setFormData({ ...formData, identifier: e.target.value })}
                                    />
                                </div>
                            </div>
                            <div className="grid grid-2">
                                <div className="form-group">
                                    <label className="form-label">
                                        {formData.type === 'staff' ? 'Department' : 'Class / Year'}
                                    </label>
                                    <input
                                        type="text"
                                        className="form-control"
                                        value={formData.class_dept}
                                        onChange={(e) => setFormData({ ...formData, class_dept: e.target.value })}
                                    />
                                </div>
                                <div className="form-group">
                                    <label className="form-label">Campus</label>
                                    <select
                                        className="form-control"
                                        value={formData.campus}
                                        onChange={(e) => setFormData({ ...formData, campus: e.target.value })}
                                    >
                                        <option value="">— Select campus —</option>
                                        {CAMPUSES.map((c) => <option key={c} value={c}>{c}</option>)}
                                        {formData.campus && !CAMPUSES.includes(formData.campus) && (
                                            <option value={formData.campus}>{formData.campus}</option>
                                        )}
                                    </select>
                                </div>
                            </div>
                            <div className="grid grid-2">
                                <div className="form-group">
                                    <label className="form-label">Email</label>
                                    <input
                                        type="email"
                                        className="form-control"
                                        value={formData.email}
                                        onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                                    />
                                </div>
                                <div className="form-group">
                                    <label className="form-label">Phone</label>
                                    <input
                                        type="tel"
                                        className="form-control"
                                        value={formData.phone}
                                        onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                                    />
                                </div>
                            </div>
                            <div className="flex gap-2 mt-3">
                                <button type="button" onClick={() => setShowModal(false)} className="btn btn-secondary">
                                    Cancel
                                </button>
                                <button type="submit" className="btn btn-primary">
                                    {editing ? 'Update' : 'Create'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
