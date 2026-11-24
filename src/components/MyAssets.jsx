import React, { useEffect, useState } from 'react';
import { myAPI } from '../services/api';
import { queueDraft } from '../utils/emailTemplates';

// The database stores UTC without a zone marker.
export function formatStamp(value) {
    if (!value) return '—';
    const date = new Date(String(value).replace(' ', 'T') + (String(value).includes('Z') ? '' : 'Z'));
    return Number.isNaN(date.getTime())
        ? '—'
        : date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

const ITEM_REASONS = ['not_mine', 'wrong_details', 'faulty'];

/**
 * What is recorded against the person signed in. Every member of staff can
 * open this page; it is the only page a member of staff who does not run the
 * system can open. They confirm what they hold and tell IT Support about
 * anything that is wrong.
 */
export default function MyAssets() {
    const [data, setData] = useState(null);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const [busyId, setBusyId] = useState(null);
    // { item } for a problem with one item, { item: null } for anything else.
    const [reporting, setReporting] = useState(null);
    const [reason, setReason] = useState('');
    const [message, setMessage] = useState('');
    const [sending, setSending] = useState(false);
    const [reportError, setReportError] = useState('');

    async function load() {
        try {
            setData(await myAPI.assets());
            setError('');
        } catch (err) {
            setError(err.message || 'Could not load your assets');
        }
    }

    useEffect(() => { load(); }, []);

    async function confirm(item) {
        setBusyId(item.assignment_id);
        setNotice('');
        try {
            await myAPI.confirm(item.assignment_id);
            await load();
        } catch (err) {
            setError(err.message);
        } finally {
            setBusyId(null);
        }
    }

    async function confirmAll() {
        const waiting = data.items.filter((item) => !item.confirmed_at && !item.open_reports && !item.bulk);
        setBusyId('all');
        setNotice('');
        let problem = '';
        try {
            for (const item of waiting) {
                await myAPI.confirm(item.assignment_id);
            }
            setNotice('Thank you — everything on your list is confirmed.');
        } catch (err) {
            problem = err.message;
        } finally {
            await load();
            // Shown after the list reloads, which would otherwise clear it.
            if (problem) setError(`Not everything could be confirmed: ${problem} Check the list below and try again.`);
            setBusyId(null);
        }
    }

    function openReport(item) {
        setReporting({ item });
        setReason(item ? 'not_mine' : 'missing');
        setMessage('');
        setReportError('');
    }

    async function sendReport(e) {
        e.preventDefault();
        setSending(true);
        setReportError('');
        try {
            const result = await myAPI.report({
                reason,
                message,
                assignment_id: reporting.item ? reporting.item.assignment_id : undefined
            });
            setReporting(null);
            if (result.draft) queueDraft(result.draft.to, result.draft.subject, result.draft.body);
            setNotice(result.emailed
                ? 'Your message has been sent to IT Support. They will be in touch.'
                : 'Your report has been recorded and IT Support can see it. You can also email it to them with the draft at the bottom of the screen.');
            await load();
        } catch (err) {
            setReportError(err.message);
        } finally {
            setSending(false);
        }
    }

    if (!data && !error) return <div className="spinner"></div>;
    if (!data) return <div className="alert alert-danger">{error}</div>;

    const { person, items, returned, reports, reasons } = data;
    // Bulk stock is counted by IT, so it is never waiting on the holder.
    const waiting = items.filter((item) => !item.confirmed_at && !item.open_reports && !item.bulk);
    const confirmed = items.filter((item) => item.confirmed_at).length;
    const reasonChoices = Object.entries(reasons).filter(([key]) =>
        (reporting?.item ? ITEM_REASONS.includes(key) : !ITEM_REASONS.includes(key)));

    return (
        <div className="my-assets">
            <div className="flex justify-between items-center mb-3" style={{ flexWrap: 'wrap', gap: '0.75rem' }}>
                <div>
                    <h2 style={{ marginBottom: '0.25rem' }}>My assets</h2>
                    <div className="text-muted">
                        {person.name} · {person.email}{person.department ? ` · ${person.department}` : ''}
                    </div>
                </div>
                {person.on_staff_list && (
                    <button type="button" className="btn btn-secondary" onClick={() => openReport(null)}>
                        Something is missing or wrong
                    </button>
                )}
            </div>

            {error && <div className="alert alert-danger">{error}</div>}
            {notice && <div className="alert alert-success">{notice}</div>}

            {person.on_staff_list && items.length > 0 && (
                <div className="alert alert-info">
                    <strong>Please confirm what you have received.</strong> Check each item below against what is
                    actually with you. Press <strong>✓ I have this</strong> if you have it. If you never received
                    it, no longer have it, or a detail is wrong, press <strong>Report a problem</strong> and IT
                    Support will sort it out. Bulk or shared stock is confirmed by IT Support, so it has no button.
                </div>
            )}

            {!person.on_staff_list ? (
                <div className="card">
                    <div className="card-body">
                        <p style={{ marginBottom: 0 }}>
                            There is no staff record with your email address ({person.email}), so nothing can be
                            assigned to you yet. Add yourself under Employees with this address to see your own
                            items here.
                        </p>
                    </div>
                </div>
            ) : (
                <>
                    <div className="stats-grid">
                        <div className="stat-card">
                            <div className="stat-value">{items.length}</div>
                            <div className="stat-label">Assigned to you</div>
                        </div>
                        <div className="stat-card">
                            <div className="stat-value">{confirmed}</div>
                            <div className="stat-label">Confirmed</div>
                        </div>
                        <div className="stat-card">
                            <div className="stat-value">{waiting.length}</div>
                            <div className="stat-label">Waiting for you to confirm</div>
                        </div>
                    </div>

                    <div className="card mb-3">
                        <div className="card-header flex justify-between items-center" style={{ flexWrap: 'wrap', gap: '0.5rem' }}>
                            <h3 className="card-title">Items recorded against your name</h3>
                            {waiting.length > 1 && (
                                <button
                                    type="button" className="btn btn-sm btn-primary"
                                    onClick={confirmAll} disabled={busyId !== null}
                                >
                                    {busyId === 'all' ? 'Confirming…' : `Confirm all ${waiting.length}`}
                                </button>
                            )}
                        </div>
                        {items.length === 0 ? (
                            <div className="card-body">
                                <p className="text-muted" style={{ marginBottom: 0 }}>
                                    Nothing is recorded against your name. If you do have equipment from IT, use
                                    “Something is missing or wrong” to let them know.
                                </p>
                            </div>
                        ) : (
                            <div className="my-asset-list">
                                {items.map((item) => (
                                    <div key={item.assignment_id} className="my-asset-row">
                                        <div className="my-asset-main">
                                            <div className="my-asset-name">
                                                {item.name}
                                                {item.quantity > 1 && (
                                                    <span className="badge badge-info" style={{ marginLeft: '0.5rem' }}>× {item.quantity}</span>
                                                )}
                                            </div>
                                            <div className="text-muted my-asset-meta">
                                                {[
                                                    item.asset_number,
                                                    item.category_name,
                                                    [item.brand, item.model].filter(Boolean).join(' '),
                                                    item.serial_number ? `Serial ${item.serial_number}` : '',
                                                    `Assigned ${formatStamp(item.assigned_at)}`
                                                ].filter(Boolean).join(' · ')}
                                            </div>
                                        </div>
                                        <div className="my-asset-actions">
                                            {item.open_reports > 0 ? (
                                                <span className="badge badge-warning">Reported to IT Support</span>
                                            ) : item.confirmed_at ? (
                                                <span className="badge badge-success">
                                                    ✓ {item.bulk ? 'Checked by IT' : 'Confirmed'} {formatStamp(item.confirmed_at)}
                                                </span>
                                            ) : item.bulk ? (
                                                <span className="badge badge-info" title="Shared stock is counted by IT Support, so there is nothing for you to confirm">
                                                    Bulk stock — IT confirms
                                                </span>
                                            ) : (
                                                <button
                                                    type="button" className="btn btn-sm btn-primary"
                                                    onClick={() => confirm(item)} disabled={busyId !== null}
                                                >
                                                    {busyId === item.assignment_id ? 'Confirming…' : '✓ I have this'}
                                                </button>
                                            )}
                                            {item.open_reports === 0 && (
                                                <button
                                                    type="button" className="btn btn-sm btn-secondary"
                                                    onClick={() => openReport(item)} disabled={busyId !== null}
                                                >
                                                    Report a problem
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {reports.length > 0 && (
                        <div className="card mb-3">
                            <div className="card-header"><h3 className="card-title">Your reports to IT Support</h3></div>
                            <div className="table-container">
                                <table className="table">
                                    <thead>
                                        <tr><th>Date</th><th>Problem</th><th>Item</th><th>Status</th></tr>
                                    </thead>
                                    <tbody>
                                        {reports.map((r) => (
                                            <tr key={r.id}>
                                                <td style={{ whiteSpace: 'nowrap' }}>{formatStamp(r.created_at)}</td>
                                                <td>
                                                    {reasons[r.reason] || r.reason}
                                                    {r.message && <div className="text-muted" style={{ fontSize: '0.85rem' }}>{r.message}</div>}
                                                </td>
                                                <td>{r.asset_number ? `${r.asset_number} — ${r.asset_name}` : '—'}</td>
                                                <td>
                                                    {r.status === 'open'
                                                        ? <span className="badge badge-warning">With IT Support</span>
                                                        : <span className="badge badge-success">Closed {formatStamp(r.resolved_at)}</span>}
                                                    {r.resolution_note && (
                                                        <div className="text-muted" style={{ fontSize: '0.85rem' }}>{r.resolution_note}</div>
                                                    )}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}

                    {returned.length > 0 && (
                        <div className="card mb-3">
                            <div className="card-header"><h3 className="card-title">Previously held and returned</h3></div>
                            <div className="table-container">
                                <table className="table">
                                    <thead>
                                        <tr><th>Asset number</th><th>Item</th><th>From</th><th>Until</th></tr>
                                    </thead>
                                    <tbody>
                                        {returned.map((r) => (
                                            <tr key={r.assignment_id}>
                                                <td>{r.asset_number}</td>
                                                <td>{r.name}{r.quantity > 1 ? ` × ${r.quantity}` : ''}</td>
                                                <td style={{ whiteSpace: 'nowrap' }}>{formatStamp(r.assigned_at)}</td>
                                                <td style={{ whiteSpace: 'nowrap' }}>{formatStamp(r.returned_at)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}
                </>
            )}

            {reporting && (
                <div className="modal-overlay" onClick={() => !sending && setReporting(null)}>
                    <div className="modal" onClick={(e) => e.stopPropagation()}>
                        <h3>Tell IT Support</h3>
                        {reporting.item ? (
                            <p className="text-muted">
                                About: <strong>{reporting.item.name}</strong> ({reporting.item.asset_number})
                            </p>
                        ) : (
                            <p className="text-muted">
                                Use this if you hold something that is not on your list, or for anything else about
                                your equipment.
                            </p>
                        )}
                        {reportError && <div className="alert alert-danger">{reportError}</div>}
                        <form onSubmit={sendReport}>
                            <div className="form-group">
                                <label className="form-label">What is the problem?</label>
                                <select className="form-control" value={reason} onChange={(e) => setReason(e.target.value)}>
                                    {reasonChoices.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                                </select>
                            </div>
                            <div className="form-group">
                                <label className="form-label">
                                    Message{reporting.item ? ' (optional)' : ''}
                                </label>
                                <textarea
                                    className="form-control" rows="4" maxLength={2000}
                                    value={message} onChange={(e) => setMessage(e.target.value)}
                                    required={!reporting.item}
                                    placeholder={reporting.item
                                        ? 'Anything that will help, e.g. who has it now'
                                        : 'e.g. I also have a Dell monitor, serial ABC123'}
                                />
                            </div>
                            <div className="flex gap-2 mt-3">
                                <button type="button" className="btn btn-secondary" onClick={() => setReporting(null)} disabled={sending}>
                                    Cancel
                                </button>
                                <button type="submit" className="btn btn-primary" disabled={sending}>
                                    {sending ? 'Sending…' : 'Send to IT Support'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
