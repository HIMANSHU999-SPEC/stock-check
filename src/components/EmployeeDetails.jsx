import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { employeesAPI, assetsAPI } from '../services/api';

export default function EmployeeDetails() {
    const { id } = useParams();
    const navigate = useNavigate();
    const [employee, setEmployee] = useState(null);
    const [loading, setLoading] = useState(true);
    const [exporting, setExporting] = useState(false);

    useEffect(() => {
        loadEmployee();
    }, [id]);

    async function loadEmployee() {
        try {
            setLoading(true);
            const data = await employeesAPI.getById(id);
            setEmployee(data);
        } catch (error) {
            alert('Error loading employee: ' + error.message);
            navigate('/employees');
        } finally {
            setLoading(false);
        }
    }

    async function handleExport() {
        try {
            setExporting(true);
            await employeesAPI.exportReport(id);
        } catch (error) {
            alert('Export failed: ' + error.message);
        } finally {
            setExporting(false);
        }
    }

    if (loading) {
        return <div className="spinner"></div>;
    }

    if (!employee) {
        return <div>Employee not found</div>;
    }

    return (
        <div>
            <div className="flex justify-between items-center mb-3">
                <h2>Employee Details</h2>
                <div className="flex gap-2">
                    <button onClick={handleExport} className="btn btn-secondary" disabled={exporting}>
                        {exporting ? 'Exporting...' : 'Export PDF'}
                    </button>
                    <Link to="/employees" className="btn btn-secondary">Back</Link>
                </div>
            </div>

            <div className="card mb-3">
                <div className="card-body grid grid-2">
                    <div>
                        <div className="form-group">
                            <label className="form-label">Name</label>
                            <div>{employee.name}</div>
                        </div>
                        <div className="form-group">
                            <label className="form-label">Email</label>
                            <div>{employee.email}</div>
                        </div>
                        <div className="form-group">
                            <label className="form-label">Department</label>
                            <div>{employee.department || 'N/A'}</div>
                        </div>
                        <div className="form-group">
                            <label className="form-label">Phone</label>
                            <div>{employee.phone || 'N/A'}</div>
                        </div>
                    </div>
                    <div>
                        <div className="form-group">
                            <label className="form-label">Assigned Assets</label>
                            <div className="badge badge-info">{employee.assets?.length || 0}</div>
                        </div>
                    </div>
                </div>
            </div>

            <div className="card mb-3">
                <div className="card-header">
                    <h3 className="card-title">Current Assigned Assets</h3>
                </div>
                <div className="table-container">
                    <table className="table">
                        <thead>
                            <tr>
                                <th>Asset Number</th>
                                <th>Name</th>
                                <th>Category</th>
                                <th>Status</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {(employee.assets || []).length === 0 ? (
                                <tr><td colSpan="5" className="text-center text-muted">No assets assigned</td></tr>
                            ) : (
                                employee.assets.map((a) => (
                                    <tr key={a.id}>
                                        <td><Link to={`/assets/${a.id}`} className="text-primary">{a.asset_number}</Link></td>
                                        <td>{a.name}</td>
                                        <td>{a.category_name || 'N/A'}</td>
                                        <td><span className={`badge badge-${getStatusColor(a.status)}`}>{a.status}</span></td>
                                        <td>
                                            <div className="flex gap-1">
                                                <Link to={`/assets/${a.id}`} className="btn btn-sm btn-secondary">View</Link>
                                                <Link to={`/assets/${a.id}/edit`} className="btn btn-sm btn-secondary">Edit</Link>
                                            </div>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            <div className="card">
                <div className="card-header">
                    <h3 className="card-title">History</h3>
                </div>
                <div className="table-container">
                    <table className="table">
                        <thead>
                            <tr>
                                <th>Date</th>
                                <th>Action</th>
                                <th>Asset</th>
                                <th>Notes</th>
                            </tr>
                        </thead>
                        <tbody>
                            {(employee.history || []).length === 0 ? (
                                <tr><td colSpan="4" className="text-center text-muted">No history</td></tr>
                            ) : (
                                employee.history.map((h) => (
                                    <tr key={h.id}>
                                        <td>{new Date(h.timestamp).toLocaleString()}</td>
                                        <td><span className="badge badge-primary">{h.action}</span></td>
                                        <td>{h.asset_number || '-'} {h.asset_name ? `(${h.asset_name})` : ''}</td>
                                        <td>{h.notes || '-'}</td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}

function getStatusColor(status) {
    const colors = {
        available: 'success',
        assigned: 'info',
        maintenance: 'warning',
        repair: 'warning',
        damaged: 'danger',
        lost: 'danger',
        stolen: 'danger',
        retired: 'danger'
    };
    return colors[status] || 'primary';
}
