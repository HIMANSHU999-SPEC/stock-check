import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { assetsAPI, reportsAPI, documentsAPI, tidyAPI } from '../services/api';
import { CAMPUSES } from '../constants';

export default function AssetForm() {
    const navigate = useNavigate();
    const { id } = useParams();
    const isEdit = Boolean(id);
    // A new asset can arrive part-filled, e.g. from a device the Intune check
    // found that is not in the register yet.
    const [query] = useSearchParams();
    const preset = (field) => (isEdit ? '' : (query.get(field) || '').slice(0, 200));

    const [categories, setCategories] = useState([]);
    const [campuses, setCampuses] = useState([]);
    const [models, setModels] = useState([]);
    const [addingCampus, setAddingCampus] = useState(false);
    const [newCampus, setNewCampus] = useState('');
    const [loading, setLoading] = useState(false);
    const [invoiceFile, setInvoiceFile] = useState(null);
    const [formData, setFormData] = useState({
        name: preset('name'),
        category_id: '',
        brand: preset('brand'),
        model: preset('model'),
        serial_number: preset('serial_number'),
        quantity: 1,
        purchase_date: '',
        purchase_price: '',
        supplier_name: '',
        warranty_period_months: 0,
        campus: '',
        location: '',
        notes: preset('notes'),
        status: 'available'
    });

    useEffect(() => {
        loadCategories();
        loadCampuses();
        loadModels();
        loadBrands();
        if (isEdit) {
            loadAsset();
        }
    }, [id]);

    async function loadModels() {
        try {
            const data = await reportsAPI.getByModel();
            const names = [...new Set(data.map((m) => m.model).filter((n) => n && n !== 'Unspecified'))];
            setModels(names);
        } catch (error) {
            console.error('Error loading models:', error);
        }
    }

    const COMMON_BRANDS = ['HP', 'Dell', 'Lenovo', 'Apple', 'Microsoft', 'Samsung', 'Acer', 'Asus', 'Logitech', 'Cisco'];
    const [brands, setBrands] = useState(COMMON_BRANDS);

    async function loadBrands() {
        try {
            const data = await reportsAPI.getByBrand();
            const names = data.map((b) => b.brand).filter((n) => n && n !== 'Unspecified');
            setBrands([...new Set([...names, ...COMMON_BRANDS])]);
        } catch (error) {
            // keep common suggestions
        }
    }

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
            const names = data.map((c) => c.campus).filter((n) => n && n !== 'Unspecified');
            // Standard campuses always offered, merged with any already in use.
            setCampuses([...new Set([...CAMPUSES, ...names])]);
        } catch (error) {
            console.error('Error loading campuses:', error);
            setCampuses([...CAMPUSES]);
        }
    }

    async function loadAsset() {
        try {
            const data = await assetsAPI.getById(id);
            setFormData({
                name: data.name || '',
                category_id: data.category_id || '',
                brand: data.brand || '',
                model: data.model || '',
                serial_number: data.serial_number || '',
                quantity: data.quantity || 1,
                purchase_date: data.purchase_date || '',
                purchase_price: data.purchase_price || '',
                supplier_name: data.supplier_name || '',
                warranty_period_months: data.warranty_period_months || 0,
                campus: data.campus || '',
                location: data.location || '',
                notes: data.notes || '',
                status: data.status || 'available'
            });
        } catch (error) {
            alert('Error loading asset: ' + error.message);
            navigate('/assets');
        }
    }

    // For a new asset, the category, brand and campus are suggested from the
    // name and model as they are typed. A field the person has set themselves
    // is never overwritten: `auto` remembers which values are still ours.
    const [suggestion, setSuggestion] = useState(null);
    const [auto, setAuto] = useState({ category_id: false, brand: false, campus: false });
    const latest = useRef({ formData, auto });
    latest.current = { formData, auto };

    useEffect(() => {
        if (isEdit) return undefined;
        const name = formData.name.trim();
        if (name.length < 3) {
            setSuggestion(null);
            return undefined;
        }
        let cancelled = false;
        const timer = setTimeout(async () => {
            try {
                const guess = await tidyAPI.classify({ name, model: formData.model || '' });
                if (cancelled) return;
                setSuggestion(guess);
                // Judge against the form as it is now, not as it was when
                // the lookup started.
                const now = latest.current;
                const values = {
                    category_id: guess.category?.id || '',
                    brand: guess.brand || '',
                    campus: guess.electronic ? guess.home_campus : ''
                };
                const patch = {};
                const filled = {};
                for (const field of Object.keys(values)) {
                    if (!now.formData[field] || now.auto[field]) {
                        patch[field] = values[field];
                        filled[field] = Boolean(values[field]);
                    }
                }
                setFormData((prev) => ({ ...prev, ...patch }));
                setAuto((a) => ({ ...a, ...filled }));
            } catch (err) {
                // suggestions are a convenience; the form works without them
            }
        }, 700);
        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [formData.name, formData.model, isEdit]);

    async function handleSubmit(e) {
        e.preventDefault();
        // A category that does not exist yet is created from the suggestion
        // on the server; otherwise one has to be chosen.
        if (!formData.category_id && !suggestion?.category) {
            alert('Choose a category for this asset.');
            return;
        }
        setLoading(true);

        try {
            let newAssetId = id;
            if (isEdit) {
                await assetsAPI.update(id, formData);
            } else {
                const created = await assetsAPI.create(formData);
                newAssetId = created.id;
            }
            if (invoiceFile && newAssetId) {
                try {
                    await documentsAPI.upload(newAssetId, invoiceFile);
                } catch (err) {
                    alert('Asset saved, but the invoice upload failed: ' + err.message +
                        '\nYou can attach it from the asset page.');
                }
            }
            if (!isEdit && newAssetId) {
                // Carry on to "who has it", with the person the link named.
                const who = ['assign_to', 'assign_name', 'assign_email']
                    .filter((key) => query.get(key))
                    .map((key) => `&${key}=${encodeURIComponent(query.get(key))}`).join('');
                navigate(`/assets/${newAssetId}?assign=1${who}`);
            } else {
                navigate('/assets');
            }
        } catch (error) {
            alert('Error saving asset: ' + error.message);
        } finally {
            setLoading(false);
        }
    }

    function handleChange(e) {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
        // Once someone sets a suggested field themselves, leave it alone.
        if (name in auto) setAuto((a) => ({ ...a, [name]: false }));
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
                                >
                                    <option value="">
                                        {suggestion?.category && !suggestion.category.id
                                            ? `${suggestion.category.name} (new category)`
                                            : 'Select Category'}
                                    </option>
                                    {categories.map((cat) => (
                                        <option key={cat.id} value={cat.id}>
                                            {cat.name}
                                        </option>
                                    ))}
                                </select>
                                {!isEdit && suggestion?.category && (auto.category_id || !formData.category_id) && (
                                    <div className="text-muted" style={{ fontSize: '0.85rem' }}>
                                        {suggestion.source === 'ai' ? '✨ Suggested by AI' : 'Suggested from the name'}
                                        {suggestion.sure ? '' : ' — not certain, please check'}. Change it if it is wrong.
                                    </div>
                                )}
                            </div>

                            <div className="form-group">
                                <label className="form-label">Brand</label>
                                <input
                                    type="text"
                                    name="brand"
                                    className="form-control"
                                    list="asset-brands"
                                    placeholder="e.g. HP, Dell, Lenovo"
                                    value={formData.brand}
                                    onChange={handleChange}
                                />
                                <datalist id="asset-brands">
                                    {brands.map((b) => <option key={b} value={b} />)}
                                </datalist>
                            </div>

                            <div className="form-group">
                                <label className="form-label">Model</label>
                                <input
                                    type="text"
                                    name="model"
                                    className="form-control"
                                    list="asset-models"
                                    placeholder="Pick an existing model or type a new one"
                                    value={formData.model}
                                    onChange={handleChange}
                                />
                                <datalist id="asset-models">
                                    {models.map((m) => <option key={m} value={m} />)}
                                </datalist>
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
                                <label className="form-label">Quantity</label>
                                <input
                                    type="number"
                                    name="quantity"
                                    className="form-control"
                                    value={formData.quantity}
                                    min="1"
                                    step="1"
                                    onChange={handleChange}
                                />
                                <div className="text-muted" style={{ fontSize: '0.85rem' }}>
                                    Use quantity for items without serial numbers or bulk inventory.
                                </div>
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
                                <label className="form-label">Invoice (PDF or photo, optional)</label>
                                <input
                                    type="file"
                                    className="form-control"
                                    accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp"
                                    onChange={(e) => setInvoiceFile(e.target.files?.[0] || null)}
                                />
                                {invoiceFile && (
                                    <div className="text-muted" style={{ fontSize: '0.85rem' }}>
                                        Will attach: {invoiceFile.name}
                                    </div>
                                )}
                            </div>

                            <div className="form-group">
                                <label className="form-label">Status</label>
                                <select
                                    name="status"
                                    className="form-control"
                                    value={formData.status}
                                    onChange={handleChange}
                                    disabled={formData.status === 'sold'}
                                >
                                    {/* Set by recording a sale, cleared by undoing it. */}
                                    {formData.status === 'sold' && <option value="sold">Sold</option>}
                                    <option value="available">Available</option>
                                    <option value="assigned">Assigned</option>
                                    <option value="maintenance">Maintenance</option>
                                    <option value="repair">Repair</option>
                                    <option value="damaged">Damaged</option>
                                    <option value="lost">Lost</option>
                                    <option value="stolen">Stolen</option>
                                    <option value="retired">Retired</option>
                                </select>
                                {formData.status === 'sold' && (
                                    <div className="text-muted" style={{ fontSize: '0.85rem' }}>
                                        This asset has been sold. To change its status, undo the sale on the asset's page.
                                    </div>
                                )}
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

                            <div className="form-group">
                                <label className="form-label">Campus</label>
                                <select
                                    name="campus"
                                    className="form-control"
                                    value={addingCampus ? '__new__' : (formData.campus || '')}
                                    onChange={(e) => {
                                        const val = e.target.value;
                                        if (val === '__new__') {
                                            setAddingCampus(true);
                                            setNewCampus('');
                                            return;
                                        }
                                        setAddingCampus(false);
                                        setFormData((prev) => ({ ...prev, campus: val }));
                                        setAuto((a) => ({ ...a, campus: false }));
                                    }}
                                >
                                    <option value="">Unassigned</option>
                                    {campuses.map((c) => (
                                        <option key={c} value={c}>
                                            {c}
                                        </option>
                                    ))}
                                    <option value="__new__">+ Add new campus</option>
                                </select>
                                {!isEdit && suggestion?.electronic && (
                                    <div className="text-muted" style={{ fontSize: '0.85rem' }}>
                                        Electronics with no campus are kept under {suggestion.home_campus} until
                                        they are moved.
                                    </div>
                                )}
                                {addingCampus && (
                                    <div className="flex gap-2 mt-2">
                                        <input
                                            type="text"
                                            className="form-control"
                                            placeholder="Enter campus name"
                                            value={newCampus}
                                            onChange={(e) => setNewCampus(e.target.value)}
                                        />
                                        <button
                                            type="button"
                                            className="btn btn-secondary"
                                            onClick={() => {
                                                if (!newCampus.trim()) return;
                                                setFormData((prev) => ({ ...prev, campus: newCampus.trim() }));
                                                setCampuses((prev) =>
                                                    prev.includes(newCampus.trim()) ? prev : [...prev, newCampus.trim()]
                                                );
                                                setAddingCampus(false);
                                            }}
                                        >
                                            Save
                                        </button>
                                    </div>
                                )}
                            </div>

                            <div className="form-group">
                                <label className="form-label">Supplier</label>
                                <input
                                    type="text"
                                    name="supplier_name"
                                    className="form-control"
                                    value={formData.supplier_name}
                                    onChange={handleChange}
                                    placeholder="Who supplied this item?"
                                />
                            </div>
                        </div>

                        <div className="grid grid-2">
                            <div className="form-group">
                                <label className="form-label">Warranty Period (months)</label>
                                <input
                                    type="number"
                                    name="warranty_period_months"
                                    className="form-control"
                                    min="0"
                                    step="1"
                                    value={formData.warranty_period_months}
                                    onChange={handleChange}
                                    placeholder="e.g., 24"
                                />
                                <div className="text-muted" style={{ fontSize: '0.85rem' }}>
                                    Leave 0 if no warranty.
                                </div>
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

