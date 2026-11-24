import React, { useState } from 'react';
import { authAPI } from '../services/api';

const MIN_LENGTH = 8;

// Change your own password. Open to every account that signs in with one,
// whatever its role; an administrator is only needed when it is forgotten.
export default function ChangePassword({ onClose }) {
    const [current, setCurrent] = useState('');
    const [next, setNext] = useState('');
    const [again, setAgain] = useState('');
    const [show, setShow] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [done, setDone] = useState(false);

    const problem = () => {
        if (!current) return 'Enter your current password.';
        if (next.length < MIN_LENGTH) return `The new password must be at least ${MIN_LENGTH} characters long.`;
        if (next === current) return 'The new password is the same as the current one.';
        if (next !== again) return 'The two new passwords do not match.';
        return '';
    };

    const submit = async (event) => {
        event.preventDefault();
        const found = problem();
        if (found) { setError(found); return; }
        setBusy(true);
        setError('');
        try {
            await authAPI.changePassword(current, next);
            setDone(true);
        } catch (err) {
            setError(err.message);
        } finally {
            setBusy(false);
        }
    };

    const type = show ? 'text' : 'password';

    return (
        <div className="modal-overlay" onClick={busy ? undefined : onClose}>
            <div className="modal" style={{ maxWidth: 460 }} onClick={(e) => e.stopPropagation()}>
                <h3 style={{ marginBottom: '0.25rem' }}>Change password</h3>
                {done ? (
                    <>
                        <div className="alert alert-success mt-2">
                            Your password has been changed. Use the new one next time you sign in.
                        </div>
                        <div className="flex mt-3" style={{ justifyContent: 'flex-end' }}>
                            <button type="button" className="btn btn-primary" onClick={onClose} autoFocus>Done</button>
                        </div>
                    </>
                ) : (
                    <form onSubmit={submit}>
                        <p className="text-muted">For the password you sign in to this system with.</p>
                        {error && <div className="alert alert-danger" role="alert">{error}</div>}
                        <div className="form-group">
                            <label className="form-label" htmlFor="cp-current">Current password</label>
                            <input
                                id="cp-current" type={type} className="form-control" autoComplete="current-password"
                                value={current} onChange={(e) => setCurrent(e.target.value)} autoFocus
                            />
                        </div>
                        <div className="form-group">
                            <label className="form-label" htmlFor="cp-new">New password</label>
                            <input
                                id="cp-new" type={type} className="form-control" autoComplete="new-password"
                                value={next} onChange={(e) => setNext(e.target.value)}
                            />
                            <div className="text-muted" style={{ fontSize: '0.85rem' }}>At least {MIN_LENGTH} characters.</div>
                        </div>
                        <div className="form-group">
                            <label className="form-label" htmlFor="cp-again">New password again</label>
                            <input
                                id="cp-again" type={type} className="form-control" autoComplete="new-password"
                                value={again} onChange={(e) => setAgain(e.target.value)}
                            />
                        </div>
                        <label className="flex items-center gap-1">
                            <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} />
                            <span>Show what I am typing</span>
                        </label>
                        <div className="flex gap-2 mt-3" style={{ justifyContent: 'flex-end' }}>
                            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
                            <button type="submit" className="btn btn-primary" disabled={busy}>
                                {busy ? 'Working…' : 'Change password'}
                            </button>
                        </div>
                    </form>
                )}
            </div>
        </div>
    );
}
