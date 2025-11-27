import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { employeesAPI } from '../services/api';

export default function EmployeeList() {
    const [employees, setEmployees] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showModal, setShowModal] = useState(false);
    const [editingEmployee, setEditingEmployee] = useState(null);
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

    async function handleDelete(id) {
        if (!confirm('Are you sure you want to delete this employee?')) return;

        try {
            await employeesAPI.delete(id);
            loadEmployees();
        } catch (error) {
            alert('Error deleting employee: ' + error.message);
        }
    }

    if (loading) {
        return <div className="spinner"></div>;
    }

    return (
        <div>
            <div className="flex justify-between items-center mb-3">
                <h2>Employee Management</h2>
                <button onClick={() => openModal()} className="btn btn-primary">
                    + Add Employee
                </button>
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
                                <th>Assigned Assets</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {employees.length === 0 ? (
                                <tr>
                                    <td colSpan="6" className="text-center text-muted">
                                        No employees found
                                    </td>
                                </tr>
                            ) : (
                                employees.map((employee) => (
                                    <tr key={employee.id}>
                                        <td>
                                            <Link to={`/employees/${employee.id}`} className="text-primary">
                                                <strong>{employee.name}</strong>
                                            </Link>
                                        </td>
                                        <td>{employee.email}</td>
                                        <td>{employee.department || 'N/A'}</td>
                                        <td>{employee.phone || 'N/A'}</td>
                                        <td>
                                            <span className="badge badge-info">
                                                {employee.asset_count || 0}
                                            </span>
                                        </td>
                                        <td>
                                            <div className="flex gap-1">
                                                <button
                                                    onClick={() => openModal(employee)}
                                                    className="btn btn-sm btn-secondary"
                                                >
                                                    Edit
                                                </button>
                                                <button
                                                    onClick={() => handleDelete(employee.id)}
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
