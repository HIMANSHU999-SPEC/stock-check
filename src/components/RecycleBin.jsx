import React, { useEffect, useState } from 'react';
import { assetsAPI } from '../services/api';

export default function RecycleBin() {
    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(true);
    const [password, setPassword] = useState('');
    const [restoringId, setRestoringId] = useState(null);

    useEffect(() => {
        loadBin();
    }, []);

    async function loadBin() {
        try {
            setLoading(true);
            const data = await assetsAPI.recycleBin.list();
            setItems(data);
        } catch (error) {
            alert('Failed to load recycle bin: ' + error.message);
        } finally {
            setLoading(false);
        }
    }

    async function handleRestore(entityId) {
        if (!password) {
            alert('Enter the recycle bin password to restore.');
            return;
        }
        setRestoringId(entityId);
        try {
            await assetsAPI.restore(entityId, password);
            await loadBin();
            alert('Restored successfully');
        } catch (error) {
            alert('Restore failed: ' + error.message);
        } finally {
            setRestoringId(null);
        }
    }

    return (
        <div>
            <div className="flex justify-between items-center mb-3">
                <h2>Recycle Bin (90-day retention)</h2>
                <div className="flex items-center gap-2">
                    <input
                        type="password"
                        className="form-control"
                        placeholder="Recycle bin password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        style={{ width: '220px' }}
                    />
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
                                    <th>Asset #</th>
                                    <th>Name</th>
                                    <th>Campus</th>
                                    <th>Supplier</th>
                                    <th>Deleted At</th>
                                    <th>Restore Until</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {items.length === 0 ? (
                                    <tr>
                                        <td colSpan="7" className="text-center text-muted">
                                            No items in recycle bin
                                        </td>
                                    </tr>
                                ) : (
                                    items.map((item) => (
                                        <tr key={item.id}>
                                            <td>{item.asset_number || item.entity_id}</td>
                                            <td>{item.name || '-'}</td>
                                            <td>{item.campus || 'N/A'}</td>
                                            <td>{item.supplier_name || 'N/A'}</td>
                                            <td>{item.deleted_at}</td>
                                            <td>{item.can_restore_until}</td>
                                            <td>
                                                <button
                                                    className="btn btn-sm btn-primary"
                                                    onClick={() => handleRestore(item.entity_id)}
                                                    disabled={restoringId === item.entity_id}
                                                >
                                                    {restoringId === item.entity_id ? 'Restoring...' : 'Restore'}
                                                </button>
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

