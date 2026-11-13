import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { staffReportsAPI, employeesAPI } from '../services/api';
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
    // Asking Microsoft 365 takes a few seconds, so it loads on its own.
    const [leavers, setLeavers] = useState(null);
    const [leaversBusy, setLeaversBusy] = useState(false);
    const [leaversError, setLeaversError] = useState('');

    async function load() {
        try {
            setData(await staffReportsAPI.list());
            setError('');
        } catch (err) {
            setError(err.message || 'Could not load the reports');
        }
    }

    async function loadLeavers(refresh = false) {
        setLeaversBusy(true);
        setLeaversError('');
        try {
            setLeavers(await staffReportsAPI.leavers(refresh));
        } catch (err) {
            setLeaversError(err.message || 'Could not check Microsoft 365');
        } finally {
            setLeaversBusy(false);
        }
    }

    async function markInactive(person) {
        const reason = {
            disabled: 'Microsoft 365 account is blocked',
            no_licence: 'Microsoft 365 account has no A5 faculty licence',
            not_found: 'No Microsoft 365 account with this email'
        }[person.account];
        if (!window.confirm(`Mark ${person.name} inactive? Their record and history are kept, and they can be reactivated.`)) return;
        try {
            await employeesAPI.deactivate(person.employee_id, `${reason} — marked inactive from Staff reports`);
            await Promise.all([loadLeavers(), load()]);
        } catch (err) {
            setLeaversError(err.message);
        }
    }

    useEffect(() => { load(); loadLeavers(); }, []);

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
                <div className="card-header flex justify-between items-center" style={{ flexWrap: 'wrap', gap: '0.5rem' }}>
                    <div>
                        <h3 className="card-title">
                            Staff who may have left
                            {leavers?.people?.length > 0 && (
                                <span className="badge badge-danger" style={{ marginLeft: '0.5rem' }}>{leavers.people.length}</span>
                            )}
                        </h3>
                        <div className="text-muted" style={{ fontSize: '0.9rem' }}>
                            Active on the staff list here, but their Microsoft 365 account is blocked, has no A5
                            faculty licence, or does not exist. Treat them as leavers: collect or reassign what
                            they hold, then mark them inactive.
                        </div>
                    </div>
                    <button type="button" className="btn btn-sm btn-secondary" onClick={() => loadLeavers(true)} disabled={leaversBusy}>
                        {leaversBusy ? 'Checking Microsoft 365…' : 'Check again'}
                    </button>
                </div>
                {leaversError && <div className="card-body"><div className="alert alert-danger" style={{ marginBottom: 0 }}>{leaversError}</div></div>}
                {!leavers && !leaversError && <div className="card-body text-muted">Checking Microsoft 365…</div>}
                {leavers && !leavers.available && (
                    <div className="card-body text-muted">Microsoft 365 is not connected on this server, so this check is not available.</div>
                )}
                {leavers && leavers.available && (
                    <div className="table-container">
                        <table className="table">
                            <thead>
                                <tr><th>Person</th><th>Microsoft 365 account</th><th>Still recorded against them</th><th>What to do</th></tr>
                            </thead>
                            <tbody>
                                {leavers.people.length === 0 ? (
                                    <tr><td colSpan="4" className="text-center text-muted">
                                        Everyone active on the staff list has a working Microsoft 365 account
                                    </td></tr>
                                ) : leavers.people.map((p) => (
                                    <tr key={p.employee_id}>
                                        <td>
                                            <Link to={`/employees/${p.employee_id}`} className="text-primary">{p.name}</Link>
                                            <div className="text-muted" style={{ fontSize: '0.85rem' }}>{p.email}</div>
                                        </td>
                                        <td>
                                            {p.account === 'disabled' && <span className="badge badge-danger">Blocked</span>}
                                            {p.account === 'no_licence' && <span className="badge badge-danger">No staff licence</span>}
                                            {p.account === 'not_found' && <span className="badge badge-warning">No account</span>}
                                            {p.account === 'no_licence' && (
                                                <div className="text-muted" style={{ fontSize: '0.8rem' }}>
                                                    Signed-in account without the A5 faculty licence
                                                </div>
                                            )}
                                            {p.account === 'not_found' && (
                                                <div className="text-muted" style={{ fontSize: '0.8rem' }}>
                                                    A department or shared name, or a deleted account
                                                </div>
                                            )}
                                        </td>
                                        <td>
                                            {p.held === 0 ? 'Nothing' : `${p.held} item${p.held === 1 ? '' : 's'}${p.units > p.held ? ` (${p.units} units)` : ''}`}
                                            {p.held > 0 && p.account !== 'not_found' && (
                                                <div><span className="badge badge-danger">Not returned</span></div>
                                            )}
                                        </td>
                                        <td>
                                            {p.account === 'not_found' && (
                                                <button
                                                    type="button" className="btn btn-sm btn-secondary" style={{ marginRight: '0.4rem' }}
                                                    title="A department or shared mailbox: stop listing it here"
                                                    onClick={() => employeesAPI.setKind(p.employee_id, 'shared').then(() => Promise.all([loadLeavers(), load()])).catch((e) => setLeaversError(e.message))}
                                                >
                                                    It is a department
                                                </button>
                                            )}
                                            {p.held === 0 ? (
                                                <button type="button" className="btn btn-sm btn-primary" onClick={() => markInactive(p)}>
                                                    Mark inactive
                                                </button>
                                            ) : (
                                                <Link to={`/employees/${p.employee_id}`} className="btn btn-sm btn-secondary">
                                                    Return or reassign first
                                                </Link>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
                {leavers?.available && leavers.unknown > 0 && (
                    <div className="card-body text-muted" style={{ fontSize: '0.85rem' }}>
                        {leavers.unknown} of {leavers.checked} could not be checked just now; use “Check again”.
                    </div>
                )}
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
                                        {row.kind === 'shared' && (
                                            <span className="badge badge-info" style={{ marginLeft: '0.5rem' }}>Department — IT confirms</span>
                                        )}
                                        {leavers?.people?.some((p) => p.employee_id === row.employee_id) && (
                                            <span className="badge badge-danger" style={{ marginLeft: '0.5rem' }}>Cannot sign in</span>
                                        )}
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
