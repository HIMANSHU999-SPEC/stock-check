import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { assetsAPI, employeesAPI } from '../services/api';
import { generateEmailDraft, openEmailDraft } from '../utils/emailTemplates';
import QRCode from 'react-qr-code';

export default function AssetDetails() {
    const { id } = useParams();
    const navigate = useNavigate();
    const [asset, setAsset] = useState(null);
    const [employees, setEmployees] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showAssignModal, setShowAssignModal] = useState(false);
    const [selectedEmployee, setSelectedEmployee] = useState('');

    useEffect(() => {
        loadAsset();
        loadEmployees();
    }, [id]);

    async function loadAsset() {
        try {
            const data = await assetsAPI.getById(id);
            setAsset(data);
        } catch (error) {
            alert('Error loading asset: ' + error.message);
            navigate('/assets');
        } finally {
            setLoading(false);
        }
    }

    async function loadEmployees() {
        try {
            const data = await employeesAPI.getAll();
            setEmployees(data);
        } catch (error) {
            console.error('Error loading employees:', error);
        }
    }

    async function handleAssign() {
        if (!selectedEmployee) {
            alert('Please select an employee');
            return;
        }

        try {
            await assetsAPI.assign(id, { employee_id: selectedEmployee });
            setShowAssignModal(false);
            loadAsset();
        } catch (error) {
            alert('Error assigning asset: ' + error.message);
        }
    }

    async function handleReturn() {
        if (!confirm('Return this asset?')) return;

        try {
            await assetsAPI.return(id, {});
            loadAsset();
        } catch (error) {
            alert('Error returning asset: ' + error.message);
        }
    }

    async function handleDelete() {
        if (!confirm('Are you sure you want to delete this asset?')) return;

        try {
            await assetsAPI.delete(id);
            navigate('/assets');
        } catch (error) {
            alert('Error deleting asset: ' + error.message);
        }
    }

    function handleEmailEmployee() {
        if (!asset.employee_email) {
            alert('No employee assigned to this asset');
            return;
        }

        const employee = {
            name: asset.employee_name,
            email: asset.employee_email
        };

        const emailData = generateEmailDraft(asset, employee, 'assignment');
        openEmailDraft(employee.email, emailData.subject, emailData.body);
    }

    function handlePrintTag() {
        window.print();
    }

    if (loading) {
        return <div className="spinner"></div>;
    }

    if (!asset) {
        return <div>Asset not found</div>;
    }

    return (
        <div>
            <div className="flex justify-between items-center mb-3">
                <h2>Asset Details</h2>
                <div className="flex gap-2">
                    <Link to={`/assets/${id}/edit`} className="btn btn-secondary">
                        Edit
                    </Link>
                    <button onClick={handleDelete} className="btn btn-danger">
                        Delete
                    </button>
                </div>
            </div>

            <div className="grid grid-2">
                <div className="card">
                    <div className="card-header">
                        <h3 className="card-title">Asset Information</h3>
                    </div>
                    <div className="card-body">
                        <div className="form-group">
                            <label className="form-label">Asset Number</label>
                            <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: 'var(--primary)' }}>
                                {asset.asset_number}
                            </div>
                        </div>

                        <div className="grid grid-2">
                            <div className="form-group">
                                <label className="form-label">Name</label>
                                <div>{asset.name}</div>
                            </div>

                            <div className="form-group">
                                <label className="form-label">Category</label>
                                <div>{asset.category_name || 'N/A'}</div>
                            </div>

                            <div className="form-group">
                                <label className="form-label">Model</label>
                                <div>{asset.model || 'N/A'}</div>
                            </div>

                            <div className="form-group">
                                <label className="form-label">Serial Number</label>
                                <div>{asset.serial_number || 'N/A'}</div>
                            </div>

                            <div className="form-group">
                                <label className="form-label">Status</label>
                                <div>
                                    <span className={`badge badge-${getStatusColor(asset.status)}`}>
                                        {asset.status}
                                    </span>
                                </div>
                            </div>

                            <div className="form-group">
                                <label className="form-label">Location</label>
                                <div>{asset.location || 'N/A'}</div>
                            </div>
                        </div>

                        <div className="form-group">
                            <label className="form-label">Notes</label>
                            <div>{asset.notes || 'No notes'}</div>
                        </div>
                    </div>
                </div>

                <div className="card">
                    <div className="card-header">
                        <h3 className="card-title">Financial Information</h3>
                    </div>
                    <div className="card-body">
                        <div className="grid grid-2">
                            <div className="form-group">
                                <label className="form-label">Purchase Date</label>
                                <div>{asset.purchase_date || 'N/A'}</div>
                            </div>

                            <div className="form-group">
                                <label className="form-label">Purchase Price</label>
                                <div style={{ fontSize: '1.25rem', fontWeight: 'bold' }}>
                                    {asset.purchase_price ? `£${parseFloat(asset.purchase_price).toFixed(2)}` : 'N/A'}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="card">
                    <div className="card-header">
                        <h3 className="card-title">Assignment</h3>
                    </div>
                    <div className="card-body">
                        {asset.assigned_to ? (
                            <>
                                <div className="form-group">
                                    <label className="form-label">Assigned To</label>
                                    <div style={{ fontSize: '1.1rem', fontWeight: 'bold' }}>
                                        {asset.employee_name}
                                    </div>
                                </div>

                                <div className="form-group">
                                    <label className="form-label">Email</label>
                                    <div>{asset.employee_email}</div>
                                </div>

                                <div className="form-group">
                                    <label className="form-label">Department</label>
                                    <div>{asset.department || 'N/A'}</div>
                                </div>

                                <div className="flex gap-2 mt-3">
                                    <button onClick={handleEmailEmployee} className="btn btn-primary">
                                        Email Employee
                                    </button>
                                    <button onClick={handleReturn} className="btn btn-secondary">
                                        Return Asset
                                    </button>
                                </div>
                            </>
                        ) : (
                            <>
                                <p className="text-muted">This asset is not currently assigned</p>
                                <button
                                    onClick={() => setShowAssignModal(true)}
                                    className="btn btn-primary mt-2"
                                >
                                    Assign to Employee
                                </button>
                            </>
                        )}
                    </div>
                </div>

                <div className="card">
                    <div className="card-header">
                        <h3 className="card-title">QR Code</h3>
                    </div>
                    <div className="card-body">
                        <div style={{ background: 'white', padding: '1rem', borderRadius: '8px', display: 'inline-block' }}>
                            <QRCode value={asset.asset_number} size={200} />
                        </div>
                        <div className="mt-2">
                            <button onClick={handlePrintTag} className="btn btn-secondary">
                                Print Tag
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            {asset.history && asset.history.length > 0 && (
                <div className="card mt-3">
                    <div className="card-header">
                        <h3 className="card-title">History</h3>
                    </div>
                    <div className="table-container">
                        <table className="table">
                            <thead>
                                <tr>
                                    <th>Date</th>
                                    <th>Action</th>
                                    <th>Employee</th>
                                    <th>Notes</th>
                                </tr>
                            </thead>
                            <tbody>
                                {asset.history.map((entry) => (
                                    <tr key={entry.id}>
                                        <td>{new Date(entry.timestamp).toLocaleString()}</td>
                                        <td>
                                            <span className="badge badge-primary">{entry.action}</span>
                                        </td>
                                        <td>{entry.employee_name || '-'}</td>
                                        <td>{entry.notes || '-'}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {showAssignModal && (
                <div className="modal-overlay" onClick={() => setShowAssignModal(false)}>
                    <div className="modal" onClick={(e) => e.stopPropagation()}>
                        <h3>Assign Asset to Employee</h3>
                        <div className="form-group mt-3">
                            <label className="form-label">Select Employee</label>
                            <select
                                className="form-control"
                                value={selectedEmployee}
                                onChange={(e) => setSelectedEmployee(e.target.value)}
                            >
                                <option value="">Choose an employee...</option>
                                {employees.map((emp) => (
                                    <option key={emp.id} value={emp.id}>
                                        {emp.name} - {emp.department || 'No department'}
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div className="flex gap-2 mt-3">
                            <button onClick={() => setShowAssignModal(false)} className="btn btn-secondary">
                                Cancel
                            </button>
                            <button onClick={handleAssign} className="btn btn-primary">
                                Assign
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

function getStatusColor(status) {
    const colors = {
        available: 'success',
        assigned: 'info',
        maintenance: 'warning',
        retired: 'danger'
    };
    return colors[status] || 'primary';
}
