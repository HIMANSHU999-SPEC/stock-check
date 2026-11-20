import React, { useState, useEffect, useRef } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import * as XLSX from 'xlsx';
import { assetsAPI, reportsAPI } from '../services/api';
import { statusColor } from '../utils/scan';
import { useAssetActions } from './AssetActions';
import { CAMPUSES } from '../constants';

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
    // Ticked rows, for moving several assets to a campus in one go.
    const [selected, setSelected] = useState(() => new Set());
    const [moveCampus, setMoveCampus] = useState('');
    const [moveLocation, setMoveLocation] = useState('');
    const [moving, setMoving] = useState(false);
    const [noCampusCount, setNoCampusCount] = useState(0);
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
            // "Unspecified" is the report's label for assets with no campus yet.
            const names = data.map((c) => c.campus).filter((n) => n && n !== 'Unspecified');
            setCampuses([...new Set([...CAMPUSES, ...names])]);
            setNoCampusCount(data.find((c) => c.campus === 'Unspecified')?.asset_count || 0);
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
            brand: data['brand'] || data['make'] || data['manufacturer'] || '',
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
            // Only a name is needed: a missing category, brand or campus is
            // worked out from the name on the server.
            const items = rows.map(mapRowToAsset).filter((item) => item.name);
            if (items.length === 0) {
                alert('No valid rows found in the sheet (it needs a Name column).');
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

    // Ticks only ever refer to rows that are on screen.
    const selectedIds = assets.filter((a) => selected.has(a.id)).map((a) => a.id);
    const allSelected = assets.length > 0 && selectedIds.length === assets.length;

    function toggleRow(id) {
        setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    }

    function toggleAll() {
        setSelected(allSelected ? new Set() : new Set(assets.map((a) => a.id)));
    }

    async function moveSelected() {
        if (!moveCampus || selectedIds.length === 0) return;
        const where = moveLocation.trim() ? `${moveCampus} / ${moveLocation.trim()}` : moveCampus;
        if (!confirm(`Move ${selectedIds.length} asset${selectedIds.length === 1 ? '' : 's'} to ${where}?`)) return;
        setMoving(true);
        try {
            const result = await assetsAPI.bulkTransfer({
                ids: selectedIds,
                campus: moveCampus,
                location: moveLocation.trim() || undefined
            });
            const parts = [`${result.moved} asset${result.moved === 1 ? '' : 's'} moved to ${where}.`];
            if (result.skipped.length > 0) {
                parts.push(`${result.skipped.length} left as they were (already there).`);
            }
            setNotice(parts.join(' '));
            setSelected(new Set());
            setMoveLocation('');
            loadAssets();
            loadCampuses();
        } catch (error) {
            alert('Could not move the assets: ' + error.message);
        } finally {
            setMoving(false);
        }
    }

    return (
        <div>
            <div className="flex justify-between items-center mb-3">
                <h2>Asset Management</h2>
                <div className="flex gap-2">
                    <button onClick={exportExcel} className="download-only btn btn-secondary">
                        📥 Export Excel (filtered)
                    </button>
                    <Link to="/assets/tidy" className="write-only btn btn-secondary">
                        ✨ Categorise with AI
                    </Link>
                    <Link to="/assets/import-invoice" className="write-only btn btn-secondary">
                        📄 Import Invoice
                    </Link>
                    <Link to="/assets/new" className="write-only btn btn-primary">
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
                                <option value="sold">Sold</option>
                            </select>
                        </div>
                        <div className="form-group">
                            <select
                                className="form-control"
                                value={filters.category}
                                onChange={(e) => setFilters({ ...filters, category: e.target.value })}
                            >
                                <option value="">All Categories</option>
                                <option value="__none__">No category</option>
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
                                <option value="__unassigned__">No campus yet{noCampusCount ? ` (${noCampusCount})` : ''}</option>
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

            <details className="write-only card details-card mb-3">
                <summary>Import assets from an Excel file</summary>
                <div className="card-body">
                    <p className="text-muted">
                        Upload .xlsx or .xls with columns: Name, Category, Brand, Model, Serial Number, Quantity,
                        Purchase Date, Purchase Price, Supplier, Status, Campus, Location, Notes. Only Name is needed:
                        a missing category or brand is worked out from the name, and electronics with no campus go
                        under Towerhill.
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
            </details>

            {noCampusCount > 0 && filters.campus !== '__unassigned__' && selectedIds.length === 0 && (
                <div className="alert alert-info flex justify-between items-center">
                    <span>
                        {noCampusCount} asset{noCampusCount === 1 ? ' has' : 's have'} no campus yet. Show them,
                        tick the ones to move and choose a campus.
                    </span>
                    <button
                        className="btn btn-sm btn-secondary"
                        onClick={() => {
                            setFilters({ ...filters, campus: '__unassigned__' });
                            navigate({ search: 'campus=__unassigned__' });
                        }}
                    >
                        Show assets with no campus
                    </button>
                </div>
            )}

            {selectedIds.length > 0 && (
                <div className="write-only bulk-bar">
                    <strong>{selectedIds.length} selected</strong>
                    <span className="text-muted">Move to</span>
                    <select
                        className="form-control"
                        value={moveCampus}
                        onChange={(e) => setMoveCampus(e.target.value)}
                        aria-label="Campus to move to"
                    >
                        <option value="">Choose campus…</option>
                        {campuses.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                    <input
                        type="text"
                        className="form-control"
                        placeholder="Room / location (optional)"
                        value={moveLocation}
                        onChange={(e) => setMoveLocation(e.target.value)}
                    />
                    <button className="btn btn-primary" onClick={moveSelected} disabled={!moveCampus || moving}>
                        {moving ? 'Moving…' : `Move ${selectedIds.length}`}
                    </button>
                    <button className="btn btn-secondary" onClick={() => setSelected(new Set())} disabled={moving}>
                        Clear
                    </button>
                </div>
            )}

            {loading ? (
                <div className="spinner"></div>
            ) : (
                <div className="card">
                    <div className="table-container">
                        <table className="table">
                            <thead>
                                <tr>
                                    <th style={{ width: '1%' }}>
                                        <input
                                            className="write-only"
                                            type="checkbox"
                                            checked={allSelected}
                                            onChange={toggleAll}
                                            aria-label="Select all assets shown"
                                        />
                                    </th>
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
                                        <td colSpan="12" className="text-center text-muted">
                                            No assets found
                                        </td>
                                    </tr>
                                ) : (
                                    assets.map((asset) => (
                                        <tr key={asset.id} className={selected.has(asset.id) ? 'row-selected' : ''}>
                                            <td>
                                                <input
                                            className="write-only"
                                                    type="checkbox"
                                                    checked={selected.has(asset.id)}
                                                    onChange={() => toggleRow(asset.id)}
                                                    aria-label={`Select ${asset.asset_number}`}
                                                />
                                            </td>
                                            <td>
                                                <Link to={`/assets/${asset.id}`} className="text-primary">
                                                    <strong>{asset.asset_number}</strong>
                                                </Link>
                                            </td>
                                            <td><div className="cell-clamp" title={asset.name}>{asset.name}</div></td>
                                            <td>{asset.category_name || '—'}</td>
                                            <td><div className="cell-clamp" title={asset.model || ''}>{asset.model || '—'}</div></td>
                                            <td>{asset.supplier_name || '—'}</td>
                                            <td>
                                                {asset.campus || <span className="badge badge-warning">No campus</span>}
                                            </td>
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
                                            <td>
                                                <div className="cell-clamp" title={asset.status === 'sold' && asset.sold_to ? `Sold to ${asset.sold_to}` : asset.holders || ''}>
                                                    {asset.status === 'sold' && asset.sold_to ? `Sold to ${asset.sold_to}` : asset.holders || '—'}
                                                </div>
                                            </td>
                                            <td style={{ whiteSpace: 'nowrap' }}>
                                                {asset.created_at ? new Date(asset.created_at).toLocaleDateString() : '—'}
                                            </td>
                                            <td>
                                                <div className="flex gap-1">
                                                    <Link to={`/assets/${asset.id}`} className="btn btn-sm btn-secondary">
                                                        View
                                                    </Link>
                                                    <Link to={`/assets/${asset.id}/edit`} className="write-only btn btn-sm btn-secondary">
                                                        Edit
                                                    </Link>
                                                    {canAssign(asset) && (
                                                        <button
                                                            onClick={() => actions.open('assign', asset.id)}
                                                            className="write-only btn btn-sm btn-primary"
                                                        >
                                                            Assign
                                                        </button>
                                                    )}
                                                    {asset.holder_count > 0 && (
                                                        <>
                                                            <button
                                                                onClick={() => actions.open('reassign', asset.id)}
                                                                className="write-only btn btn-sm btn-secondary"
                                                            >
                                                                Reassign
                                                            </button>
                                                            <button
                                                                onClick={() => actions.open('return', asset.id)}
                                                                className="write-only btn btn-sm btn-secondary"
                                                            >
                                                                Return
                                                            </button>
                                                        </>
                                                    )}
                                                    <button
                                                        onClick={() => handleDelete(asset.id)}
                                                        className="write-only btn btn-sm btn-danger"
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
