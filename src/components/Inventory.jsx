import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import * as XLSX from 'xlsx';
import { inventoryAPI } from '../services/api';

const money = (value) => `£${Math.round(value || 0).toLocaleString()}`;

// Link into the asset list with the matching filters applied.
function assetsLink({ campus, categoryId, status }) {
    const params = new URLSearchParams();
    if (campus !== undefined) params.set('campus', campus === '' ? '__unassigned__' : campus);
    if (categoryId) params.set('category', categoryId);
    if (status) params.set('status', status);
    return `/assets?${params}`;
}

function StockBar({ row }) {
    const total = Math.max(1, row.total);
    const pct = (n) => `${Math.max(0, (n / total) * 100)}%`;
    return (
        <div className="stock-bar" title={`${row.assigned} out · ${row.available} available · ${row.in_repair} in repair · ${row.written_off} written off`}>
            <span style={{ width: pct(row.assigned), background: 'var(--info)' }} />
            <span style={{ width: pct(row.available), background: 'var(--success)' }} />
            <span style={{ width: pct(row.in_repair), background: 'var(--warning)' }} />
            <span style={{ width: pct(row.written_off), background: 'var(--danger)' }} />
        </div>
    );
}

export default function Inventory() {
    const [data, setData] = useState(null);
    const [locations, setLocations] = useState([]);
    const [error, setError] = useState('');
    const [openCampus, setOpenCampus] = useState(null);

    useEffect(() => {
        inventoryAPI.summary().then(setData).catch((err) => setError(err.message));
        inventoryAPI.locations().then(setLocations).catch(() => {});
    }, []);

    function exportExcel() {
        const rows = [];
        data.campuses.forEach((campus) => {
            campus.categories.forEach((c) => {
                rows.push({
                    Campus: campus.campus || 'Unassigned',
                    Category: c.category,
                    'Asset lines': c.lines,
                    'Total quantity': c.total,
                    'Assigned': c.assigned,
                    'Available': c.available,
                    'In repair / maintenance': c.in_repair,
                    'Damaged / lost / retired': c.written_off,
                    'Value (£)': Math.round(c.value || 0)
                });
            });
        });
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Stock by campus');
        XLSX.writeFile(wb, `stock-by-campus-${new Date().toISOString().slice(0, 10)}.xlsx`);
    }

    if (error) return <div className="alert alert-danger">Could not load the inventory: {error}</div>;
    if (!data) return <div className="spinner"></div>;

    const { totals, campuses, categories } = data;

    return (
        <div>
            <div className="flex justify-between items-center mb-3" style={{ flexWrap: 'wrap', gap: '0.5rem' }}>
                <div>
                    <h2 style={{ marginBottom: '0.25rem' }}>Stock by Campus</h2>
                    <p className="text-muted" style={{ marginBottom: 0 }}>
                        Counts are quantities, so 40 tables registered as one line count as 40.
                    </p>
                </div>
                <button onClick={exportExcel} className="download-only btn btn-secondary" disabled={campuses.length === 0}>
                    📥 Export Excel
                </button>
            </div>

            <div className="stats-grid">
                <div className="stat-card">
                    <div className="stat-label">Total items</div>
                    <div className="stat-value">{totals.total.toLocaleString()}</div>
                    <div className="text-muted">{totals.lines.toLocaleString()} asset lines</div>
                </div>
                <div className="stat-card">
                    <div className="stat-label">Assigned</div>
                    <div className="stat-value">{totals.assigned.toLocaleString()}</div>
                    <div className="text-muted">with staff or in rooms</div>
                </div>
                <div className="stat-card">
                    <div className="stat-label">Available</div>
                    <div className="stat-value">{totals.available.toLocaleString()}</div>
                    <div className="text-muted">in stock, ready to assign</div>
                </div>
                <div className="stat-card">
                    <div className="stat-label">Out of service</div>
                    <div className="stat-value">{(totals.in_repair + totals.written_off).toLocaleString()}</div>
                    <div className="text-muted">{totals.in_repair} in repair · {totals.written_off} written off</div>
                </div>
            </div>

            <div className="stock-legend mb-2">
                <span><i style={{ background: 'var(--info)' }} /> Assigned</span>
                <span><i style={{ background: 'var(--success)' }} /> Available</span>
                <span><i style={{ background: 'var(--warning)' }} /> Repair / maintenance</span>
                <span><i style={{ background: 'var(--danger)' }} /> Damaged / lost / retired</span>
            </div>

            {campuses.length === 0 && (
                <div className="card"><p className="text-muted">No assets registered yet.</p></div>
            )}

            {campuses.map((campus) => {
                const name = campus.campus || 'Unassigned (no campus set)';
                const isOpen = openCampus === campus.campus || campuses.length === 1;
                const rooms = locations.filter((l) => l.campus === campus.campus);
                return (
                    <div key={campus.campus || '__none__'} className="card mb-3">
                        <button
                            type="button"
                            className="campus-head"
                            onClick={() => setOpenCampus(isOpen ? null : campus.campus)}
                            aria-expanded={isOpen}
                        >
                            <div>
                                <div className="card-title">{isOpen ? '▾' : '▸'} {name}</div>
                                <div className="text-muted" style={{ fontSize: '0.9rem' }}>
                                    {campus.total.toLocaleString()} items · {campus.assigned} assigned ·{' '}
                                    {campus.available} available · {money(campus.value)}
                                </div>
                            </div>
                            <div style={{ flex: '1 1 12rem', maxWidth: '24rem' }}><StockBar row={campus} /></div>
                        </button>

                        {isOpen && (
                            <>
                                <div className="table-container mt-2">
                                    <table className="table">
                                        <thead>
                                            <tr>
                                                <th>Category</th>
                                                <th>Total</th>
                                                <th>Assigned</th>
                                                <th>Available</th>
                                                <th>Repair</th>
                                                <th>Written off</th>
                                                <th>Value</th>
                                                <th style={{ minWidth: '9rem' }}>Split</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {campus.categories.map((c) => (
                                                <tr key={c.category}>
                                                    <td>
                                                        <Link
                                                            to={assetsLink({ campus: campus.campus, categoryId: c.category_id })}
                                                            className="text-primary"
                                                        >
                                                            <strong>{c.category}</strong>
                                                        </Link>
                                                    </td>
                                                    <td>{c.total}</td>
                                                    <td>
                                                        <Link to={assetsLink({ campus: campus.campus, categoryId: c.category_id, status: 'assigned' })}>
                                                            {c.assigned}
                                                        </Link>
                                                    </td>
                                                    <td>
                                                        <Link to={assetsLink({ campus: campus.campus, categoryId: c.category_id, status: 'available' })}>
                                                            {c.available}
                                                        </Link>
                                                    </td>
                                                    <td>{c.in_repair}</td>
                                                    <td>{c.written_off}</td>
                                                    <td>{money(c.value)}</td>
                                                    <td><StockBar row={c} /></td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                                {rooms.length > 0 && (
                                    <div className="mt-2">
                                        <div className="form-label">Rooms holding stock</div>
                                        <div className="flex gap-1" style={{ flexWrap: 'wrap' }}>
                                            {rooms.map((room) => (
                                                <Link
                                                    key={room.location}
                                                    to={`/assets?${new URLSearchParams({ search: room.location })}`}
                                                    className="btn btn-sm btn-secondary"
                                                >
                                                    📍 {room.location} · {room.quantity}
                                                </Link>
                                            ))}
                                        </div>
                                    </div>
                                )}
                                <div className="mt-2">
                                    <Link to={assetsLink({ campus: campus.campus })} className="btn btn-sm btn-secondary">
                                        View all assets at this campus
                                    </Link>
                                </div>
                            </>
                        )}
                    </div>
                );
            })}

            {categories.length > 0 && (
                <div className="card">
                    <div className="card-header">
                        <h3 className="card-title">All campuses by category</h3>
                    </div>
                    <div className="table-container">
                        <table className="table">
                            <thead>
                                <tr>
                                    <th>Category</th>
                                    {campuses.map((c) => <th key={c.campus || '__none__'}>{c.campus || 'Unassigned'}</th>)}
                                    <th>Total</th>
                                    <th>Available</th>
                                </tr>
                            </thead>
                            <tbody>
                                {categories.map((cat) => (
                                    <tr key={cat.category}>
                                        <td><strong>{cat.category}</strong></td>
                                        {campuses.map((campus) => {
                                            const cell = campus.categories.find((c) => c.category === cat.category);
                                            return <td key={campus.campus || '__none__'}>{cell ? cell.total : '—'}</td>;
                                        })}
                                        <td><strong>{cat.total}</strong></td>
                                        <td>{cat.available}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    );
}
