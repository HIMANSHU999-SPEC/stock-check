import React, { useEffect, useMemo, useState } from 'react';
import { assetsAPI, employeesAPI, inventoryAPI, reportsAPI, settingsAPI } from '../services/api';
import { handleEmailResult } from '../utils/emailTemplates';
import { CAMPUSES } from '../constants';

// The dialogs behind every assign / reassign / return / move action, shared by
// the asset list, the asset page and the scan screen so the rules and wording
// are the same wherever the action starts.

const holderName = (row) => row.employee_name || row.location_label || 'Unknown holder';

// Always work from the asset as it is now, not as the calling screen last saw it.
function useFreshAsset(assetId) {
    const [asset, setAsset] = useState(null);
    const [error, setError] = useState('');
    useEffect(() => {
        let cancelled = false;
        assetsAPI.getById(assetId)
            .then((data) => { if (!cancelled) setAsset(data); })
            .catch((err) => { if (!cancelled) setError(err.message); });
        return () => { cancelled = true; };
    }, [assetId]);
    return { asset, error };
}

function useMailSettings() {
    const [mail, setMail] = useState(null);
    useEffect(() => {
        settingsAPI.getPublic().then((s) => setMail(s.mail)).catch(() => setMail({ configured: false }));
    }, []);
    return mail;
}

function Modal({ title, subtitle, onClose, children }) {
    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
                <h3 style={{ marginBottom: '0.25rem' }}>{title}</h3>
                {subtitle && <p className="text-muted">{subtitle}</p>}
                {children}
            </div>
        </div>
    );
}

function Footer({ onClose, onSubmit, busy, label }) {
    return (
        <div className="flex gap-2 mt-3" style={{ justifyContent: 'flex-end' }}>
            <button type="button" onClick={onClose} className="btn btn-secondary" disabled={busy}>
                Cancel
            </button>
            <button type="button" onClick={onSubmit} className="btn btn-primary" disabled={busy}>
                {busy ? 'Working…' : label}
            </button>
        </div>
    );
}

// Which of several holders an action applies to.
function HolderSelect({ assignments, value, onChange, label }) {
    if (assignments.length <= 1) return null;
    return (
        <div className="form-group">
            <label className="form-label">{label}</label>
            <select className="form-control" value={value} onChange={(e) => onChange(e.target.value)}>
                <option value="">Choose a holder…</option>
                {assignments.map((row) => (
                    <option key={row.id} value={row.id}>
                        {holderName(row)} — {row.quantity}
                    </option>
                ))}
            </select>
        </div>
    );
}

function EmailOption({ mail, checked, onChange, to }) {
    if (!mail || !mail.configured) return null;
    return (
        <label className="flex items-center gap-1 mt-2">
            <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
            <span>
                Email {to || 'the member of staff'} a confirmation
                <span className="text-muted"> (from {mail.from})</span>
            </span>
        </label>
    );
}

/**
 * Assign available stock, or (mode="reassign") move it from one holder
 * straight to another. The new holder is a person or a room / location.
 */
export function AssignModal({ assetId, mode = 'assign', assignmentId, onClose, onDone }) {
    const { asset, error: loadError } = useFreshAsset(assetId);
    const mail = useMailSettings();
    const [employees, setEmployees] = useState([]);
    const [locations, setLocations] = useState([]);
    const [holderType, setHolderType] = useState('employee');
    const [employeeId, setEmployeeId] = useState('');
    const [employeeFilter, setEmployeeFilter] = useState('');
    const [location, setLocation] = useState('');
    const [fromId, setFromId] = useState(assignmentId ? String(assignmentId) : '');
    const [quantity, setQuantity] = useState(1);
    const [notes, setNotes] = useState('');
    const [sendEmail, setSendEmail] = useState(true);
    const [showNewEmployee, setShowNewEmployee] = useState(false);
    const [newEmployee, setNewEmployee] = useState({ name: '', email: '', department: '', phone: '' });
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    const isReassign = mode === 'reassign';
    const open = asset?.assignments || [];
    const fromRow = isReassign
        ? (open.length === 1 ? open[0] : open.find((row) => String(row.id) === String(fromId)))
        : null;
    const available = asset ? Math.max(0, (asset.quantity || 1) - (asset.assigned_quantity || 0)) : 0;
    const maxQuantity = isReassign ? (fromRow ? fromRow.quantity : 1) : available;
    const isBulk = (asset?.quantity || 1) > 1;

    useEffect(() => {
        employeesAPI.getAll().then(setEmployees).catch(() => {});
        inventoryAPI.locations().then(setLocations).catch(() => {});
    }, []);

    useEffect(() => {
        if (mail) setSendEmail(Boolean(mail.on_assign));
    }, [mail]);

    // Default to everything that can move: the whole holding when reassigning,
    // one unit when handing out stock.
    useEffect(() => {
        setQuantity(isReassign ? Math.max(1, maxQuantity) : 1);
    }, [isReassign, maxQuantity]);

    const filteredEmployees = useMemo(() => {
        const term = employeeFilter.trim().toLowerCase();
        if (!term) return employees;
        return employees.filter((emp) =>
            [emp.name, emp.email, emp.department].some((v) => (v || '').toLowerCase().includes(term)));
    }, [employees, employeeFilter]);

    async function createEmployee(e) {
        e.preventDefault();
        try {
            const created = await employeesAPI.create(newEmployee);
            setEmployees(await employeesAPI.getAll());
            setEmployeeFilter('');
            setEmployeeId(String(created.id));
            setShowNewEmployee(false);
            setNewEmployee({ name: '', email: '', department: '', phone: '' });
        } catch (err) {
            setError('Could not create the employee: ' + err.message);
        }
    }

    async function submit() {
        setError('');
        if (isReassign && !fromRow) return setError('Choose who it is being reassigned from.');
        if (holderType === 'employee' && !employeeId) return setError('Choose who it is going to.');
        if (holderType === 'location' && !location.trim()) return setError('Enter the room or location.');
        if (quantity < 1 || quantity > maxQuantity) return setError(`Quantity must be between 1 and ${maxQuantity}.`);

        const payload = {
            quantity,
            notes: notes.trim() || undefined,
            send_email: mail?.configured ? sendEmail : false,
            ...(holderType === 'employee' ? { employee_id: employeeId } : { location: location.trim() }),
            ...(isReassign ? { assignment_id: fromRow.id } : {})
        };

        setBusy(true);
        try {
            const result = isReassign
                ? await assetsAPI.reassign(asset.id, payload)
                : await assetsAPI.assign(asset.id, payload);
            const who = holderType === 'employee'
                ? (employees.find((emp) => String(emp.id) === String(employeeId))?.name || 'the employee')
                : location.trim();
            const parts = [`${asset.asset_number} ${isReassign ? 'reassigned' : 'assigned'} to ${who}.`];
            for (const email of [result.email, result.previous_email]) {
                const line = email && email.status !== 'not_configured' ? handleEmailResult(email) : '';
                if (line) parts.push(line);
            }
            onDone(parts.join(' '), result);
        } catch (err) {
            setError(err.message);
        } finally {
            setBusy(false);
        }
    }

    if (loadError) {
        return (
            <Modal title="Asset unavailable" onClose={onClose}>
                <div className="alert alert-danger">{loadError}</div>
                <div className="flex mt-3"><button className="btn btn-secondary" onClick={onClose}>Close</button></div>
            </Modal>
        );
    }
    if (!asset) {
        return <Modal title="Loading…" onClose={onClose}><div className="spinner"></div></Modal>;
    }

    const blocked = !['available', 'assigned'].includes(asset.status)
        ? `This asset is marked "${asset.status}". Set it back to available (Edit) before assigning it.`
        : (!isReassign && available === 0)
            ? 'Nothing is available to assign — return or reassign it first.'
            : (isReassign && open.length === 0)
                ? 'This asset is not assigned to anyone.'
                : '';

    return (
        <Modal
            title={isReassign ? 'Reassign asset' : 'Assign asset'}
            subtitle={`${asset.asset_number} — ${asset.name}`}
            onClose={onClose}
        >
            {blocked ? (
                <>
                    <div className="alert alert-warning mt-2">{blocked}</div>
                    <div className="flex mt-3"><button className="btn btn-secondary" onClick={onClose}>Close</button></div>
                </>
            ) : (
                <>
                    {error && <div className="alert alert-danger mt-2">{error}</div>}

                    {isReassign && open.length === 1 && (
                        <p className="mt-2">
                            Currently with <strong>{holderName(open[0])}</strong>
                            {isBulk ? ` (${open[0].quantity})` : ''}.
                        </p>
                    )}
                    {isReassign && (
                        <HolderSelect assignments={open} value={fromId} onChange={setFromId} label="Reassign from" />
                    )}

                    <div className="form-group mt-2">
                        <label className="form-label">{isReassign ? 'Reassign to' : 'Assign to'}</label>
                        <div className="segmented">
                            <button
                                type="button"
                                className={holderType === 'employee' ? 'active' : ''}
                                onClick={() => setHolderType('employee')}
                            >
                                A person
                            </button>
                            <button
                                type="button"
                                className={holderType === 'location' ? 'active' : ''}
                                onClick={() => setHolderType('location')}
                            >
                                A room / location
                            </button>
                        </div>
                    </div>

                    {holderType === 'employee' ? (
                        <div className="form-group">
                            <input
                                type="text"
                                className="form-control mb-1"
                                placeholder="Search by name, email or department…"
                                value={employeeFilter}
                                onChange={(e) => setEmployeeFilter(e.target.value)}
                            />
                            <select
                                className="form-control"
                                value={employeeId}
                                onChange={(e) => setEmployeeId(e.target.value)}
                                size={Math.min(6, Math.max(3, filteredEmployees.length))}
                            >
                                {filteredEmployees.length === 0 && <option disabled>No matching employees</option>}
                                {filteredEmployees.map((emp) => (
                                    <option key={emp.id} value={emp.id}>
                                        {emp.name} — {emp.department || 'No department'} ({emp.email})
                                    </option>
                                ))}
                            </select>
                            <button
                                type="button"
                                className="btn btn-sm btn-secondary mt-1"
                                onClick={() => setShowNewEmployee((v) => !v)}
                            >
                                {showNewEmployee ? 'Cancel new employee' : '+ New employee'}
                            </button>
                            {showNewEmployee && (
                                <form onSubmit={createEmployee} className="inline-form mt-2">
                                    <div className="grid grid-2">
                                        <input
                                            type="text" className="form-control" placeholder="Name *" required
                                            value={newEmployee.name}
                                            onChange={(e) => setNewEmployee({ ...newEmployee, name: e.target.value })}
                                        />
                                        <input
                                            type="email" className="form-control" placeholder="Email *" required
                                            value={newEmployee.email}
                                            onChange={(e) => setNewEmployee({ ...newEmployee, email: e.target.value })}
                                        />
                                        <input
                                            type="text" className="form-control" placeholder="Department"
                                            value={newEmployee.department}
                                            onChange={(e) => setNewEmployee({ ...newEmployee, department: e.target.value })}
                                        />
                                        <input
                                            type="text" className="form-control" placeholder="Phone"
                                            value={newEmployee.phone}
                                            onChange={(e) => setNewEmployee({ ...newEmployee, phone: e.target.value })}
                                        />
                                    </div>
                                    <button type="submit" className="btn btn-sm btn-primary mt-2">Save & select</button>
                                </form>
                            )}
                        </div>
                    ) : (
                        <div className="form-group">
                            <input
                                type="text"
                                className="form-control"
                                list="known-locations"
                                placeholder="e.g. Room 204, Library, Reception"
                                value={location}
                                onChange={(e) => setLocation(e.target.value)}
                            />
                            <datalist id="known-locations">
                                {[...new Set(locations.map((l) => l.location))].map((l) => <option key={l} value={l} />)}
                            </datalist>
                            <div className="text-muted" style={{ fontSize: '0.85rem' }}>
                                For furniture and shared equipment that belongs to a place rather than a person.
                            </div>
                        </div>
                    )}

                    {(isBulk || maxQuantity > 1) && (
                        <div className="form-group">
                            <label className="form-label">Quantity</label>
                            <input
                                type="number"
                                className="form-control"
                                min="1"
                                max={maxQuantity}
                                value={quantity}
                                onChange={(e) => setQuantity(parseInt(e.target.value, 10) || 1)}
                            />
                            <div className="text-muted" style={{ fontSize: '0.85rem' }}>
                                {isReassign
                                    ? `${holderName(fromRow || {})} holds ${maxQuantity}`
                                    : `${available} of ${asset.quantity} available`}
                            </div>
                        </div>
                    )}

                    <div className="form-group">
                        <label className="form-label">Note (optional)</label>
                        <input
                            type="text"
                            className="form-control"
                            placeholder="e.g. with charger and bag"
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                        />
                    </div>

                    {holderType === 'employee' && (
                        <EmailOption mail={mail} checked={sendEmail} onChange={setSendEmail} />
                    )}

                    <Footer onClose={onClose} onSubmit={submit} busy={busy} label={isReassign ? 'Reassign' : 'Assign'} />
                </>
            )}
        </Modal>
    );
}

const CONDITIONS = [
    { value: 'good', label: 'Good — back into stock' },
    { value: 'needs_repair', label: 'Needs repair' },
    { value: 'damaged', label: 'Damaged' },
    { value: 'lost', label: 'Lost / not returned' }
];

/** Book stock back in from a holder, recording the condition it came back in. */
export function ReturnModal({ assetId, assignmentId, onClose, onDone }) {
    const { asset, error: loadError } = useFreshAsset(assetId);
    const mail = useMailSettings();
    const [fromId, setFromId] = useState(assignmentId ? String(assignmentId) : '');
    const [quantity, setQuantity] = useState(1);
    const [condition, setCondition] = useState('good');
    const [notes, setNotes] = useState('');
    const [sendEmail, setSendEmail] = useState(true);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    const open = asset?.assignments || [];
    const row = open.length === 1 ? open[0] : open.find((r) => String(r.id) === String(fromId));
    const isBulk = (asset?.quantity || 1) > 1;

    useEffect(() => {
        if (mail) setSendEmail(Boolean(mail.on_return));
    }, [mail]);

    useEffect(() => {
        if (row) setQuantity(row.quantity);
    }, [row?.id, row?.quantity]);

    async function submit() {
        setError('');
        if (!row) return setError('Choose who is returning it.');
        if (quantity < 1 || quantity > row.quantity) return setError(`Quantity must be between 1 and ${row.quantity}.`);
        setBusy(true);
        try {
            const result = await assetsAPI.return(asset.id, {
                assignment_id: row.id,
                quantity,
                condition,
                notes: notes.trim() || undefined,
                send_email: mail?.configured ? sendEmail : false
            });
            const parts = [`${asset.asset_number} returned from ${holderName(row)}.`];
            if (condition !== 'good' && !isBulk) parts.push(`Status is now "${result.status}".`);
            const line = result.email && result.email.status !== 'not_configured' ? handleEmailResult(result.email) : '';
            if (line) parts.push(line);
            onDone(parts.join(' '), result);
        } catch (err) {
            setError(err.message);
        } finally {
            setBusy(false);
        }
    }

    if (loadError) {
        return (
            <Modal title="Asset unavailable" onClose={onClose}>
                <div className="alert alert-danger">{loadError}</div>
                <div className="flex mt-3"><button className="btn btn-secondary" onClick={onClose}>Close</button></div>
            </Modal>
        );
    }
    if (!asset) {
        return <Modal title="Loading…" onClose={onClose}><div className="spinner"></div></Modal>;
    }
    if (open.length === 0) {
        return (
            <Modal title="Return asset" subtitle={`${asset.asset_number} — ${asset.name}`} onClose={onClose}>
                <div className="alert alert-warning mt-2">This asset is not assigned to anyone.</div>
                <div className="flex mt-3"><button className="btn btn-secondary" onClick={onClose}>Close</button></div>
            </Modal>
        );
    }

    return (
        <Modal title="Return asset" subtitle={`${asset.asset_number} — ${asset.name}`} onClose={onClose}>
            {error && <div className="alert alert-danger mt-2">{error}</div>}

            {open.length === 1 && (
                <p className="mt-2">
                    Returning from <strong>{holderName(open[0])}</strong>{isBulk ? ` (holds ${open[0].quantity})` : ''}.
                </p>
            )}
            <HolderSelect assignments={open} value={fromId} onChange={setFromId} label="Returning from" />

            {row && row.quantity > 1 && (
                <div className="form-group">
                    <label className="form-label">Quantity returned</label>
                    <input
                        type="number"
                        className="form-control"
                        min="1"
                        max={row.quantity}
                        value={quantity}
                        onChange={(e) => setQuantity(parseInt(e.target.value, 10) || 1)}
                    />
                    <div className="text-muted" style={{ fontSize: '0.85rem' }}>
                        {holderName(row)} holds {row.quantity}; anything not returned stays with them.
                    </div>
                </div>
            )}

            <div className="form-group">
                <label className="form-label">Condition</label>
                <select className="form-control" value={condition} onChange={(e) => setCondition(e.target.value)}>
                    {CONDITIONS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
                {condition !== 'good' && (
                    <div className="text-muted" style={{ fontSize: '0.85rem' }}>
                        {isBulk
                            ? 'Recorded in the history. If units are written off, reduce the quantity on the asset.'
                            : 'The asset will be taken out of circulation until its status is set back to available.'}
                    </div>
                )}
            </div>

            <div className="form-group">
                <label className="form-label">Note (optional)</label>
                <input
                    type="text"
                    className="form-control"
                    placeholder="e.g. charger missing"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                />
            </div>

            {row && row.employee_id && (
                <EmailOption mail={mail} checked={sendEmail} onChange={setSendEmail} to={row.employee_name} />
            )}

            <Footer onClose={onClose} onSubmit={submit} busy={busy} label="Confirm return" />
        </Modal>
    );
}

/** Move an asset to another campus and/or location. Whoever holds it keeps it. */
export function TransferModal({ assetId, onClose, onDone }) {
    const { asset, error: loadError } = useFreshAsset(assetId);
    const [campuses, setCampuses] = useState([...CAMPUSES]);
    const [campus, setCampus] = useState('');
    const [location, setLocation] = useState('');
    const [notes, setNotes] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        reportsAPI.getByCampus()
            .then((data) => {
                const names = data.map((c) => c.campus).filter((n) => n && n !== 'Unspecified');
                setCampuses([...new Set([...CAMPUSES, ...names])]);
            })
            .catch(() => {});
    }, []);

    useEffect(() => {
        if (asset) {
            setCampus(asset.campus || '');
            setLocation(asset.location || '');
        }
    }, [asset?.id]);

    async function submit() {
        setError('');
        setBusy(true);
        try {
            const result = await assetsAPI.transfer(asset.id, {
                campus,
                location: location.trim(),
                notes: notes.trim() || undefined
            });
            const where = [result.campus || 'no campus', result.location].filter(Boolean).join(' / ');
            onDone(`${asset.asset_number} moved to ${where}.`, result);
        } catch (err) {
            setError(err.message);
        } finally {
            setBusy(false);
        }
    }

    if (loadError) {
        return (
            <Modal title="Asset unavailable" onClose={onClose}>
                <div className="alert alert-danger">{loadError}</div>
                <div className="flex mt-3"><button className="btn btn-secondary" onClick={onClose}>Close</button></div>
            </Modal>
        );
    }
    if (!asset) {
        return <Modal title="Loading…" onClose={onClose}><div className="spinner"></div></Modal>;
    }

    return (
        <Modal title="Move to another campus" subtitle={`${asset.asset_number} — ${asset.name}`} onClose={onClose}>
            {error && <div className="alert alert-danger mt-2">{error}</div>}
            <p className="mt-2">
                Currently at <strong>{asset.campus || 'no campus'}</strong>
                {asset.location ? ` / ${asset.location}` : ''}.
            </p>
            <div className="form-group">
                <label className="form-label">Campus</label>
                <select className="form-control" value={campus} onChange={(e) => setCampus(e.target.value)}>
                    <option value="">Unassigned</option>
                    {campuses.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
            </div>
            <div className="form-group">
                <label className="form-label">Location</label>
                <input
                    type="text"
                    className="form-control"
                    placeholder="e.g. IT store, Room 101"
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                />
            </div>
            <div className="form-group">
                <label className="form-label">Note (optional)</label>
                <input
                    type="text"
                    className="form-control"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                />
            </div>
            <Footer onClose={onClose} onSubmit={submit} busy={busy} label="Move" />
        </Modal>
    );
}

/**
 * One place to hold "which dialog is open" for a screen. Render the returned
 * `dialogs` once and call open('assign' | 'reassign' | 'return' | 'transfer', assetId).
 */
export function useAssetActions(onChanged) {
    const [active, setActive] = useState(null); // { type, assetId, assignmentId }

    const close = () => setActive(null);
    const done = (message, result) => {
        setActive(null);
        onChanged(message, result);
    };
    const open = (type, assetId, assignmentId) => setActive({ type, assetId, assignmentId });

    let dialogs = null;
    if (active && (active.type === 'assign' || active.type === 'reassign')) {
        dialogs = (
            <AssignModal
                assetId={active.assetId} mode={active.type} assignmentId={active.assignmentId}
                onClose={close} onDone={done}
            />
        );
    } else if (active && active.type === 'return') {
        dialogs = (
            <ReturnModal assetId={active.assetId} assignmentId={active.assignmentId} onClose={close} onDone={done} />
        );
    } else if (active && active.type === 'transfer') {
        dialogs = <TransferModal assetId={active.assetId} onClose={close} onDone={done} />;
    }

    return { open, dialogs };
}
