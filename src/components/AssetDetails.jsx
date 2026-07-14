import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, Link, useLocation } from 'react-router-dom';
import { assetsAPI, employeesAPI } from '../services/api';
import { generateEmailDraft, openEmailDraft } from '../utils/emailTemplates';
import QRCode from 'react-qr-code';

export default function AssetDetails() {
    const ADMIN_MAILBOX = 'admin@stock.local';
    const { id } = useParams();
    const navigate = useNavigate();
    const location = useLocation();
    const [asset, setAsset] = useState(null);
    const [employees, setEmployees] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showAssignModal, setShowAssignModal] = useState(false);
    const [selectedEmployee, setSelectedEmployee] = useState('');
    const [assignQuantity, setAssignQuantity] = useState(1);
    const [showNewEmployeeForm, setShowNewEmployeeForm] = useState(false);
    const [newEmployee, setNewEmployee] = useState({
        name: '',
        email: '',
        department: '',
        phone: ''
    });

    useEffect(() => {
        loadAsset();
        loadEmployees();
    }, [id]);

    useEffect(() => {
        const params = new URLSearchParams(location.search);
        if (params.get('assign') === '1') {
            setShowAssignModal(true);
        }
    }, [location.search]);

    async function loadAsset() {
        try {
            const data = await assetsAPI.getById(id);
            setAsset(data);
            setAssignQuantity(Math.max(1, (data.quantity || 1) - (data.assigned_quantity || 0)));
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
        const available = Math.max(0, (asset?.quantity || 0) - (asset?.assigned_quantity || 0));
        if (assignQuantity < 1 || assignQuantity > available) {
            alert(`Select a quantity between 1 and ${available}`);
            return;
        }

        try {
            await assetsAPI.assign(id, { employee_id: selectedEmployee, quantity: assignQuantity });
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

    async function handleCreateEmployee(e) {
        e.preventDefault();
        try {
            const created = await employeesAPI.create(newEmployee);
            await loadEmployees();
            setSelectedEmployee(created.id);
            setShowNewEmployeeForm(false);
            setNewEmployee({ name: '', email: '', department: '', phone: '' });
        } catch (error) {
            alert('Error creating employee: ' + error.message);
        }
    }

    function handleEmailEmployee(type = 'assignment') {
        if (!asset.employee_email) {
            alert('No employee assigned to this asset');
            return;
        }

        const employee = {
            name: asset.employee_name,
            email: asset.employee_email
        };

        const emailData = generateEmailDraft(asset, employee, type);
        openEmailDraft(employee.email, emailData.subject, emailData.body, ADMIN_MAILBOX);
    }

    function handlePrintTag() {
        window.print();
    }

    const availableQuantity = Math.max(0, (asset?.quantity || 1) - (asset?.assigned_quantity || 0));
    const warrantyMonths = asset?.warranty_period_months || 0;
    let warrantyExpiry = null;
    if (warrantyMonths > 0 && asset?.purchase_date) {
        const d = new Date(asset.purchase_date);
        if (!Number.isNaN(d.getTime())) {
            d.setMonth(d.getMonth() + warrantyMonths);
            warrantyExpiry = d.toISOString().slice(0, 10);
        }
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
                                <label className="form-label">Brand</label>
                                <div>{asset.brand || 'N/A'}</div>
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
                            <label className="form-label">Quantity</label>
                            <div>{asset.quantity || 1}</div>
                        </div>

                        <div className="form-group">
                            <label className="form-label">Assigned Qty</label>
                            <div>{asset.assigned_quantity || 0}</div>
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
                            <label className="form-label">Available Quantity</label>
                            <div>{availableQuantity}</div>
                        </div>

                            <div className="form-group">
                                <label className="form-label">Location</label>
                                <div>{asset.location || 'N/A'}</div>
                            </div>

                            <div className="form-group">
                                <label className="form-label">Campus</label>
                                <div>{asset.campus || 'N/A'}</div>
                            </div>

                            <div className="form-group">
                                <label className="form-label">Supplier</label>
                                <div>{asset.supplier_name || 'N/A'}</div>
                            </div>

                            <div className="form-group">
                                <label className="form-label">Warranty Period</label>
                                <div>{warrantyMonths ? `${warrantyMonths} months` : 'No warranty'}</div>
                            </div>
                            <div className="form-group">
                                <label className="form-label">Warranty Expiry</label>
                                <div>{warrantyExpiry || 'N/A'}</div>
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

                            <div className="form-group">
                                <label className="form-label">Added to System</label>
                                <div>
                                    {asset.created_at ? new Date(asset.created_at).toLocaleDateString() : 'N/A'}
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
                                    <button onClick={() => handleEmailEmployee('return')} className="btn btn-secondary">
                                        Email Return Notice
                                    </button>
                                    <button onClick={() => setShowAssignModal(true)} className="btn btn-secondary">
                                        Reassign
                                    </button>
                                </div>
                            </>
                        ) : (
                            <>
                                <p className="text-muted">This asset is not currently assigned</p>
                                <button
                                    onClick={() => setShowAssignModal(true)}
                                    className="btn btn-primary mt-2"
                                    disabled={availableQuantity === 0}
                                >
                                    Assign to Employee
                                </button>
                                {availableQuantity === 0 && (
                                    <div className="text-muted" style={{ marginTop: '0.5rem' }}>
                                        No available quantity to assign. Increase stock or return items first.
                                    </div>
                                )}
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
                <div
                    className="modal-overlay"
                    onClick={() => {
                        setShowAssignModal(false);
                        setShowNewEmployeeForm(false);
                    }}
                >
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
                        <div className="form-group mt-2">
                            <label className="form-label">Quantity to Assign</label>
                            <input
                                type="number"
                                className="form-control"
                                min="1"
                                max={Math.max(availableQuantity, 1)}
                                value={assignQuantity}
                                onChange={(e) => setAssignQuantity(parseInt(e.target.value, 10) || 1)}
                            />
                            <div className="text-muted" style={{ fontSize: '0.85rem' }}>
                                Available: {availableQuantity}
                            </div>
                        </div>

                        <div className="form-group mt-2">
                            <button
                                type="button"
                                className="btn btn-secondary"
                                onClick={() => setShowNewEmployeeForm((v) => !v)}
                            >
                                {showNewEmployeeForm ? 'Cancel new employee' : 'Create new employee'}
                            </button>
                        </div>

                        {showNewEmployeeForm && (
                            <form onSubmit={handleCreateEmployee} className="card mt-2">
                                <div className="card-body">
                                    <div className="grid grid-2">
                                        <div className="form-group">
                                            <label className="form-label">Name *</label>
                                            <input
                                                type="text"
                                                className="form-control"
                                                value={newEmployee.name}
                                                onChange={(e) => setNewEmployee({ ...newEmployee, name: e.target.value })}
                                                required
                                            />
                                        </div>
                                        <div className="form-group">
                                            <label className="form-label">Email *</label>
                                            <input
                                                type="email"
                                                className="form-control"
                                                value={newEmployee.email}
                                                onChange={(e) => setNewEmployee({ ...newEmployee, email: e.target.value })}
                                                required
                                            />
                                        </div>
                                    </div>
                                    <div className="grid grid-2">
                                        <div className="form-group">
                                            <label className="form-label">Department</label>
                                            <input
                                                type="text"
                                                className="form-control"
                                                value={newEmployee.department}
                                                onChange={(e) => setNewEmployee({ ...newEmployee, department: e.target.value })}
                                            />
                                        </div>
                                        <div className="form-group">
                                            <label className="form-label">Phone</label>
                                            <input
                                                type="text"
                                                className="form-control"
                                                value={newEmployee.phone}
                                                onChange={(e) => setNewEmployee({ ...newEmployee, phone: e.target.value })}
                                            />
                                        </div>
                                    </div>
                                </div>
                                <div className="card-footer">
                                    <button type="submit" className="btn btn-primary">
                                        Save & select
                                    </button>
                                </div>
                            </form>
                        )}

                        <div className="flex gap-2 mt-3">
                            <button
                                onClick={() => {
                                    setShowAssignModal(false);
                                    setShowNewEmployeeForm(false);
                                }}
                                className="btn btn-secondary"
                            >
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
        repair: 'warning',
        damaged: 'danger',
        lost: 'danger',
        stolen: 'danger',
        retired: 'danger'
    };
    return colors[status] || 'primary';
}

