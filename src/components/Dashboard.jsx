import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { reportsAPI, assetsAPI, authAPI } from '../services/api';

export default function Dashboard() {
    const [stats, setStats] = useState(null);
    const [recentAssets, setRecentAssets] = useState([]);
    const [campusStats, setCampusStats] = useState([]);
    const [categoryStats, setCategoryStats] = useState([]);
    const [statusStats, setStatusStats] = useState([]);
    const [license, setLicense] = useState(null);
    const [showLicense, setShowLicense] = useState(true);
    const [campusModal, setCampusModal] = useState({ open: false, name: '', assets: [], loading: false });
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        loadData();
    }, []);

    async function loadData() {
        try {
            const [summaryData, assetsData, campusData, categoryData, statusData] = await Promise.all([
                reportsAPI.getSummary(),
                assetsAPI.getAll(),
                reportsAPI.getByCampus(),
                reportsAPI.getByCategory(),
                reportsAPI.getByStatus()
            ]);
            setStats(summaryData);
            setRecentAssets(assetsData.slice(0, 5));
            setCampusStats(campusData);
            setCategoryStats(categoryData);
            setStatusStats(statusData);
            try {
                const lic = await authAPI.license();
                setLicense(lic);
            } catch (e) {
                // ignore license fetch errors on dashboard
            }
        } catch (error) {
            console.error('Error loading dashboard:', error);
        } finally {
            setLoading(false);
        }
    }

    async function handleCampusClick(displayName, campusValue) {
        setCampusModal({ open: true, name: displayName || 'Unassigned', assets: [], loading: true });
        try {
            const assets = await assetsAPI.getAll({ campus: campusValue || '' });
            setCampusModal({ open: true, name: displayName || 'Unassigned', assets, loading: false });
        } catch (error) {
            setCampusModal({ open: true, name: displayName || 'Unassigned', assets: [], loading: false });
            console.error('Failed to load campus assets', error);
        }
    }

    if (loading) {
        return <div className="spinner"></div>;
    }

    const totalAssets = stats?.total || 0;
    const utilizationPct = totalAssets > 0 ? Math.round(((stats?.assigned || 0) / totalAssets) * 100) : 0;
    const maxCategoryCount = Math.max(...(categoryStats.map(c => c.count || 0)), 1);
    const maxStatusCount = Math.max(...(statusStats.map(s => s.count || 0)), 1);
    const maxCampusValue = Math.max(...(campusStats.map(c => c.total_value || 0)), 1);

    return (
        <div>
            <div className="flex justify-between items-center mb-3">
                <h2>Dashboard</h2>
                <div className="flex gap-2">
                    <Link to="/assets/import" className="btn btn-secondary">
                        Import Assets
                    </Link>
                    <Link to="/assets/new" className="btn btn-primary">
                        + Add New Asset
                    </Link>
                </div>
            </div>

            {/* License Banner */}
            <div className="flex justify-between items-center mb-3">
                <div>
                    <button className="btn btn-secondary btn-sm" onClick={() => setShowLicense((v) => !v)}>
                        {showLicense ? 'Hide License' : 'Show License'}
                    </button>
                </div>
                {showLicense && license && (() => {
                    const expiryMs = license.expires_at ? Number(license.expires_at) : null;
                    const daysLeft = expiryMs ? Math.max(0, Math.ceil((expiryMs - Date.now()) / (1000 * 60 * 60 * 24))) : null;
                    const isWarning = daysLeft !== null && daysLeft <= 30;
                    return (
                        <div className={`badge badge-${isWarning ? 'warning' : 'primary'}`} style={{ fontSize: '0.95rem', padding: '0.5rem 0.75rem' }}>
                            License: {license.status || 'unknown'}{' '}
                            {daysLeft !== null ? `(expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'})` : '(no expiry)'}
                        </div>
                    );
                })()}
            </div>

            {/* Primary Stats */}
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
                    <div className="stat-label">Maintenance</div>
                    <div className="stat-value">{stats?.maintenance || 0}</div>
                    <div className="text-muted">Under repair/service</div>
                </div>
                <div className="stat-card">
                    <div className="stat-label">Total Value</div>
                    <div className="stat-value">£{(stats?.total_value || 0).toLocaleString()}</div>
                    <div className="text-muted">Purchase price</div>
                </div>
                <div className="stat-card">
                    <div className="stat-label">Intune Value</div>
                    <div className="stat-value">£{(stats?.total_intune_value || 0).toLocaleString()}</div>
                    <div className="text-muted">Licensing cost</div>
                </div>
            </div>

            {/* Utilization Bar */}
            <div className="card mt-3">
                <div className="card-body" style={{ padding: '1rem 1.25rem' }}>
                    <div className="flex justify-between" style={{ marginBottom: '0.4rem' }}>
                        <span style={{ fontWeight: 600 }}>Asset Utilization</span>
                        <span style={{ fontWeight: 700, color: utilizationPct >= 80 ? 'var(--danger)' : utilizationPct >= 60 ? 'var(--warning)' : 'var(--success)' }}>
                            {utilizationPct}%
                        </span>
                    </div>
                    <div style={{ background: 'var(--bg-tertiary)', borderRadius: '6px', height: '12px', overflow: 'hidden' }}>
                        <div style={{
                            width: utilizationPct + '%', height: '100%', borderRadius: '6px', transition: 'width 0.5s',
                            background: utilizationPct >= 80 ? 'var(--danger)' : utilizationPct >= 60 ? 'var(--warning)' : 'var(--success)'
                        }} />
                    </div>
                    <div className="text-muted" style={{ fontSize: '0.8rem', marginTop: '0.3rem' }}>
                        {stats?.assigned || 0} of {totalAssets} assets are currently assigned
                    </div>
                </div>
            </div>

            <div className="grid grid-2 mt-3">
                {/* Category Chart */}
                <div className="card">
                    <div className="card-header">
                        <div className="flex justify-between items-center">
                            <h3 className="card-title">Assets by Category</h3>
                            <Link to="/reports" className="btn btn-sm btn-secondary">Full Report</Link>
                        </div>
                    </div>
                    <div className="card-body">
                        {categoryStats.filter(c => c.count > 0).slice(0, 8).map((cat, idx) => {
                            const pct = Math.round((cat.count / maxCategoryCount) * 100);
                            return (
                                <div key={idx} style={{ marginBottom: '0.6rem' }}>
                                    <div className="flex justify-between" style={{ fontSize: '0.85rem', marginBottom: '2px' }}>
                                        <span>{cat.name}</span>
                                        <span className="text-muted">{cat.count} &nbsp;·&nbsp; £{(cat.total_value || 0).toLocaleString()}</span>
                                    </div>
                                    <div style={{ background: 'var(--bg-tertiary)', borderRadius: '4px', height: '8px', overflow: 'hidden' }}>
                                        <div style={{ width: pct + '%', height: '100%', background: 'var(--primary)', borderRadius: '4px', transition: 'width 0.4s' }} />
                                    </div>
                                </div>
                            );
                        })}
                        {categoryStats.filter(c => c.count > 0).length === 0 && <p className="text-muted">No category data</p>}
                    </div>
                </div>

                {/* Status Chart */}
                <div className="card">
                    <div className="card-header">
                        <h3 className="card-title">Assets by Status</h3>
                    </div>
                    <div className="card-body">
                        {statusStats.map((s, idx) => {
                            const pct = Math.round((s.count / maxStatusCount) * 100);
                            const color = getStatusColor(s.status);
                            const colorVar = { success: 'var(--success)', info: 'var(--info, var(--primary))', warning: 'var(--warning)', danger: 'var(--danger)', primary: 'var(--primary)' }[color] || 'var(--primary)';
                            return (
                                <div key={idx} style={{ marginBottom: '0.6rem' }}>
                                    <div className="flex justify-between" style={{ fontSize: '0.85rem', marginBottom: '2px' }}>
                                        <span className="flex items-center gap-1">
                                            <span className={`badge badge-${color}`} style={{ fontSize: '0.7rem' }}>{s.status}</span>
                                        </span>
                                        <span className="text-muted">{s.count} ({totalAssets > 0 ? Math.round(s.count / totalAssets * 100) : 0}%)</span>
                                    </div>
                                    <div style={{ background: 'var(--bg-tertiary)', borderRadius: '4px', height: '8px', overflow: 'hidden' }}>
                                        <div style={{ width: pct + '%', height: '100%', background: colorVar, borderRadius: '4px', transition: 'width 0.4s' }} />
                                    </div>
                                </div>
                            );
                        })}
                        {statusStats.length === 0 && <p className="text-muted">No status data</p>}
                    </div>
                </div>
            </div>

            {/* Campus Overview with Value Bars */}
            <div className="card mt-3">
                <div className="card-header">
                    <div className="flex justify-between items-center">
                        <h3 className="card-title">Campus Overview</h3>
                        <Link to="/campus-report" className="btn btn-sm btn-secondary">Detailed Report</Link>
                    </div>
                </div>
                <div className="table-container">
                    <table className="table campus-table">
                        <thead>
                            <tr>
                                <th>Campus</th>
                                <th>Assets</th>
                                <th>Total Qty</th>
                                <th>Available</th>
                                <th>Total Value</th>
                                <th style={{ width: '160px' }}>Value Share</th>
                            </tr>
                        </thead>
                        <tbody>
                            {campusStats.length === 0 ? (
                                <tr>
                                    <td colSpan="6" className="text-muted text-center">No campus data</td>
                                </tr>
                            ) : (
                                campusStats.map((c, idx) => {
                                    const displayName = c.campus && c.campus.trim() ? c.campus : 'Unassigned';
                                    const campusValue = c.campus && c.campus.trim() ? c.campus : '';
                                    const valuePct = Math.round(((c.total_value || 0) / maxCampusValue) * 100);
                                    return (
                                        <tr key={idx}>
                                            <td>
                                                <button
                                                    type="button"
                                                    className="campus-badge"
                                                    onClick={() => handleCampusClick(displayName, campusValue)}
                                                >
                                                    {displayName}
                                                </button>
                                            </td>
                                            <td>{c.asset_count || 0}</td>
                                            <td>{c.total_quantity || 0}</td>
                                            <td>{c.available_quantity || 0}</td>
                                            <td>£{(c.total_value || 0).toLocaleString()}</td>
                                            <td>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                    <div style={{ flex: 1, background: 'var(--bg-tertiary)', borderRadius: '4px', height: '8px', overflow: 'hidden' }}>
                                                        <div style={{ width: valuePct + '%', height: '100%', background: 'var(--primary)', borderRadius: '4px' }} />
                                                    </div>
                                                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', minWidth: '28px' }}>{valuePct}%</span>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            <div className="grid grid-2 mt-3">
                {/* Recent Assets */}
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

                {/* Quick Actions */}
                <div className="card">
                    <div className="card-header">
                        <h3 className="card-title">Quick Actions</h3>
                    </div>
                    <div className="card-body">
                        <div className="flex flex-col gap-2">
                            <Link to="/assets/new" className="btn btn-primary">
                                📦 Register New Asset
                            </Link>
                            <Link to="/assets/import" className="btn btn-secondary">
                                📥 Import Assets (CSV/Excel)
                            </Link>
                            <Link to="/employees" className="btn btn-secondary">
                                👥 Manage Employees
                            </Link>
                            <Link to="/campus-report" className="btn btn-secondary">
                                🏫 Campus Stock Report
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

            {/* System Info */}
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
                            <div className="mt-1"><strong>2.0.0</strong></div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Campus Modal */}
            {campusModal.open && (
                <div className="modal-overlay" onClick={() => setCampusModal({ open: false, name: '', assets: [], loading: false })}>
                    <div className="modal" onClick={(e) => e.stopPropagation()}>
                        <h3>Campus: {campusModal.name || 'Unassigned'}</h3>
                        {campusModal.loading ? (
                            <div className="spinner"></div>
                        ) : (
                            <>
                                <div className="mt-2">
                                    {buildStatusSummary(campusModal.assets).map((s) => (
                                        <span key={s.status} className="badge badge-primary" style={{ marginRight: '0.35rem' }}>
                                            {s.status}: {s.count}
                                        </span>
                                    ))}
                                </div>
                                <div style={{ marginTop: '0.5rem', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                                    Total Value: £{campusModal.assets.reduce((sum, a) => sum + (a.purchase_price || 0), 0).toLocaleString()}
                                </div>
                                <div className="table-container mt-2">
                                    <table className="table">
                                        <thead>
                                            <tr>
                                                <th>Asset #</th>
                                                <th>Name</th>
                                                <th>Status</th>
                                                <th>Qty</th>
                                                <th>Price</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {campusModal.assets.length === 0 ? (
                                                <tr>
                                                    <td colSpan="5" className="text-center text-muted">No assets for this campus</td>
                                                </tr>
                                            ) : (
                                                campusModal.assets.map((a) => (
                                                    <tr key={a.id}>
                                                        <td>{a.asset_number}</td>
                                                        <td>{a.name}</td>
                                                        <td>
                                                            <span className={`badge badge-${getStatusColor(a.status)}`}>
                                                                {a.status}
                                                            </span>
                                                        </td>
                                                        <td>{a.quantity || 1}</td>
                                                        <td>{a.purchase_price ? '£' + Number(a.purchase_price).toLocaleString() : '—'}</td>
                                                    </tr>
                                                ))
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            </>
                        )}
                        <div className="flex gap-2 mt-3">
                            <Link to="/campus-report" className="btn btn-primary btn-sm" onClick={() => setCampusModal({ open: false, name: '', assets: [], loading: false })}>
                                Full Report
                            </Link>
                            <button className="btn btn-secondary" onClick={() => setCampusModal({ open: false, name: '', assets: [], loading: false })}>
                                Close
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

function buildStatusSummary(assets) {
    const counts = assets.reduce((acc, a) => {
        const key = a.status || 'unknown';
        acc[key] = (acc[key] || 0) + 1;
        return acc;
    }, {});
    return Object.keys(counts).map((status) => ({ status, count: counts[status] }));
}
