import React, { useState, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import * as XLSX from 'xlsx';
import { assetsAPI, reportsAPI, employeesAPI } from '../services/api';

export default function AssetList() {
    const [assets, setAssets] = useState([]);
    const [categories, setCategories] = useState([]);
    const [campuses, setCampuses] = useState([]);
    const [employees, setEmployees] = useState([]);
    const [loading, setLoading] = useState(true);
    const [importing, setImporting] = useState(false);
    const [createMissingCategories, setCreateMissingCategories] = useState(true);
    const [filters, setFilters] = useState({
        search: '',
        status: '',
        category: '',
        campus: '',
        model: ''
    });
    const [models, setModels] = useState([]);
    const location = useLocation();
    const navigate = useNavigate();
    const [assignModal, setAssignModal] = useState({ open: false, asset: null });
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
        loadCategories();
        loadEmployees();
        loadCampuses();
        loadModels();
        const params = new URLSearchParams(location.search);
        const campusParam = params.get('campus');
        if (campusParam !== null) {
            setFilters((prev) => ({ ...prev, campus: campusParam }));
        }
        const modelParam = params.get('model');
        if (modelParam !== null) {
            setFilters((prev) => ({ ...prev, model: modelParam }));
        }
    }, [location.search]);

    async function loadModels() {
        try {
            const data = await reportsAPI.getByModel();
            // The report is grouped per category; merge to one row per model name.
            const merged = new Map();
            for (const m of data) {
                merged.set(m.model, (merged.get(m.model) || 0) + (m.asset_count || 0));
            }
            setModels(
                [...merged.entries()]
                    .map(([model, asset_count]) => ({ model, asset_count }))
                    .sort((a, b) => b.asset_count - a.asset_count)
            );
        } catch (error) {
            console.error('Error loading models:', error);
        }
    }

    useEffect(() => {
        loadAssets();
    }, [filters]);

    async function loadCategories() {
        try {
            const data = await reportsAPI.getCategories();
            setCategories(data);
        } catch (error) {
            console.error('Error loading categories:', error);
        }
    }

    async function loadCampuses() {
        try {
            const data = await reportsAPI.getByCampus();
            const names = data.map((c) => c.campus).filter(Boolean);
            setCampuses(names);
        } catch (error) {
            console.error('Error loading campuses:', error);
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

    async function loadAssets() {
        try {
            setLoading(true);
            const params = {
                ...filters,
                campus: filters.campus === '__unassigned__' ? '' : filters.campus
            };
            const data = await assetsAPI.getAll(params);
            setAssets(data);
        } catch (error) {
            console.error('Error loading assets:', error);
        } finally {
            setLoading(false);
        }
    }

    async function handleDelete(id) {
        if (!confirm('Are you sure you want to delete this asset?')) return;

        try {
            await assetsAPI.delete(id);
            loadAssets();
        } catch (error) {
            alert('Error deleting asset: ' + error.message);
        }
    }

    function openAssign(asset) {
        const available = Math.max(0, (asset.quantity || 1) - (asset.assigned_quantity || 0));
        if (available === 0) {
            alert('No available quantity to assign for this asset.');
            return;
        }
        setAssignQuantity(Math.max(1, available || 1));
        setSelectedEmployee('');
        setShowNewEmployeeForm(false);
        setAssignModal({ open: true, asset });
    }

    async function submitAssign() {
        if (!assignModal.asset) return;
        const available = Math.max(0, (assignModal.asset.quantity || 1) - (assignModal.asset.assigned_quantity || 0));
        if (!selectedEmployee) {
            alert('Select an employee');
            return;
        }
        if (assignQuantity < 1 || assignQuantity > available) {
            alert(`Select a quantity between 1 and ${available}`);
            return;
        }
        try {
            await assetsAPI.assign(assignModal.asset.id, {
                employee_id: selectedEmployee,
                quantity: assignQuantity
            });
            setAssignModal({ open: false, asset: null });
            loadAssets();
        } catch (error) {
            alert('Error assigning asset: ' + error.message);
        }
    }

    function normalizeRow(row) {
        const normalized = {};
        Object.keys(row).forEach((key) => {
            const safeKey = key ? key.toString().trim().toLowerCase() : '';
            normalized[safeKey] = row[key];
        });
        return normalized;
    }

    function mapRowToAsset(row) {
        const data = normalizeRow(row);
        return {
            name: data['name'] || data['asset name'] || '',
            category: data['category'] || '',
            model: data['model'] || '',
            serial_number: data['serial number'] || '',
            quantity: data['quantity'] || data['qty'] || '',
            purchase_date: data['purchase date'] || '',
            purchase_price: data['purchase price'] || '',
            warranty_period_months: data['warranty period'] || data['warranty'] || data['warranty months'] || '',
            supplier_name: data['supplier'] || data['supplier name'] || '',
            status: (data['status'] || '').toLowerCase(),
            location: data['location'] || '',
            campus: data['campus'] || '',
            notes: data['notes'] || ''
        };
    }

    async function handleImportFile(file) {
        if (!file) return;
        setImporting(true);
        try {
            const buffer = await file.arrayBuffer();
            const workbook = XLSX.read(buffer, { type: 'array' });
            const sheet = workbook.Sheets[workbook.SheetNames[0]];
            const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
            const items = rows.map(mapRowToAsset).filter((item) => item.name && item.category);
            if (items.length === 0) {
                alert('No valid rows found in the sheet (need Name and Category columns).');
                return;
            }
            const result = await assetsAPI.importBulk(items, createMissingCategories);
            alert(`Imported ${result.inserted} assets successfully.`);
            loadAssets();
        } catch (error) {
            alert('Import failed: ' + error.message);
        } finally {
            setImporting(false);
        }
    }

    return (
        <div>
            <div className="flex justify-between items-center mb-3">
                <h2>Asset Management</h2>
                <Link to="/assets/new" className="btn btn-primary">
                    + Add New Asset
                </Link>
            </div>

            <div className="card mb-3">
                <div className="card-body">
                    <div className="grid grid-3">
                        <div className="form-group">
                            <input
                                type="text"
                                className="form-control"
                                placeholder="Search assets..."
                                value={filters.search}
                                onChange={(e) => setFilters({ ...filters, search: e.target.value })}
                            />
                        </div>
                        <div className="form-group">
                            <select
                                className="form-control"
                                value={filters.status}
                                onChange={(e) => setFilters({ ...filters, status: e.target.value })}
                            >
                                <option value="">All Statuses</option>
                                <option value="available">Available</option>
                                <option value="assigned">Assigned</option>
                                <option value="maintenance">Maintenance</option>
                                <option value="repair">Repair</option>
                                <option value="damaged">Damaged</option>
                                <option value="lost">Lost</option>
                                <option value="stolen">Stolen</option>
                                <option value="retired">Retired</option>
                            </select>
                        </div>
                        <div className="form-group">
                            <select
                                className="form-control"
                                value={filters.category}
                                onChange={(e) => setFilters({ ...filters, category: e.target.value })}
                            >
                                <option value="">All Categories</option>
                                {categories.map((cat) => (
                                    <option key={cat.id} value={cat.id}>
                                        {cat.name}
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div className="form-group">
                            <select
                                className="form-control"
                                value={filters.model}
                                onChange={(e) => setFilters({ ...filters, model: e.target.value })}
                            >
                                <option value="">All Models</option>
                                {models.map((m, i) => (
                                    <option key={`${m.model}-${i}`} value={m.model}>
                                        {m.model} ({m.asset_count})
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div className="form-group">
                            <select
                                className="form-control"
                                value={filters.campus}
                                onChange={(e) => {
                                    const val = e.target.value;
                                    setFilters({ ...filters, campus: val });
                                    const search = new URLSearchParams(location.search);
                                    if (val) {
                                        search.set('campus', val);
                                    } else {
                                        search.delete('campus');
                                    }
                                    navigate({ search: search.toString() });
                                }}
                            >
                                <option value="">All Campuses</option>
                                <option value="__unassigned__">Unassigned</option>
                                {campuses.map((c) => (
                                    <option key={c} value={c}>
                                        {c}
                                    </option>
                                ))}
                            </select>
                        </div>
                    </div>
                </div>
            </div>

            <div className="card mb-3">
                <div className="card-header">
                    <h3 className="card-title">Import Assets (Excel by Category)</h3>
                </div>
                <div className="card-body">
                    <p className="text-muted">
                        Upload .xlsx or .xls with columns: Name, Category, Model, Serial Number, Purchase Date,
                        Purchase Price, Supplier, Status, Location, Notes. Categories will be auto-created if needed.
                    </p>
                    <div className="flex gap-2 items-center">
                        <input
                            type="file"
                            accept=".xlsx,.xls"
                            onChange={(e) => handleImportFile(e.target.files?.[0])}
                            disabled={importing}
                        />
                        <label className="flex items-center gap-1">
                            <input
                                type="checkbox"
                                checked={createMissingCategories}
                                onChange={(e) => setCreateMissingCategories(e.target.checked)}
                            />
                            <span>Create missing categories automatically</span>
                        </label>
                        {importing && <span className="text-muted">Importing...</span>}
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
                                    <th>Asset Number</th>
                                    <th>Name</th>
                                    <th>Category</th>
                                    <th>Model</th>
                                    <th>Supplier</th>
                                    <th>Campus</th>
                                    <th>Qty</th>
                                    <th>Status</th>
                                    <th>Assigned To</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {assets.length === 0 ? (
                                    <tr>
                                        <td colSpan="9" className="text-center text-muted">
                                            No assets found
                                        </td>
                                    </tr>
                                ) : (
                                    assets.map((asset) => (
                                        <tr key={asset.id}>
                                            <td>
                                                <Link to={`/assets/${asset.id}`} className="text-primary">
                                                    <strong>{asset.asset_number}</strong>
                                                </Link>
                                            </td>
                                            <td>{asset.name}</td>
                                            <td>{asset.category_name || 'N/A'}</td>
                                            <td>{asset.model || 'N/A'}</td>
                                            <td>{asset.supplier_name || 'N/A'}</td>
                                            <td>{asset.campus || 'N/A'}</td>
                                            <td>{asset.quantity || 1}</td>
                                            <td>
                                                <span className={`badge badge-${getStatusColor(asset.status)}`}>
                                                    {asset.status}
                                                </span>
                                            </td>
                                            <td>{asset.employee_name || '-'}</td>
                                            <td>
                                                <div className="flex gap-1">
                                                    <Link to={`/assets/${asset.id}`} className="btn btn-sm btn-secondary">
                                                        View
                                                    </Link>
                                                    <Link to={`/assets/${asset.id}/edit`} className="btn btn-sm btn-secondary">
                                                        Edit
                                                    </Link>
                                                    {!asset.assigned_to && (
                                                        <button
                                                            onClick={() => openAssign(asset)}
                                                            className="btn btn-sm btn-primary"
                                                        >
                                                            Assign
                                                        </button>
                                                    )}
                                                    <button
                                                        onClick={() => handleDelete(asset.id)}
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
            )}

            {assignModal.open && (
                <div
                    className="modal-overlay"
                    onClick={() => {
                        setAssignModal({ open: false, asset: null });
                        setShowNewEmployeeForm(false);
                    }}
                >
                    <div className="modal" onClick={(e) => e.stopPropagation()}>
                        <h3>Assign Asset</h3>
                        <div className="form-group mt-2">
                            <label className="form-label">Employee</label>
                            <select
                                className="form-control"
                                value={selectedEmployee}
                                onChange={(e) => setSelectedEmployee(e.target.value)}
                            >
                                <option value="">Choose an employee...</option>
                                {employees.map((emp) => (
                                    <option key={emp.id} value={emp.id}>
                                        {emp.name} ({emp.department || 'No department'})
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div className="form-group">
                            <label className="form-label">Quantity</label>
                            <input
                                type="number"
                                min="1"
                                max={Math.max(1, (assignModal.asset?.quantity || 1) - (assignModal.asset?.assigned_quantity || 0))}
                                className="form-control"
                                value={assignQuantity}
                                onChange={(e) => setAssignQuantity(parseInt(e.target.value, 10) || 1)}
                            />
                            <div className="text-muted" style={{ fontSize: '0.85rem' }}>
                                Available: {Math.max(0, (assignModal.asset?.quantity || 1) - (assignModal.asset?.assigned_quantity || 0))}
                            </div>
                        </div>
                        <div className="form-group">
                            <button
                                type="button"
                                className="btn btn-secondary"
                                onClick={() => setShowNewEmployeeForm((v) => !v)}
                            >
                                {showNewEmployeeForm ? 'Cancel new employee' : 'Create new employee'}
                            </button>
                        </div>
                        {showNewEmployeeForm && (
                            <form onSubmit={async (e) => {
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
                            }} className="card mt-2">
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
                                    setAssignModal({ open: false, asset: null });
                                    setShowNewEmployeeForm(false);
                                }}
                                className="btn btn-secondary"
                            >
                                Cancel
                            </button>
                            <button onClick={submitAssign} className="btn btn-primary">
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
