import React, { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';

// The menu, grouped so it fits on one line. An entry with `items` is a
// drop-down; `match` lists the path prefixes that light it up.
function buildMenu(user) {
    const isAdmin = user?.role === 'admin';
    const admin = [
        { to: '/activity', label: 'Activity' },
        ...(isAdmin ? [{ to: '/users', label: 'Users' }, { to: '/settings', label: 'Settings' }] : [])
    ];

    return [
        { to: '/', label: 'Dashboard', exact: true },
        {
            label: 'Assets',
            items: [
                { to: '/assets', label: 'All assets' },
                { to: '/inventory', label: 'Inventory' },
                { to: '/categories', label: 'Categories' },
                { to: '/tags', label: 'Print stickers' },
                { to: '/recycle-bin', label: 'Recycle bin' }
            ]
        },
        { to: '/scan', label: 'Scan' },
        { to: '/employees', label: 'Employees' },
        {
            label: 'Library',
            items: [
                { to: '/books', label: 'Books' },
                { to: '/borrowers', label: 'Borrowers' },
                { to: '/library/issue', label: 'Issue desk' }
            ]
        },
        { to: '/reports', label: 'Reports' },
        // With only one entry there is nothing to drop down.
        admin.length > 1 ? { label: 'Admin', items: admin } : admin[0]
    ];
}

function matches(pathname, entry) {
    if (entry.exact) return pathname === entry.to;
    return pathname === entry.to || pathname.startsWith(`${entry.to}/`);
}

export default function Navbar({ user, onLogout, license }) {
    const location = useLocation();
    const [openGroup, setOpenGroup] = useState(null);
    const [menuOpen, setMenuOpen] = useState(false);
    const navRef = useRef(null);
    const menu = buildMenu(user);

    // Moving to another page closes whatever was open.
    useEffect(() => {
        setOpenGroup(null);
        setMenuOpen(false);
    }, [location.pathname]);

    // So does clicking elsewhere or pressing Escape.
    useEffect(() => {
        function onPointer(e) {
            if (navRef.current && !navRef.current.contains(e.target)) setOpenGroup(null);
        }
        function onKey(e) {
            if (e.key === 'Escape') {
                setOpenGroup(null);
                setMenuOpen(false);
            }
        }
        document.addEventListener('mousedown', onPointer);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('mousedown', onPointer);
            document.removeEventListener('keydown', onKey);
        };
    }, []);

    return (
        <nav className="navbar" ref={navRef}>
            <div className="container navbar-content">
                <Link to="/" className="navbar-brand">
                    <img
                        src="/laat-shield.png"
                        alt="London Academy for Applied Technology"
                        onError={(e) => { e.currentTarget.style.display = 'none'; }}
                    />
                    <div>
                        <h1>Stock Management System</h1>
                        <div className="navbar-subtitle">
                            London Academy for Applied Technology — Built by JH Infotech
                        </div>
                    </div>
                </Link>

                <button
                    type="button"
                    className="navbar-toggle"
                    aria-label="Menu"
                    aria-expanded={menuOpen}
                    onClick={() => setMenuOpen((v) => !v)}
                >
                    <span></span><span></span><span></span>
                </button>

                <div className={`navbar-collapse ${menuOpen ? 'open' : ''}`}>
                    <ul className="navbar-nav">
                        {menu.map((entry) => {
                            if (!entry.items) {
                                return (
                                    <li key={entry.to}>
                                        <Link
                                            to={entry.to}
                                            className={`nav-link ${matches(location.pathname, entry) ? 'active' : ''}`}
                                        >
                                            {entry.label}
                                        </Link>
                                    </li>
                                );
                            }
                            const active = entry.items.some((item) => matches(location.pathname, item));
                            const open = openGroup === entry.label;
                            return (
                                <li key={entry.label} className={`nav-group ${open ? 'open' : ''}`}>
                                    <button
                                        type="button"
                                        className={`nav-link nav-group-btn ${active ? 'active' : ''}`}
                                        aria-haspopup="true"
                                        aria-expanded={open}
                                        onClick={() => setOpenGroup(open ? null : entry.label)}
                                    >
                                        {entry.label}
                                        <span className="nav-caret" aria-hidden="true">▾</span>
                                    </button>
                                    <div className="nav-menu">
                                        {entry.items.map((item) => (
                                            <Link
                                                key={item.to}
                                                to={item.to}
                                                className={matches(location.pathname, item) ? 'active' : ''}
                                            >
                                                {item.label}
                                            </Link>
                                        ))}
                                    </div>
                                </li>
                            );
                        })}
                    </ul>

                    <div className="navbar-user">
                        {license?.expired && <span className="badge badge-danger">Licence expired</span>}
                        <div className="navbar-user-name">
                            <span>{user?.name || user?.email}</span>
                            <small>{user?.role === 'admin' ? 'Administrator' : 'Sub-administrator'}</small>
                        </div>
                        <button type="button" className="btn btn-sm navbar-logout" onClick={onLogout}>
                            Log out
                        </button>
                    </div>
                </div>
            </div>
        </nav>
    );
}
