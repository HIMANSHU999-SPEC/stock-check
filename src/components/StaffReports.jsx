import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { staffReportsAPI } from '../services/api';
import { formatStamp } from './MyAssets';

/**
 * The IT side of "My assets": problems staff have raised about their own
 * lists, and how far each person has got with confirming what they hold.
 */
export default function StaffReports() {
    const [data, setData] = useState(null);
    const [error, setError] = useState('');
    const [showClosed, setShowClosed] = useState(false);
    const [closing, setClosing] = useState(null);
    const [note, setNote] = useState('');
    const [saving, setSaving] = useState(false);
    const [closeError, setCloseError] = useState('');

    async function load() {
        try {
            setData(await staffReportsAPI.list());
            setError('');
        } catch (err) {
            setError(err.message || 'Could not load the reports');
        }
    }

    useEffect(() => { load(); }, []);

    async function closeReport(e) {
        e.preventDefault();
        setSaving(true);
        setCloseError('');
        try {
            await staffReportsAPI.resolve(closing.id, note);
            setClosing(null);
            await load();
        } catch (err) {
            setCloseError(err.message);
        } finally {
            setSaving(false);
        }
    }

    if (!data && !error) return <div className="spinner"></div>;
    if (!data) return <div className="alert alert-danger">{error}</div>;

    const open = data.reports.filter((r) => r.status === 'open');
    const shown = showClosed ? data.reports : open;
    const held = data.confirmations.reduce((sum, row) => sum + row.held, 0);
    const confirmed = data.confirmations.reduce((sum, row) => sum + row.confirmed, 0);

    return (
        <div>
            <div className="mb-3">
                <h2 style={{ marginBottom: '0.25rem' }}>Staff reports</h2>
                <div className="text-muted">
                    Staff sign in with Microsoft to see their own assets, confirm them, and report anything wrong.
                </div>
            </div>

            <div className="card mb-3">
                <div className="card-header flex justify-between items-center" style={{ flexWrap: 'wrap', gap: '0.5rem' }}>
                    <h3 className="card-title">
                        Reported problems
                        {open.length > 0 && <span className="badge badge-warning" style={{ marginLeft: '0.5rem' }}>{open.length} open</span>}
                    </h3>
                    <label className="flex items-center gap-1">
                        <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} />
                        <span>Show closed</span>
                    </label>
                </div>
                <div className="table-container">
                    <table className="table">
                        <thead>
                            <tr><th>Date</th><th>From</th><th>Problem</th><th>Item</th><th>Status</th><th></th></tr>
                        </thead>
                        <tbody>
                            {shown.length === 0 ? (
                                <tr><td colSpan="6" className="text-center text-muted">
                                    {showClosed ? 'No reports yet' : 'Nothing waiting'}
                                </td></tr>
                            ) : shown.map((r) => (
                                <tr key={r.id}>
                                    <td style={{ whiteSpace: 'nowrap' }}>{formatStamp(r.created_at)}</td>
                                    <td>
                                        {r.employee_id
                                            ? <Link to={`/employees/${r.employee_id}`} className="text-primary">{r.employee_name}</Link>
                                            : r.employee_name}
                                        <div className="text-muted" style={{ fontSize: '0.85rem' }}>{r.employee_email}</div>
                                    </td>
                                    <td>
                                        {r.reason_label}
                                        {r.message && <div className="text-muted cell-clamp" style={{ fontSize: '0.85rem' }}>{r.message}</div>}
                                    </td>
                                    <td>
                                        {r.asset_id
                                            ? <Link to={`/assets/${r.asset_id}`} className="text-primary">{r.asset_number}</Link>
                                            : '—'}
                                        {r.asset_name && <div className="text-muted" style={{ fontSize: '0.85rem' }}>{r.asset_name}</div>}
                                    </td>
                                    <td>
                                        {r.status === 'open' ? (
                                            <span className="badge badge-warning">Open</span>
                                        ) : (
                                            <>
                                                <span className="badge badge-success">Closed {formatStamp(r.resolved_at)}</span>
                                                <div className="text-muted" style={{ fontSize: '0.85rem' }}>
                                                    {r.resolution_note} — {r.resolved_by}
                                                </div>
                                            </>
                                        )}
                                        {r.status === 'open' && r.email_status && r.email_status !== 'sent' && (
                                            <div className="text-muted" style={{ fontSize: '0.8rem' }}>Email not sent</div>
                                        )}
                                    </td>
                                    <td>
                                        {r.status === 'open' && (
                                            <button
                                                type="button" className="btn btn-sm btn-primary"
                                                onClick={() => { setClosing(r); setNote(''); setCloseError(''); }}
                                            >
                                                Close
                                            </button>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            <div className="card mb-3">
                <div className="card-header">
                    <h3 className="card-title">Confirmations</h3>
                    <div className="text-muted" style={{ fontSize: '0.9rem' }}>
                        {held === 0
                            ? 'Nothing is assigned to anyone yet.'
                            : `${confirmed} of ${held} assignments confirmed by the person holding them.`}
                    </div>
                </div>
                <div className="table-container">
                    <table className="table">
                        <thead>
                            <tr><th>Person</th><th>Department</th><th>Holding</th><th>Confirmed</th><th>Last confirmed</th></tr>
                        </thead>
                        <tbody>
                            {data.confirmations.length === 0 ? (
                                <tr><td colSpan="5" className="text-center text-muted">No one holds anything</td></tr>
                            ) : data.confirmations.map((row) => (
                                <tr key={row.employee_id}>
                                    <td>
                                        <Link to={`/employees/${row.employee_id}`} className="text-primary">{row.name}</Link>
                                        <div className="text-muted" style={{ fontSize: '0.85rem' }}>{row.email}</div>
                                    </td>
                                    <td>{row.department || '—'}</td>
                                    <td>{row.held}</td>
                                    <td>
                                        <span className={`badge badge-${row.confirmed === row.held ? 'success' : row.confirmed === 0 ? 'danger' : 'warning'}`}>
                                            {row.confirmed} of {row.held}
                                        </span>
                                    </td>
                                    <td style={{ whiteSpace: 'nowrap' }}>{formatStamp(row.last_confirmed_at)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            {closing && (
                <div className="modal-overlay" onClick={() => !saving && setClosing(null)}>
                    <div className="modal" onClick={(e) => e.stopPropagation()}>
                        <h3>Close report from {closing.employee_name}</h3>
                        <p className="text-muted">
                            {closing.reason_label}{closing.asset_number ? ` — ${closing.asset_number}` : ''}.
                            Closing does not change any assignment: return or reassign the item first if that is
                            what is needed. The report and your note are kept.
                        </p>
                        {closeError && <div className="alert alert-danger">{closeError}</div>}
                        <form onSubmit={closeReport}>
                            <div className="form-group">
                                <label className="form-label">What was done</label>
                                <input
                                    type="text" className="form-control" value={note} maxLength={1000} required
                                    onChange={(e) => setNote(e.target.value)}
                                    placeholder="e.g. Laptop was reassigned to J. Smith in September; record corrected"
                                />
                            </div>
                            <div className="flex gap-2 mt-3">
                                <button type="button" className="btn btn-secondary" onClick={() => setClosing(null)} disabled={saving}>
                                    Cancel
                                </button>
                                <button type="submit" className="btn btn-primary" disabled={saving}>
                                    {saving ? 'Saving…' : 'Close report'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
