import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { authAPI } from '../services/api';

const STORED_EMAIL_KEY = 'saved_login_email';

export default function Login({ onLogin, onActivate, license, authLoading }) {
    const navigate = useNavigate();
    const location = useLocation();
    // Where the person was heading before being asked to sign in (for
    // example the asset a scanned sticker points to).
    const returnTo = location.state?.from || '/';
    const [sso, setSso] = useState({ enabled: false, password_login: true });
    const [email, setEmail] = useState('itsupport@laat.ac.uk');
    const [password, setPassword] = useState('');
    const [error, setError] = useState(() => new URLSearchParams(location.search).get('sso_error') || '');
    const [message, setMessage] = useState('');
    const [code, setCode] = useState('');
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

    return (
        <div className="card" style={{ maxWidth: '540px', margin: '2rem auto' }}>
            <div className="card-header">
                <h3 className="card-title">Login</h3>
                <p className="text-muted" style={{ marginBottom: 0 }}>
                    {sso.enabled
                        ? 'Sign in with your work Microsoft account.'
                        : 'Sign in with your administrator or sub-administrator credentials.'}
                </p>
            </div>
            <div className="card-body">
                {error && <div className="alert alert-danger">{error}</div>}
                {message && <div className="alert alert-success">{message}</div>}

                {sso.enabled && (
                    <>
                        <a
                            href={authAPI.ssoLoginUrl(returnTo)}
                            className="btn btn-microsoft w-100"
                            aria-disabled={license?.expired ? 'true' : undefined}
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

            <div className="card-header">
                <h4 className="card-title" style={{ marginBottom: 0 }}>Activation</h4>
                <p className="text-muted" style={{ marginBottom: 0 }}>
                    Enter your activation code to start a trial or extend your license.
                </p>
            </div>
            <div className="card-body">
                <div className="form-group">
                    <label className="form-label">Activation Code</label>
                    <input
                        type="text"
                        className="form-control"
                        value={code}
                        onChange={(e) => setCode(e.target.value)}
                        placeholder="Enter activation code"
                    />
                </div>
                <button
                    onClick={async (e) => {
                        e.preventDefault();
                        if (!code) return;
                        setBusy(true);
                        setError('');
                        setMessage('');
                        try {
                            const res = await onActivate(code);
                            setMessage(res?.message || 'License updated');
                            setCode('');
                        } catch (err) {
                            setError(err.message || 'Activation failed');
                        } finally {
                            setBusy(false);
                        }
                    }}
                    className="btn btn-secondary w-100"
                    disabled={busy}
                >
                    Activate / Extend
                </button>

                <div className="mt-3">
                    <div className="text-muted">License status</div>
                    <div style={{ fontWeight: 'bold' }}>
                        {license
                            ? `${license.status ?? 'unknown'}${license.expired ? ' (expired)' : ''}`
                            : 'Not activated'}
                    </div>
                    {license?.expires_at && (
                        <div>Expires: {new Date(license.expires_at).toLocaleString()}</div>
                    )}
                </div>
            </div>
        </div>
    );
}
