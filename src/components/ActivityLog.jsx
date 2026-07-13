import React, { useState, useEffect } from 'react';
import { activityAPI } from '../services/api';

export default function ActivityLog() {
    const [data, setData] = useState({ items: [], total: 0, total_pages: 1, actions: [] });
    const [loading, setLoading] = useState(true);
    const [action, setAction] = useState('');
    const [page, setPage] = useState(1);

    useEffect(() => {
        load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [action, page]);

    async function load() {
        try {
            setLoading(true);
            const res = await activityAPI.list({ page, page_size: 25, ...(action ? { action } : {}) });
            setData(res);
        } catch (err) {
            console.error('Error loading activity:', err);
        } finally {
            setLoading(false);
        }
    }

    return (
        <div>
            <h2 className="mb-3">Activity Log</h2>

            <div className="card mb-3">
                <div className="card-body">
                    <div className="grid grid-2">
                        <div className="form-group">
                            <label className="form-label">Filter by action</label>
                            <select
                                className="form-control"
                                value={action}
                                onChange={(e) => { setPage(1); setAction(e.target.value); }}
                            >
                                <option value="">All actions</option>
                                {data.actions.map((a) => (
                                    <option key={a} value={a}>{a}</option>
                                ))}
                            </select>
                        </div>
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
                                    <th>When</th>
                                    <th>User</th>
                                    <th>Action</th>
                                    <th>Details</th>
                                </tr>
                            </thead>
                            <tbody>
                                {data.items.length === 0 ? (
                                    <tr><td colSpan="4" className="text-center text-muted">No activity recorded yet</td></tr>
                                ) : (
                                    data.items.map((row) => (
                                        <tr key={row.id}>
                                            <td>{row.timestamp ? new Date(row.timestamp).toLocaleString() : '—'}</td>
                                            <td>{row.user_email || 'system'}</td>
                                            <td><span className="badge badge-primary">{row.action}</span></td>
                                            <td>{row.description || '—'}</td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                    <div className="card-footer flex justify-between items-center">
                        <span className="text-muted">
                            {data.total} entr{data.total === 1 ? 'y' : 'ies'} · page {data.page} of {data.total_pages}
                        </span>
                        <div className="flex gap-2">
                            <button
                                className="btn btn-sm btn-secondary"
                                disabled={page <= 1}
                                onClick={() => setPage((p) => Math.max(1, p - 1))}
                            >
                                ← Prev
                            </button>
                            <button
                                className="btn btn-sm btn-secondary"
                                disabled={page >= data.total_pages}
                                onClick={() => setPage((p) => p + 1)}
                            >
                                Next →
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
