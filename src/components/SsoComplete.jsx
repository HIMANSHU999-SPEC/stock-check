import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { saveAuthToken } from '../services/api';

// Where Microsoft sign-in lands. The server hands the session token over in
// the URL fragment (never sent to a server or logged); store it, scrub it
// from the address bar and carry on to wherever the person was going.
export default function SsoComplete({ onSignedIn }) {
    const [error, setError] = useState('');

    useEffect(() => {
        const params = new URLSearchParams(window.location.hash.slice(1));
        const token = params.get('token');
        const returnTo = params.get('returnTo') || '/';
        window.history.replaceState(null, '', window.location.pathname);
        if (!token) {
            setError('Sign-in did not complete. Please try again.');
            return;
        }
        saveAuthToken(token);
        const safePath = returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '/';
        onSignedIn(safePath).catch(() => setError('Sign-in did not complete. Please try again.'));
    }, []);

    if (error) {
        return (
            <div className="card" style={{ maxWidth: '540px', margin: '2rem auto' }}>
                <div className="alert alert-danger">{error}</div>
                <Link to="/login" className="btn btn-primary">Back to login</Link>
            </div>
        );
    }
    return <div className="spinner"></div>;
}
