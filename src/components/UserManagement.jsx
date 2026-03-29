import React, { useState, useEffect } from 'react';
import { usersAPI } from '../services/api';

export default function UserManagement() {
    const [users, setUsers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showForm, setShowForm] = useState(false);
    const [editUser, setEditUser] = useState(null);
    const [form, setForm] = useState({ name: '', email: '', password: '', role: 'subadmin' });
    const [saving, setSaving] = useState(false);
    const [alert, setAlert] = useState(null);
    const [deletingId, setDeletingId] = useState(null);

    useEffect(() => { loadUsers(); }, []);

    async function loadUsers() {
        try {
            const data = await usersAPI.getAll();
            setUsers(data);
        } catch (e) {
            setAlert({ type: 'danger', msg: 'Failed to load users: ' + e.message });
        } finally {
            setLoading(false);
        }
    }

    function openCreate() {
        setEditUser(null);
        setForm({ name: '', email: '', password: '', role: 'subadmin' });
        setShowForm(true);
    }

    function openEdit(user) {
        setEditUser(user);
        setForm({ name: user.name || '', email: user.email, password: '', role: user.role });
        setShowForm(true);
    }

    async function handleSubmit(e) {
        e.preventDefault();
        setSaving(true);
        setAlert(null);
        try {
            if (editUser) {
                const payload = { name: form.name, email: form.email, role: form.role };
                if (form.password) payload.password = form.password;
                await usersAPI.update(editUser.id, payload);
                setAlert({ type: 'success', msg: 'User updated successfully' });
            } else {
                await usersAPI.create(form);
                setAlert({ type: 'success', msg: 'User created successfully' });
            }
            setShowForm(false);
            loadUsers();
        } catch (e) {
            setAlert({ type: 'danger', msg: e.message });
        } finally {
            setSaving(false);
        }
    }

    async function handleDelete(user) {
        if (!confirm(`Delete user "${user.name || user.email}"? This cannot be undone.`)) return;
        setDeletingId(user.id);
        try {
            await usersAPI.delete(user.id);
            setAlert({ type: 'success', msg: 'User deleted' });
            loadUsers();
        } catch (e) {
            setAlert({ type: 'danger', msg: e.message });
        } finally {
            setDeletingId(null);
        }
    }

    if (loading) return <div className="spinner"></div>;

    return (
        <div>
            <div className="flex justify-between items-center mb-3">
                <h2>User Management</h2>
                <button className="btn btn-primary" onClick={openCreate}>+ Add User</button>
            </div>

            {alert && (
                <div className={`alert alert-${alert.type} mb-3`} style={{ padding: '0.75rem 1rem', borderRadius: '6px', background: alert.type === 'success' ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)', color: alert.type === 'success' ? 'var(--success)' : 'var(--danger)', border: `1px solid ${alert.type === 'success' ? 'var(--success)' : 'var(--danger)'}` }}>
                    {alert.msg}
                    <button onClick={() => setAlert(null)} style={{ float: 'right', background: 'none', border: 'none', cursor: 'pointer', color: 'inherit' }}>×</button>
                </div>
            )}

            <div className="card">
                <div className="card-header">
                    <h3 className="card-title">System Users</h3>
                    <p className="text-muted" style={{ margin: 0, fontSize: '0.875rem' }}>
                        Manage admin and sub-admin accounts. Only admins can access this page.
                    </p>
                </div>
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
                            {users.map(user => (
                                <tr key={user.id}>
                                    <td><strong>{user.name || '—'}</strong></td>
                                    <td>{user.email}</td>
                                    <td>
                                        <span className={`badge badge-${user.role === 'admin' ? 'primary' : 'info'}`}>
                                            {user.role}
                                        </span>
                                    </td>
                                    <td className="text-muted" style={{ fontSize: '0.85rem' }}>
                                        {user.created_at ? new Date(user.created_at).toLocaleDateString() : '—'}
                                    </td>
                                    <td>
                                        <button className="btn btn-sm btn-secondary" onClick={() => openEdit(user)} style={{ marginRight: '0.5rem' }}>
                                            Edit
                                        </button>
                                        <button
                                            className="btn btn-sm btn-danger"
                                            onClick={() => handleDelete(user)}
                                            disabled={deletingId === user.id}
                                        >
                                            {deletingId === user.id ? 'Deleting...' : 'Delete'}
                                        </button>
                                    </td>
                                </tr>
                            ))}
                            {users.length === 0 && (
                                <tr><td colSpan="5" className="text-center text-muted">No users found</td></tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {showForm && (
                <div className="modal-overlay" onClick={() => setShowForm(false)}>
                    <div className="modal" onClick={e => e.stopPropagation()}>
                        <h3>{editUser ? 'Edit User' : 'Add New User'}</h3>
                        <form onSubmit={handleSubmit}>
                            <div className="form-group mt-2">
                                <label className="form-label">Full Name</label>
                                <input
                                    className="form-control"
                                    value={form.name}
                                    onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                                    placeholder="e.g. John Smith"
                                />
                            </div>
                            <div className="form-group">
                                <label className="form-label">Email *</label>
                                <input
                                    className="form-control"
                                    type="email"
                                    required
                                    value={form.email}
                                    onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                                    placeholder="user@example.com"
                                />
                            </div>
                            <div className="form-group">
                                <label className="form-label">
                                    Password {editUser && <span className="text-muted">(leave blank to keep current)</span>}
                                </label>
                                <input
                                    className="form-control"
                                    type="password"
                                    required={!editUser}
                                    value={form.password}
                                    onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                                    placeholder={editUser ? 'New password (optional)' : 'Enter password'}
                                />
                            </div>
                            <div className="form-group">
                                <label className="form-label">Role *</label>
                                <select
                                    className="form-control"
                                    value={form.role}
                                    onChange={e => setForm(f => ({ ...f, role: e.target.value }))}
                                    required
                                >
                                    <option value="admin">Admin (full access)</option>
                                    <option value="subadmin">Sub-Admin (limited access)</option>
                                </select>
                            </div>
                            <div className="flex gap-2 mt-3">
                                <button type="submit" className="btn btn-primary" disabled={saving}>
                                    {saving ? 'Saving...' : editUser ? 'Update User' : 'Create User'}
                                </button>
                                <button type="button" className="btn btn-secondary" onClick={() => setShowForm(false)}>
                                    Cancel
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
