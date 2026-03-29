import React, { useState, useRef } from 'react';
import * as XLSX from 'xlsx';
import { assetsAPI } from '../services/api';

const EXPECTED_COLUMNS = ['name', 'category', 'model', 'serial_number', 'quantity', 'purchase_price', 'intune_price', 'status', 'campus', 'location', 'supplier_name', 'warranty_period_months', 'purchase_date', 'notes'];

const COLUMN_INFO = [
    { key: 'name', label: 'Name', required: true, example: 'Dell Laptop' },
    { key: 'category', label: 'Category', required: false, example: 'Laptop' },
    { key: 'model', label: 'Model', required: false, example: 'Latitude 5520' },
    { key: 'serial_number', label: 'Serial Number', required: false, example: 'SN12345' },
    { key: 'quantity', label: 'Quantity', required: false, example: '1' },
    { key: 'purchase_price', label: 'Purchase Price', required: false, example: '850.00' },
    { key: 'intune_price', label: 'Intune Price', required: false, example: '9.99' },
    { key: 'status', label: 'Status', required: false, example: 'available' },
    { key: 'campus', label: 'Campus', required: false, example: 'Main Campus' },
    { key: 'location', label: 'Location', required: false, example: 'Room 101' },
    { key: 'supplier_name', label: 'Supplier', required: false, example: 'Dell UK' },
    { key: 'warranty_period_months', label: 'Warranty (months)', required: false, example: '24' },
    { key: 'purchase_date', label: 'Purchase Date', required: false, example: '2024-01-15' },
    { key: 'notes', label: 'Notes', required: false, example: 'Refurbished' },
];

export default function AssetImport() {
    const fileRef = useRef(null);
    const [preview, setPreview] = useState(null);
    const [importing, setImporting] = useState(false);
    const [result, setResult] = useState(null);
    const [alert, setAlert] = useState(null);
    const [createMissingCategories, setCreateMissingCategories] = useState(true);
    const [step, setStep] = useState('upload'); // upload | preview | done

    function handleFile(e) {
        const file = e.target.files[0];
        if (!file) return;
        setAlert(null);
        setResult(null);

        const reader = new FileReader();
        reader.onload = (evt) => {
            try {
                const wb = XLSX.read(evt.target.result, { type: 'binary', cellDates: true });
                const ws = wb.Sheets[wb.SheetNames[0]];
                const raw = XLSX.utils.sheet_to_json(ws, { defval: '' });

                if (!raw || raw.length === 0) {
                    setAlert({ type: 'danger', msg: 'No data found in file. Make sure the first sheet has data.' });
                    return;
                }

                // Normalize headers to lowercase with underscores
                const normalised = raw.map(row => {
                    const out = {};
                    Object.keys(row).forEach(k => {
                        const norm = k.toLowerCase().trim().replace(/\s+/g, '_');
                        out[norm] = row[k];
                    });
                    return out;
                });

                setPreview(normalised);
                setStep('preview');
            } catch (err) {
                setAlert({ type: 'danger', msg: 'Failed to parse file: ' + err.message });
            }
        };
        reader.readAsBinaryString(file);
    }

    async function handleImport() {
        if (!preview || preview.length === 0) return;
        setImporting(true);
        setAlert(null);
        try {
            const res = await assetsAPI.importBulk(preview, createMissingCategories);
            setResult(res);
            setStep('done');
        } catch (e) {
            setAlert({ type: 'danger', msg: 'Import failed: ' + e.message });
        } finally {
            setImporting(false);
        }
    }

    function reset() {
        setPreview(null);
        setResult(null);
        setAlert(null);
        setStep('upload');
        if (fileRef.current) fileRef.current.value = '';
    }

    function downloadTemplate() {
        const ws = XLSX.utils.json_to_sheet([
            COLUMN_INFO.reduce((acc, col) => { acc[col.label] = col.example; return acc; }, {})
        ]);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Assets');
        XLSX.writeFile(wb, 'asset-import-template.xlsx');
    }

    return (
        <div>
            <div className="flex justify-between items-center mb-3">
                <h2>Import Assets (CSV / Excel)</h2>
                <button className="btn btn-secondary" onClick={downloadTemplate}>
                    Download Template
                </button>
            </div>

            {alert && (
                <div style={{ padding: '0.75rem 1rem', borderRadius: '6px', marginBottom: '1rem', background: alert.type === 'success' ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)', color: alert.type === 'success' ? 'var(--success)' : 'var(--danger)', border: `1px solid ${alert.type === 'success' ? 'var(--success)' : 'var(--danger)'}` }}>
                    {alert.msg}
                    <button onClick={() => setAlert(null)} style={{ float: 'right', background: 'none', border: 'none', cursor: 'pointer', color: 'inherit' }}>×</button>
                </div>
            )}

            {step === 'upload' && (
                <div className="card">
                    <div className="card-header">
                        <h3 className="card-title">Upload File</h3>
                        <p className="text-muted" style={{ margin: 0, fontSize: '0.875rem' }}>
                            Supported formats: .xlsx, .xls, .csv — First row must be column headers.
                        </p>
                    </div>
                    <div className="card-body">
                        <div style={{ border: '2px dashed var(--border-color)', borderRadius: '8px', padding: '2rem', textAlign: 'center', marginBottom: '1.5rem' }}>
                            <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>📂</div>
                            <p className="text-muted" style={{ marginBottom: '1rem' }}>Select your Excel or CSV file to import assets</p>
                            <input
                                ref={fileRef}
                                type="file"
                                accept=".xlsx,.xls,.csv"
                                onChange={handleFile}
                                style={{ display: 'none' }}
                                id="file-input"
                            />
                            <label htmlFor="file-input" className="btn btn-primary" style={{ cursor: 'pointer' }}>
                                Choose File
                            </label>
                        </div>

                        <h4 style={{ marginBottom: '0.75rem' }}>Supported Columns</h4>
                        <div className="table-container">
                            <table className="table">
                                <thead>
                                    <tr>
                                        <th>Column Header</th>
                                        <th>Required</th>
                                        <th>Example</th>
                                        <th>Notes</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {COLUMN_INFO.map(col => (
                                        <tr key={col.key}>
                                            <td><code style={{ background: 'var(--bg-tertiary)', padding: '2px 6px', borderRadius: '3px' }}>{col.label}</code></td>
                                            <td>{col.required ? <span className="badge badge-danger">Required</span> : <span className="badge badge-info">Optional</span>}</td>
                                            <td className="text-muted">{col.example}</td>
                                            <td className="text-muted" style={{ fontSize: '0.8rem' }}>
                                                {col.key === 'status' && 'available, assigned, maintenance, damaged, lost, stolen, retired'}
                                                {col.key === 'quantity' && 'Default: 1'}
                                                {col.key === 'category' && 'Must match an existing category name'}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            )}

            {step === 'preview' && preview && (
                <div className="card">
                    <div className="card-header">
                        <div className="flex justify-between items-center">
                            <h3 className="card-title">Preview — {preview.length} rows found</h3>
                            <div className="flex gap-2">
                                <button className="btn btn-secondary btn-sm" onClick={reset}>Back</button>
                            </div>
                        </div>
                        <div style={{ marginTop: '0.75rem' }}>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                                <input type="checkbox" checked={createMissingCategories} onChange={e => setCreateMissingCategories(e.target.checked)} />
                                <span>Auto-create missing categories</span>
                            </label>
                        </div>
                    </div>
                    <div className="card-body">
                        <div className="table-container">
                            <table className="table">
                                <thead>
                                    <tr>
                                        <th>#</th>
                                        {Object.keys(preview[0]).slice(0, 8).map(k => <th key={k}>{k}</th>)}
                                        {Object.keys(preview[0]).length > 8 && <th>...</th>}
                                    </tr>
                                </thead>
                                <tbody>
                                    {preview.slice(0, 20).map((row, idx) => (
                                        <tr key={idx} style={!row.name ? { background: 'rgba(239,68,68,0.08)' } : {}}>
                                            <td className="text-muted">{idx + 1}</td>
                                            {Object.keys(preview[0]).slice(0, 8).map(k => <td key={k}>{String(row[k] ?? '')}</td>)}
                                            {Object.keys(preview[0]).length > 8 && <td className="text-muted">...</td>}
                                        </tr>
                                    ))}
                                    {preview.length > 20 && (
                                        <tr>
                                            <td colSpan={9} className="text-center text-muted">
                                                ...and {preview.length - 20} more rows
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                        <div className="flex gap-2 mt-3">
                            <button className="btn btn-primary" onClick={handleImport} disabled={importing}>
                                {importing ? 'Importing...' : `Import ${preview.length} Assets`}
                            </button>
                            <button className="btn btn-secondary" onClick={reset}>Cancel</button>
                        </div>
                    </div>
                </div>
            )}

            {step === 'done' && result && (
                <div className="card">
                    <div className="card-header">
                        <h3 className="card-title">Import Complete</h3>
                    </div>
                    <div className="card-body">
                        <div className="stats-grid mb-3">
                            <div className="stat-card">
                                <div className="stat-label">Imported</div>
                                <div className="stat-value" style={{ color: 'var(--success)' }}>{result.imported || 0}</div>
                                <div className="text-muted">Assets added</div>
                            </div>
                            <div className="stat-card">
                                <div className="stat-label">Skipped</div>
                                <div className="stat-value" style={{ color: 'var(--warning)' }}>{result.skipped || 0}</div>
                                <div className="text-muted">Rows skipped</div>
                            </div>
                            {result.categoriesCreated > 0 && (
                                <div className="stat-card">
                                    <div className="stat-label">Categories</div>
                                    <div className="stat-value" style={{ color: 'var(--primary)' }}>{result.categoriesCreated}</div>
                                    <div className="text-muted">Auto-created</div>
                                </div>
                            )}
                        </div>
                        {result.errors && result.errors.length > 0 && (
                            <div style={{ marginBottom: '1rem' }}>
                                <h4 style={{ color: 'var(--danger)', marginBottom: '0.5rem' }}>Errors ({result.errors.length})</h4>
                                <ul style={{ paddingLeft: '1.25rem', color: 'var(--danger)', fontSize: '0.875rem' }}>
                                    {result.errors.slice(0, 10).map((err, i) => <li key={i}>{err}</li>)}
                                    {result.errors.length > 10 && <li>...and {result.errors.length - 10} more</li>}
                                </ul>
                            </div>
                        )}
                        <div className="flex gap-2">
                            <button className="btn btn-primary" onClick={reset}>Import Another File</button>
                            <a href="/assets" className="btn btn-secondary">View Assets</a>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
