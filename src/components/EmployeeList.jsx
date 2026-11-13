import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { employeesAPI } from '../services/api';

export default function EmployeeList() {
    const [employees, setEmployees] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showModal, setShowModal] = useState(false);
    const [editingEmployee, setEditingEmployee] = useState(null);
    const [statusFilter, setStatusFilter] = useState('active');
    const [search, setSearch] = useState('');
    const [leaving, setLeaving] = useState(null); // the employee being marked inactive
    const [leavingNote, setLeavingNote] = useState('');
    const [formData, setFormData] = useState({
        name: '',
        email: '',
        department: '',
        phone: ''
    });

    useEffect(() => {
        loadEmployees();
    }, []);

    async function loadEmployees() {
        try {
            const data = await employeesAPI.getAll();
            setEmployees(data);
        } catch (error) {
            console.error('Error loading employees:', error);
        } finally {
            setLoading(false);
        }
    }

    function openModal(employee = null) {
        if (employee) {
            setEditingEmployee(employee);
            setFormData({
                name: employee.name,
                email: employee.email,
                department: employee.department || '',
                phone: employee.phone || ''
            });
        } else {
            setEditingEmployee(null);
            setFormData({ name: '', email: '', department: '', phone: '' });
        }
        setShowModal(true);
    }

    async function handleSubmit(e) {
        e.preventDefault();

        try {
            if (editingEmployee) {
                await employeesAPI.update(editingEmployee.id, formData);
            } else {
                await employeesAPI.create(formData);
            }
            setShowModal(false);
            loadEmployees();
        } catch (error) {
            alert('Error saving employee: ' + error.message);
        }
    }

    // Only offered for a record with no asset history (added by mistake).
    async function handleDelete(employee) {
        if (!confirm(`Delete ${employee.name}? This is only possible because they have no asset history.`)) return;

        try {
            await employeesAPI.delete(employee.id);
            loadEmployees();
        } catch (error) {
            alert(error.message);
        }
    }

    async function confirmLeaving(e) {
        e.preventDefault();
        try {
            await employeesAPI.deactivate(leaving.id, leavingNote);
            setLeaving(null);
            setLeavingNote('');
            loadEmployees();
        } catch (error) {
            alert(error.message);
        }
    }

    async function handleReactivate(employee) {
        if (!confirm(`Mark ${employee.name} as active again?`)) return;
        try {
            await employeesAPI.reactivate(employee.id);
            loadEmployees();
        } catch (error) {
            alert(error.message);
        }
    }

    const counts = {
        active: employees.filter((emp) => emp.status !== 'inactive').length,
        inactive: employees.filter((emp) => emp.status === 'inactive').length,
        all: employees.length
    };
    const term = search.trim().toLowerCase();
    const visible = employees.filter((emp) => {
        if (statusFilter === 'active' && emp.status === 'inactive') return false;
        if (statusFilter === 'inactive' && emp.status !== 'inactive') return false;
        if (!term) return true;
        return [emp.name, emp.email, emp.department].some((v) => (v || '').toLowerCase().includes(term));
    });

    if (loading) {
        return <div className="spinner"></div>;
    }

    return (
        <div>
            <div className="flex justify-between items-center mb-3">
                <h2>Employee Management</h2>
                <button onClick={() => openModal()} className="write-only btn btn-primary">
                    + Add Employee
                </button>
            </div>

            <div className="flex justify-between items-center mb-3">
                <div className="tabs" style={{ marginBottom: 0 }}>
                    {[['active', 'Active'], ['inactive', 'Inactive'], ['all', 'All']].map(([key, label]) => (
                        <button
                            key={key}
                            type="button"
                            className={`tab ${statusFilter === key ? 'active' : ''}`}
                            onClick={() => setStatusFilter(key)}
                        >
                            {label} ({counts[key]})
                        </button>
                    ))}
                </div>
                <input
                    type="search"
                    className="form-control"
                    style={{ maxWidth: '320px' }}
                    placeholder="Search name, email or department"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                />
            </div>

            <div className="card">
                <div className="table-container">
                    <table className="table">
                        <thead>
                            <tr>
                                <th>Name</th>
                                <th>Email</th>
                                <th>Department</th>
                                <th>Phone</th>
                                <th>Status</th>
                                <th>Assigned Assets</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {visible.length === 0 ? (
                                <tr>
                                    <td colSpan="7" className="text-center text-muted">
                                        No employees found
                                    </td>
                                </tr>
                            ) : (
                                visible.map((employee) => {
                                    const inactive = employee.status === 'inactive';
                                    return (
                                        <tr key={employee.id}>
                                            <td>
                                                <Link to={`/employees/${employee.id}`} className="text-primary">
                                                    <strong>{employee.name}</strong>
                                                </Link>
                                            </td>
                                            <td>{employee.email}</td>
                                            <td>{employee.department || '—'}</td>
                                            <td>{employee.phone || '—'}</td>
                                            <td>
                                                <span
                                                    className={`badge badge-${inactive ? 'warning' : 'success'}`}
                                                    title={inactive && employee.deactivated_at
                                                        ? `Since ${new Date(employee.deactivated_at).toLocaleDateString()}${employee.deactivation_note ? ` — ${employee.deactivation_note}` : ''}`
                                                        : undefined}
                                                >
                                                    {inactive ? 'Inactive' : 'Active'}
                                                </span>
                                            </td>
                                            <td>
                                                <span className="badge badge-info">
                                                    {employee.asset_count || 0}
                                                </span>
                                            </td>
                                            <td>
                                                <div className="flex gap-1">
                                                    <button
                                                        onClick={() => openModal(employee)}
                                                        className="write-only btn btn-sm btn-secondary"
                                                    >
                                                        Edit
                                                    </button>
                                                    {inactive ? (
                                                        <button
                                                            onClick={() => handleReactivate(employee)}
                                                            className="write-only btn btn-sm btn-secondary"
                                                        >
                                                            Reactivate
                                                        </button>
                                                    ) : (
                                                        <button
                                                            onClick={() => { setLeaving(employee); setLeavingNote(''); }}
                                                            className="write-only btn btn-sm btn-secondary"
                                                        >
                                                            Mark inactive
                                                        </button>
                                                    )}
                                                    {!employee.has_history && (
                                                        <button
                                                            onClick={() => handleDelete(employee)}
                                                            className="write-only btn btn-sm btn-danger"
                                                        >
                                                            Delete
                                                        </button>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {leaving && (
                <div className="modal-overlay" onClick={() => setLeaving(null)}>
                    <div className="modal" onClick={(e) => e.stopPropagation()}>
                        <h3>Mark {leaving.name} inactive</h3>
                        <p className="text-muted">
                            Their record and the full history of what they used are kept. They can no longer
                            be assigned anything, and can be reactivated at any time.
                        </p>
                        {leaving.asset_count > 0 && (
                            <div className="alert alert-warning">
                                {leaving.name} still holds {leaving.asset_count} asset{leaving.asset_count === 1 ? '' : 's'}.
                                Return or reassign {leaving.asset_count === 1 ? 'it' : 'them'} first.
                            </div>
                        )}
                        <form onSubmit={confirmLeaving}>
                            <div className="form-group mt-3">
                                <label className="form-label">Reason (kept in the activity log)</label>
                                <input
                                    type="text"
                                    className="form-control"
                                    value={leavingNote}
                                    onChange={(e) => setLeavingNote(e.target.value)}
                                    placeholder="e.g. Left the organisation on 30 November"
                                    maxLength={300}
                                />
                            </div>
                            <div className="flex gap-2 mt-3">
                                <button type="button" onClick={() => setLeaving(null)} className="btn btn-secondary">
                                    Cancel
                                </button>
                                <button type="submit" className="btn btn-primary" disabled={leaving.asset_count > 0}>
                                    Mark inactive
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {showModal && (
                <div className="modal-overlay" onClick={() => setShowModal(false)}>
                    <div className="modal" onClick={(e) => e.stopPropagation()}>
                        <h3>{editingEmployee ? 'Edit Employee' : 'Add New Employee'}</h3>
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

                            <div className="form-group">
                                <label className="form-label">Email *</label>
                                <input
                                    type="email"
                                    className="form-control"
                                    value={formData.email}
                                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                                    required
                                />
                            </div>

                            <div className="form-group">
                                <label className="form-label">Department</label>
                                <input
                                    type="text"
                                    className="form-control"
                                    value={formData.department}
                                    onChange={(e) => setFormData({ ...formData, department: e.target.value })}
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

                            <div className="flex gap-2 mt-3">
                                <button
                                    type="button"
                                    onClick={() => setShowModal(false)}
                                    className="btn btn-secondary"
                                >
                                    Cancel
                                </button>
                                <button type="submit" className="btn btn-primary">
                                    {editingEmployee ? 'Update' : 'Create'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
