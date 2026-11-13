import React, { useState, useEffect, useRef } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import * as XLSX from 'xlsx';
import { assetsAPI, reportsAPI } from '../services/api';
import { statusColor } from '../utils/scan';
import { useAssetActions } from './AssetActions';

const EMPTY_FILTERS = { search: '', status: '', category: '', campus: '', model: '', brand: '' };

// Filters can be preset from a link (dashboard, inventory page).
function filtersFromUrl(search) {
    const params = new URLSearchParams(search);
    const preset = {};
    for (const key of Object.keys(EMPTY_FILTERS)) {
        if (params.get(key) !== null) preset[key] = params.get(key);
    }
    return preset;
}

export default function AssetList() {
    const location = useLocation();
    const navigate = useNavigate();
    const [assets, setAssets] = useState([]);
    const [categories, setCategories] = useState([]);
    const [campuses, setCampuses] = useState([]);
    const [loading, setLoading] = useState(true);
    const [notice, setNotice] = useState('');
    const [importing, setImporting] = useState(false);
    const [createMissingCategories, setCreateMissingCategories] = useState(true);
    const [filters, setFilters] = useState(() => ({ ...EMPTY_FILTERS, ...filtersFromUrl(location.search) }));
    const [models, setModels] = useState([]);
    const [brands, setBrands] = useState([]);
    // Only the most recent request may fill the table: a slower earlier one
    // must not overwrite the results of the filters now on screen.
    const latestLoad = useRef(0);
    const actions = useAssetActions((message) => {
        setNotice(message);
        loadAssets();
    });

    useEffect(() => {
        loadCategories();
        loadCampuses();
        loadModels();
        loadBrands();
    }, []);

    // Following another link to this page while it is open re-applies its filters.
    useEffect(() => {
        const preset = filtersFromUrl(location.search);
        setFilters((prev) => {
            const next = { ...prev, ...preset };
            return Object.keys(next).every((key) => next[key] === prev[key]) ? prev : next;
        });
    }, [location.search]);

    async function loadModels() {
        try {
            const data = await reportsAPI.getByModel();
            // The report is grouped per category; merge to one row per model name.
            const merged = new Map();
            for (const m of data) {
                merged.set(m.model, (merged.get(m.model) || 0) + (m.asset_count || 0));
            }
            setModels(
                [...merged.entries()]
                    .map(([model, asset_count]) => ({ model, asset_count }))
                    .sort((a, b) => b.asset_count - a.asset_count)
            );
        } catch (error) {
            console.error('Error loading models:', error);
        }
    }

    useEffect(() => {
        loadAssets();
    }, [filters]);

    async function loadCategories() {
        try {
            const data = await reportsAPI.getCategories();
            setCategories(data);
        } catch (error) {
            console.error('Error loading categories:', error);
        }
    }

    async function loadCampuses() {
        try {
            const data = await reportsAPI.getByCampus();
            const names = data.map((c) => c.campus).filter(Boolean);
            setCampuses(names);
        } catch (error) {
            console.error('Error loading campuses:', error);
        }
    }

    async function loadBrands() {
        try {
            const data = await reportsAPI.getByBrand();
            setBrands(data.filter((b) => b.brand));
        } catch (error) {
            console.error('Error loading brands:', error);
        }
    }

    // Export the currently filtered view as a real Excel workbook.
    function exportExcel() {
        if (assets.length === 0) {
            alert('Nothing to export with the current filters.');
            return;
        }
        const rows = assets.map((a) => ({
            'Asset Number': a.asset_number,
            'Name': a.name,
            'Brand': a.brand || '',
            'Category': a.category_name || '',
            'Model': a.model || '',
            'Serial Number': a.serial_number || '',
            'Quantity': a.quantity || 1,
            'Assigned Qty': a.assigned_quantity || 0,
            'Status': a.status,
            'Assigned To': a.holders || '',
            'Supplier': a.supplier_name || '',
            'Campus': a.campus || '',
            'Location': a.location || '',
            'Purchase Date': a.purchase_date || '',
            'Purchase Price': a.purchase_price || '',
            'Warranty (months)': a.warranty_period_months || 0,
            'Date Added': a.created_at ? new Date(a.created_at).toLocaleDateString() : ''
        }));
        const ws = XLSX.utils.json_to_sheet(rows);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Assets');
        const catName = categories.find((c) => `${c.id}` === `${filters.category}`)?.name;
        const nameParts = ['assets', catName, filters.brand, filters.campus].filter(Boolean);
        XLSX.writeFile(wb, `${nameParts.join('-').toLowerCase().replace(/\s+/g, '_')}.xlsx`);
    }

    async function loadAssets() {
        const request = ++latestLoad.current;
        try {
            setLoading(true);
            const data = await assetsAPI.getAll(filters);
            if (request === latestLoad.current) setAssets(data);
        } catch (error) {
            console.error('Error loading assets:', error);
        } finally {
            if (request === latestLoad.current) setLoading(false);
        }
    }

    async function handleDelete(id) {
        if (!confirm('Are you sure you want to delete this asset?')) return;

        try {
            await assetsAPI.delete(id);
            loadAssets();
        } catch (error) {
            alert('Error deleting asset: ' + error.message);
        }
    }

    function normalizeRow(row) {
        const normalized = {};
        Object.keys(row).forEach((key) => {
            const safeKey = key ? key.toString().trim().toLowerCase() : '';
            normalized[safeKey] = row[key];
        });
        return normalized;
    }

    function mapRowToAsset(row) {
        const data = normalizeRow(row);
        return {
            name: data['name'] || data['asset name'] || '',
            category: data['category'] || '',
            model: data['model'] || '',
            serial_number: data['serial number'] || '',
            quantity: data['quantity'] || data['qty'] || '',
            purchase_date: data['purchase date'] || '',
            purchase_price: data['purchase price'] || '',
            warranty_period_months: data['warranty period'] || data['warranty'] || data['warranty months'] || '',
            supplier_name: data['supplier'] || data['supplier name'] || '',
            status: (data['status'] || '').toLowerCase(),
            location: data['location'] || '',
            campus: data['campus'] || '',
            notes: data['notes'] || ''
        };
    }

    async function handleImportFile(file) {
        if (!file) return;
        setImporting(true);
        try {
            const buffer = await file.arrayBuffer();
            const workbook = XLSX.read(buffer, { type: 'array' });
            const sheet = workbook.Sheets[workbook.SheetNames[0]];
            const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
            const items = rows.map(mapRowToAsset).filter((item) => item.name && item.category);
            if (items.length === 0) {
                alert('No valid rows found in the sheet (need Name and Category columns).');
                return;
            }
            const result = await assetsAPI.importBulk(items, createMissingCategories);
            alert(`Imported ${result.inserted} assets successfully.`);
            loadAssets();
        } catch (error) {
            alert('Import failed: ' + error.message);
        } finally {
            setImporting(false);
        }
    }

    return (
        <div>
            <div className="flex justify-between items-center mb-3">
                <h2>Asset Management</h2>
                <div className="flex gap-2">
                    <button onClick={exportExcel} className="btn btn-secondary">
                        📥 Export Excel (filtered)
                    </button>
                    <Link to="/assets/import-invoice" className="btn btn-secondary">
                        📄 Import Invoice
                    </Link>
                    <Link to="/assets/new" className="btn btn-primary">
                        + Add New Asset
                    </Link>
                </div>
            </div>

            {notice && (
                <div className="alert alert-info flex justify-between items-center">
                    <span>{notice}</span>
                    <button className="btn btn-sm btn-secondary" onClick={() => setNotice('')}>Dismiss</button>
                </div>
            )}

            <div className="card mb-3">
                <div className="card-body">
                    <div className="grid grid-3">
                        <div className="form-group">
                            <input
                                type="text"
                                className="form-control"
                                placeholder="Search by name, number, serial or holder..."
                                value={filters.search}
                                onChange={(e) => setFilters({ ...filters, search: e.target.value })}
                            />
                        </div>
                        <div className="form-group">
                            <select
                                className="form-control"
                                value={filters.status}
                                onChange={(e) => setFilters({ ...filters, status: e.target.value })}
                            >
                                <option value="">All Statuses</option>
                                <option value="available">Available</option>
                                <option value="assigned">Assigned</option>
                                <option value="maintenance">Maintenance</option>
                                <option value="repair">Repair</option>
                                <option value="damaged">Damaged</option>
                                <option value="lost">Lost</option>
                                <option value="stolen">Stolen</option>
                                <option value="retired">Retired</option>
                            </select>
                        </div>
                        <div className="form-group">
                            <select
                                className="form-control"
                                value={filters.category}
                                onChange={(e) => setFilters({ ...filters, category: e.target.value })}
                            >
                                <option value="">All Categories</option>
                                {categories.map((cat) => (
                                    <option key={cat.id} value={cat.id}>
                                        {cat.name}
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div className="form-group">
                            <select
                                className="form-control"
                                value={filters.brand}
                                onChange={(e) => setFilters({ ...filters, brand: e.target.value })}
                            >
                                <option value="">All Brands</option>
                                {brands.map((b) => (
                                    <option key={b.brand} value={b.brand}>
                                        {b.brand} ({b.asset_count})
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div className="form-group">
                            <select
                                className="form-control"
                                value={filters.model}
                                onChange={(e) => setFilters({ ...filters, model: e.target.value })}
                            >
                                <option value="">All Models</option>
                                {models.map((m, i) => (
                                    <option key={`${m.model}-${i}`} value={m.model}>
                                        {m.model} ({m.asset_count})
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div className="form-group">
                            <select
                                className="form-control"
                                value={filters.campus}
                                onChange={(e) => {
                                    const val = e.target.value;
                                    setFilters({ ...filters, campus: val });
                                    const search = new URLSearchParams(location.search);
                                    if (val) {
                                        search.set('campus', val);
                                    } else {
                                        search.delete('campus');
                                    }
                                    navigate({ search: search.toString() });
                                }}
                            >
                                <option value="">All Campuses</option>
                                <option value="__unassigned__">Unassigned</option>
                                {campuses.map((c) => (
                                    <option key={c} value={c}>
                                        {c}
                                    </option>
                                ))}
                            </select>
                        </div>
                    </div>
                </div>
            </div>

            <div className="card mb-3">
                <div className="card-header">
                    <h3 className="card-title">Import Assets (Excel by Category)</h3>
                </div>
                <div className="card-body">
                    <p className="text-muted">
                        Upload .xlsx or .xls with columns: Name, Category, Model, Serial Number, Purchase Date,
                        Purchase Price, Supplier, Status, Location, Notes. Categories will be auto-created if needed.
                    </p>
                    <div className="flex gap-2 items-center">
                        <input
                            type="file"
                            accept=".xlsx,.xls"
                            onChange={(e) => handleImportFile(e.target.files?.[0])}
                            disabled={importing}
                        />
                        <label className="flex items-center gap-1">
                            <input
                                type="checkbox"
                                checked={createMissingCategories}
                                onChange={(e) => setCreateMissingCategories(e.target.checked)}
                            />
                            <span>Create missing categories automatically</span>
                        </label>
                        {importing && <span className="text-muted">Importing...</span>}
                    </div>
                </div>
            </div>

            {loading ? (
                <div className="spinner"></div>
            ) : (
                <div className="card">
                    <div className="table-container">
                        <table className="table">
                            <thead>
                                <tr>
                                    <th>Asset Number</th>
                                    <th>Name</th>
                                    <th>Category</th>
                                    <th>Model</th>
                                    <th>Supplier</th>
                                    <th>Campus</th>
                                    <th>Qty</th>
                                    <th>Status</th>
                                    <th>Assigned To</th>
                                    <th>Added</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {assets.length === 0 ? (
                                    <tr>
                                        <td colSpan="11" className="text-center text-muted">
                                            No assets found
                                        </td>
                                    </tr>
                                ) : (
                                    assets.map((asset) => (
                                        <tr key={asset.id}>
                                            <td>
                                                <Link to={`/assets/${asset.id}`} className="text-primary">
                                                    <strong>{asset.asset_number}</strong>
                                                </Link>
                                            </td>
                                            <td>{asset.name}</td>
                                            <td>{asset.category_name || 'N/A'}</td>
                                            <td>{asset.model || 'N/A'}</td>
                                            <td>{asset.supplier_name || 'N/A'}</td>
                                            <td>{asset.campus || 'N/A'}</td>
                                            <td style={{ whiteSpace: 'nowrap' }}>
                                                {(asset.quantity || 1) > 1
                                                    ? `${asset.assigned_quantity || 0} / ${asset.quantity} out`
                                                    : 1}
                                            </td>
                                            <td>
                                                <span className={`badge badge-${statusColor(asset.status)}`}>
                                                    {asset.status}
                                                </span>
                                            </td>
                                            <td>{asset.holders || '-'}</td>
                                            <td style={{ whiteSpace: 'nowrap' }}>
                                                {asset.created_at ? new Date(asset.created_at).toLocaleDateString() : '—'}
                                            </td>
                                            <td>
                                                <div className="flex gap-1">
                                                    <Link to={`/assets/${asset.id}`} className="btn btn-sm btn-secondary">
                                                        View
                                                    </Link>
                                                    <Link to={`/assets/${asset.id}/edit`} className="btn btn-sm btn-secondary">
                                                        Edit
                                                    </Link>
                                                    {canAssign(asset) && (
                                                        <button
                                                            onClick={() => actions.open('assign', asset.id)}
                                                            className="btn btn-sm btn-primary"
                                                        >
                                                            Assign
                                                        </button>
                                                    )}
                                                    {asset.holder_count > 0 && (
                                                        <>
                                                            <button
                                                                onClick={() => actions.open('reassign', asset.id)}
                                                                className="btn btn-sm btn-secondary"
                                                            >
                                                                Reassign
                                                            </button>
                                                            <button
                                                                onClick={() => actions.open('return', asset.id)}
                                                                className="btn btn-sm btn-secondary"
                                                            >
                                                                Return
                                                            </button>
                                                        </>
                                                    )}
                                                    <button
                                                        onClick={() => handleDelete(asset.id)}
                                                        className="btn btn-sm btn-danger"
                                                    >
                                                        Delete
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {actions.dialogs}
        </div>
    );
}

function canAssign(asset) {
    return ['available', 'assigned'].includes(asset.status)
        && (asset.quantity || 1) > (asset.assigned_quantity || 0);
}
