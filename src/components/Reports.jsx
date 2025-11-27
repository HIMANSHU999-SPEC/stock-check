import React, { useState, useEffect } from 'react';
import { reportsAPI, assetsAPI, employeesAPI } from '../services/api';

export default function Reports() {
    const [summary, setSummary] = useState(null);
    const [categoryData, setCategoryData] = useState([]);
    const [statusData, setStatusData] = useState([]);
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
            const [summaryRes, categoryRes, statusRes] = await Promise.all([
                reportsAPI.getSummary(),
                reportsAPI.getByCategory(),
                reportsAPI.getByStatus()
            ]);

            setSummary(summaryRes);
            setCategoryData(categoryRes);
            setStatusData(statusRes);
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
            <h2>Reports & Analytics</h2>

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
