import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { assetsAPI, reportsAPI } from '../services/api';

export default function AssetForm() {
    const navigate = useNavigate();
    const { id } = useParams();
    const isEdit = Boolean(id);

    const [categories, setCategories] = useState([]);
    const [loading, setLoading] = useState(false);
    const [formData, setFormData] = useState({
        name: '',
        category_id: '',
        model: '',
        serial_number: '',
        purchase_date: '',
        purchase_price: '',
        location: '',
        notes: '',
        status: 'available'
    });

    useEffect(() => {
        loadCategories();
        if (isEdit) {
            loadAsset();
        }
    }, [id]);

    async function loadCategories() {
        try {
            const data = await reportsAPI.getCategories();
            setCategories(data);
        } catch (error) {
            console.error('Error loading categories:', error);
        }
    }

    async function loadAsset() {
        try {
            const data = await assetsAPI.getById(id);
            setFormData({
                name: data.name || '',
                category_id: data.category_id || '',
                model: data.model || '',
                serial_number: data.serial_number || '',
                purchase_date: data.purchase_date || '',
                purchase_price: data.purchase_price || '',
                location: data.location || '',
                notes: data.notes || '',
                status: data.status || 'available'
            });
        } catch (error) {
            alert('Error loading asset: ' + error.message);
            navigate('/assets');
        }
    }

    async function handleSubmit(e) {
        e.preventDefault();
        setLoading(true);

        try {
            if (isEdit) {
                await assetsAPI.update(id, formData);
            } else {
                await assetsAPI.create(formData);
            }
            navigate('/assets');
        } catch (error) {
            alert('Error saving asset: ' + error.message);
        } finally {
            setLoading(false);
        }
    }

    function handleChange(e) {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    }

    return (
        <div>
            <h2>{isEdit ? 'Edit Asset' : 'Register New Asset'}</h2>

            <div className="card">
                <form onSubmit={handleSubmit}>
                    <div className="card-body">
                        <div className="grid grid-2">
                            <div className="form-group">
                                <label className="form-label">Asset Name *</label>
                                <input
                                    type="text"
                                    name="name"
                                    className="form-control"
                                    value={formData.name}
                                    onChange={handleChange}
                                    required
                                />
                            </div>

                            <div className="form-group">
                                <label className="form-label">Category *</label>
                                <select
                                    name="category_id"
                                    className="form-control"
                                    value={formData.category_id}
                                    onChange={handleChange}
                                    required
                                >
                                    <option value="">Select Category</option>
                                    {categories.map((cat) => (
                                        <option key={cat.id} value={cat.id}>
                                            {cat.name}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            <div className="form-group">
                                <label className="form-label">Model</label>
                                <input
                                    type="text"
                                    name="model"
                                    className="form-control"
                                    value={formData.model}
                                    onChange={handleChange}
                                />
                            </div>

                            <div className="form-group">
                                <label className="form-label">Serial Number</label>
                                <input
                                    type="text"
                                    name="serial_number"
                                    className="form-control"
                                    value={formData.serial_number}
                                    onChange={handleChange}
                                />
                            </div>

                            <div className="form-group">
                                <label className="form-label">Purchase Date</label>
                                <input
                                    type="date"
                                    name="purchase_date"
                                    className="form-control"
                                    value={formData.purchase_date}
                                    onChange={handleChange}
                                />
                            </div>

                            <div className="form-group">
                                <label className="form-label">Purchase Price (£)</label>
                                <input
                                    type="number"
                                    name="purchase_price"
                                    className="form-control"
                                    value={formData.purchase_price}
                                    onChange={handleChange}
                                    step="0.01"
                                    min="0"
                                />
                            </div>

                            <div className="form-group">
                                <label className="form-label">Status</label>
                                <select
                                    name="status"
                                    className="form-control"
                                    value={formData.status}
                                    onChange={handleChange}
                                >
                                    <option value="available">Available</option>
                                    <option value="assigned">Assigned</option>
                                    <option value="maintenance">Maintenance</option>
                                    <option value="retired">Retired</option>
                                </select>
                            </div>

                            <div className="form-group">
                                <label className="form-label">Location</label>
                                <input
                                    type="text"
                                    name="location"
                                    className="form-control"
                                    value={formData.location}
                                    onChange={handleChange}
                                    placeholder="e.g., Building A, Room 101"
                                />
                            </div>
                        </div>

                        <div className="form-group">
                            <label className="form-label">Notes</label>
                            <textarea
                                name="notes"
                                className="form-control"
                                value={formData.notes}
                                onChange={handleChange}
                                rows="4"
                                placeholder="Additional information about this asset..."
                            ></textarea>
                        </div>
                    </div>

                    <div className="card-footer">
                        <button
                            type="button"
                            onClick={() => navigate('/assets')}
                            className="btn btn-secondary"
                            disabled={loading}
                        >
                            Cancel
                        </button>
                        <button type="submit" className="btn btn-primary" disabled={loading}>
                            {loading ? 'Saving...' : isEdit ? 'Update Asset' : 'Register Asset'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
