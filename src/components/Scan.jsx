import React, { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { assetsAPI } from '../services/api';
import { statusColor } from '../utils/scan';
import { useAssetActions } from './AssetActions';
import CameraScanner from './CameraScanner';

// Scan a sticker and act on the asset straight away. Reached three ways:
//  - a phone camera opens the link printed on the sticker (/s/AST-2026-0001)
//  - a handheld scanner types the code into the box here and presses Enter
//  - the camera button scans from inside the app
export default function Scan() {
    const { code: codeFromLink } = useParams();
    const inputRef = useRef(null);
    const [code, setCode] = useState('');
    const [asset, setAsset] = useState(null);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const [busy, setBusy] = useState(false);
    const [showCamera, setShowCamera] = useState(false);
    const [recent, setRecent] = useState([]);

    const actions = useAssetActions((message, result) => {
        setNotice(message);
        if (result?.id) loadAsset(result.id);
    });

    async function loadAsset(id) {
        const data = await assetsAPI.getById(id);
        setAsset(data);
        setRecent((prev) => [
            { id: data.id, asset_number: data.asset_number, name: data.name },
            ...prev.filter((r) => r.id !== data.id)
        ].slice(0, 8));
        return data;
    }

    async function lookup(raw) {
        const value = String(raw || '').trim();
        if (!value) return;
        setBusy(true);
        setError('');
        setNotice('');
        try {
            const found = await assetsAPI.lookup(value);
            await loadAsset(found.id);
            setCode('');
        } catch (err) {
            setAsset(null);
            setError(err.message);
        } finally {
            setBusy(false);
            // Keep the box ready for the next scan from a handheld scanner.
            if (inputRef.current) inputRef.current.focus();
        }
    }

    useEffect(() => {
        if (codeFromLink) lookup(codeFromLink);
    }, [codeFromLink]);

    const holders = asset?.assignments || [];
    const isBulk = (asset?.quantity || 1) > 1;
    const available = asset ? Math.max(0, (asset.quantity || 1) - (asset.assigned_quantity || 0)) : 0;
    const inService = asset && ['available', 'assigned'].includes(asset.status);

    return (
        <div className="scan-page">
            <h2>Scan</h2>

            <div className="card mb-3">
                <form
                    onSubmit={(e) => {
                        e.preventDefault();
                        lookup(code);
                    }}
                    className="flex gap-2"
                    style={{ flexWrap: 'wrap' }}
                >
                    <input
                        ref={inputRef}
                        type="text"
                        className="form-control"
                        style={{ flex: '1 1 16rem' }}
                        placeholder="Scan a sticker, or type an asset / serial number"
                        value={code}
                        onChange={(e) => setCode(e.target.value)}
                        autoFocus
                        autoComplete="off"
                    />
                    <button type="submit" className="btn btn-primary" disabled={busy || !code.trim()}>
                        {busy ? 'Looking up…' : 'Look up'}
                    </button>
                    <button type="button" className="btn btn-secondary" onClick={() => setShowCamera(true)}>
                        📷 Use camera
                    </button>
                </form>
            </div>

            {error && <div className="alert alert-danger">{error}</div>}
            {notice && <div className="alert alert-info">{notice}</div>}

            {asset && (
                <div className="card mb-3">
                    <div className="flex justify-between items-center" style={{ flexWrap: 'wrap', gap: '0.5rem' }}>
                        <div>
                            <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: 'var(--primary)' }}>
                                {asset.asset_number}
                            </div>
                            <div style={{ fontSize: '1.15rem', fontWeight: 600 }}>{asset.name}</div>
                        </div>
                        <span className={`badge badge-${statusColor(asset.status)}`} style={{ fontSize: '0.9rem' }}>
                            {asset.status}
                        </span>
                    </div>

                    <div className="scan-facts mt-2">
                        <div><span className="text-muted">Category</span>{asset.category_name || '—'}</div>
                        <div><span className="text-muted">Brand / model</span>{[asset.brand, asset.model].filter(Boolean).join(' ') || '—'}</div>
                        <div><span className="text-muted">Serial</span>{asset.serial_number || '—'}</div>
                        <div><span className="text-muted">Campus</span>{asset.campus || '—'}{asset.location ? ` / ${asset.location}` : ''}</div>
                        {isBulk && (
                            <div><span className="text-muted">Stock</span>{asset.assigned_quantity || 0} of {asset.quantity} out · {available} available</div>
                        )}
                    </div>

                    <div className="mt-3">
                        <div className="form-label">Currently with</div>
                        {holders.length === 0 ? (
                            <p className="text-muted">
                                {inService ? 'Nobody — in stock.' : `Out of service (${asset.status}).`}
                            </p>
                        ) : holders.map((row) => (
                            <div key={row.id} className="holder-row">
                                <div>
                                    <strong>{row.employee_name || `📍 ${row.location_label}`}</strong>
                                    {isBulk && <span className="badge badge-info" style={{ marginLeft: '0.5rem' }}>× {row.quantity}</span>}
                                    {row.employee_email && (
                                        <div className="text-muted" style={{ fontSize: '0.85rem' }}>{row.employee_email}</div>
                                    )}
                                </div>
                                <div className="flex gap-1">
                                    <button className="write-only btn btn-sm btn-primary" onClick={() => actions.open('return', asset.id, row.id)}>
                                        Return
                                    </button>
                                    <button className="write-only btn btn-sm btn-secondary" onClick={() => actions.open('reassign', asset.id, row.id)}>
                                        Reassign
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>

                    <div className="flex gap-2 mt-3" style={{ flexWrap: 'wrap' }}>
                        {inService && available > 0 && (
                            <button className="write-only btn btn-primary" onClick={() => actions.open('assign', asset.id)}>
                                {holders.length > 0 ? `Assign more (${available} left)` : 'Assign'}
                            </button>
                        )}
                        <button className="write-only btn btn-secondary" onClick={() => actions.open('transfer', asset.id)}>
                            Move campus
                        </button>
                        <Link to={`/assets/${asset.id}`} className="btn btn-secondary">Full details</Link>
                        <Link to={`/assets/${asset.id}/edit`} className="write-only btn btn-secondary">Edit / change status</Link>
                    </div>
                </div>
            )}

            {!asset && !error && (
                <p className="text-muted">
                    Point a handheld scanner at a sticker (the cursor is already in the box), or use the camera on a
                    phone or tablet. Older stickers that only carry the asset number work too.
                </p>
            )}

            {recent.length > 1 && (
                <div className="card">
                    <div className="form-label">Scanned this session</div>
                    <div className="flex gap-1" style={{ flexWrap: 'wrap' }}>
                        {recent.map((r) => (
                            <button key={r.id} className="btn btn-sm btn-secondary" onClick={() => lookup(r.asset_number)}>
                                {r.asset_number} · {r.name}
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {showCamera && (
                <CameraScanner
                    title="Scan a sticker"
                    hint="Point the camera at the QR code on the sticker."
                    onScan={(text) => {
                        setShowCamera(false);
                        lookup(text);
                    }}
                    onClose={() => setShowCamera(false)}
                />
            )}

            {actions.dialogs}
        </div>
    );
}
