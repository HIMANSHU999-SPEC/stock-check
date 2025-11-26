import React, { useState, useEffect } from 'react';
import { assetsAPI } from '../services/api';
import QRCode from 'react-qr-code';

export default function TagPrinter() {
    const [assets, setAssets] = useState([]);
    const [selectedAssets, setSelectedAssets] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        loadAssets();
    }, []);

    async function loadAssets() {
        try {
            const data = await assetsAPI.getAll();
            setAssets(data);
        } catch (error) {
            console.error('Error loading assets:', error);
        } finally {
            setLoading(false);
        }
    }

    function toggleAsset(assetId) {
        setSelectedAssets(prev => {
            if (prev.includes(assetId)) {
                return prev.filter(id => id !== assetId);
            } else {
                return [...prev, assetId];
            }
        });
    }

    function selectAll() {
        setSelectedAssets(assets.map(a => a.id));
    }

    function clearSelection() {
        setSelectedAssets([]);
    }

    function handlePrint() {
        window.print();
    }

    const selectedAssetData = assets.filter(a => selectedAssets.includes(a.id));

    if (loading) {
        return <div className="spinner"></div>;
    }

    return (
        <div>
            <div className="no-print">
                <h2>Print Asset Tags</h2>

                <div className="card mb-3">
                    <div className="card-header">
                        <div className="flex justify-between items-center">
                            <h3 className="card-title">Select Assets</h3>
                            <div className="flex gap-2">
                                <button onClick={selectAll} className="btn btn-sm btn-secondary">
                                    Select All
                                </button>
                                <button onClick={clearSelection} className="btn btn-sm btn-secondary">
                                    Clear Selection
                                </button>
                                <button
                                    onClick={handlePrint}
                                    className="btn btn-sm btn-primary"
                                    disabled={selectedAssets.length === 0}
                                >
                                    🖨️ Print {selectedAssets.length} Tag(s)
                                </button>
                            </div>
                        </div>
                    </div>

                    <div className="table-container">
                        <table className="table">
                            <thead>
                                <tr>
                                    <th>
                                        <input
                                            type="checkbox"
                                            checked={selectedAssets.length === assets.length && assets.length > 0}
                                            onChange={(e) => e.target.checked ? selectAll() : clearSelection()}
                                        />
                                    </th>
                                    <th>Asset Number</th>
                                    <th>Name</th>
                                    <th>Category</th>
                                    <th>Status</th>
                                </tr>
                            </thead>
                            <tbody>
                                {assets.map((asset) => (
                                    <tr key={asset.id}>
                                        <td>
                                            <input
                                                type="checkbox"
                                                checked={selectedAssets.includes(asset.id)}
                                                onChange={() => toggleAsset(asset.id)}
                                            />
                                        </td>
                                        <td><strong>{asset.asset_number}</strong></td>
                                        <td>{asset.name}</td>
                                        <td>{asset.category_name || 'N/A'}</td>
                                        <td>
                                            <span className={`badge badge-${getStatusColor(asset.status)}`}>
                                                {asset.status}
                                            </span>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            {selectedAssetData.length > 0 && (
                <div className="print-only">
                    <style>{`
            @media print {
              .no-print {
                display: none !important;
              }
              .print-only {
                display: block !important;
              }
              .asset-tag {
                page-break-inside: avoid;
                break-inside: avoid;
                margin-bottom: 0.5cm;
                border: 2px solid #000;
                padding: 0.5cm;
                width: 8cm;
                height: 5cm;
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                background: white;
                color: black;
              }
              .tag-grid {
                display: grid;
                grid-template-columns: repeat(2, 1fr);
                gap: 0.5cm;
                padding: 1cm;
              }
              body {
                background: white;
              }
            }
            .print-only {
              display: none;
            }
          `}</style>

                    <div className="tag-grid">
                        {selectedAssetData.map((asset) => (
                            <div key={asset.id} className="asset-tag">
                                <div style={{ marginBottom: '0.3cm' }}>
                                    <QRCode value={asset.asset_number} size={120} />
                                </div>
                                <div style={{
                                    fontSize: '16px',
                                    fontWeight: 'bold',
                                    textAlign: 'center',
                                    marginBottom: '0.2cm'
                                }}>
                                    {asset.asset_number}
                                </div>
                                <div style={{
                                    fontSize: '12px',
                                    textAlign: 'center',
                                    marginBottom: '0.1cm'
                                }}>
                                    {asset.name}
                                </div>
                                <div style={{
                                    fontSize: '10px',
                                    textAlign: 'center',
                                    color: '#666'
                                }}>
                                    {asset.category_name}
                                </div>
                                <div style={{
                                    fontSize: '8px',
                                    textAlign: 'center',
                                    marginTop: '0.2cm',
                                    color: '#999'
                                }}>
                                    London Academy for Applied Technology
                                </div>
                            </div>
                        ))}
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
