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
/**
 * Choosing one person from the staff list. Nobody counts as chosen until a
 * row is clicked (or Enter is pressed on it); once chosen, the list gives way
 * to a box naming them, so what will be saved is always what is on screen.
 */
function PersonPicker({ people, value, onChange, filter, onFilterChange }) {
    const [cursor, setCursor] = useState(-1); // row the arrow keys are on; not a choice
    const chosen = people.find((emp) => String(emp.id) === String(value));

    const matches = useMemo(() => {
        const term = filter.trim().toLowerCase();
        if (!term) return people;
        return people.filter((emp) =>
            [emp.name, emp.email, emp.department].some((v) => (v || '').toLowerCase().includes(term)));
    }, [people, filter]);

    useEffect(() => { setCursor(-1); }, [filter]);

    if (chosen) {
        return (
            <div className="person-chosen">
                <span className="person-tick" aria-hidden="true">✓</span>
                <div className="person-text">
                    <strong>{chosen.name}</strong>
                    <span>{[chosen.department || 'No department', chosen.email].filter(Boolean).join(' · ')}</span>
                </div>
                <button type="button" className="btn btn-sm btn-secondary" onClick={() => onChange('')}>
                    Change
                </button>
            </div>
        );
    }

    function onKeyDown(e) {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            if (matches.length === 0) return;
            const step = e.key === 'ArrowDown' ? 1 : -1;
            setCursor((at) => (at + step + matches.length) % matches.length);
        } else if (e.key === 'Enter') {
            e.preventDefault();
            // Enter takes the row the arrows are on, or the only match left.
            const pick = cursor >= 0 ? matches[cursor] : (matches.length === 1 ? matches[0] : null);
            if (pick) onChange(String(pick.id));
        }
    }

    return (
        <>
            <input
                type="text"
                className="form-control mb-1"
                placeholder="Search by name, email or department…"
                value={filter}
                onChange={(e) => onFilterChange(e.target.value)}
                onKeyDown={onKeyDown}
                aria-label="Search the staff list"
                autoFocus
            />
            <div className="person-list" role="listbox" aria-label="Staff">
                {matches.length === 0 && <div className="person-empty">No one matches that search.</div>}
                {matches.map((emp, index) => (
                    <button
                        key={emp.id}
                        type="button"
                        role="option"
                        aria-selected="false"
                        className={`person-row ${index === cursor ? 'at-cursor' : ''}`}
                        ref={index === cursor ? (el) => el && el.scrollIntoView({ block: 'nearest' }) : undefined}
                        onClick={() => onChange(String(emp.id))}
                    >
                        <strong>{emp.name}</strong>
                        <span>{[emp.department || 'No department', emp.email].filter(Boolean).join(' · ')}</span>
                    </button>
                ))}
            </div>
            <div className="text-muted" style={{ fontSize: '0.85rem' }}>
                Click a person to select them{matches.length === 1 ? ', or press Enter' : ''}.
            </div>
        </>
    );
}

// `suggest` pre-fills who it is going to, when the caller already has a good
// idea (the Intune check does): { employeeId } for someone on the staff list,
// or { name, email } to offer adding them. Nothing is chosen for the person;
// they still confirm.
export function AssignModal({ assetId, mode = 'assign', assignmentId, suggest, onClose, onDone }) {
    const { asset, error: loadError } = useFreshAsset(assetId);
    const mail = useMailSettings();
    const [employees, setEmployees] = useState([]);
    const [locations, setLocations] = useState([]);
    const [holderType, setHolderType] = useState('employee');
    const [employeeId, setEmployeeId] = useState(suggest?.employeeId ? String(suggest.employeeId) : '');
    const [employeeFilter, setEmployeeFilter] = useState('');
    const [location, setLocation] = useState('');
    const [fromId, setFromId] = useState(assignmentId ? String(assignmentId) : '');
    const [quantity, setQuantity] = useState(1);
    const [notes, setNotes] = useState('');
    const [sendEmail, setSendEmail] = useState(true);
    const offerNew = Boolean(suggest && !suggest.employeeId && suggest.email);
    const [showNewEmployee, setShowNewEmployee] = useState(offerNew);
    const [newEmployee, setNewEmployee] = useState({
        name: offerNew ? suggest.name || '' : '', email: offerNew ? suggest.email : '', department: '', phone: ''
    });
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

    // Leavers stay on record but cannot be given anything.
    const assignable = useMemo(() => employees.filter((emp) => emp.status !== 'inactive'), [employees]);

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
        if (holderType === 'employee' && !assignable.some((emp) => String(emp.id) === String(employeeId))) {
            return setError('Choose who it is going to: click their name in the list.');
        }
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
                const line = email ? handleEmailResult(email) : '';
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

    const blocked = asset.status === 'sold'
        ? 'This asset has been sold. If that is wrong, undo the sale on the asset\'s page first.'
        : !['available', 'assigned'].includes(asset.status)
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
                            <PersonPicker
                                people={assignable}
                                value={employeeId}
                                onChange={(id) => { setEmployeeId(id); setError(''); }}
                                filter={employeeFilter}
                                onFilterChange={setEmployeeFilter}
                            />
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
            const line = result.email ? handleEmailResult(result.email) : '';
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
/**
 * Sell the asset, usually to the person who has been using it. The asset
 * stays on record as "sold" with the buyer, price and date.
 */
export function SellModal({ assetId, assignmentId, onClose, onDone }) {
    const { asset, error: loadError } = useFreshAsset(assetId);
    const mail = useMailSettings();
    const [employees, setEmployees] = useState([]);
    const [buyerType, setBuyerType] = useState('employee');
    const [employeeId, setEmployeeId] = useState('');
    const [buyerName, setBuyerName] = useState('');
    const [buyerEmail, setBuyerEmail] = useState('');
    const [price, setPrice] = useState('');
    const [soldOn, setSoldOn] = useState(new Date().toISOString().slice(0, 10));
    const [reference, setReference] = useState('');
    const [notes, setNotes] = useState('');
    const [cleared, setCleared] = useState(false);
    const [sendEmail, setSendEmail] = useState(true);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        employeesAPI.getAll().then(setEmployees).catch(() => {});
    }, []);

    // Start with whoever has it: they are nearly always the buyer.
    const open = asset?.assignments || [];
    const holder = open.find((row) => String(row.id) === String(assignmentId) && row.employee_id)
        || open.find((row) => row.employee_id);
    useEffect(() => {
        if (holder && !employeeId) setEmployeeId(String(holder.employee_id));
    }, [holder?.employee_id]);

    // People first, leavers included; departments and shared mailboxes do not buy laptops.
    const people = useMemo(() => employees
        .filter((emp) => emp.kind !== 'shared')
        .sort((a, b) => a.name.localeCompare(b.name)), [employees]);
    const buyer = people.find((emp) => String(emp.id) === String(employeeId));
    const buyerHasEmail = buyerType === 'employee' ? Boolean(buyer?.email) : Boolean(buyerEmail.trim());

    async function submit() {
        setError('');
        if (buyerType === 'employee' && !employeeId) return setError('Choose who is buying it.');
        if (buyerType === 'other' && !buyerName.trim()) return setError('Enter the name of the buyer.');
        if (price === '' || Number.isNaN(Number(price)) || Number(price) < 0) {
            return setError('Enter the price it is being sold for (0 if it is being given away).');
        }
        if (!cleared) return setError('Tick the box to confirm the device has been cleared for sale.');
        setBusy(true);
        try {
            const result = await assetsAPI.sell(asset.id, {
                ...(buyerType === 'employee'
                    ? { employee_id: employeeId }
                    : { buyer_name: buyerName.trim(), buyer_email: buyerEmail.trim() || undefined }),
                price: Number(price),
                sold_on: soldOn,
                payment_reference: reference.trim() || undefined,
                notes: notes.trim() || undefined,
                send_email: Boolean(mail?.configured && sendEmail && buyerHasEmail)
            });
            const parts = [`${asset.asset_number} sold to ${result.sale.buyer_name} for £${Number(result.sale.price).toFixed(2)}.`];
            const line = result.email ? handleEmailResult(result.email) : '';
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

    const blocked = asset.status === 'sold'
        ? 'This asset has already been sold.'
        : ['lost', 'stolen', 'retired'].includes(asset.status)
            ? `This asset is marked "${asset.status}" and cannot be sold. Change its status (Edit) first if that is wrong.`
            : (asset.quantity || 1) > 1
                ? 'This is a stock line of several items. Register the one being sold as its own asset, then sell that.'
                : '';
    const others = open.filter((row) => !holder || row.id !== holder.id);

    return (
        <Modal title="Sell asset" subtitle={`${asset.asset_number} — ${asset.name}`} onClose={onClose}>
            {blocked ? (
                <>
                    <div className="alert alert-warning mt-2">{blocked}</div>
                    <div className="flex mt-3"><button className="btn btn-secondary" onClick={onClose}>Close</button></div>
                </>
            ) : (
                <>
                    {error && <div className="alert alert-danger mt-2">{error}</div>}
                    <p className="mt-2 text-muted">
                        {open.length > 0
                            ? <>Currently with <strong>{open.map(holderName).join(', ')}</strong>. Selling it takes it off their list and out of stock; it stays on record as sold.</>
                            : 'Selling it takes it out of stock; it stays on record as sold.'}
                        {asset.purchase_price ? ` Bought for £${Number(asset.purchase_price).toFixed(2)}${asset.purchase_date ? ` on ${asset.purchase_date}` : ''}.` : ''}
                    </p>

                    <div className="form-group">
                        <label className="form-label">Sold to</label>
                        <div className="segmented">
                            <button type="button" className={buyerType === 'employee' ? 'active' : ''} onClick={() => setBuyerType('employee')}>
                                Someone on the staff list
                            </button>
                            <button type="button" className={buyerType === 'other' ? 'active' : ''} onClick={() => setBuyerType('other')}>
                                Someone else
                            </button>
                        </div>
                    </div>
                    {buyerType === 'employee' ? (
                        <div className="form-group">
                            <select className="form-control" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} aria-label="Buyer">
                                <option value="">Choose…</option>
                                {people.map((emp) => (
                                    <option key={emp.id} value={emp.id}>
                                        {emp.name}{emp.status === 'inactive' ? ' (left)' : ''} — {emp.email}
                                    </option>
                                ))}
                            </select>
                            {others.length > 0 && buyer && holder && String(holder.employee_id) !== String(employeeId) && (
                                <div className="text-muted" style={{ fontSize: '0.85rem' }}>
                                    Not the person who has it now ({holderName(holder)}).
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="grid grid-2">
                            <div className="form-group">
                                <input type="text" className="form-control" placeholder="Buyer's name *" value={buyerName} onChange={(e) => setBuyerName(e.target.value)} />
                            </div>
                            <div className="form-group">
                                <input type="email" className="form-control" placeholder="Buyer's email" value={buyerEmail} onChange={(e) => setBuyerEmail(e.target.value)} />
                            </div>
                        </div>
                    )}

                    <div className="grid grid-2">
                        <div className="form-group">
                            <label className="form-label">Sale price (£)</label>
                            <input
                                type="number" className="form-control" min="0" step="0.01" placeholder="0.00"
                                value={price} onChange={(e) => setPrice(e.target.value)}
                            />
                        </div>
                        <div className="form-group">
                            <label className="form-label">Date of sale</label>
                            <input type="date" className="form-control" value={soldOn} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setSoldOn(e.target.value)} />
                        </div>
                    </div>
                    <div className="form-group">
                        <label className="form-label">Payment reference</label>
                        <input
                            type="text" className="form-control" placeholder="e.g. invoice or receipt number, payroll deduction"
                            value={reference} onChange={(e) => setReference(e.target.value)}
                        />
                    </div>
                    <div className="form-group">
                        <label className="form-label">Notes</label>
                        <textarea className="form-control" rows="2" placeholder="Who approved it, condition, anything agreed" value={notes} onChange={(e) => setNotes(e.target.value)} />
                    </div>

                    <label style={{ display: 'flex', flexWrap: 'nowrap', alignItems: 'flex-start', gap: '0.5rem' }}>
                        <input type="checkbox" checked={cleared} onChange={(e) => setCleared(e.target.checked)} style={{ marginTop: '0.3rem', flexShrink: 0 }} />
                        <span>
                            The device has been wiped and removed from Intune / Autopilot and our Microsoft 365 tenant,
                            and its asset sticker taken off.
                        </span>
                    </label>
                    {mail?.configured && (
                        <label className="flex items-center gap-1 mt-2">
                            <input type="checkbox" checked={sendEmail && buyerHasEmail} disabled={!buyerHasEmail} onChange={(e) => setSendEmail(e.target.checked)} />
                            Email the buyer a confirmation of the sale
                        </label>
                    )}
                    <Footer onClose={onClose} onSubmit={submit} busy={busy} label="Record sale" />
                </>
            )}
        </Modal>
    );
}

export function useAssetActions(onChanged) {
    const [active, setActive] = useState(null); // { type, assetId, assignmentId }

    const close = () => setActive(null);
    const done = (message, result) => {
        setActive(null);
        onChanged(message, result);
    };
    const open = (type, assetId, assignmentId, suggest) => setActive({ type, assetId, assignmentId, suggest });

    let dialogs = null;
    if (active && (active.type === 'assign' || active.type === 'reassign')) {
        dialogs = (
            <AssignModal
                assetId={active.assetId} mode={active.type} assignmentId={active.assignmentId}
                suggest={active.suggest} onClose={close} onDone={done}
            />
        );
    } else if (active && active.type === 'return') {
        dialogs = (
            <ReturnModal assetId={active.assetId} assignmentId={active.assignmentId} onClose={close} onDone={done} />
        );
    } else if (active && active.type === 'sell') {
        dialogs = <SellModal assetId={active.assetId} assignmentId={active.assignmentId} onClose={close} onDone={done} />;
    } else if (active && active.type === 'transfer') {
        dialogs = <TransferModal assetId={active.assetId} onClose={close} onDone={done} />;
    }

    return { open, dialogs };
}
