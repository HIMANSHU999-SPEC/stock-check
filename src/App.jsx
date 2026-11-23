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
import TidyAssets from './components/TidyAssets';
import IntuneCheck from './components/IntuneCheck';
import Scan from './components/Scan';
import Settings from './components/Settings';
import SsoComplete from './components/SsoComplete';
import Navbar from './components/Navbar';
import MyAssets from './components/MyAssets';
import EmailDraftBar from './components/EmailDraftBar';
import StaffReports from './components/StaffReports';
import { authAPI, saveAuthToken, clearAuthToken } from './services/api';
import './index.css';

function Footer() {
    return (
        <footer className="footer">
            <div className="container">
                <p className="footer-text">
                    © {new Date().getFullYear()} London Academy for Applied Technology — Developed by{' '}
                    <span className="footer-link">JH Infotech</span>
                </p>
            </div>
        </footer>
    );
}

// Pages that exist to change something, or to run the system. View-only
// accounts are sent back to the dashboard; the server refuses them anyway.
const READ_ONLY_ROLES = ['viewer', 'inventory'];
const NOT_FOR_READ_ONLY = /^\/(assets\/(new|import-invoice|tidy)|assets\/[^/]+\/edit|books\/new|books\/[^/]+\/edit|library\/(issue|rapid)|recycle-bin|activity|users|settings|staff-reports|intune)\/?$/;

function ProtectedRoute({ user, license, authLoading, children, staffAllowed = false }) {
    const location = useLocation();

    if (authLoading) {
        return <div className="spinner"></div>;
    }

    // Remember where they were heading (e.g. a scanned sticker's link) so
    // signing in takes them straight there.
    if (!license || license.expired || !user) {
        return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
    }

    // Staff who do not run the system have one page: their own assets. The
    // server refuses them everything else in any case.
    if (user.role === 'staff' && !staffAllowed) {
        return <Navigate to="/my-assets" replace />;
    }

    if (READ_ONLY_ROLES.includes(user.role) && NOT_FOR_READ_ONLY.test(location.pathname)) {
        return <Navigate to="/" replace />;
    }

    return children;
}

// An address that is not a page of the app: a mistyped link, or one from an
// older version. Better a way back than a blank screen.
function NotFound() {
    const location = useLocation();
    return (
        <div className="card" style={{ maxWidth: '36rem', margin: '2rem auto' }}>
            <div className="card-body">
                <h2>Page not found</h2>
                <p className="text-muted">
                    There is nothing at <code>{location.pathname}</code>. The link may be mistyped or out of date.
                </p>
                <div className="flex gap-2 mt-3">
                    <Link to="/" className="btn btn-primary">Go to the dashboard</Link>
                    <Link to="/scan" className="btn btn-secondary">Look up an asset</Link>
                </div>
            </div>
        </div>
    );
}

function LoggedInRedirect({ user }) {
    const location = useLocation();
    if (user?.role === 'staff') return <Navigate to="/my-assets" replace />;
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

    // The server stopped accepting the session while the app was open.
    const [sessionEnded, setSessionEnded] = React.useState(false);
    React.useEffect(() => {
        function onEnded() {
            clearAuthToken();
            setUser((current) => {
                if (current) setSessionEnded(true);
                return null;
            });
        }
        window.addEventListener('session-ended', onEnded);
        return () => window.removeEventListener('session-ended', onEnded);
    }, []);

    // Lets the stylesheet hide the buttons an account cannot use
    // (see .write-only / .download-only in index.css).
    React.useEffect(() => {
        if (user?.role) document.body.dataset.access = user.role;
        else delete document.body.dataset.access;
    }, [user]);

    async function handleLogin(email, password) {
        const res = await authAPI.login(email, password);
        saveAuthToken(res.token);
        setSessionEnded(false);
        setUser(res.user);
        const lic = await authAPI.license();
        setLicense(lic);
        return res;
    }

    async function handleSsoSignedIn() {
        setSessionEnded(false);
        const me = await authAPI.me();
        setUser(me.user);
        setLicense(await authAPI.license());
    }

    function handleLogout() {
        setSessionEnded(false);
        clearAuthToken();
        setUser(null);
        // Signed-out visitors only learn whether the app is usable.
        authAPI.license().then(setLicense).catch(() => setLicense(null));
    }

    return (
        <Router>
            <div className="app">
                {/* Nothing of the application is shown until someone has signed in:
                    the sign-in page carries just the logo and the sign-in card. */}
                {user && <Navbar user={user} onLogout={handleLogout} license={license} />}
                <main className="main-content">
                    <div className="container">
                        <Routes>
                            <Route
                                path="/login"
                                element={
                                    user && license && !license.expired ? (
                                        <LoggedInRedirect user={user} />
                                    ) : (
                                        <Login
                                            onLogin={handleLogin}
                                            license={license}
                                            authLoading={authLoading}
                                            user={user}
                                            sessionEnded={sessionEnded}
                                        />
                                    )
                                }
                            />
                            <Route path="/sso-complete" element={<SsoLanding onSignedIn={handleSsoSignedIn} />} />
                            <Route
                                path="/"
                                element={
                                    <ProtectedRoute user={user} license={license} authLoading={authLoading}>
                                        <Dashboard user={user} />
                                    </ProtectedRoute>
                                }
                            />
                            <Route
                                path="/my-assets"
                                element={
                                    <ProtectedRoute user={user} license={license} authLoading={authLoading} staffAllowed>
                                        <MyAssets />
                                    </ProtectedRoute>
                                }
                            />
                            <Route
                                path="/staff-reports"
                                element={
                                    <ProtectedRoute user={user} license={license} authLoading={authLoading}>
                                        <StaffReports />
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
                                        <Settings currentUser={user} license={license} />
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
                                path="/assets/tidy"
                                element={
                                    <ProtectedRoute user={user} license={license} authLoading={authLoading}>
                                        <TidyAssets />
                                    </ProtectedRoute>
                                }
                            />
                            <Route
                                path="/intune"
                                element={
                                    <ProtectedRoute user={user} license={license} authLoading={authLoading}>
                                        <IntuneCheck />
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
                            <Route
                                path="*"
                                element={
                                    <ProtectedRoute user={user} license={license} authLoading={authLoading}>
                                        <NotFound />
                                    </ProtectedRoute>
                                }
                            />
                        </Routes>
                    </div>
                </main>
                {user && <Footer />}
                {user && <EmailDraftBar />}
            </div>
        </Router>
    );
}

export default App;
