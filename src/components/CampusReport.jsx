import React, { useState, useEffect } from 'react';
import { reportsAPI, assetsAPI } from '../services/api';

export default function CampusReport() {
    const [campusDetail, setCampusDetail] = useState([]);
    const [loading, setLoading] = useState(true);
    const [expanded, setExpanded] = useState({});
    const [campusAssets, setCampusAssets] = useState({});
    const [loadingAssets, setLoadingAssets] = useState({});
    const [exporting, setExporting] = useState({});
    const [search, setSearch] = useState('');

    useEffect(() => {
        loadData();
    }, []);

    async function loadData() {
        try {
            const data = await reportsAPI.getCampusDetail();
            setCampusDetail(data);
        } catch (error) {
            console.error('Error loading campus detail:', error);
        } finally {
            setLoading(false);
        }
    }

    async function toggleCampus(campusName) {
        const next = !expanded[campusName];
        setExpanded(prev => ({ ...prev, [campusName]: next }));
        if (next && !campusAssets[campusName]) {
            setLoadingAssets(prev => ({ ...prev, [campusName]: true }));
            try {
                const value = campusName === 'Unspecified' ? '' : campusName;
                const assets = await assetsAPI.getAll({ campus: value });
                setCampusAssets(prev => ({ ...prev, [campusName]: assets }));
            } catch (e) {
                console.error('Failed to load assets for campus', e);
            } finally {
                setLoadingAssets(prev => ({ ...prev, [campusName]: false }));
            }
        }
    }

    async function exportCampus(campusName) {
        setExporting(prev => ({ ...prev, [campusName]: true }));
        try {
            const value = campusName === 'Unspecified' ? '' : campusName;
            await assetsAPI.exportByCampus(value);
        } catch (e) {
            alert('Export failed: ' + e.message);
        } finally {
            setExporting(prev => ({ ...prev, [campusName]: false }));
        }
    }

    const filtered = campusDetail.filter(c =>
        !search || c.campus.toLowerCase().includes(search.toLowerCase())
    );

    const grandTotal = campusDetail.reduce((acc, c) => {
        acc.asset_count += c.totals.asset_count;
        acc.total_quantity += c.totals.total_quantity;
        acc.available_quantity += c.totals.available_quantity;
        acc.assigned_quantity += c.totals.assigned_quantity;
        acc.total_value += c.totals.total_value;
        acc.total_intune_value += c.totals.total_intune_value;
        return acc;
    }, { asset_count: 0, total_quantity: 0, available_quantity: 0, assigned_quantity: 0, total_value: 0, total_intune_value: 0 });

    if (loading) return <div className="spinner"></div>;

    return (
        <div>
            <div className="flex justify-between items-center mb-3">
                <h2>Campus Stock Report</h2>
                <div className="flex gap-2">
                    <input
                        className="form-control"
                        placeholder="Search campus..."
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        style={{ width: '200px' }}
                    />
                    <button className="btn btn-secondary" onClick={() => assetsAPI.exportByCampus()}>
                        Export All CSV
                    </button>
                </div>
            </div>

            {/* Grand Totals */}
            <div className="stats-grid mb-3">
                <div className="stat-card">
                    <div className="stat-label">Total Assets</div>
                    <div className="stat-value">{grandTotal.asset_count}</div>
                    <div className="text-muted">Across all campuses</div>
                </div>
                <div className="stat-card">
                    <div className="stat-label">Total Qty</div>
                    <div className="stat-value">{grandTotal.total_quantity}</div>
                    <div className="text-muted">Units</div>
                </div>
                <div className="stat-card">
                    <div className="stat-label">Available</div>
                    <div className="stat-value">{grandTotal.available_quantity}</div>
                    <div className="text-muted">Ready to assign</div>
                </div>
                <div className="stat-card">
                    <div className="stat-label">Total Value</div>
                    <div className="stat-value">£{(grandTotal.total_value || 0).toLocaleString()}</div>
                    <div className="text-muted">Purchase price</div>
                </div>
            </div>

            {filtered.length === 0 && (
                <div className="card">
                    <div className="card-body text-muted text-center">No campus data found.</div>
                </div>
            )}

            {filtered.map(campusData => {
                const cn = campusData.campus;
                const t = campusData.totals;
                const isExpanded = expanded[cn];
                const assets = campusAssets[cn] || [];
                const isLoadingAssets = loadingAssets[cn];

                return (
                    <div className="card mb-3" key={cn}>
                        <div className="card-header" style={{ cursor: 'pointer' }} onClick={() => toggleCampus(cn)}>
                            <div className="flex justify-between items-center">
                                <div className="flex items-center gap-2">
                                    <span style={{ fontSize: '1.1rem', fontWeight: '600' }}>{cn}</span>
                                    <span className="badge badge-primary">{t.asset_count} assets</span>
                                    <span className="badge badge-success">£{(t.total_value || 0).toLocaleString()}</span>
                                </div>
                                <div className="flex gap-2 items-center">
                                    <button
                                        className="btn btn-sm btn-secondary"
                                        onClick={e => { e.stopPropagation(); exportCampus(cn); }}
                                        disabled={exporting[cn]}
                                    >
                                        {exporting[cn] ? 'Exporting...' : 'Export CSV'}
                                    </button>
                                    <span style={{ fontSize: '1.2rem' }}>{isExpanded ? '▲' : '▼'}</span>
                                </div>
                            </div>
                            <div className="flex gap-3 mt-1" style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                                <span>Total Qty: {t.total_quantity}</span>
                                <span>Assigned: {t.assigned_quantity}</span>
                                <span>Available: {t.available_quantity}</span>
                                {t.total_intune_value > 0 && <span>Intune Value: £{(t.total_intune_value || 0).toLocaleString()}</span>}
                            </div>
                        </div>

                        {isExpanded && (
                            <div className="card-body">
                                {/* Category breakdown */}
                                <h4 style={{ marginBottom: '0.75rem' }}>By Category</h4>
                                <div className="table-container mb-3">
                                    <table className="table">
                                        <thead>
                                            <tr>
                                                <th>Category</th>
                                                <th>Assets</th>
                                                <th>Total Qty</th>
                                                <th>Assigned</th>
                                                <th>Available</th>
                                                <th>Total Value</th>
                                                <th>Intune Value</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {campusData.categories.map((cat, idx) => (
                                                <tr key={idx}>
                                                    <td><strong>{cat.category}</strong></td>
                                                    <td>{cat.asset_count}</td>
                                                    <td>{cat.total_quantity}</td>
                                                    <td>{cat.assigned_quantity}</td>
                                                    <td>{cat.available_quantity}</td>
                                                    <td>£{(cat.total_value || 0).toLocaleString()}</td>
                                                    <td>{cat.total_intune_value ? '£' + (cat.total_intune_value || 0).toLocaleString() : '—'}</td>
                                                </tr>
                                            ))}
                                            <tr style={{ fontWeight: '700', borderTop: '2px solid var(--border-color)' }}>
                                                <td>TOTAL</td>
                                                <td>{t.asset_count}</td>
                                                <td>{t.total_quantity}</td>
                                                <td>{t.assigned_quantity}</td>
                                                <td>{t.available_quantity}</td>
                                                <td>£{(t.total_value || 0).toLocaleString()}</td>
                                                <td>{t.total_intune_value ? '£' + (t.total_intune_value || 0).toLocaleString() : '—'}</td>
                                            </tr>
                                        </tbody>
                                    </table>
                                </div>

                                {/* Value progress bars by category */}
                                <h4 style={{ marginBottom: '0.5rem' }}>Value Distribution</h4>
                                <div style={{ marginBottom: '1rem' }}>
                                    {campusData.categories.filter(c => c.total_value > 0).map((cat, idx) => {
                                        const pct = t.total_value > 0 ? Math.round((cat.total_value / t.total_value) * 100) : 0;
                                        return (
                                            <div key={idx} style={{ marginBottom: '0.5rem' }}>
                                                <div className="flex justify-between" style={{ fontSize: '0.85rem', marginBottom: '2px' }}>
                                                    <span>{cat.category}</span>
                                                    <span>£{(cat.total_value || 0).toLocaleString()} ({pct}%)</span>
                                                </div>
                                                <div style={{ background: 'var(--bg-tertiary)', borderRadius: '4px', height: '8px', overflow: 'hidden' }}>
                                                    <div style={{ width: pct + '%', height: '100%', background: 'var(--primary)', borderRadius: '4px', transition: 'width 0.3s' }} />
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>

                                {/* Asset list */}
                                <h4 style={{ marginBottom: '0.5rem' }}>All Assets in {cn}</h4>
                                {isLoadingAssets ? (
                                    <div className="spinner"></div>
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
                                                    <th>Purchase Price</th>
                                                    <th>Assigned To</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {assets.length === 0 ? (
                                                    <tr><td colSpan="8" className="text-center text-muted">No assets found</td></tr>
                                                ) : (
                                                    assets.map(a => (
                                                        <tr key={a.id}>
                                                            <td><span className="text-primary">{a.asset_number}</span></td>
                                                            <td>{a.name}</td>
                                                            <td>{a.category_name || 'N/A'}</td>
                                                            <td>{a.model || '—'}</td>
                                                            <td><span className={`badge badge-${getStatusColor(a.status)}`}>{a.status}</span></td>
                                                            <td>{a.quantity}</td>
                                                            <td>{a.purchase_price ? '£' + Number(a.purchase_price).toLocaleString() : '—'}</td>
                                                            <td>{a.employee_name || '—'}</td>
                                                        </tr>
                                                    ))
                                                )}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
}

function getStatusColor(status) {
    const map = { available: 'success', assigned: 'info', maintenance: 'warning', repair: 'warning', damaged: 'danger', lost: 'danger', stolen: 'danger', retired: 'danger' };
    return map[status] || 'primary';
}
