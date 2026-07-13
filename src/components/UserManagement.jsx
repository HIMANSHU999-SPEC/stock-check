import React, { useState, useEffect } from 'react';
import { usersAPI } from '../services/api';

const EMPTY = { name: '', email: '', role: 'subadmin', password: '' };

export default function UserManagement({ currentUser }) {
    const [users, setUsers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showModal, setShowModal] = useState(false);
    const [editing, setEditing] = useState(null);
    const [formData, setFormData] = useState(EMPTY);
    const [error, setError] = useState('');

    const isAdmin = currentUser?.role === 'admin';

    useEffect(() => {
        if (isAdmin) loadUsers();
        else setLoading(false);
    }, [isAdmin]);

    async function loadUsers() {
        try {
            setLoading(true);
            const data = await usersAPI.getAll();
            setUsers(data);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }

    function openModal(user = null) {
        setError('');
        if (user) {
            setEditing(user);
            setFormData({ name: user.name || '', email: user.email, role: user.role, password: '' });
        } else {
            setEditing(null);
            setFormData(EMPTY);
        }
        setShowModal(true);
    }

    async function handleSubmit(e) {
        e.preventDefault();
        setError('');
        try {
            if (editing) {
                await usersAPI.update(editing.id, {
                    name: formData.name,
                    role: formData.role,
                    password: formData.password || undefined
                });
            } else {
                await usersAPI.create(formData);
            }
            setShowModal(false);
            loadUsers();
        } catch (err) {
            setError(err.message);
        }
    }

    async function handleDelete(user) {
        if (!confirm(`Delete user ${user.email}?`)) return;
        try {
            await usersAPI.delete(user.id);
            loadUsers();
        } catch (err) {
            alert('Error deleting user: ' + err.message);
        }
    }

    if (!isAdmin) {
        return (
            <div className="card">
                <div className="card-body">
                    <p className="text-muted">Only administrators can manage users.</p>
                </div>
            </div>
        );
    }

    if (loading) return <div className="spinner"></div>;

    return (
        <div>
            <div className="flex justify-between items-center mb-3">
                <h2>User Management</h2>
                <button onClick={() => openModal()} className="btn btn-primary">+ Add User</button>
            </div>

            {error && <div className="card mb-3"><div className="card-body" style={{ color: 'var(--danger,#ef4444)' }}>{error}</div></div>}

            <div className="card">
                <div className="table-container">
                    <table className="table">
                        <thead>
                            <tr>
                                <th>Name</th>
                                <th>Email</th>
                                <th>Role</th>
                                <th>Created</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {users.map((u) => (
                                <tr key={u.id}>
                                    <td>{u.name || '—'}</td>
                                    <td>{u.email}{String(u.id) === String(currentUser.id) && <span className="text-muted"> (you)</span>}</td>
                                    <td><span className={`badge badge-${u.role === 'admin' ? 'info' : 'primary'}`}>{u.role}</span></td>
                                    <td>{u.created_at ? new Date(u.created_at).toLocaleDateString() : '—'}</td>
                                    <td>
                                        <div className="flex gap-1">
                                            <button onClick={() => openModal(u)} className="btn btn-sm btn-secondary">Edit</button>
                                            <button onClick={() => handleDelete(u)} className="btn btn-sm btn-danger">Delete</button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            {showModal && (
                <div className="modal-overlay" onClick={() => setShowModal(false)}>
                    <div className="modal" onClick={(e) => e.stopPropagation()}>
                        <h3>{editing ? `Edit ${editing.email}` : 'Add New User'}</h3>
                        <form onSubmit={handleSubmit}>
                            <div className="form-group mt-3">
                                <label className="form-label">Name</label>
                                <input type="text" className="form-control" value={formData.name}
                                    onChange={(e) => setFormData({ ...formData, name: e.target.value })} />
                            </div>
                            <div className="form-group">
                                <label className="form-label">Email *</label>
                                <input type="email" className="form-control" value={formData.email} required
                                    disabled={!!editing}
                                    onChange={(e) => setFormData({ ...formData, email: e.target.value })} />
                            </div>
                            <div className="form-group">
                                <label className="form-label">Role</label>
                                <select className="form-control" value={formData.role}
                                    onChange={(e) => setFormData({ ...formData, role: e.target.value })}>
                                    <option value="subadmin">Sub-admin</option>
                                    <option value="admin">Admin</option>
                                </select>
                            </div>
                            <div className="form-group">
                                <label className="form-label">{editing ? 'Reset password (leave blank to keep)' : 'Password *'}</label>
                                <input type="password" className="form-control" value={formData.password}
                                    required={!editing}
                                    onChange={(e) => setFormData({ ...formData, password: e.target.value })} />
                            </div>
                            {error && <p style={{ color: 'var(--danger,#ef4444)' }}>{error}</p>}
                            <div className="flex gap-2 mt-3">
                                <button type="button" onClick={() => setShowModal(false)} className="btn btn-secondary">Cancel</button>
                                <button type="submit" className="btn btn-primary">{editing ? 'Save' : 'Create'}</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
