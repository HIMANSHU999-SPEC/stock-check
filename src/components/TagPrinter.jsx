import React, { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { assetsAPI, reportsAPI, settingsAPI } from '../services/api';
import { assetScanUrl, statusColor } from '../utils/scan';
import QRCode from 'react-qr-code';

// Sticker stock the printer knows how to lay out. Sheet formats tile an A4
// page; roll formats print one sticker per page on a label printer.
const FORMATS = {
    'a4-21': {
        label: 'A4 sheet — 21 per page (63.5 × 38.1 mm, Avery L7160)',
        page: 'A4 portrait', pageMargin: '15.1mm 7.2mm 0 7.2mm',
        width: 63.5, height: 38.1, columns: 3, perPage: 21, columnGap: 2.5, qr: 27, detail: 'full'
    },
    'a4-65': {
        label: 'A4 sheet — 65 per page (38.1 × 21.2 mm, Avery L7651)',
        page: 'A4 portrait', pageMargin: '10.7mm 4.7mm 0 4.7mm',
        width: 38.1, height: 21.2, columns: 5, perPage: 65, columnGap: 2.5, qr: 16, detail: 'minimal'
    },
    'roll-62x29': {
        label: 'Label printer — 62 × 29 mm (Brother DK-11209)',
        page: '62mm 29mm', pageMargin: '0',
        width: 62, height: 29, columns: 1, perPage: 1, columnGap: 0, qr: 23, detail: 'full'
    },
    'roll-50x25': {
        label: 'Label printer — 50 × 25 mm (Zebra / Dymo / generic thermal)',
        page: '50mm 25mm', pageMargin: '0',
        width: 50, height: 25, columns: 1, perPage: 1, columnGap: 0, qr: 20, detail: 'compact'
    }
};
const FORMAT_KEY = 'sticker_format';

function Sticker({ asset, format, baseUrl, orgName, contact }) {
    const compact = format.detail !== 'full';
    return (
        <div className="sticker" style={{ width: `${format.width}mm`, height: `${format.height}mm` }}>
            <QRCode
                value={assetScanUrl(baseUrl, asset.asset_number)}
                size={256}
                level="M"
                style={{ width: `${format.qr}mm`, height: `${format.qr}mm`, flex: 'none' }}
            />
            <div className="sticker-text">
                {format.detail !== 'minimal' && <div className="sticker-org">{orgName}</div>}
                <div className="sticker-number" style={{ fontSize: format.detail === 'minimal' ? '7pt' : '10pt' }}>
                    {asset.asset_number}
                </div>
                {format.detail !== 'minimal' && <div className="sticker-name">{asset.name}</div>}
                {!compact && asset.serial_number && <div className="sticker-line">S/N {asset.serial_number}</div>}
                {!compact && asset.campus && <div className="sticker-line">{asset.campus}</div>}
                {!compact && contact && <div className="sticker-foot">If found: {contact}</div>}
            </div>
        </div>
    );
}

export default function TagPrinter() {
    const location = useLocation();
    const [assets, setAssets] = useState([]);
    const [categories, setCategories] = useState([]);
    const [selected, setSelected] = useState(() => new Set());
    const [filters, setFilters] = useState({ search: '', campus: '', category: '', status: '' });
    const [formatKey, setFormatKey] = useState(() => {
        const saved = typeof localStorage !== 'undefined' ? localStorage.getItem(FORMAT_KEY) : null;
        return FORMATS[saved] ? saved : 'a4-21';
    });
    const [perUnit, setPerUnit] = useState(false);
    const [skip, setSkip] = useState(0);
    const [settings, setSettings] = useState({ app_base_url: '', org_name: '', mail: {} });
    const [loading, setLoading] = useState(true);

    const format = FORMATS[formatKey];
    const isSheet = format.perPage > 1;

    useEffect(() => {
        async function load() {
            try {
                const [assetData, categoryData] = await Promise.all([
                    assetsAPI.getAll(),
                    reportsAPI.getCategories().catch(() => [])
                ]);
                setAssets(assetData);
                setCategories(categoryData);
                // "Print sticker" on an asset page arrives with ?ids=…
                const ids = (new URLSearchParams(location.search).get('ids') || '')
                    .split(',').map((v) => parseInt(v, 10)).filter(Boolean);
                if (ids.length) setSelected(new Set(ids));
            } catch (error) {
                console.error('Error loading assets:', error);
            } finally {
                setLoading(false);
            }
        }
        load();
        settingsAPI.getPublic().then(setSettings).catch(() => {});
    }, []);

    function chooseFormat(key) {
        setFormatKey(key);
        try { localStorage.setItem(FORMAT_KEY, key); } catch (e) { /* preference only */ }
    }

    const campuses = useMemo(
        () => [...new Set(assets.map((a) => (a.campus || '').trim()).filter(Boolean))].sort(),
        [assets]
    );

    const visible = useMemo(() => {
        const term = filters.search.trim().toLowerCase();
        return assets.filter((a) => {
            if (filters.campus && (a.campus || '').trim() !== filters.campus) return false;
            if (filters.category && `${a.category_id}` !== filters.category) return false;
            if (filters.status && a.status !== filters.status) return false;
            if (!term) return true;
            return [a.asset_number, a.name, a.serial_number, a.model, a.holders]
                .some((v) => (v || '').toLowerCase().includes(term));
        });
    }, [assets, filters]);

    function toggle(id) {
        setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    }

    const allVisibleSelected = visible.length > 0 && visible.every((a) => selected.has(a.id));

    function toggleAllVisible(checked) {
        setSelected((prev) => {
            const next = new Set(prev);
            visible.forEach((a) => (checked ? next.add(a.id) : next.delete(a.id)));
            return next;
        });
    }

    // One sticker per asset line, or one per physical unit for bulk stock.
    const stickers = useMemo(() => {
        const list = [];
        assets.filter((a) => selected.has(a.id)).forEach((asset) => {
            const copies = perUnit ? Math.min(asset.quantity || 1, 500) : 1;
            for (let i = 0; i < copies; i += 1) list.push({ key: `${asset.id}-${i}`, asset });
        });
        return list;
    }, [assets, selected, perUnit]);

    const blanks = isSheet ? Math.min(Math.max(0, skip), format.perPage - 1) : 0;
    const pages = isSheet ? Math.ceil((stickers.length + blanks) / format.perPage) : stickers.length;

    if (loading) {
        return <div className="spinner"></div>;
    }

    return (
        <div className="tag-printer">
            <style>{`
              .sticker-sheet {
                display: grid;
                grid-template-columns: repeat(${format.columns}, ${format.width}mm);
                column-gap: ${format.columnGap}mm;
                row-gap: 0;
                width: max-content;
              }
              @media print {
                @page { size: ${format.page}; margin: ${format.pageMargin}; }
                .navbar, .footer, .no-print { display: none !important; }
                .main-content, .container { padding: 0 !important; margin: 0 !important; max-width: none !important; }
                .sticker-preview { border: none !important; padding: 0 !important; overflow: visible !important; background: none !important; }
                .sticker { outline: none !important; ${isSheet ? '' : 'break-after: page;'} }
              }
            `}</style>

            <div className="no-print">
                <h2>Print Stickers</h2>
                <p className="text-muted mb-3">
                    Each sticker carries a QR code that opens the asset when scanned with a phone camera or a
                    handheld scanner. Stick it on the device, then use <strong>Scan</strong> to look it up, assign
                    it or book it back in.
                </p>

                <div className="card mb-3">
                    <div className="card-body">
                        <div className="grid grid-2">
                            <div className="form-group">
                                <label className="form-label">Sticker type</label>
                                <select className="form-control" value={formatKey} onChange={(e) => chooseFormat(e.target.value)}>
                                    {Object.entries(FORMATS).map(([key, f]) => (
                                        <option key={key} value={key}>{f.label}</option>
                                    ))}
                                </select>
                            </div>
                            <div className="form-group">
                                <label className="form-label">Options</label>
                                <label className="flex items-center gap-1">
                                    <input type="checkbox" checked={perUnit} onChange={(e) => setPerUnit(e.target.checked)} />
                                    <span>One sticker per unit for bulk items (e.g. 40 chairs → 40 stickers)</span>
                                </label>
                                {isSheet && (
                                    <label className="flex items-center gap-1 mt-1">
                                        <span>Skip</span>
                                        <input
                                            type="number" className="form-control" style={{ width: '5rem' }}
                                            min="0" max={format.perPage - 1} value={skip}
                                            onChange={(e) => setSkip(parseInt(e.target.value, 10) || 0)}
                                        />
                                        <span>already-used labels on the first sheet</span>
                                    </label>
                                )}
                            </div>
                        </div>
                        <div className="flex justify-between items-center" style={{ flexWrap: 'wrap', gap: '0.5rem' }}>
                            <span className="text-muted">
                                {stickers.length === 0
                                    ? 'Select the assets to print below.'
                                    : `${stickers.length} sticker(s) on ${pages} ${isSheet ? 'sheet(s)' : 'label(s)'}. In the print dialog choose "Actual size" / 100% scale and no headers or footers.`}
                            </span>
                            <button onClick={() => window.print()} className="btn btn-primary" disabled={stickers.length === 0}>
                                Print {stickers.length || ''} sticker{stickers.length === 1 ? '' : 's'}
                            </button>
                        </div>
                    </div>
                </div>

                <div className="card mb-3">
                    <div className="card-header">
                        <div className="flex justify-between items-center" style={{ flexWrap: 'wrap', gap: '0.5rem' }}>
                            <h3 className="card-title">Select Assets ({selected.size} selected)</h3>
                            <div className="flex gap-2">
                                <button onClick={() => toggleAllVisible(true)} className="btn btn-sm btn-secondary">
                                    Select all shown ({visible.length})
                                </button>
                                <button onClick={() => setSelected(new Set())} className="btn btn-sm btn-secondary">
                                    Clear
                                </button>
                            </div>
                        </div>
                    </div>
                    <div className="grid grid-4 mb-2">
                        <input
                            type="text" className="form-control" placeholder="Search number, name, serial, holder…"
                            value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })}
                        />
                        <select className="form-control" value={filters.campus} onChange={(e) => setFilters({ ...filters, campus: e.target.value })}>
                            <option value="">All campuses</option>
                            {campuses.map((c) => <option key={c} value={c}>{c}</option>)}
                        </select>
                        <select className="form-control" value={filters.category} onChange={(e) => setFilters({ ...filters, category: e.target.value })}>
                            <option value="">All categories</option>
                            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                        <select className="form-control" value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
                            <option value="">All statuses</option>
                            {['available', 'assigned', 'maintenance', 'repair', 'damaged', 'lost', 'stolen', 'retired'].map((s) => (
                                <option key={s} value={s}>{s}</option>
                            ))}
                        </select>
                    </div>

                    <div className="table-container" style={{ maxHeight: '22rem', overflowY: 'auto' }}>
                        <table className="table">
                            <thead>
                                <tr>
                                    <th>
                                        <input
                                            type="checkbox"
                                            checked={allVisibleSelected}
                                            onChange={(e) => toggleAllVisible(e.target.checked)}
                                            aria-label="Select all shown"
                                        />
                                    </th>
                                    <th>Asset Number</th>
                                    <th>Name</th>
                                    <th>Category</th>
                                    <th>Campus</th>
                                    <th>Qty</th>
                                    <th>Status</th>
                                </tr>
                            </thead>
                            <tbody>
                                {visible.length === 0 ? (
                                    <tr><td colSpan="7" className="text-center text-muted">No assets match</td></tr>
                                ) : visible.map((asset) => (
                                    <tr key={asset.id} onClick={() => toggle(asset.id)} style={{ cursor: 'pointer' }}>
                                        <td>
                                            <input
                                                type="checkbox"
                                                checked={selected.has(asset.id)}
                                                onChange={() => toggle(asset.id)}
                                                onClick={(e) => e.stopPropagation()}
                                            />
                                        </td>
                                        <td><strong>{asset.asset_number}</strong></td>
                                        <td>{asset.name}</td>
                                        <td>{asset.category_name || 'N/A'}</td>
                                        <td>{asset.campus || '—'}</td>
                                        <td>{asset.quantity || 1}</td>
                                        <td>
                                            <span className={`badge badge-${statusColor(asset.status)}`}>{asset.status}</span>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>

                {stickers.length > 0 && <h3 className="card-title mb-2">Preview (actual size)</h3>}
            </div>

            {stickers.length > 0 && (
                <div className="sticker-preview">
                    <div className="sticker-sheet">
                        {Array.from({ length: blanks }).map((_, i) => (
                            <div key={`blank-${i}`} style={{ width: `${format.width}mm`, height: `${format.height}mm` }} />
                        ))}
                        {stickers.map(({ key, asset }) => (
                            <Sticker
                                key={key}
                                asset={asset}
                                format={format}
                                baseUrl={settings.app_base_url}
                                orgName={settings.org_name}
                                contact={settings.mail?.from}
                            />
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
