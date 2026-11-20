import React from 'react';

/**
 * Read-only licence status for administrators. The licence itself is set on
 * the server (scripts/set-licence.js); nothing in the web app can change it.
 */
export default function LicencePanel({ license }) {
    const status = license?.status
        ? `${license.status.replace('_', ' ')}${license.expired ? ' (expired)' : ''}`
        : (license?.expired ? 'Expired or not activated' : 'Unknown');

    return (
        <div className="card">
            <div className="card-header">
                <h3 className="card-title">Licence</h3>
            </div>
            <div className="card-body">
                <div className="mb-3">
                    <div className="text-muted">Status</div>
                    <div style={{ fontWeight: 'bold', textTransform: 'capitalize' }}>{status}</div>
                    {license?.expires_at && (
                        <div>
                            {license.expired ? 'Expired' : 'Valid until'}:{' '}
                            {new Date(license.expires_at).toLocaleDateString(undefined, {
                                day: 'numeric', month: 'long', year: 'numeric'
                            })}
                        </div>
                    )}
                </div>
                <p className="text-muted" style={{ marginBottom: 0 }}>
                    The licence is renewed on the server by the system administrator. It cannot be
                    changed from this page.
                </p>
            </div>
        </div>
    );
}
