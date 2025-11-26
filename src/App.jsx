import React from 'react';
import { BrowserRouter as Router, Routes, Route, Link, useLocation, Navigate } from 'react-router-dom';
import Dashboard from './components/Dashboard';
import AssetList from './components/AssetList';
import AssetDetails from './components/AssetDetails';
import AssetForm from './components/AssetForm';
import EmployeeList from './components/EmployeeList';
import CategoryManagement from './components/CategoryManagement';
import Reports from './components/Reports';
import TagPrinter from './components/TagPrinter';
import Login from './components/Login';
import { authAPI, saveAuthToken, clearAuthToken } from './services/api';
import './index.css';

function Navbar({ user, onLogout, license }) {
    const location = useLocation();
    const [darkMode, setDarkMode] = React.useState(true);

    React.useEffect(() => {
        if (darkMode) {
            document.body.classList.remove('light-mode');
        } else {
            document.body.classList.add('light-mode');
        }
    }, [darkMode]);

    const isActive = (path) => location.pathname === path;

    return (
        <nav className="navbar">
            <div className="container navbar-content">
                <div className="navbar-brand">
                    <h1>Stock Management System</h1>
                    <div className="navbar-subtitle">
                        London Academy for Applied Technology — Built by JH Infotech
                    </div>
                </div>
                <ul className="navbar-nav">
                    <li>
                        <Link to="/" className={`nav-link ${isActive('/') ? 'active' : ''}`}>
                            Dashboard
                        </Link>
                    </li>
                    <li>
                        <Link to="/assets" className={`nav-link ${isActive('/assets') ? 'active' : ''}`}>
                            Assets
                        </Link>
                    </li>
                    <li>
                        <Link to="/employees" className={`nav-link ${isActive('/employees') ? 'active' : ''}`}>
                            Employees
                        </Link>
                    </li>
                    <li>
                        <Link to="/categories" className={`nav-link ${isActive('/categories') ? 'active' : ''}`}>
                            Categories
                        </Link>
                    </li>
                    <li>
                        <Link to="/reports" className={`nav-link ${isActive('/reports') ? 'active' : ''}`}>
                            Reports
                        </Link>
                    </li>
                    <li>
                        <Link to="/tags" className={`nav-link ${isActive('/tags') ? 'active' : ''}`}>
                            Print Tags
                        </Link>
                    </li>
                    <li>
                        <button
                            className="theme-toggle"
                            onClick={() => setDarkMode(!darkMode)}
                            title="Toggle theme"
                        >
                            {darkMode ? 'Dark' : 'Light'}
                        </button>
                    </li>
                    {user ? (
                        <>
                            <li className="text-muted" style={{ padding: '0 0.5rem' }}>
                                {user.name} ({user.role})
                            </li>
                            <li>
                                <button className="btn btn-sm btn-secondary" onClick={onLogout}>
                                    Logout
                                </button>
                            </li>
                        </>
                    ) : (
                        <li>
                            <Link to="/login" className="btn btn-sm btn-secondary">
                                Login
                            </Link>
                        </li>
                    )}
                    {license?.expired && (
                        <li>
                            <span className="badge badge-danger">License expired</span>
                        </li>
                    )}
                </ul>
            </div>
        </nav>
    );
}

function Footer() {
    return (
        <footer className="footer">
            <div className="container">
                <p className="footer-text">
                    © 2025 London Academy for Applied Technology — Developed by{' '}
                    <span className="footer-link">JH Infotech</span>
                </p>
            </div>
        </footer>
    );
}

function ProtectedRoute({ user, license, authLoading, children }) {
    if (authLoading) {
        return <div className="spinner"></div>;
    }

    if (!license || license.expired) {
        return <Navigate to="/login" replace />;
    }

    if (!user) {
        return <Navigate to="/login" replace />;
    }

    return children;
}

function App() {
    const [user, setUser] = React.useState(null);
    const [license, setLicense] = React.useState(null);
    const [authLoading, setAuthLoading] = React.useState(true);

    React.useEffect(() => {
        async function bootstrap() {
            try {
                const lic = await authAPI.license();
                setLicense(lic);

                const storedToken = typeof localStorage !== 'undefined' ? localStorage.getItem('auth_token') : null;
                if (storedToken) {
                    const me = await authAPI.me();
                    setUser(me.user);
                }
            } catch (error) {
                console.error('Auth bootstrap failed', error);
            } finally {
                setAuthLoading(false);
            }
        }
        bootstrap();
    }, []);

    async function handleLogin(email, password) {
        const res = await authAPI.login(email, password);
        saveAuthToken(res.token);
        setUser(res.user);
        const lic = await authAPI.license();
        setLicense(lic);
        return res;
    }

    async function handleActivate(code) {
        const res = await authAPI.activate(code);
        if (res.license) setLicense(res.license);
        return res;
    }

    function handleLogout() {
        clearAuthToken();
        setUser(null);
    }

    return (
        <Router>
            <div className="app">
                <Navbar user={user} onLogout={handleLogout} license={license} />
                <main className="main-content">
                    <div className="container">
                        <Routes>
                            <Route
                                path="/login"
                                element={
                                    <Login
                                        onLogin={handleLogin}
                                        onActivate={handleActivate}
                                        license={license}
                                        authLoading={authLoading}
                                    />
                                }
                            />
                            <Route
                                path="/"
                                element={
                                    <ProtectedRoute user={user} license={license} authLoading={authLoading}>
                                        <Dashboard />
                                    </ProtectedRoute>
                                }
                            />
                            <Route
                                path="/assets"
                                element={
                                    <ProtectedRoute user={user} license={license} authLoading={authLoading}>
                                        <AssetList />
                                    </ProtectedRoute>
                                }
                            />
                            <Route
                                path="/assets/new"
                                element={
                                    <ProtectedRoute user={user} license={license} authLoading={authLoading}>
                                        <AssetForm />
                                    </ProtectedRoute>
                                }
                            />
                            <Route
                                path="/assets/:id"
                                element={
                                    <ProtectedRoute user={user} license={license} authLoading={authLoading}>
                                        <AssetDetails />
                                    </ProtectedRoute>
                                }
                            />
                            <Route
                                path="/assets/:id/edit"
                                element={
                                    <ProtectedRoute user={user} license={license} authLoading={authLoading}>
                                        <AssetForm />
                                    </ProtectedRoute>
                                }
                            />
                            <Route
                                path="/employees"
                                element={
                                    <ProtectedRoute user={user} license={license} authLoading={authLoading}>
                                        <EmployeeList />
                                    </ProtectedRoute>
                                }
                            />
                            <Route
                                path="/categories"
                                element={
                                    <ProtectedRoute user={user} license={license} authLoading={authLoading}>
                                        <CategoryManagement />
                                    </ProtectedRoute>
                                }
                            />
                            <Route
                                path="/reports"
                                element={
                                    <ProtectedRoute user={user} license={license} authLoading={authLoading}>
                                        <Reports />
                                    </ProtectedRoute>
                                }
                            />
                            <Route
                                path="/tags"
                                element={
                                    <ProtectedRoute user={user} license={license} authLoading={authLoading}>
                                        <TagPrinter />
                                    </ProtectedRoute>
                                }
                            />
                        </Routes>
                    </div>
                </main>
                <Footer />
            </div>
        </Router>
    );
}

export default App;
