import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import * as XLSX from 'xlsx';
import { assetsAPI, reportsAPI } from '../services/api';

export default function AssetList() {
    const [assets, setAssets] = useState([]);
    const [categories, setCategories] = useState([]);
    const [loading, setLoading] = useState(true);
    const [importing, setImporting] = useState(false);
    const [createMissingCategories, setCreateMissingCategories] = useState(true);
    const [filters, setFilters] = useState({
        search: '',
        status: '',
        category: ''
    });

    useEffect(() => {
        loadCategories();
    }, []);

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

    async function loadAssets() {
        try {
            setLoading(true);
            const data = await assetsAPI.getAll(filters);
            setAssets(data);
        } catch (error) {
            console.error('Error loading assets:', error);
        } finally {
            setLoading(false);
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
            purchase_date: data['purchase date'] || '',
            purchase_price: data['purchase price'] || '',
            status: (data['status'] || '').toLowerCase(),
            location: data['location'] || '',
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
                <Link to="/assets/new" className="btn btn-primary">
                    + Add New Asset
                </Link>
            </div>

            <div className="card mb-3">
                <div className="card-body">
                    <div className="grid grid-3">
                        <div className="form-group">
                            <input
                                type="text"
                                className="form-control"
                                placeholder="Search assets..."
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
                        Purchase Price, Status, Location, Notes. Categories will be auto-created if needed.
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
                                    <th>Status</th>
                                    <th>Assigned To</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {assets.length === 0 ? (
                                    <tr>
                                        <td colSpan="7" className="text-center text-muted">
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
                                            <td>
                                                <span className={`badge badge-${getStatusColor(asset.status)}`}>
                                                    {asset.status}
                                                </span>
                                            </td>
                                            <td>{asset.employee_name || '-'}</td>
                                            <td>
                                                <div className="flex gap-1">
                                                    <Link to={`/assets/${asset.id}`} className="btn btn-sm btn-secondary">
                                                        View
                                                    </Link>
                                                    <Link to={`/assets/${asset.id}/edit`} className="btn btn-sm btn-secondary">
                                                        Edit
                                                    </Link>
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
        </div>
    );
}

function getStatusColor(status) {
    const colors = {
        available: 'success',
        assigned: 'info',
        maintenance: 'warning',
        retired: 'danger'
    };
    return colors[status] || 'primary';
}
