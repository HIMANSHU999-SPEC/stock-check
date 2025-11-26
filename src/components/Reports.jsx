import React, { useState, useEffect } from 'react';
import { reportsAPI } from '../services/api';

export default function Reports() {
    const [summary, setSummary] = useState(null);
    const [categoryData, setCategoryData] = useState([]);
    const [statusData, setStatusData] = useState([]);
    const [pricingData, setPricingData] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        loadReports();
    }, []);

    async function loadReports() {
        try {
            const [summaryRes, categoryRes, statusRes, pricingRes] = await Promise.all([
                reportsAPI.getSummary(),
                reportsAPI.getByCategory(),
                reportsAPI.getByStatus(),
                reportsAPI.getPricing()
            ]);

            setSummary(summaryRes);
            setCategoryData(categoryRes);
            setStatusData(statusRes);
            setPricingData(pricingRes);
        } catch (error) {
            console.error('Error loading reports:', error);
        } finally {
            setLoading(false);
        }
    }

    function exportToCSV(data, filename) {
        const csv = convertToCSV(data);
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
    }

    function convertToCSV(data) {
        if (!data || data.length === 0) return '';

        const headers = Object.keys(data[0]).join(',');
        const rows = data.map(row => Object.values(row).join(','));
        return [headers, ...rows].join('\n');
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
                    <div className="stat-label">Intune Value</div>
                    <div className="stat-value">£{(summary?.total_intune_value || 0).toLocaleString()}</div>
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

            <div className="card mt-3">
                <div className="card-header">
                    <div className="flex justify-between items-center">
                        <h3 className="card-title">Intune Pricing Report</h3>
                        <button
                            onClick={() => exportToCSV(pricingData?.assets || [], 'intune-pricing-report.csv')}
                            className="btn btn-secondary btn-sm"
                        >
                            📥 Export to CSV
                        </button>
                    </div>
                </div>

                {pricingData?.summary && (
                    <div className="card-body">
                        <div className="grid grid-3">
                            <div>
                                <div className="text-muted">Total Devices</div>
                                <div className="mt-1" style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>
                                    {pricingData.summary.total_devices}
                                </div>
                            </div>
                            <div>
                                <div className="text-muted">Total Purchase Cost</div>
                                <div className="mt-1" style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>
                                    £{(pricingData.summary.total_purchase || 0).toLocaleString()}
                                </div>
                            </div>
                            <div>
                                <div className="text-muted">Total Intune Cost</div>
                                <div className="mt-1" style={{ fontSize: '1.5rem', fontWeight: 'bold', color: 'var(--primary)' }}>
                                    £{(pricingData.summary.total_intune || 0).toLocaleString()}
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                <div className="table-container">
                    <table className="table">
                        <thead>
                            <tr>
                                <th>Asset Number</th>
                                <th>Name</th>
                                <th>Category</th>
                                <th>Purchase Price</th>
                                <th>Intune Price</th>
                                <th>Difference</th>
                            </tr>
                        </thead>
                        <tbody>
                            {pricingData?.assets?.length === 0 ? (
                                <tr>
                                    <td colSpan="6" className="text-center text-muted">
                                        No assets with Intune pricing
                                    </td>
                                </tr>
                            ) : (
                                pricingData?.assets?.map((asset) => (
                                    <tr key={asset.asset_number}>
                                        <td><strong>{asset.asset_number}</strong></td>
                                        <td>{asset.name}</td>
                                        <td>{asset.category}</td>
                                        <td>£{parseFloat(asset.purchase_price || 0).toFixed(2)}</td>
                                        <td>£{parseFloat(asset.intune_price || 0).toFixed(2)}</td>
                                        <td style={{ color: asset.price_difference >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                                            £{parseFloat(asset.price_difference || 0).toFixed(2)}
                                        </td>
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
        retired: 'danger'
    };
    return colors[status] || 'primary';
}
