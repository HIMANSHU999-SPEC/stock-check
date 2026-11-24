import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, Link, useLocation } from 'react-router-dom';
import { assetsAPI, documentsAPI, settingsAPI } from '../services/api';
import { handleEmailResult } from '../utils/emailTemplates';
import { assetScanUrl, statusColor, outcomeLabel, availableQuantity as stockAvailable } from '../utils/scan';
import { useAssetActions } from './AssetActions';
import QRCode from 'react-qr-code';
import { formatDate, formatDateTime } from '../utils/dates';
import { actionLabel } from '../utils/labels';

export default function AssetDetails() {
    const { id } = useParams();
    const navigate = useNavigate();
    const location = useLocation();
    const [asset, setAsset] = useState(null);
    const [loading, setLoading] = useState(true);
    const [notice, setNotice] = useState('');
    const [appBaseUrl, setAppBaseUrl] = useState('');
    const actions = useAssetActions((message) => {
        setNotice(message);
        loadAsset();
    });
    const [documents, setDocuments] = useState([]);
    const [uploadingDoc, setUploadingDoc] = useState(false);

    async function loadDocuments() {
        try {
            const docs = await documentsAPI.list(id);
            setDocuments(docs);
        } catch (e) {
            // documents are non-critical; don't block the page
        }
    }

    async function handleDocUpload(e) {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;
        setUploadingDoc(true);
        try {
            await documentsAPI.upload(id, file);
            await loadDocuments();
        } catch (err) {
            alert('Upload failed: ' + err.message);
        } finally {
            setUploadingDoc(false);
        }
    }

    async function handleDocDelete(doc) {
        if (!confirm(`Delete "${doc.original_name}"?`)) return;
        try {
            await documentsAPI.delete(id, doc.id);
            await loadDocuments();
        } catch (err) {
            alert('Delete failed: ' + err.message);
        }
    }
    useEffect(() => {
        loadAsset();
        loadDocuments();
        settingsAPI.getPublic().then((s) => setAppBaseUrl(s.app_base_url || '')).catch(() => {});
    }, [id]);

    // Arriving from "Register new asset" opens the assign dialog straight away.
    useEffect(() => {
        const params = new URLSearchParams(location.search);
        if (params.get('assign') === '1') {
            const suggest = params.get('assign_to')
                ? { employeeId: params.get('assign_to') }
                : params.get('assign_email')
                    ? { name: params.get('assign_name') || '', email: params.get('assign_email') }
                    : undefined;
            actions.open('assign', id, undefined, suggest);
            navigate(location.pathname, { replace: true });
        }
    }, [location.search]);

    async function loadAsset() {
        try {
            const data = await assetsAPI.getById(id);
            setAsset(data);
        } catch (error) {
            alert('Error loading asset: ' + error.message);
            navigate('/assets');
        } finally {
            setLoading(false);
        }
    }

    async function handleDelete() {
        if (!confirm('Are you sure you want to delete this asset?')) return;

        try {
            await assetsAPI.delete(id);
            navigate('/assets');
        } catch (error) {
            alert('Error deleting asset: ' + error.message);
        }
    }

    async function handleEmail(template, assignmentId) {
        try {
            const result = await assetsAPI.sendEmail(id, template, assignmentId);
            const line = handleEmailResult(result);
            if (line) setNotice(line);
        } catch (error) {
            setNotice('The email could not be sent: ' + error.message);
        }
    }

    // In service and not already out: a lost, sold or in-repair item has none.
    const availableQuantity = stockAvailable(asset);
    const holders = asset?.assignments || [];
    const isBulk = (asset?.quantity || 1) > 1;
    const inService = ['available', 'assigned'].includes(asset?.status);
    const sale = asset?.sale || null;
    const canSell = Boolean(asset) && !isBulk && !['sold', 'lost', 'stolen', 'retired'].includes(asset.status);

    async function handleUndoSale() {
        const reason = window.prompt(`Undo the sale of ${asset.asset_number} to ${sale.buyer_name}? It goes back into stock, not back to whoever had it.\n\nReason (optional):`, '');
        if (reason === null) return;
        try {
            await assetsAPI.undoSale(id, reason.trim());
            setNotice(`Sale undone. ${asset.asset_number} is back in stock.`);
            loadAsset();
        } catch (error) {
            setNotice('The sale could not be undone: ' + error.message);
        }
    }
    const warrantyMonths = asset?.warranty_period_months || 0;
    let warrantyExpiry = null;
    if (warrantyMonths > 0 && asset?.purchase_date) {
        const d = new Date(asset.purchase_date);
        if (!Number.isNaN(d.getTime())) {
            d.setMonth(d.getMonth() + warrantyMonths);
            warrantyExpiry = d.toISOString().slice(0, 10);
        }
    }

    if (loading) {
        return <div className="spinner"></div>;
    }

    if (!asset) {
        return <div>Asset not found</div>;
    }

    return (
        <div>
            <div className="flex justify-between items-center mb-3">
                <h2>Asset Details</h2>
                <div className="flex gap-2">
                    {canSell && (
                        <button
                            onClick={() => actions.open('sell', id)} className="write-only btn btn-secondary"
                            title="Record that this device has been sold, for example to the person who uses it"
                        >
                            Sell
                        </button>
                    )}
                    <button onClick={() => actions.open('transfer', id)} className="write-only btn btn-secondary">
                        Move campus
                    </button>
                    <Link to={`/assets/${id}/edit`} className="write-only btn btn-secondary">
                        Edit
                    </Link>
                    <button onClick={handleDelete} className="write-only btn btn-danger">
                        Delete
                    </button>
                </div>
            </div>

            {notice && (
                <div className="alert alert-info flex justify-between items-center">
                    <span>{notice}</span>
                    <button className="btn btn-sm btn-secondary" onClick={() => setNotice('')}>Dismiss</button>
                </div>
            )}

            <div className="grid grid-2">
                <div className="card">
                    <div className="card-header">
                        <h3 className="card-title">Asset Information</h3>
                    </div>
                    <div className="card-body">
                        <div className="form-group">
                            <label className="form-label">Asset Number</label>
                            <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: 'var(--primary)' }}>
                                {asset.asset_number}
                            </div>
                        </div>

                        <div className="grid grid-2">
                            <div className="form-group">
                                <label className="form-label">Name</label>
                                <div>{asset.name}</div>
                            </div>

                            <div className="form-group">
                                <label className="form-label">Category</label>
                                <div>{asset.category_name || 'N/A'}</div>
                            </div>

                            <div className="form-group">
                                <label className="form-label">Brand</label>
                                <div>{asset.brand || 'N/A'}</div>
                            </div>

                            <div className="form-group">
                                <label className="form-label">Model</label>
                                <div>{asset.model || 'N/A'}</div>
                            </div>

                        <div className="form-group">
                            <label className="form-label">Serial Number</label>
                            <div>{asset.serial_number || 'N/A'}</div>
                        </div>

                        <div className="form-group">
                            <label className="form-label">Quantity</label>
                            <div>{asset.quantity || 1}</div>
                        </div>

                        <div className="form-group">
                            <label className="form-label">Assigned Qty</label>
                            <div>{asset.assigned_quantity || 0}</div>
                        </div>

                        <div className="form-group">
                            <label className="form-label">Status</label>
                            <div>
                                <span className={`badge badge-${statusColor(asset.status)}`}>
                                    {asset.status}
                                </span>
                            </div>
                        </div>

                        <div className="form-group">
                            <label className="form-label">Available Quantity</label>
                            <div>{availableQuantity}</div>
                        </div>

                            <div className="form-group">
                                <label className="form-label">Location</label>
                                <div>{asset.location || 'N/A'}</div>
                            </div>

                            <div className="form-group">
                                <label className="form-label">Campus</label>
                                <div>{asset.campus || 'N/A'}</div>
                            </div>

                            <div className="form-group">
                                <label className="form-label">Supplier</label>
                                <div>{asset.supplier_name || 'N/A'}</div>
                            </div>

                            <div className="form-group">
                                <label className="form-label">Warranty Period</label>
                                <div>{warrantyMonths ? `${warrantyMonths} months` : 'No warranty'}</div>
                            </div>
                            <div className="form-group">
                                <label className="form-label">Warranty Expiry</label>
                                <div>{warrantyExpiry || 'N/A'}</div>
                            </div>
                        </div>

                        <div className="form-group">
                            <label className="form-label">Notes</label>
                            <div>{asset.notes || 'No notes'}</div>
                        </div>
                    </div>
                </div>

                <div className="card">
                    <div className="card-header">
                        <h3 className="card-title">Financial Information</h3>
                    </div>
                    <div className="card-body">
                        <div className="grid grid-2">
                            <div className="form-group">
                                <label className="form-label">Purchase Date</label>
                                <div>{asset.purchase_date || 'N/A'}</div>
                            </div>

                            <div className="form-group">
                                <label className="form-label">Purchase Price{isBulk ? ' (per item)' : ''}</label>
                                <div style={{ fontSize: '1.25rem', fontWeight: 'bold' }}>
                                    {asset.purchase_price ? `£${parseFloat(asset.purchase_price).toFixed(2)}` : 'N/A'}
                                </div>
                                {isBulk && asset.purchase_price > 0 && (
                                    <div className="text-muted" style={{ fontSize: '0.85rem' }}>
                                        £{(asset.purchase_price * asset.quantity).toFixed(2)} for all {asset.quantity}
                                    </div>
                                )}
                            </div>

                            <div className="form-group">
                                <label className="form-label">Added to System</label>
                                <div>
                                    {formatDate(asset.created_at, 'N/A')}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="card">
                    <div className="card-header">
                        <div className="flex justify-between items-center">
                            <h3 className="card-title">📎 Invoices & Documents</h3>
                            <label className="write-only btn btn-sm btn-primary" style={{ cursor: 'pointer', marginBottom: 0 }}>
                                {uploadingDoc ? 'Uploading…' : '+ Attach file'}
                                <input
                                    type="file"
                                    accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp"
                                    style={{ display: 'none' }}
                                    onChange={handleDocUpload}
                                    disabled={uploadingDoc}
                                />
                            </label>
                        </div>
                    </div>
                    <div className="card-body">
                        {documents.length === 0 ? (
                            <p className="text-muted">
                                No documents yet. Attach the purchase invoice (PDF or photo, max 10&nbsp;MB).
                            </p>
                        ) : (
                            <div className="table-container">
                                <table className="table">
                                    <thead>
                                        <tr>
                                            <th>File</th>
                                            <th>Size</th>
                                            <th>Uploaded</th>
                                            <th>Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {documents.map((doc) => (
                                            <tr key={doc.id}>
                                                <td>{doc.original_name}</td>
                                                <td>{doc.size ? `${Math.max(1, Math.round(doc.size / 1024))} KB` : '—'}</td>
                                                <td>{formatDate(doc.uploaded_at)}</td>
                                                <td>
                                                    <div className="flex gap-1">
                                                        <a
                                                            href={documentsAPI.viewUrl(id, doc.id)}
                                                            target="_blank"
                                                            rel="noreferrer"
                                                            className="download-only btn btn-sm btn-secondary"
                                                        >
                                                            View
                                                        </a>
                                                        <button
                                                            onClick={() => handleDocDelete(doc)}
                                                            className="write-only btn btn-sm btn-danger"
                                                        >
                                                            Delete
                                                        </button>
                                                    </div>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                </div>

                <div className="card">
                    <div className="card-header">
                        <div className="flex justify-between items-center">
                            <h3 className="card-title">Assignment</h3>
                            {inService && availableQuantity > 0 && (
                                <button onClick={() => actions.open('assign', id)} className="write-only btn btn-sm btn-primary">
                                    {holders.length > 0 ? `Assign more (${availableQuantity} left)` : 'Assign'}
                                </button>
                            )}
                        </div>
                    </div>
                    <div className="card-body">
                        {sale ? (
                            <div>
                                <div style={{ fontWeight: 'bold' }}>
                                    Sold to{' '}
                                    {sale.employee_id ? (
                                        <Link to={`/employees/${sale.employee_id}`} className="text-primary">{sale.buyer_name}</Link>
                                    ) : sale.buyer_name}
                                    {' '}for £{Number(sale.price).toFixed(2)}
                                </div>
                                <div className="text-muted" style={{ fontSize: '0.85rem' }}>
                                    {[
                                        `on ${new Date(`${sale.sold_on}T12:00:00Z`).toLocaleDateString()}`,
                                        sale.buyer_email,
                                        sale.payment_reference && `ref ${sale.payment_reference}`,
                                        sale.recorded_by && `recorded by ${sale.recorded_by}`
                                    ].filter(Boolean).join(' · ')}
                                </div>
                                {sale.notes && <p className="mt-1">{sale.notes}</p>}
                                <p className="text-muted mt-2" style={{ fontSize: '0.85rem' }}>
                                    No longer ours: it is kept here for the record and is not counted as stock.
                                    If it still appears in Intune, remove it there.
                                </p>
                                <button onClick={handleUndoSale} className="write-only btn btn-sm btn-secondary">Undo sale</button>
                            </div>
                        ) : holders.length === 0 ? (
                            <p className="text-muted">
                                {inService
                                    ? 'Not currently assigned to anyone.'
                                    : `Marked "${asset.status}" — set the status back to available (Edit) before assigning it.`}
                            </p>
                        ) : (
                            holders.map((row) => (
                                <div key={row.id} className="holder-row">
                                    <div>
                                        <div style={{ fontWeight: 'bold' }}>
                                            {row.employee_id ? (
                                                <Link to={`/employees/${row.employee_id}`} className="text-primary">
                                                    {row.employee_name}
                                                </Link>
                                            ) : (
                                                <>📍 {row.location_label}</>
                                            )}
                                            {isBulk && <span className="badge badge-info" style={{ marginLeft: '0.5rem' }}>× {row.quantity}</span>}
                                        </div>
                                        <div className="text-muted" style={{ fontSize: '0.85rem' }}>
                                            {row.employee_id
                                                ? [row.employee_email, row.department].filter(Boolean).join(' · ')
                                                : 'Room / location'}
                                            {' · since '}
                                            {formatDate(row.assigned_at)}
                                            {row.confirmed_at
                                                ? ` · ✓ confirmed ${formatDate(row.confirmed_at)} by ${
                                                    String(row.confirmed_by || '').toLowerCase() === String(row.employee_email || '').toLowerCase()
                                                        ? 'the holder' : `IT (${row.confirmed_by})`}`
                                                : isBulk || !row.employee_id
                                                    ? ' · not yet confirmed by IT'
                                                    : ' · not yet confirmed'}
                                        </div>
                                    </div>
                                    <div className="flex gap-1" style={{ flexWrap: 'wrap' }}>
                                        {!row.confirmed_at && (
                                            <button
                                                className="write-only btn btn-sm btn-secondary"
                                                title="Record that you have checked this holder really has it"
                                                onClick={() => assetsAPI.confirmHolder(id, row.id).then(loadAsset).catch((e) => alert(e.message))}
                                            >
                                                ✓ Confirm
                                            </button>
                                        )}
                                        <button onClick={() => actions.open('return', id, row.id)} className="write-only btn btn-sm btn-primary">
                                            Return
                                        </button>
                                        <button onClick={() => actions.open('reassign', id, row.id)} className="write-only btn btn-sm btn-secondary">
                                            Reassign
                                        </button>
                                        {canSell && row.employee_id && (
                                            <button
                                                onClick={() => actions.open('sell', id, row.id)} className="write-only btn btn-sm btn-secondary"
                                                title="They are buying this device"
                                            >
                                                Sell to them
                                            </button>
                                        )}
                                        {row.employee_id && (
                                            <select
                                                className="write-only form-control email-menu"
                                                value=""
                                                onChange={(e) => e.target.value && handleEmail(e.target.value, row.id)}
                                                aria-label="Send an email"
                                            >
                                                <option value="">Email…</option>
                                                <option value="asset_assigned">Assignment confirmation</option>
                                                <option value="asset_return_request">Return request</option>
                                                <option value="asset_maintenance">Maintenance required</option>
                                            </select>
                                        )}
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>

                <div className="card">
                    <div className="card-header">
                        <h3 className="card-title">Sticker</h3>
                    </div>
                    <div className="card-body">
                        <div style={{ background: 'white', padding: '1rem', borderRadius: '8px', display: 'inline-block' }}>
                            <QRCode value={assetScanUrl(appBaseUrl, asset.asset_number)} size={180} />
                        </div>
                        <p className="text-muted mt-1" style={{ fontSize: '0.85rem' }}>
                            Scanning this with a phone camera or a handheld scanner opens this asset.
                        </p>
                        <div className="mt-2">
                            <Link to={`/tags?ids=${id}`} className="btn btn-secondary">
                                Print sticker
                            </Link>
                        </div>
                    </div>
                </div>
            </div>

            {asset.previous_holders && asset.previous_holders.length > 0 && (
                <div className="card mt-3">
                    <div className="card-header">
                        <h3 className="card-title">Previous Holders</h3>
                    </div>
                    <div className="table-container">
                        <table className="table">
                            <thead>
                                <tr>
                                    <th>Held by</th>
                                    {isBulk && <th>Qty</th>}
                                    <th>From</th>
                                    <th>Until</th>
                                    <th>Outcome</th>
                                    <th>Recorded by</th>
                                </tr>
                            </thead>
                            <tbody>
                                {asset.previous_holders.map((row) => (
                                    <tr key={row.id}>
                                        <td>
                                            {row.employee_id ? (
                                                <Link to={`/employees/${row.employee_id}`} className="text-primary">
                                                    <strong>{row.employee_name || 'Unknown'}</strong>
                                                </Link>
                                            ) : (
                                                <strong>{row.location_label || 'Unknown'}</strong>
                                            )}
                                            {row.employee_status === 'inactive' && (
                                                <span className="badge badge-warning" style={{ marginLeft: '0.5rem' }}>Inactive</span>
                                            )}
                                        </td>
                                        {isBulk && <td>{row.quantity}</td>}
                                        <td style={{ whiteSpace: 'nowrap' }}>{formatDate(row.assigned_at)}</td>
                                        <td style={{ whiteSpace: 'nowrap' }}>{formatDate(row.returned_at)}</td>
                                        <td>{outcomeLabel(row.return_condition)}</td>
                                        <td>{row.returned_by_email || '—'}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {asset.history && asset.history.length > 0 && (
                <div className="card mt-3">
                    <div className="card-header">
                        <h3 className="card-title">History</h3>
                    </div>
                    <div className="table-container">
                        <table className="table">
                            <thead>
                                <tr>
                                    <th>Date</th>
                                    <th>Action</th>
                                    <th>Employee</th>
                                    <th>Notes</th>
                                    <th>By</th>
                                </tr>
                            </thead>
                            <tbody>
                                {asset.history.map((entry) => (
                                    <tr key={entry.id}>
                                        <td style={{ whiteSpace: 'nowrap' }}>{formatDateTime(entry.timestamp)}</td>
                                        <td>
                                            <span className="badge badge-primary">{actionLabel(entry.action)}</span>
                                        </td>
                                        <td>{entry.employee_name || '-'}</td>
                                        <td>{entry.notes || '-'}</td>
                                        <td>{entry.performed_by || '—'}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {actions.dialogs}
        </div>
    );
}
