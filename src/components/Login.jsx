import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { authAPI } from '../services/api';

const STORED_EMAIL_KEY = 'saved_login_email';

export default function Login({ onLogin, license, authLoading, user, sessionEnded }) {
    const navigate = useNavigate();
    const location = useLocation();
    // Where the person was heading before being asked to sign in (for
    // example the asset a scanned sticker points to).
    const returnTo = location.state?.from || '/';
    const [sso, setSso] = useState({ enabled: false, password_login: true });
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState(() => new URLSearchParams(location.search).get('sso_error') || '');
    const [message, setMessage] = useState('');
    const [busy, setBusy] = useState(false);
    const [remember, setRemember] = useState(true);

    useEffect(() => {
        const stored = typeof localStorage !== 'undefined' ? localStorage.getItem(STORED_EMAIL_KEY) : '';
        if (stored) setEmail(stored);
        authAPI.ssoConfig().then(setSso).catch(() => {});
    }, []);

    async function handleLogin(e) {
        e.preventDefault();
        setBusy(true);
        setError('');
        setMessage('');
        try {
            await onLogin(email, password);
            if (remember && typeof localStorage !== 'undefined') {
                localStorage.setItem(STORED_EMAIL_KEY, email);
            }
            setMessage('Logged in successfully');
            navigate(returnTo, { replace: true });
        } catch (err) {
            setError(err.message || 'Login failed');
        } finally {
            setBusy(false);
        }
    }

    // Signed in but the licence has lapsed. It can only be renewed on the
    // server, so there is nothing to do here but say who to ask.
    if (user && license?.expired) {
        return (
            <div className="card" style={{ maxWidth: '540px', margin: '2rem auto' }}>
                <div className="card-body">
                    <div className="alert alert-danger" style={{ marginBottom: 0 }}>
                        The licence for this system needs renewing. Please contact the administrator.
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div style={{ maxWidth: '480px', margin: '0 auto', padding: '4rem 0 2rem' }}>
        <div className="card login-card">
            <div className="login-brand">
                <img
                    src="/laat-logo-full.png"
                    alt="London Academy for Applied Technology"
                    onError={(e) => { e.currentTarget.style.display = 'none'; }}
                />
                <h3>Stock Management System</h3>
                <p className="text-muted">
                    {sso.enabled
                        ? 'Sign in with your work Microsoft account.'
                        : 'Sign in with your administrator or sub-administrator credentials.'}
                </p>
            </div>
            <div className="card-body">
                {sessionEnded && !error && (
                    <div className="alert alert-info">
                        You have been signed out because your session ended. Sign in again to carry on where you were.
                    </div>
                )}
                {error && <div className="alert alert-danger">{error}</div>}
                {message && <div className="alert alert-success">{message}</div>}
                {license?.expired && (
                    <div className="alert alert-danger">
                        The licence for this system needs renewing. Please contact the administrator.
                    </div>
                )}

                {sso.enabled && (
                    <>
                        <a
                            href={authAPI.ssoLoginUrl(returnTo)}
                            className="btn btn-microsoft w-100"
                        >
                            <svg width="18" height="18" viewBox="0 0 21 21" aria-hidden="true">
                                <rect x="1" y="1" width="9" height="9" fill="#f25022" />
                                <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
                                <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
                                <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
                            </svg>
                            Sign in with Microsoft
                        </a>
                        {sso.password_login && <div className="divider">or use a password</div>}
                    </>
                )}

                {sso.password_login && (
                <form onSubmit={handleLogin}>
                    <div className="form-group">
                        <label className="form-label">Email</label>
                        <input
                            type="email"
                            className="form-control"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            required
                            autoComplete="username"
                        />
                    </div>

                    <div className="form-group">
                        <label className="form-label">Password</label>
                        <input
                            type="password"
                            className="form-control"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            required
                            autoComplete="current-password"
                        />
                    </div>

                    <label className="flex items-center gap-1 mb-2">
                        <input
                            type="checkbox"
                            checked={remember}
                            onChange={(e) => setRemember(e.target.checked)}
                        />
                        <span>Remember this device</span>
                    </label>

                    <button type="submit" className="btn btn-primary w-100" disabled={busy || authLoading}>
                        {busy ? 'Working...' : 'Login'}
                    </button>
                </form>
                )}
            </div>

        </div>
        </div>
    );
}
