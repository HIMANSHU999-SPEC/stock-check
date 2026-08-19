import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { invoiceAPI, reportsAPI } from '../services/api';

// Upload a supplier invoice PDF (e.g. Amazon Business), review the extracted
// line items, then create them as assets with the invoice attached to each.
const EMPTY_ROW = { name: '', brand: '', category: 'Electronics', quantity: 1, unit_price: '' };

export default function InvoiceImport() {
    const [step, setStep] = useState('upload'); // upload -> review -> done
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [items, setItems] = useState([]);
    const [fileToken, setFileToken] = useState(null);
    const [fileName, setFileName] = useState('');
    const [created, setCreated] = useState([]);
    const [categories, setCategories] = useState([]);

    useEffect(() => {
        reportsAPI.getCategories()
            .then((data) => setCategories(data.map((c) => c.name)))
            .catch(() => {});
    }, []);

    async function handleFile(e) {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;
        setBusy(true);
        setError('');
        try {
            const res = await invoiceAPI.parse(file);
            setFileToken(res.file_token);
            setFileName(res.file_name || file.name);
            setItems(res.items.length ? res.items : [{ ...EMPTY_ROW }]);
            setStep('review');
            if (!res.items.length) {
                setError('No line items were recognised in this PDF — add them manually below; the invoice will still be attached.');
            }
        } catch (err) {
            setError(err.message);
        } finally {
            setBusy(false);
        }
    }

    function updateRow(index, field, value) {
        setItems((prev) => prev.map((it, i) => (i === index ? { ...it, [field]: value } : it)));
    }

    function removeRow(index) {
        setItems((prev) => prev.filter((_, i) => i !== index));
    }

    async function handleImport() {
        const valid = items.filter((it) => String(it.name || '').trim());
        if (!valid.length) {
            alert('Add at least one item with a name.');
            return;
        }
        setBusy(true);
        setError('');
        try {
            const res = await invoiceAPI.import({ items: valid, file_token: fileToken, file_name: fileName });
            setCreated(res.created || []);
            setStep('done');
        } catch (err) {
            setError(err.message);
        } finally {
            setBusy(false);
        }
    }

    const totalValue = items.reduce(
        (s, it) => s + (parseFloat(it.unit_price) || 0) * (parseInt(it.quantity, 10) || 1), 0
    );

    return (
        <div>
            <div className="flex justify-between items-center mb-3">
                <h2>📄 Import from Invoice</h2>
                <Link to="/assets" className="btn btn-secondary">Back to Assets</Link>
            </div>

            {step === 'upload' && (
                <div className="card">
                    <div className="card-body">
                        <p>
                            Upload a supplier invoice PDF (Amazon Business, Currys, etc.). The line items are
                            read automatically — you review and correct everything before anything is created.
                        </p>
                        <label className="btn btn-primary mt-2" style={{ cursor: 'pointer' }}>
                            {busy ? 'Reading invoice…' : 'Choose invoice PDF'}
                            <input
                                type="file"
                                accept=".pdf,application/pdf"
                                style={{ display: 'none' }}
                                onChange={handleFile}
                                disabled={busy}
                            />
                        </label>
                        {error && <p style={{ color: 'var(--danger)', marginTop: '0.75rem' }}>{error}</p>}
                        <p className="text-muted mt-2" style={{ fontSize: '0.85rem' }}>
                            Works best with digital PDFs (downloaded from the supplier). Scanned photos of paper
                            invoices can't be read — add those items manually and attach the scan on the asset page.
                        </p>
                    </div>
                </div>
            )}

            {step === 'review' && (
                <>
                    <div className="card mb-3">
                        <div className="card-header">
                            <div className="flex justify-between items-center">
                                <h3 className="card-title">Check the items from “{fileName}”</h3>
                                <span className="badge badge-primary">
                                    {items.length} item(s) · £{totalValue.toFixed(2)}
                                </span>
                            </div>
                        </div>
                        <div className="table-container">
                            <table className="table">
                                <thead>
                                    <tr>
                                        <th style={{ minWidth: '220px' }}>Item name</th>
                                        <th>Brand</th>
                                        <th>Category</th>
                                        <th>Qty</th>
                                        <th>Unit price (£)</th>
                                        <th></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {items.map((it, i) => (
                                        <tr key={i}>
                                            <td>
                                                <input className="form-control" value={it.name}
                                                    onChange={(e) => updateRow(i, 'name', e.target.value)} />
                                            </td>
                                            <td>
                                                <input className="form-control" style={{ width: '110px' }} value={it.brand || ''}
                                                    onChange={(e) => updateRow(i, 'brand', e.target.value)} />
                                            </td>
                                            <td>
                                                <input className="form-control" style={{ width: '150px' }} list="invoice-categories"
                                                    value={it.category || ''}
                                                    onChange={(e) => updateRow(i, 'category', e.target.value)} />
                                            </td>
                                            <td>
                                                <input type="number" min="1" className="form-control" style={{ width: '70px' }}
                                                    value={it.quantity}
                                                    onChange={(e) => updateRow(i, 'quantity', parseInt(e.target.value, 10) || 1)} />
                                            </td>
                                            <td>
                                                <input type="number" min="0" step="0.01" className="form-control" style={{ width: '110px' }}
                                                    value={it.unit_price}
                                                    onChange={(e) => updateRow(i, 'unit_price', e.target.value)} />
                                            </td>
                                            <td>
                                                <button className="btn btn-sm btn-danger" onClick={() => removeRow(i)}>✕</button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        <datalist id="invoice-categories">
                            {[...new Set(['Laptop', 'Monitor', 'Tablet', 'Printer', 'Peripheral', 'Accessory',
                                'Network', 'Storage & Components', 'Phone', 'Electronics', ...categories])]
                                .map((c) => <option key={c} value={c} />)}
                        </datalist>
                        <div className="card-body">
                            <button className="btn btn-secondary btn-sm"
                                onClick={() => setItems((prev) => [...prev, { ...EMPTY_ROW }])}>
                                + Add row
                            </button>
                        </div>
                    </div>

                    {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
                    <div className="flex gap-2">
                        <button className="btn btn-primary" onClick={handleImport} disabled={busy}>
                            {busy ? 'Importing…' : `Import ${items.filter((it) => it.name.trim()).length} item(s)`}
                        </button>
                        <button className="btn btn-secondary" onClick={() => { setStep('upload'); setItems([]); setError(''); }}>
                            Start over
                        </button>
                    </div>
                    <p className="text-muted mt-2" style={{ fontSize: '0.85rem' }}>
                        Each item becomes an asset with the price recorded and this invoice PDF attached.
                    </p>
                </>
            )}

            {step === 'done' && (
                <div className="card">
                    <div className="card-header">
                        <h3 className="card-title">✅ Imported {created.length} item(s)</h3>
                    </div>
                    <div className="table-container">
                        <table className="table">
                            <thead>
                                <tr><th>Asset Number</th><th>Name</th><th>Qty</th><th>Price</th></tr>
                            </thead>
                            <tbody>
                                {created.map((c) => (
                                    <tr key={c.id}>
                                        <td><Link to={`/assets/${c.id}`} className="text-primary"><strong>{c.asset_number}</strong></Link></td>
                                        <td>{c.name}</td>
                                        <td>{c.quantity}</td>
                                        <td>{c.purchase_price != null ? `£${Number(c.purchase_price).toFixed(2)}` : '—'}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    <div className="card-body flex gap-2">
                        <button className="btn btn-primary" onClick={() => { setStep('upload'); setItems([]); setCreated([]); setError(''); }}>
                            Import another invoice
                        </button>
                        <Link to="/assets" className="btn btn-secondary">View Assets</Link>
                    </div>
                </div>
            )}
        </div>
    );
}
