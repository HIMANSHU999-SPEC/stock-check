import React from 'react';
import { BrowserRouter as Router, Routes, Route, Link, useLocation, useNavigate, Navigate } from 'react-router-dom';
import Dashboard from './components/Dashboard';
import AssetList from './components/AssetList';
import AssetDetails from './components/AssetDetails';
import AssetForm from './components/AssetForm';
import EmployeeList from './components/EmployeeList';
import CategoryManagement from './components/CategoryManagement';
import Reports from './components/Reports';
import TagPrinter from './components/TagPrinter';
import Login from './components/Login';
import EmployeeDetails from './components/EmployeeDetails';
import RecycleBin from './components/RecycleBin';
import BookList from './components/BookList';
import BookForm from './components/BookForm';
import BookDetails from './components/BookDetails';
import BorrowerList from './components/BorrowerList';
import IssueDesk from './components/IssueDesk';
import BookTagPrinter from './components/BookTagPrinter';
import UserManagement from './components/UserManagement';
import ActivityLog from './components/ActivityLog';
import RapidCatalogue from './components/RapidCatalogue';
import InvoiceImport from './components/InvoiceImport';
import Inventory from './components/Inventory';
import Scan from './components/Scan';
import Settings from './components/Settings';
import SsoComplete from './components/SsoComplete';
import { authAPI, saveAuthToken, clearAuthToken } from './services/api';
import './index.css';

function Navbar({ user, onLogout, license }) {
    const location = useLocation();

    const isActive = (path) => location.pathname === path;

    return (
        <nav className="navbar">
            <div className="container navbar-content">
                <div className="navbar-brand">
                    <img
                        src="/laat-logo.png"
                        alt="London Academy for Applied Technology"
                        style={{ height: '40px', width: 'auto', background: '#fff', borderRadius: '6px', padding: '3px' }}
                        onError={(e) => { e.currentTarget.style.display = 'none'; }}
                    />
                    <div>
                        <h1>Stock Management System</h1>
                        <div className="navbar-subtitle">
                            London Academy for Applied Technology — Built by JH Infotech
                        </div>
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
                        <Link to="/inventory" className={`nav-link ${isActive('/inventory') ? 'active' : ''}`}>
                            Inventory
                        </Link>
                    </li>
                    <li>
                        <Link to="/scan" className={`nav-link ${isActive('/scan') ? 'active' : ''}`}>
                            Scan
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
                        <Link to="/books" className={`nav-link ${isActive('/books') ? 'active' : ''}`}>
                            Books
                        </Link>
                    </li>
                    <li>
                        <Link to="/borrowers" className={`nav-link ${isActive('/borrowers') ? 'active' : ''}`}>
                            Borrowers
                        </Link>
                    </li>
                    <li>
                        <Link to="/library/issue" className={`nav-link ${isActive('/library/issue') ? 'active' : ''}`}>
                            Issue Desk
                        </Link>
                    </li>
                    <li>
                        <Link to="/activity" className={`nav-link ${isActive('/activity') ? 'active' : ''}`}>
                            Activity
                        </Link>
                    </li>
                    {user?.role === 'admin' && (
                        <li>
                            <Link to="/users" className={`nav-link ${isActive('/users') ? 'active' : ''}`}>
                                Users
                            </Link>
                        </li>
                    )}
                    <li>
                        <Link to="/recycle-bin" className={`nav-link ${isActive('/recycle-bin') ? 'active' : ''}`}>
                            Recycle Bin
                        </Link>
                    </li>
                    <li>
                        <Link to="/tags" className={`nav-link ${isActive('/tags') ? 'active' : ''}`}>
                            Print Stickers
                        </Link>
                    </li>
                    {user?.role === 'admin' && (
                        <li>
                            <Link to="/settings" className={`nav-link ${isActive('/settings') ? 'active' : ''}`}>
                                Settings
                            </Link>
                        </li>
                    )}
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
    const location = useLocation();

    if (authLoading) {
        return <div className="spinner"></div>;
    }

    // Remember where they were heading (e.g. a scanned sticker's link) so
    // signing in takes them straight there.
    if (!license || license.expired || !user) {
        return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
    }

    return children;
}

function LoggedInRedirect() {
    const location = useLocation();
    return <Navigate to={location.state?.from || '/'} replace />;
}

// Finishes a Microsoft sign-in: the token is already stored, so load the
// user and move on to where they were going.
function SsoLanding({ onSignedIn }) {
    const navigate = useNavigate();
    return (
        <SsoComplete
            onSignedIn={async (returnTo) => {
                await onSignedIn();
                navigate(returnTo, { replace: true });
            }}
        />
    );
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

    async function handleSsoSignedIn() {
        const me = await authAPI.me();
        setUser(me.user);
        setLicense(await authAPI.license());
    }

    async function handleActivate(code) {
        const res = await authAPI.activate(code);
        if (res.license) setLicense(res.license);
        return res;
    }

    function handleLogout() {
        clearAuthToken();
        setUser(null);
        setLicense(null);
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
                                    user && license && !license.expired ? (
                                        <LoggedInRedirect />
                                    ) : (
                                        <Login
                                            onLogin={handleLogin}
                                            onActivate={handleActivate}
                                            license={license}
                                            authLoading={authLoading}
                                        />
                                    )
                                }
                            />
                            <Route path="/sso-complete" element={<SsoLanding onSignedIn={handleSsoSignedIn} />} />
                            <Route
                                path="/"
                                element={
                                    <ProtectedRoute user={user} license={license} authLoading={authLoading}>
                                        <Dashboard />
                                    </ProtectedRoute>
                                }
                            />
                            <Route
                                path="/inventory"
                                element={
                                    <ProtectedRoute user={user} license={license} authLoading={authLoading}>
                                        <Inventory />
                                    </ProtectedRoute>
                                }
                            />
                            <Route
                                path="/scan"
                                element={
                                    <ProtectedRoute user={user} license={license} authLoading={authLoading}>
                                        <Scan />
                                    </ProtectedRoute>
                                }
                            />
                            {/* The link printed in every sticker's QR code */}
                            <Route
                                path="/s/:code"
                                element={
                                    <ProtectedRoute user={user} license={license} authLoading={authLoading}>
                                        <Scan />
                                    </ProtectedRoute>
                                }
                            />
                            <Route
                                path="/settings"
                                element={
                                    <ProtectedRoute user={user} license={license} authLoading={authLoading}>
                                        <Settings currentUser={user} />
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
                                path="/assets/import-invoice"
                                element={
                                    <ProtectedRoute user={user} license={license} authLoading={authLoading}>
                                        <InvoiceImport />
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
                                path="/employees/:id"
                                element={
                                    <ProtectedRoute user={user} license={license} authLoading={authLoading}>
                                        <EmployeeDetails />
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
                            <Route
                                path="/recycle-bin"
                                element={
                                    <ProtectedRoute user={user} license={license} authLoading={authLoading}>
                                        <RecycleBin />
                                    </ProtectedRoute>
                                }
                            />
                            <Route
                                path="/books"
                                element={
                                    <ProtectedRoute user={user} license={license} authLoading={authLoading}>
                                        <BookList />
                                    </ProtectedRoute>
                                }
                            />
                            <Route
                                path="/books/new"
                                element={
                                    <ProtectedRoute user={user} license={license} authLoading={authLoading}>
                                        <BookForm />
                                    </ProtectedRoute>
                                }
                            />
                            <Route
                                path="/books/:id"
                                element={
                                    <ProtectedRoute user={user} license={license} authLoading={authLoading}>
                                        <BookDetails />
                                    </ProtectedRoute>
                                }
                            />
                            <Route
                                path="/books/:id/edit"
                                element={
                                    <ProtectedRoute user={user} license={license} authLoading={authLoading}>
                                        <BookForm />
                                    </ProtectedRoute>
                                }
                            />
                            <Route
                                path="/borrowers"
                                element={
                                    <ProtectedRoute user={user} license={license} authLoading={authLoading}>
                                        <BorrowerList />
                                    </ProtectedRoute>
                                }
                            />
                            <Route
                                path="/library/issue"
                                element={
                                    <ProtectedRoute user={user} license={license} authLoading={authLoading}>
                                        <IssueDesk />
                                    </ProtectedRoute>
                                }
                            />
                            <Route
                                path="/library/tags"
                                element={
                                    <ProtectedRoute user={user} license={license} authLoading={authLoading}>
                                        <BookTagPrinter />
                                    </ProtectedRoute>
                                }
                            />
                            <Route
                                path="/library/rapid"
                                element={
                                    <ProtectedRoute user={user} license={license} authLoading={authLoading}>
                                        <RapidCatalogue />
                                    </ProtectedRoute>
                                }
                            />
                            <Route
                                path="/activity"
                                element={
                                    <ProtectedRoute user={user} license={license} authLoading={authLoading}>
                                        <ActivityLog />
                                    </ProtectedRoute>
                                }
                            />
                            <Route
                                path="/users"
                                element={
                                    <ProtectedRoute user={user} license={license} authLoading={authLoading}>
                                        <UserManagement currentUser={user} />
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
