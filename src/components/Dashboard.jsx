import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { reportsAPI, assetsAPI } from '../services/api';

export default function Dashboard() {
    const [stats, setStats] = useState(null);
    const [recentAssets, setRecentAssets] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        loadData();
    }, []);

    async function loadData() {
        try {
            const [summaryData, assetsData] = await Promise.all([
                reportsAPI.getSummary(),
                assetsAPI.getAll()
            ]);
            setStats(summaryData);
            setRecentAssets(assetsData.slice(0, 5));
        } catch (error) {
            console.error('Error loading dashboard:', error);
        } finally {
            setLoading(false);
        }
    }

    if (loading) {
        return <div className="spinner"></div>;
    }

    return (
        <div>
            <div className="flex justify-between items-center mb-3">
                <h2>Dashboard</h2>
                <Link to="/assets/new" className="btn btn-primary">
                    + Add New Asset
                </Link>
            </div>

            <div className="stats-grid">
                <div className="stat-card">
                    <div className="stat-label">Total Assets</div>
                    <div className="stat-value">{stats?.total || 0}</div>
                    <div className="text-muted">All registered assets</div>
                </div>

                <div className="stat-card">
                    <div className="stat-label">Assigned</div>
                    <div className="stat-value">{stats?.assigned || 0}</div>
                    <div className="text-muted">Currently in use</div>
                </div>

                <div className="stat-card">
                    <div className="stat-label">Available</div>
                    <div className="stat-value">{stats?.available || 0}</div>
                    <div className="text-muted">Ready to assign</div>
                </div>

                <div className="stat-card">
                    <div className="stat-label">Total Value</div>
                    <div className="stat-value">
                        £{(stats?.total_value || 0).toLocaleString()}
                    </div>
                    <div className="text-muted">Purchase price</div>
                </div>
            </div>

            <div className="grid grid-2">
                <div className="card">
                    <div className="card-header">
                        <h3 className="card-title">Recent Assets</h3>
                    </div>
                    <div className="card-body">
                        {recentAssets.length === 0 ? (
                            <p className="text-muted">No assets registered yet</p>
                        ) : (
                            <div className="table-container">
                                <table className="table">
                                    <thead>
                                        <tr>
                                            <th>Asset Number</th>
                                            <th>Name</th>
                                            <th>Category</th>
                                            <th>Status</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {recentAssets.map((asset) => (
                                            <tr key={asset.id}>
                                                <td>
                                                    <Link to={`/assets/${asset.id}`} className="text-primary">
                                                        {asset.asset_number}
                                                    </Link>
                                                </td>
                                                <td>{asset.name}</td>
                                                <td>{asset.category_name || 'N/A'}</td>
                                                <td>
                                                    <span className={`badge badge-${getStatusColor(asset.status)}`}>
                                                        {asset.status}
                                                    </span>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                    <div className="card-footer">
                        <Link to="/assets" className="btn btn-secondary">
                            View All Assets →
                        </Link>
                    </div>
                </div>

                <div className="card">
                    <div className="card-header">
                        <h3 className="card-title">Quick Actions</h3>
                    </div>
                    <div className="card-body">
                        <div className="flex flex-col gap-2">
                            <Link to="/assets/new" className="btn btn-primary">
                                📦 Register New Asset
                            </Link>
                            <Link to="/employees" className="btn btn-secondary">
                                👥 Manage Employees
                            </Link>
                            <Link to="/reports" className="btn btn-secondary">
                                📊 View Reports
                            </Link>
                            <Link to="/tags" className="btn btn-secondary">
                                🏷️ Print Asset Tags
                            </Link>
                        </div>
                    </div>
                </div>
            </div>

            <div className="card mt-3">
                <div className="card-header">
                    <h3 className="card-title">System Information</h3>
                </div>
                <div className="card-body">
                    <div className="grid grid-3">
                        <div>
                            <div className="text-muted">Organization</div>
                            <div className="mt-1"><strong>London Academy for Applied Technology</strong></div>
                        </div>
                        <div>
                            <div className="text-muted">System Developer</div>
                            <div className="mt-1"><strong>JH Infotech</strong></div>
                        </div>
                        <div>
                            <div className="text-muted">Version</div>
                            <div className="mt-1"><strong>1.0.0</strong></div>
                        </div>
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
