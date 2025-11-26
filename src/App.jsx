import React from 'react';
import { BrowserRouter as Router, Routes, Route, Link, useLocation } from 'react-router-dom';
import Dashboard from './components/Dashboard';
import AssetList from './components/AssetList';
import AssetDetails from './components/AssetDetails';
import AssetForm from './components/AssetForm';
import EmployeeList from './components/EmployeeList';
import CategoryManagement from './components/CategoryManagement';
import Reports from './components/Reports';
import TagPrinter from './components/TagPrinter';
import './index.css';

function Navbar() {
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
                        London Academy for Applied Technology • Built by JH Infotech
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
                            {darkMode ? '☀️' : '🌙'}
                        </button>
                    </li>
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
                    © 2025 London Academy for Applied Technology • Developed by{' '}
                    <span className="footer-link">JH Infotech</span>
                </p>
            </div>
        </footer>
    );
}

function App() {
    return (
        <Router>
            <div className="app">
                <Navbar />
                <main className="main-content">
                    <div className="container">
                        <Routes>
                            <Route path="/" element={<Dashboard />} />
                            <Route path="/assets" element={<AssetList />} />
                            <Route path="/assets/new" element={<AssetForm />} />
                            <Route path="/assets/:id" element={<AssetDetails />} />
                            <Route path="/assets/:id/edit" element={<AssetForm />} />
                            <Route path="/employees" element={<EmployeeList />} />
                            <Route path="/categories" element={<CategoryManagement />} />
                            <Route path="/reports" element={<Reports />} />
                            <Route path="/tags" element={<TagPrinter />} />
                        </Routes>
                    </div>
                </main>
                <Footer />
            </div>
        </Router>
    );
}

export default App;
