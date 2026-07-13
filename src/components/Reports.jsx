import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { reportsAPI, assetsAPI, employeesAPI } from '../services/api';

export default function Reports() {
    const [summary, setSummary] = useState(null);
    const [categoryData, setCategoryData] = useState([]);
    const [statusData, setStatusData] = useState([]);
    const [supplierData, setSupplierData] = useState([]);
    const [campusData, setCampusData] = useState([]);
    const [modelData, setModelData] = useState([]);
    const [campusExporting, setCampusExporting] = useState(false);
    const [selectedCampuses, setSelectedCampuses] = useState([]);
    const [supplierAssets, setSupplierAssets] = useState([]);
    const [selectedSupplier, setSelectedSupplier] = useState({ value: '', label: '' });
    const [employees, setEmployees] = useState([]);
    const [selectedCategory, setSelectedCategory] = useState('');
    const [selectedEmployees, setSelectedEmployees] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        loadReports();
        loadEmployees();
    }, []);

    async function loadReports() {
        try {
            const [summaryRes, categoryRes, statusRes, supplierRes, campusRes, modelRes] = await Promise.all([
                reportsAPI.getSummary(),
                reportsAPI.getByCategory(),
                reportsAPI.getByStatus(),
                reportsAPI.getBySupplier(),
                reportsAPI.getByCampus(),
                reportsAPI.getByModel().catch(() => [])
            ]);

            setSummary(summaryRes);
            setCategoryData(categoryRes);
            setStatusData(statusRes);
            setSupplierData(supplierRes);
            setCampusData(campusRes);
            setModelData(modelRes);
        } catch (error) {
            console.error('Error loading reports:', error);
        } finally {
            setLoading(false);
        }
    }

    async function loadEmployees() {
        try {
            const data = await employeesAPI.getAll();
            setEmployees(data);
        } catch (error) {
            console.error('Error loading employees for exports:', error);
        }
    }

    async function exportByCategory() {
        try {
            await assetsAPI.exportByCategory(selectedCategory);
        } catch (error) {
            alert('Export failed: ' + error.message);
        }
    }

    async function exportAssignments() {
        try {
            await assetsAPI.exportAssignments(selectedEmployees);
        } catch (error) {
            alert('Export failed: ' + error.message);
        }
    }

    async function viewSupplierAssets(supplier) {
        try {
            const value = supplier === 'Unspecified' ? '' : supplier;
            setSelectedSupplier({ value, label: supplier || 'Unspecified' });
            const data = await assetsAPI.getAll({ supplier: value });
            setSupplierAssets(data);
        } catch (error) {
            alert('Failed to load supplier items: ' + error.message);
        }
    }

    function toggleEmployee(id) {
        setSelectedEmployees((prev) =>
            prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
        );
    }

    if (loading) {
        return <div className="spinner"></div>;
    }

    return (
        <div>
            <div className="flex justify-between items-center">
                <h2>Reports & Analytics</h2>
                <Link to="/assets" className="btn btn-secondary">
                    View Master Stock List
                </Link>
            </div>

            <div className="stats-grid mb-3">
                <div className="stat-card">
                    <div className="stat-label">Total Assets</div>
                    <div className="stat-value">{summary?.total || 0}</div>
                </div>

                <div className="stat-card">
                    <div className="stat-label">Total Value</div>
                    <div className="stat-value">£{(summary?.total_value || 0).toLocaleString()}</div>
                </div>

                <div className="stat-card">
                    <div className="stat-label">Utilization</div>
                    <div className="stat-value">
                        {summary?.total > 0 ? Math.round((summary.assigned / summary.total) * 100) : 0}%
                    </div>
                </div>
            </div>

            <div className="grid grid-2">
                <div className="card">
                    <div className="card-header">
                        <div className="flex justify-between items-center">
                            <h3 className="card-title">Assets by Category</h3>
                            <div className="flex gap-2">
                                <select
                                    className="form-control"
                                    value={selectedCategory}
                                    onChange={(e) => setSelectedCategory(e.target.value)}
                                >
                                    <option value="">All Categories</option>
                                    {categoryData.map((item) => (
                                        <option key={item.id} value={item.id}>
                                            {item.name}
                                        </option>
                                    ))}
                                </select>
                                <button className="btn btn-secondary" onClick={exportByCategory}>
                                    Export CSV
                                </button>
                            </div>
                        </div>
                    </div>
                    <div className="table-container">
                        <table className="table">
                            <thead>
                                <tr>
                                    <th>Category</th>
                                    <th>Count</th>
                                    <th>Total Value</th>
                                </tr>
                            </thead>
                            <tbody>
                                {categoryData.map((item, index) => (
                                    <tr key={index}>
                                        <td><strong>{item.name}</strong></td>
                                        <td>{item.count}</td>
                                        <td>£{(item.total_value || 0).toLocaleString()}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>

                <div className="card">
                    <div className="card-header">
                        <h3 className="card-title">Assets by Status</h3>
                    </div>
                    <div className="table-container">
                        <table className="table">
                            <thead>
                                <tr>
                                    <th>Status</th>
                                    <th>Count</th>
                                    <th>Percentage</th>
                                </tr>
                            </thead>
                            <tbody>
                                {statusData.map((item, index) => (
                                    <tr key={index}>
                                        <td>
                                            <span className={`badge badge-${getStatusColor(item.status)}`}>
                                                {item.status}
                                            </span>
                                        </td>
                                        <td>{item.count}</td>
                                        <td>
                                            {summary?.total > 0 ? Math.round((item.count / summary.total) * 100) : 0}%
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            <div className="card mt-3">
                <div className="card-header">
                    <h3 className="card-title">Assets by Model</h3>
                </div>
                <div className="table-container">
                    <table className="table">
                        <thead>
                            <tr>
                                <th>Model</th>
                                <th>Category</th>
                                <th>Assets</th>
                                <th>Total Qty</th>
                                <th>Assigned</th>
                                <th>Available</th>
                                <th>Total Value</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {modelData.map((item, index) => (
                                <tr key={index}>
                                    <td><strong>{item.model}</strong></td>
                                    <td>{item.category || 'N/A'}</td>
                                    <td>{item.asset_count || 0}</td>
                                    <td>{item.total_quantity || 0}</td>
                                    <td>{item.assigned_quantity || 0}</td>
                                    <td>{item.available_quantity || 0}</td>
                                    <td>£{(item.total_value || 0).toLocaleString()}</td>
                                    <td>
                                        <Link
                                            to={`/assets?model=${encodeURIComponent(item.model)}`}
                                            className="btn btn-sm btn-secondary"
                                        >
                                            View items
                                        </Link>
                                        <button
                                            className="btn btn-sm btn-primary"
                                            style={{ marginLeft: '0.5rem' }}
                                            onClick={async () => {
                                                try {
                                                    await assetsAPI.exportByModel(item.model);
                                                } catch (error) {
                                                    alert('Export failed: ' + error.message);
                                                }
                                            }}
                                        >
                                            Export CSV
                                        </button>
                                    </td>
                                </tr>
                            ))}
                            {modelData.length === 0 && (
                                <tr>
                                    <td colSpan="8" className="text-center text-muted">No model data</td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            <div className="card mt-3">
                <div className="card-header">
                    <h3 className="card-title">Assets by Supplier</h3>
                </div>
                <div className="table-container">
                    <table className="table">
                        <thead>
                            <tr>
                                <th>Supplier</th>
                                <th>Assets</th>
                                <th>Total Qty</th>
                                <th>Available</th>
                                <th>Total Value</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {supplierData.map((item, index) => (
                                <tr key={index}>
                                    <td><strong>{item.supplier_name}</strong></td>
                                    <td>{item.asset_count || 0}</td>
                                    <td>{item.total_quantity || 0}</td>
                                    <td>{item.available_quantity || 0}</td>
                                    <td>£{(item.total_value || 0).toLocaleString()}</td>
                                    <td>
                                        <button
                                            className="btn btn-sm btn-secondary"
                                            onClick={() => viewSupplierAssets(item.supplier_name === 'Unspecified' ? '' : item.supplier_name)}
                                        >
                                            View items
                                        </button>
                                        <button
                                            className="btn btn-sm btn-primary"
                                            style={{ marginLeft: '0.5rem' }}
                                            onClick={async () => {
                                                try {
                                                    await assetsAPI.exportBySupplier(
                                                        item.supplier_name === 'Unspecified' ? '' : item.supplier_name
                                                    );
                                                } catch (error) {
                                                    alert('Export failed: ' + error.message);
                                                }
                                            }}
                                        >
                                            Export CSV
                                        </button>
                                    </td>
                                </tr>
                            ))}
                            {supplierData.length === 0 && (
                                <tr>
                                    <td colSpan="6" className="text-center text-muted">No supplier data</td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
                {selectedSupplier.label && (
                    <div className="card-body">
                        <div className="flex justify-between items-center mb-2">
                            <h4 className="card-title" style={{ margin: 0 }}>
                                Items from {selectedSupplier.label}
                            </h4>
                            <button
                                className="btn btn-secondary btn-sm"
                                onClick={() => {
                                    setSupplierAssets([]);
                                    setSelectedSupplier({ value: '', label: '' });
                                }}
                            >
                                Clear
                            </button>
                        </div>
                        {supplierAssets.length === 0 ? (
                            <div className="text-muted">No items for this supplier.</div>
                        ) : (
                            <div className="table-container">
                                <table className="table">
                                    <thead>
                                        <tr>
                                            <th>Asset #</th>
                                            <th>Name</th>
                                            <th>Category</th>
                                            <th>Model</th>
                                            <th>Status</th>
                                            <th>Qty</th>
                                            <th>Assigned</th>
                                            <th>Purchase Price</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {supplierAssets.map((asset) => (
                                            <tr key={asset.id}>
                                                <td>{asset.asset_number}</td>
                                                <td>{asset.name}</td>
                                                <td>{asset.category_name || 'N/A'}</td>
                                                <td>{asset.model || 'N/A'}</td>
                                                <td>
                                                    <span className={`badge badge-${getStatusColor(asset.status)}`}>
                                                        {asset.status}
                                                    </span>
                                                </td>
                                                <td>{asset.quantity || 0}</td>
                                                <td>{asset.assigned_quantity || 0}</td>
                                                <td>£{asset.purchase_price ? Number(asset.purchase_price).toLocaleString() : '0'}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                )}
            </div>

            <div className="card mt-3">
                <div className="card-header">
                    <div className="flex justify-between items-center">
                        <h3 className="card-title">Assets by Campus</h3>
                        <button
                            className="btn btn-secondary"
                            disabled={campusExporting}
                            onClick={async () => {
                                try {
                                    setCampusExporting(true);
                                    await assetsAPI.exportByCampus();
                                } catch (error) {
                                    alert('Export failed: ' + error.message);
                                } finally {
                                    setCampusExporting(false);
                                }
                            }}
                        >
                            {campusExporting ? 'Exporting...' : 'Export CSV'}
                        </button>
                        <button
                            className="btn btn-secondary"
                            disabled={campusExporting || selectedCampuses.length === 0}
                            onClick={async () => {
                                try {
                                    setCampusExporting(true);
                                    for (const c of selectedCampuses) {
                                        await assetsAPI.exportByCampus(c === 'Unassigned' ? '' : c);
                                    }
                                } catch (error) {
                                    alert('Export failed: ' + error.message);
                                } finally {
                                    setCampusExporting(false);
                                }
                            }}
                        >
                            {campusExporting ? 'Exporting...' : 'Export Selected'}
                        </button>
                    </div>
                </div>
                <div className="table-container">
                    <table className="table">
                        <thead>
                            <tr>
                                <th></th>
                                <th>Campus</th>
                                <th>Assets</th>
                                <th>Total Qty</th>
                                <th>Available</th>
                                <th>Total Value</th>
                            </tr>
                        </thead>
                        <tbody>
                            {campusData.map((item, index) => {
                                const displayName = item.campus && item.campus.trim() ? item.campus : 'Unassigned';
                                const value = item.campus && item.campus.trim() ? item.campus : 'Unassigned';
                                const checked = selectedCampuses.includes(value);
                                return (
                                    <tr key={index}>
                                        <td>
                                            <input
                                                type="checkbox"
                                                checked={checked}
                                                onChange={(e) => {
                                                    setSelectedCampuses((prev) =>
                                                        e.target.checked
                                                            ? [...prev, value]
                                                            : prev.filter((v) => v !== value)
                                                    );
                                                }}
                                            />
                                        </td>
                                        <td><strong>{displayName}</strong></td>
                                        <td>{item.asset_count || 0}</td>
                                        <td>{item.total_quantity || 0}</td>
                                        <td>{item.available_quantity || 0}</td>
                                        <td>£{(item.total_value || 0).toLocaleString()}</td>
                                    </tr>
                                );
                            })}
                            {campusData.length === 0 && (
                                <tr>
                                    <td colSpan="5" className="text-center text-muted">No campus data</td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            <div className="card mt-3">
                <div className="card-header">
                    <div className="flex justify-between items-center">
                        <h3 className="card-title">Export Assigned Devices by Employee</h3>
                        <button
                            className="btn btn-primary"
                            onClick={exportAssignments}
                            disabled={employees.length === 0}
                        >
                            Export CSV
                        </button>
                    </div>
                    <p className="text-muted" style={{ marginBottom: 0 }}>
                        Select one or more employees to include in the export. If none are selected, all assigned devices
                        will be exported.
                    </p>
                </div>
                <div className="card-body">
                    <div className="grid grid-2">
                        {employees.map((emp) => (
                            <label key={emp.id} className="flex items-center gap-2">
                                <input
                                    type="checkbox"
                                    checked={selectedEmployees.includes(emp.id)}
                                    onChange={() => toggleEmployee(emp.id)}
                                />
                                <span>
                                    {emp.name} ({emp.department || 'No department'}) - {emp.email}
                                </span>
                            </label>
                        ))}
                        {employees.length === 0 && (
                            <div className="text-muted">No employees available for export.</div>
                        )}
                    </div>
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

