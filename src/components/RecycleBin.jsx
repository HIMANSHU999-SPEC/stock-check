import React, { useEffect, useState } from 'react';
import { assetsAPI } from '../services/api';
import { formatDateTime } from '../utils/dates';

export default function RecycleBin() {
    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(true);
    // Whether the server wants a password, and whether this account may restore.
    const [rules, setRules] = useState({ password_required: false, can_restore: true });
    const [password, setPassword] = useState('');
    const [restoringId, setRestoringId] = useState(null);
    const [notice, setNotice] = useState(null); // { type: 'success' | 'danger', text }

    useEffect(() => {
        loadBin();
        assetsAPI.recycleBin.rules().then(setRules).catch(() => {});
    }, []);

    async function loadBin() {
        try {
            setLoading(true);
            setItems(await assetsAPI.recycleBin.list());
        } catch (error) {
            setNotice({ type: 'danger', text: 'The recycle bin could not be loaded: ' + error.message });
        } finally {
            setLoading(false);
        }
    }

    async function handleRestore(item) {
        if (rules.password_required && !password) {
            setNotice({ type: 'danger', text: 'Enter the recycle bin password, then press Restore.' });
            return;
        }
        setRestoringId(item.entity_id);
        try {
            await assetsAPI.restore(item.entity_id, password);
            await loadBin();
            setNotice({ type: 'success', text: `${item.asset_number || 'The asset'} has been restored and is back in the asset list.` });
        } catch (error) {
            setNotice({ type: 'danger', text: 'It could not be restored: ' + error.message });
        } finally {
            setRestoringId(null);
        }
    }

    return (
        <div>
            <div className="flex justify-between items-center mb-3">
                <h2>Recycle Bin</h2>
                {rules.password_required && (
                    <div className="flex items-center gap-2">
                        <input
                            type="password"
                            className="form-control"
                            placeholder="Recycle bin password"
                            aria-label="Recycle bin password"
                            autoComplete="off"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            style={{ width: '220px' }}
                        />
                    </div>
                )}
            </div>

            <p className="text-muted mb-3">
                Deleted assets are kept here with their full history and can be restored at any time.
                Nothing is removed automatically.
                {rules.password_required && ' Restoring needs the recycle bin password.'}
                {!rules.can_restore && ' Only an administrator can restore.'}
            </p>

            {notice && (
                <div className={`alert alert-${notice.type} flex justify-between items-center`}>
                    <span>{notice.text}</span>
                    <button type="button" className="btn btn-sm btn-secondary" onClick={() => setNotice(null)}>Dismiss</button>
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
                                    <th>Asset #</th>
                                    <th>Name</th>
                                    <th>Campus</th>
                                    <th>Supplier</th>
                                    <th>Deleted</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {items.length === 0 ? (
                                    <tr>
                                        <td colSpan="6" className="text-center text-muted">
                                            The recycle bin is empty
                                        </td>
                                    </tr>
                                ) : (
                                    items.map((item) => (
                                        <tr key={item.id}>
                                            <td>{item.asset_number || item.entity_id}</td>
                                            <td>{item.name || '-'}</td>
                                            <td>{item.campus || 'N/A'}</td>
                                            <td>{item.supplier_name || 'N/A'}</td>
                                            <td style={{ whiteSpace: 'nowrap' }}>{formatDateTime(item.deleted_at)}</td>
                                            <td>
                                                {rules.can_restore ? (
                                                    <button
                                                        className="btn btn-sm btn-primary"
                                                        onClick={() => handleRestore(item)}
                                                        disabled={restoringId === item.entity_id}
                                                    >
                                                        {restoringId === item.entity_id ? 'Restoring...' : 'Restore'}
                                                    </button>
                                                ) : (
                                                    <span className="text-muted">Administrator only</span>
                                                )}
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
