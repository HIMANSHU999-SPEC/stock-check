import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { intuneAPI } from '../services/api';
import { useAssetActions } from './AssetActions';

// What each finding means, most pressing first. `tone` colours the tile.
const KINDS = [
    {
        key: 'different', label: 'Different person', tone: 'danger',
        help: 'Intune says someone else uses the device than the person it is assigned to here. One of the two records is out of date: reassign it here, or change the primary user in Intune.'
    },
    {
        key: 'unassigned_here', label: 'In use, not assigned here', tone: 'danger',
        help: 'Intune shows a user on these devices, but here they are sitting in stock. If that person does have it, assign it to them.'
    },
    {
        key: 'gone_but_active', label: 'Written off or sold, still active', tone: 'danger',
        help: 'Marked lost, stolen, retired or sold here, yet the device has checked in to Intune in the last 30 days. Somebody is using it; a sold device should have been removed from Intune.'
    },
    {
        key: 'not_in_register', label: 'Not in the register', tone: 'warning',
        help: 'Intune manages these devices but nothing here has their serial number. Add them, or correct the serial number on the asset they belong to.'
    },
    {
        key: 'shared_here', label: 'Room or department here', tone: 'info',
        help: 'Recorded here against a room or a department, while Intune names a person. Often fine for shared machines (Intune names whoever set them up), but worth a glance.'
    },
    {
        key: 'no_user', label: 'No user in Intune', tone: 'info',
        help: 'Assigned to a person here, but Intune has no primary user for the device. Set the primary user in Intune if they are the only one who uses it.'
    },
    {
        key: 'not_in_intune', label: 'Not in Intune', tone: 'warning',
        help: 'Laptops, desktops, tablets and phones in the register that Intune does not know. Either they were never enrolled, or the serial number recorded here is wrong.'
    },
    {
        key: 'no_serial', label: 'No serial number', tone: 'warning',
        help: 'These devices cannot be checked because they have no usable serial number here. Add it from the label on the device.'
    },
    {
        key: 'match', label: 'Agree', tone: 'success',
        help: 'Intune and the register say the same thing about these devices.'
    }
];

function formatDate(value) {
    if (!value) return 'Never';
    const date = new Date(value);
    return Number.isNaN(date.getTime())
        ? 'Never'
        : date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatDateTime(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function holdersText(asset) {
    if (!asset) return '';
    if (asset.holders.length === 0) {
        return ['available', 'assigned'].includes(asset.status) ? 'In stock' : `Marked ${asset.status}`;
    }
    return asset.holders.map((holder) => holder.name).join(', ');
}

function rowText(row) {
    const { asset, device } = row;
    return [
        asset?.asset_number, asset?.name, asset?.serial_number, asset?.category, asset?.campus,
        ...(asset?.holders || []).flatMap((holder) => [holder.name, holder.email]),
        device?.name, device?.serial_number, device?.manufacturer, device?.model, device?.user_name, device?.user_email
    ].filter(Boolean).join(' ').toLowerCase();
}

// A spreadsheet must show these values, never run them.
function csvCell(value) {
    let text = value === null || value === undefined ? '' : String(value);
    if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
}

function downloadCsv(rows) {
    const header = [
        'Finding', 'Asset number', 'Asset', 'Category', 'Campus', 'Serial number', 'Register says', 'Register status',
        'Intune device', 'Intune model', 'Intune user', 'Intune user email', 'Last check-in', 'Days since check-in',
        'Compliance', 'Ownership'
    ];
    const label = Object.fromEntries(KINDS.map((kind) => [kind.key, kind.label]));
    const lines = rows.map(({ kind, asset, device }) => [
        label[kind], asset?.asset_number, asset?.name, asset?.category, asset?.campus,
        asset?.serial_number || device?.serial_number, holdersText(asset), asset?.status,
        device?.name, device ? makeAndModel(device) : '',
        device?.user_name, device?.user_email, device?.last_sync ? device.last_sync.slice(0, 10) : '',
        device?.days_since_sync ?? '', device?.compliance, device ? (device.personal ? 'Personal' : 'Company') : ''
    ].map(csvCell).join(','));
    const blob = new Blob([`﻿${[header.map(csvCell).join(','), ...lines].join('\r\n')}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `intune-check-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}

// "HP" + "HP EliteBook 840" reads better as just the model.
function makeAndModel(device) {
    const maker = (device.manufacturer || '').trim();
    const model = (device.model || '').trim();
    if (!maker || !model) return maker || model;
    const first = maker.split(/[\s,.]/)[0].toLowerCase();
    return model.toLowerCase().startsWith(first) ? model : `${maker} ${model}`;
}

function addAssetLink(device) {
    const s = device.suggested || {};
    const params = new URLSearchParams();
    if (s.name) params.set('name', s.name);
    if (s.brand) params.set('brand', s.brand);
    if (s.model) params.set('model', s.model);
    if (s.serial_number) params.set('serial_number', s.serial_number);
    params.set('notes', `Added from Intune (device name ${device.name || 'unknown'}).`);
    if (device.employee_id && !device.employee_inactive) params.set('assign_to', device.employee_id);
    else if (device.user_email && !device.employee_id) {
        params.set('assign_email', device.user_email);
        if (device.user_name) params.set('assign_name', device.user_name);
    }
    return `/assets/new?${params}`;
}

// Who to offer in the assign dialog: the Intune user, when we can.
function suggestFrom(device) {
    if (device.employee_id) return device.employee_inactive ? undefined : { employeeId: device.employee_id };
    return device.user_email ? { name: device.user_name, email: device.user_email } : undefined;
}

function IntuneUser({ device }) {
    if (!device.user_email && !device.user_name) return <span className="text-muted">No user</span>;
    return (
        <>
            <div>{device.user_name || device.user_email}</div>
            {device.user_name && device.user_email && (
                <div className="text-muted" style={{ fontSize: '0.8rem' }}>{device.user_email}</div>
            )}
            {!device.employee_id && device.user_email && (
                <span className="badge badge-warning" title="Nobody on the staff list has this email address">Not on the staff list</span>
            )}
            {device.employee_inactive && (
                <span className="badge badge-warning" title="Marked inactive on the staff list">Left</span>
            )}
        </>
    );
}

function LastSeen({ device, staleDays }) {
    return (
        <>
            <div>{formatDate(device.last_sync)}</div>
            {device.stale && (
                <span className="badge badge-warning" title={`Has not checked in to Intune for over ${staleDays} days`}>
                    {device.days_since_sync === null ? 'Never checked in' : `${device.days_since_sync} days ago`}
                </span>
            )}
            {device.compliance && !['compliant', 'unknown', 'configManager'].includes(device.compliance) && (
                <span className="badge badge-danger" title="Intune compliance state">{device.compliance}</span>
            )}
        </>
    );
}

/**
 * Double-check of the register against Microsoft Intune: which devices the
 * two disagree about, and who Intune says is using each one. Nothing here
 * changes anything until an action button is used.
 */
export default function IntuneCheck() {
    const [data, setData] = useState(null);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const [kind, setKind] = useState(null);
    const [search, setSearch] = useState('');
    const [showPersonal, setShowPersonal] = useState(false);
    const [notice, setNotice] = useState('');

    async function load(refresh = false) {
        setBusy(true);
        setError('');
        try {
            const result = await intuneAPI.check(refresh);
            setData(result);
            // Open on the first group that has something in it.
            setKind((current) => current
                || (KINDS.find((entry) => result.summary[entry.key] > 0) || KINDS[KINDS.length - 1]).key);
        } catch (err) {
            setError(err.message || 'Could not check Intune');
        } finally {
            setBusy(false);
        }
    }

    useEffect(() => { load(); }, []);

    const actions = useAssetActions((message) => {
        setNotice(message || 'Saved.');
        load();
    });

    const active = KINDS.find((entry) => entry.key === kind) || KINDS[0];
    const visible = useMemo(() => {
        if (!data) return [];
        const term = search.trim().toLowerCase();
        return data.rows.filter((row) => row.kind === active.key
            && (active.key !== 'not_in_register' || showPersonal || !row.device.personal)
            && (!term || rowText(row).includes(term)));
    }, [data, active.key, search, showPersonal]);

    if (!data && !error) {
        return (
            <div>
                <h2>Intune check</h2>
                <div className="spinner"></div>
                <p className="text-center text-muted">Asking Intune for its device list…</p>
            </div>
        );
    }

    const summary = data?.summary;
    const hasDevice = !['not_in_intune', 'no_serial'].includes(active.key);
    const hasAsset = active.key !== 'not_in_register';

    return (
        <div>
            <div className="flex justify-between items-center mb-3">
                <div>
                    <h2 style={{ marginBottom: 0 }}>Intune check</h2>
                    <div className="text-muted">
                        Compares every device Intune manages, and who Intune says uses it, with what is recorded here.
                        Devices are matched by serial number.
                    </div>
                </div>
                <div className="flex gap-2">
                    {data && (
                        <button type="button" className="btn btn-secondary" onClick={() => downloadCsv(data.rows)}>
                            Download CSV
                        </button>
                    )}
                    <button type="button" className="btn btn-primary" onClick={() => load(true)} disabled={busy}>
                        {busy ? 'Checking…' : 'Refresh from Intune'}
                    </button>
                </div>
            </div>

            {error && <div className="alert alert-danger">{error}</div>}
            {notice && <div className="alert alert-success" onClick={() => setNotice('')}>{notice}</div>}

            {data && (
                <>
                    <div className="card mb-3">
                        <div className="card-body">
                            <div className="text-muted mb-2">
                                Intune lists <strong>{data.intune_total}</strong> device{data.intune_total === 1 ? '' : 's'}
                                {' '}· read {formatDateTime(data.fetched_at)}
                                {summary.stale > 0 && (
                                    <> · {summary.stale} matched device{summary.stale === 1 ? ' has' : 's have'} not checked in for over {data.stale_days} days</>
                                )}
                                {data.intune_duplicates > 0 && (
                                    <> · {data.intune_duplicates} older duplicate record{data.intune_duplicates === 1 ? '' : 's'} in Intune ignored</>
                                )}
                            </div>
                            <div className="device-tiles">
                                {KINDS.map((entry) => (
                                    <button
                                        key={entry.key}
                                        type="button"
                                        className={`device-tile intune-tile intune-${entry.tone} ${entry.key === active.key ? 'active' : ''} ${summary[entry.key] === 0 ? 'empty' : ''}`}
                                        onClick={() => setKind(entry.key)}
                                    >
                                        <span className="device-count">{summary[entry.key]}</span>
                                        <span className="device-name">{entry.label}</span>
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>

                    <div className="card">
                        <div className="card-header flex justify-between items-center">
                            <div>
                                <h3 className="card-title">{active.label}</h3>
                                <div className="text-muted" style={{ maxWidth: '60rem' }}>{active.help}</div>
                            </div>
                            <input
                                type="search"
                                className="form-control"
                                style={{ maxWidth: '16rem' }}
                                placeholder="Search name, serial, person…"
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                            />
                        </div>
                        {active.key === 'not_in_register' && summary.personal_not_in_register > 0 && (
                            <div className="card-body" style={{ paddingBottom: 0 }}>
                                <label className="flex items-center gap-1">
                                    <input type="checkbox" checked={showPersonal} onChange={(e) => setShowPersonal(e.target.checked)} />
                                    Also show {summary.personal_not_in_register} personally owned device{summary.personal_not_in_register === 1 ? '' : 's'} (people's own phones and laptops enrolled in Intune)
                                </label>
                            </div>
                        )}
                        <div className="table-container">
                            <table className="table">
                                <thead>
                                    <tr>
                                        {hasAsset && <th>Asset</th>}
                                        {hasAsset && <th>Register says</th>}
                                        {hasDevice && <th>Intune device</th>}
                                        {hasDevice && <th>Intune says</th>}
                                        {hasDevice && <th>Last check-in</th>}
                                        <th></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {visible.length === 0 && (
                                        <tr>
                                            <td colSpan={6} className="text-center text-muted">
                                                {search ? 'Nothing here matches the search.' : 'Nothing in this group.'}
                                            </td>
                                        </tr>
                                    )}
                                    {visible.map(({ asset, device }) => {
                                        const person = asset?.holders.find((holder) => !holder.shared);
                                        return (
                                            <tr key={asset ? `a${asset.id}` : `d${device.id}`}>
                                                {hasAsset && (
                                                    <td>
                                                        <Link to={`/assets/${asset.id}`} className="text-primary"><strong>{asset.asset_number}</strong></Link>
                                                        <div>{asset.name}</div>
                                                        <div className="text-muted" style={{ fontSize: '0.8rem' }}>
                                                            {[asset.category, asset.campus, asset.serial_number && `S/N ${asset.serial_number}`].filter(Boolean).join(' · ')}
                                                        </div>
                                                    </td>
                                                )}
                                                {hasAsset && (
                                                    <td>
                                                        {asset.holders.length === 0 ? (
                                                            <span className="text-muted">{holdersText(asset)}</span>
                                                        ) : asset.holders.map((holder) => (
                                                            <div key={holder.assignment_id}>
                                                                {holder.name}
                                                                {holder.email && <div className="text-muted" style={{ fontSize: '0.8rem' }}>{holder.email}</div>}
                                                            </div>
                                                        ))}
                                                    </td>
                                                )}
                                                {hasDevice && (
                                                    <td>
                                                        <strong>{device.name || '—'}</strong>
                                                        <div>{makeAndModel(device)}</div>
                                                        <div className="text-muted" style={{ fontSize: '0.8rem' }}>
                                                            {[device.os, !hasAsset && (device.serial_number ? `S/N ${device.serial_number}` : 'No serial number'), device.personal && 'Personally owned'].filter(Boolean).join(' · ')}
                                                        </div>
                                                    </td>
                                                )}
                                                {hasDevice && <td><IntuneUser device={device} /></td>}
                                                {hasDevice && <td><LastSeen device={device} staleDays={data.stale_days} /></td>}
                                                <td className="text-right">
                                                    {active.key === 'different' && person && (
                                                        <button
                                                            type="button" className="write-only btn btn-sm btn-primary"
                                                            onClick={() => actions.open('reassign', asset.id, person.assignment_id, suggestFrom(device))}
                                                        >
                                                            Reassign to {(device.user_name || device.user_email).split(/[\s@]/)[0]}
                                                        </button>
                                                    )}
                                                    {active.key === 'unassigned_here' && (
                                                        <button
                                                            type="button" className="write-only btn btn-sm btn-primary"
                                                            onClick={() => actions.open('assign', asset.id, undefined, suggestFrom(device))}
                                                        >
                                                            Assign to {(device.user_name || device.user_email).split(/[\s@]/)[0]}
                                                        </button>
                                                    )}
                                                    {active.key === 'not_in_register' && (device.recycle_bin ? (
                                                        <Link to="/recycle-bin" className="btn btn-sm btn-secondary" title="This device was deleted from the register">
                                                            In recycle bin as {device.recycle_bin}
                                                        </Link>
                                                    ) : (
                                                        <Link to={addAssetLink(device)} className="write-only btn btn-sm btn-primary">Add to register</Link>
                                                    ))}
                                                    {active.key === 'no_serial' && (
                                                        <Link to={`/assets/${asset.id}/edit`} className="write-only btn btn-sm btn-primary">Add serial number</Link>
                                                    )}
                                                    {['gone_but_active', 'shared_here', 'no_user', 'not_in_intune'].includes(active.key) && (
                                                        <Link to={`/assets/${asset.id}`} className="btn btn-sm btn-secondary">Open asset</Link>
                                                    )}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </>
            )}

            {actions.dialogs}
        </div>
    );
}
