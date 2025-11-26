import React, { useState, useEffect } from 'react';
import { reportsAPI } from '../services/api';

export default function Reports() {
    const [summary, setSummary] = useState(null);
    const [categoryData, setCategoryData] = useState([]);
    const [statusData, setStatusData] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        loadReports();
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
                        <h3 className="card-title">Assets by Category</h3>
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
