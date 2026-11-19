import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { inventoryAPI } from '../services/api';

// Dashboard panel: how many of each kind of thing there are. Click a kind
// (Laptop, Desktop…) to split it by make; click a make to see those assets.

// Computers first, whatever the counts; everything else by size.
const LEAD = ['laptop', 'laptops', 'desktop', 'desktops', 'desktop pc', 'pc', 'pcs'];
const SHOWN_AT_FIRST = 8;

function assetsLink(group, brand) {
    const params = new URLSearchParams();
    params.set('category', group.category_id === null ? '__none__' : group.category_id);
    if (brand !== undefined) params.set('brand', brand === '' ? 'Unspecified' : brand);
    return `/assets?${params}`;
}

export default function DeviceBreakdown() {
    const [groups, setGroups] = useState(null);
    const [openKey, setOpenKey] = useState(null);
    const [showAll, setShowAll] = useState(false);

    useEffect(() => {
        inventoryAPI.categories()
            .then((data) => {
                const rank = (g) => {
                    const i = LEAD.indexOf(String(g.category).toLowerCase());
                    return i === -1 ? LEAD.length : i;
                };
                const sorted = [...data].sort((a, b) => rank(a) - rank(b) || b.total - a.total);
                setGroups(sorted);
            })
            .catch(() => setGroups([]));
    }, []);

    if (!groups || groups.length === 0) return null;

    const keyOf = (g) => (g.category_id === null ? 'none' : String(g.category_id));
    const open = groups.find((g) => keyOf(g) === openKey);
    // Keep the open tile visible even if it is past the fold.
    const visible = showAll ? groups : groups.filter((g, i) => i < SHOWN_AT_FIRST || keyOf(g) === openKey);
    const largest = open ? Math.max(1, ...open.brands.map((b) => b.total)) : 1;
    const unbranded = open ? open.brands.find((b) => b.brand === '') : null;

    return (
        <div className="card">
            <div className="card-header">
                <div className="flex justify-between items-center" style={{ flexWrap: 'wrap', gap: '0.5rem' }}>
                    <h3 className="card-title">What we have</h3>
                    <span className="text-muted" style={{ fontSize: '0.9rem' }}>
                        Click a type to split it by brand
                    </span>
                </div>
            </div>

            <div className="device-tiles">
                {visible.map((group) => {
                    const key = keyOf(group);
                    return (
                        <button
                            key={key}
                            type="button"
                            className={`device-tile ${key === openKey ? 'active' : ''}`}
                            onClick={() => setOpenKey(key === openKey ? null : key)}
                            aria-expanded={key === openKey}
                        >
                            <span className="device-count">{group.total.toLocaleString()}</span>
                            <span className="device-name">{group.category}</span>
                            <span className="device-sub">
                                {group.assigned} assigned · {group.available} available
                            </span>
                        </button>
                    );
                })}
            </div>

            {groups.length > SHOWN_AT_FIRST && (
                <button type="button" className="btn btn-sm btn-secondary mt-2" onClick={() => setShowAll((v) => !v)}>
                    {showAll ? 'Show fewer' : `Show all ${groups.length} types`}
                </button>
            )}

            {open && (
                <div className="device-brands">
                    <div className="flex justify-between items-center mb-2" style={{ flexWrap: 'wrap', gap: '0.5rem' }}>
                        <strong>
                            {open.category} by brand
                        </strong>
                        <Link to={assetsLink(open)} className="btn btn-sm btn-secondary">
                            View all {open.total.toLocaleString()} →
                        </Link>
                    </div>

                    {open.brands.map((b) => (
                        <Link key={b.brand || '__none__'} to={assetsLink(open, b.brand)} className="brand-row">
                            <span className="brand-name">{b.brand || 'No brand recorded'}</span>
                            <span className="brand-bar">
                                <span style={{ width: `${Math.max(2, Math.round((b.total / largest) * 100))}%` }} />
                            </span>
                            <span className="brand-count">{b.total.toLocaleString()}</span>
                            <span className="brand-sub">
                                {b.assigned} assigned · {b.available} available
                            </span>
                        </Link>
                    ))}

                    {unbranded && (
                        <p className="write-only text-muted mt-2" style={{ fontSize: '0.9rem' }}>
                            {unbranded.total} with no brand recorded.{' '}
                            <Link to="/assets/tidy" className="text-primary">Fill brands in automatically</Link>
                        </p>
                    )}
                </div>
            )}
        </div>
    );
}
