import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { reportsAPI, assetsAPI, authAPI, booksAPI } from '../services/api';

// Lightweight horizontal bar chart (no external chart library).
function BarChart({ data, unit = '' }) {
    const max = Math.max(1, ...data.map((d) => d.value));
    const palette = ['#6366f1', '#22c55e', '#f59e0b', '#ef4444', '#06b6d4', '#a855f7', '#ec4899', '#84cc16'];
    if (!data.length) {
        return <p className="text-muted">No data yet</p>;
    }
    return (
        <div className="flex flex-col gap-2">
            {data.map((d, i) => (
                <div key={d.label}>
                    <div className="flex justify-between" style={{ fontSize: '0.85rem', marginBottom: '2px' }}>
                        <span>{d.label}</span>
                        <span className="text-muted">{unit}{(d.value || 0).toLocaleString()}</span>
                    </div>
                    <div style={{ background: 'rgba(127,127,127,0.15)', borderRadius: '4px', overflow: 'hidden', height: '14px' }}>
                        <div style={{
                            width: `${Math.round((d.value / max) * 100)}%`,
                            background: palette[i % palette.length],
                            height: '100%'
                        }} />
                    </div>
                </div>
            ))}
        </div>
    );
}

export default function Dashboard() {
    const [stats, setStats] = useState(null);
    const [recentAssets, setRecentAssets] = useState([]);
    const [campusStats, setCampusStats] = useState([]);
    const [statusStats, setStatusStats] = useState([]);
    const [categoryStats, setCategoryStats] = useState([]);
    const [bookSummary, setBookSummary] = useState(null);
    const [loadError, setLoadError] = useState('');
    const [license, setLicense] = useState(null);
    const [showLicense, setShowLicense] = useState(true);
    const [campusModal, setCampusModal] = useState({ open: false, name: '', assets: [], loading: false });
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        loadData();
    }, []);

    async function loadData() {
        try {
            // Each call is independent so one failure can't blank the whole dashboard.
            const [summaryData, assetsData, campusData, statusData, categoryData, bookData] = await Promise.all([
                reportsAPI.getSummary().catch((e) => { console.error('summary failed', e); return null; }),
                assetsAPI.getAll().catch((e) => { console.error('assets failed', e); return []; }),
                reportsAPI.getByCampus().catch(() => []),
                reportsAPI.getByStatus().catch(() => []),
                reportsAPI.getByCategory().catch(() => []),
                booksAPI.summary().catch(() => null)
            ]);
            if (summaryData) setStats(summaryData);
            else setLoadError('Could not load live totals — the server may be restarting. Try refreshing.');
            setRecentAssets((assetsData || []).slice(0, 5));
            setCampusStats(campusData || []);
            setStatusStats(statusData || []);
            setCategoryStats(categoryData || []);
            setBookSummary(bookData);
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

    return (
        <div>
            <div className="flex justify-between items-center mb-3">
                <h2>Dashboard</h2>
                <Link to="/assets/new" className="btn btn-primary">
                    + Add New Asset
                </Link>
            </div>

            {loadError && (
                <div className="card mb-3" style={{ borderLeft: '4px solid var(--danger)' }}>
                    <div className="card-body" style={{ color: 'var(--danger)' }}>
                        ⚠️ {loadError}
                    </div>
                </div>
            )}

            <div className="flex justify-between items-center mb-3">
                <div>
                    <button className="btn btn-secondary btn-sm" onClick={() => setShowLicense((v) => !v)}>
                        {showLicense ? 'Hide License' : 'Show License'}
                    </button>
                </div>
                {showLicense && license && (() => {
                    const expiryMs = license.expires_at ? Number(license.expires_at) : null;
                    const daysLeft = expiryMs ? Math.max(0, Math.ceil((expiryMs - Date.now()) / (1000 * 60 * 60 * 24))) : null;
                    return (
                        <div className="badge badge-primary" style={{ fontSize: '0.95rem', padding: '0.5rem 0.75rem' }}>
                            License: {license.status || 'unknown'}{' '}
                            {daysLeft !== null ? `(expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'})` : '(no expiry)'}
                        </div>
                    );
                })()}
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
                        <h3 className="card-title">Assets by Status</h3>
                    </div>
                    <div className="card-body">
                        <BarChart data={statusStats.map((s) => ({ label: s.status || 'unknown', value: s.count || 0 }))} />
                    </div>
                </div>
                <div className="card">
                    <div className="card-header">
                        <h3 className="card-title">Top Categories</h3>
                    </div>
                    <div className="card-body">
                        <BarChart
                            data={[...categoryStats]
                                .sort((a, b) => (b.count || 0) - (a.count || 0))
                                .slice(0, 6)
                                .map((c) => ({ label: c.name, value: c.count || 0 }))}
                        />
                    </div>
                </div>
            </div>

            <div className="card">
                <div className="card-header">
                    <div className="flex justify-between items-center">
                        <h3 className="card-title">📚 Library Overview</h3>
                        <Link to="/library/issue" className="btn btn-sm btn-primary">Issue Desk</Link>
                    </div>
                </div>
                <div className="card-body">
                    <div className="stats-grid" style={{ marginBottom: '1rem' }}>
                        <div className="stat-card">
                            <div className="stat-label">Book Titles</div>
                            <div className="stat-value">{bookSummary?.titles || 0}</div>
                            <div className="text-muted">{bookSummary?.total_copies || 0} total copies</div>
                        </div>
                        <div className="stat-card">
                            <div className="stat-label">On Loan</div>
                            <div className="stat-value">{bookSummary?.active_loans || 0}</div>
                            <div className="text-muted">{bookSummary?.issued_copies || 0} copies issued</div>
                        </div>
                        <div className="stat-card">
                            <div className="stat-label">Overdue</div>
                            <div className="stat-value">{bookSummary?.overdue_loans || 0}</div>
                            <div className="text-muted">past due date</div>
                        </div>
                        <div className="stat-card">
                            <div className="stat-label">Borrowers</div>
                            <div className="stat-value">{bookSummary?.borrowers || 0}</div>
                            <div className="text-muted">students &amp; staff</div>
                        </div>
                    </div>
                    <BarChart
                        data={[
                            { label: 'Available copies', value: bookSummary?.available_copies || 0 },
                            { label: 'Issued copies', value: bookSummary?.issued_copies || 0 }
                        ]}
                    />
                </div>
            </div>

            <div className="card">
                <div className="card-header">
                    <h3 className="card-title">Campus Overview</h3>
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
                            </tr>
                        </thead>
                        <tbody>
                            {campusStats.length === 0 ? (
                                <tr>
                                    <td colSpan="5" className="text-muted text-center">No campus data</td>
                                </tr>
                            ) : (
                                campusStats.map((c, idx) => {
                                    const displayName = c.campus && c.campus.trim() ? c.campus : 'Unassigned';
                                    const campusValue = c.campus && c.campus.trim() ? c.campus : '';
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
                                        </tr>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
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
                                <div className="table-container mt-2">
                                    <table className="table">
                                        <thead>
                                            <tr>
                                                <th>Asset #</th>
                                                <th>Name</th>
                                                <th>Status</th>
                                                <th>Qty</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {campusModal.assets.length === 0 ? (
                                                <tr>
                                                    <td colSpan="4" className="text-center text-muted">No assets for this campus</td>
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
                                                    </tr>
                                                ))
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            </>
                        )}
                        <div className="flex gap-2 mt-3">
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

