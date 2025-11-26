import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { assetsAPI, reportsAPI } from '../services/api';

export default function AssetList() {
    const [assets, setAssets] = useState([]);
    const [categories, setCategories] = useState([]);
    const [loading, setLoading] = useState(true);
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
