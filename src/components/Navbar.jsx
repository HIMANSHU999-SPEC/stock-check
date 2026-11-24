import React, { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import ChangePassword from './ChangePassword';

// The menu, grouped so it fits on one line. An entry with `items` is a
// drop-down; `match` lists the path prefixes that light it up.
function buildMenu(user) {
    // Staff who do not run the system see their own assets and nothing else.
    if (user?.role === 'staff') {
        return [{ to: '/my-assets', label: 'My assets' }];
    }
    // View-only accounts: the pages they can read, without the ones that
    // exist to change things.
    if (user?.role === 'viewer' || user?.role === 'inventory') {
        return [
            { to: '/', label: 'Dashboard', exact: true },
            {
                label: 'Assets',
                items: [
                    { to: '/assets', label: 'All assets' },
                    { to: '/inventory', label: 'Inventory' },
                    { to: '/categories', label: 'Categories' }
                ]
            },
            { to: '/scan', label: 'Scan' },
            { to: '/employees', label: 'Employees' },
            {
                label: 'Library',
                items: [
                    { to: '/books', label: 'Books' },
                    { to: '/borrowers', label: 'Borrowers' }
                ]
            },
            { to: '/reports', label: 'Reports' },
            { to: '/my-assets', label: 'My assets' }
        ];
    }
    const isAdmin = user?.role === 'admin';
    const admin = [
        { to: '/staff-reports', label: 'Staff reports' },
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
                { to: '/assets/tidy', label: 'Tidy up' },
                { to: '/intune', label: 'Intune check' },
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
        { label: 'Admin', items: admin },
        { to: '/my-assets', label: 'My assets' }
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
    const [changingPassword, setChangingPassword] = useState(false);
    const navRef = useRef(null);
    const menu = buildMenu(user);
    const roleLabel = { admin: 'Administrator', subadmin: 'Sub-administrator', inventory: 'Viewer + downloads', viewer: 'Viewer' }[user?.role] || 'Staff';

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
                <Link to={user?.role === 'staff' ? '/my-assets' : '/'} className="navbar-brand">
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
                        {user?.can_change_password ? (
                            // The name opens a small menu: a second button beside
                            // "Log out" did not fit on a laptop screen.
                            <div className={`nav-group navbar-account ${openGroup === 'account' ? 'open' : ''}`}>
                                <button
                                    type="button"
                                    className="navbar-user-name navbar-account-btn"
                                    aria-haspopup="true"
                                    aria-expanded={openGroup === 'account'}
                                    title={`${user?.name || user?.email}: your account`}
                                    onClick={() => setOpenGroup(openGroup === 'account' ? null : 'account')}
                                >
                                    <span>
                                        <span className="navbar-user-label">{user?.name || user?.email}</span>
                                        <span className="nav-caret" aria-hidden="true">▾</span>
                                    </span>
                                    <small>{roleLabel}</small>
                                </button>
                                <div className="nav-menu nav-menu-right">
                                    <button
                                        type="button"
                                        onClick={() => { setChangingPassword(true); setOpenGroup(null); setMenuOpen(false); }}
                                    >
                                        Change password
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <div className="navbar-user-name" title={user?.name || user?.email}>
                                <span className="navbar-user-label">{user?.name || user?.email}</span>
                                <small>{roleLabel}</small>
                            </div>
                        )}
                        <button type="button" className="btn btn-sm navbar-logout" onClick={onLogout}>
                            Log out
                        </button>
                    </div>
                </div>
            </div>
            {changingPassword && <ChangePassword onClose={() => setChangingPassword(false)} />}
        </nav>
    );
}
