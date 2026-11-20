import React, { useState, useEffect } from 'react';
import { usersAPI, authAPI } from '../services/api';

const EMPTY = { name: '', email: '', role: 'viewer', password: '' };

// Most access first. `can` is shown under the role picker and in the key.
export const ROLES = [
    { value: 'admin', label: 'Admin', badge: 'info', can: 'Everything, including users and settings.' },
    { value: 'subadmin', label: 'Sub-admin', badge: 'primary', can: 'Day-to-day work: add, edit, assign, return and move assets; library; reports. No users or settings.' },
    { value: 'inventory', label: 'Viewer + downloads', badge: 'success', can: 'Sees assets, employees, inventory and reports, and can download them. Cannot change anything.' },
    { value: 'viewer', label: 'Viewer', badge: 'warning', can: 'Sees assets, employees, inventory and reports. No downloads, no changes.' }
];
const roleInfo = (value) => ROLES.find((r) => r.value === value) || { label: value, badge: 'primary', can: '' };

export default function UserManagement({ currentUser }) {
    const [users, setUsers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showModal, setShowModal] = useState(false);
    const [editing, setEditing] = useState(null);
    const [formData, setFormData] = useState(EMPTY);
    const [error, setError] = useState('');
    // With Microsoft sign-in on, an account needs no password of its own.
    const [ssoEnabled, setSsoEnabled] = useState(false);
    // Staff who can already see their own assets but have no account here.
    const [staff, setStaff] = useState([]);

    const isAdmin = currentUser?.role === 'admin';

    useEffect(() => {
        if (isAdmin) loadUsers();
        else setLoading(false);
        authAPI.ssoConfig().then((c) => setSsoEnabled(Boolean(c.enabled))).catch(() => {});
    }, [isAdmin]);

    async function loadUsers() {
        try {
            setLoading(true);
            const [data, candidates] = await Promise.all([
                usersAPI.getAll(),
                usersAPI.staffCandidates().catch(() => [])
            ]);
            setUsers(data);
            setStaff(candidates);
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
                    password: formData.password || undefined,
                    remove_password: formData.remove_password || undefined
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

            <div className="card mb-3">
                <div className="card-body">
                    <p style={{ marginTop: 0 }}>
                        Everyone on the Employees list can already sign in with Microsoft and see <strong>their own
                        assets only</strong>{staff.length > 0 ? ` (${staff.length} people have just that)` : ''}. Add
                        someone here to give them more.
                    </p>
                    <div className="role-key">
                        {ROLES.map((r) => (
                            <div key={r.value}>
                                <span className={`badge badge-${r.badge}`}>{r.label}</span>
                                <span className="text-muted"> {r.can}</span>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            <div className="card">
                <div className="table-container">
                    <table className="table">
                        <thead>
                            <tr>
                                <th>Name</th>
                                <th>Email</th>
                                <th>Role</th>
                                <th>Signs in with</th>
                                <th>Created</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {users.map((u) => (
                                <tr key={u.id}>
                                    <td>{u.name || '—'}</td>
                                    <td>{u.email}{String(u.id) === String(currentUser.id) && <span className="text-muted"> (you)</span>}</td>
                                    <td><span className={`badge badge-${roleInfo(u.role).badge}`}>{roleInfo(u.role).label}</span></td>
                                    <td>{u.has_password ? 'Password' : 'Microsoft only'}{u.has_password && ssoEnabled ? ' or Microsoft' : ''}</td>
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
                            {!editing && staff.length > 0 && (
                                <div className="form-group mt-3">
                                    <label className="form-label">Choose from the staff list</label>
                                    <select
                                        className="form-control" value=""
                                        onChange={(e) => {
                                            const person = staff.find((s) => String(s.id) === e.target.value);
                                            if (person) setFormData({ ...formData, name: person.name, email: person.email });
                                        }}
                                    >
                                        <option value="">Select a member of staff…</option>
                                        {staff.map((s) => (
                                            <option key={s.id} value={s.id}>
                                                {s.name} — {s.email}{s.department ? ` (${s.department})` : ''}
                                            </option>
                                        ))}
                                    </select>
                                    <div className="text-muted" style={{ fontSize: '0.85rem' }}>
                                        Fills in the name and email below, or type them yourself.
                                    </div>
                                </div>
                            )}
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
                                    {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                                </select>
                                <div className="text-muted" style={{ fontSize: '0.85rem' }}>{roleInfo(formData.role).can}</div>
                            </div>
                            <div className="form-group">
                                <label className="form-label">
                                    {editing
                                        ? 'Reset password (leave blank to keep)'
                                        : ssoEnabled ? 'Password (optional)' : 'Password *'}
                                </label>
                                <input type="password" className="form-control" value={formData.password}
                                    required={!editing && !ssoEnabled}
                                    disabled={Boolean(formData.remove_password)}
                                    autoComplete="new-password"
                                    onChange={(e) => setFormData({ ...formData, password: e.target.value })} />
                                {ssoEnabled && !editing && (
                                    <div className="text-muted" style={{ fontSize: '0.85rem' }}>
                                        Leave blank and they sign in with their Microsoft account — use their work
                                        email address above.
                                    </div>
                                )}
                                {ssoEnabled && editing?.has_password ? (
                                    <label className="flex items-center gap-1 mt-1">
                                        <input type="checkbox" checked={Boolean(formData.remove_password)}
                                            onChange={(e) => setFormData({ ...formData, remove_password: e.target.checked, password: '' })} />
                                        <span>Remove the password — Microsoft sign-in only</span>
                                    </label>
                                ) : null}
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
