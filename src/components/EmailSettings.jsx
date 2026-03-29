import React, { useState, useEffect } from 'react';
import { authAPI } from '../services/api';

export default function EmailSettings() {
    const [settings, setSettings] = useState({ host: '', port: 587, user: '', pass: '', from: '', admin_email: '', enabled: false });
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [testing, setTesting] = useState(false);
    const [alert, setAlert] = useState(null);

    useEffect(() => { loadSettings(); }, []);

    async function loadSettings() {
        try {
            const data = await authAPI.getEmailSettings();
            setSettings(s => ({ ...s, ...data }));
        } catch (e) {
            console.error('Failed to load email settings', e);
        } finally {
            setLoading(false);
        }
    }

    async function handleSave(e) {
        e.preventDefault();
        setSaving(true);
        setAlert(null);
        try {
            await authAPI.saveEmailSettings(settings);
            setAlert({ type: 'success', msg: 'Email settings saved successfully.' });
        } catch (e) {
            setAlert({ type: 'danger', msg: 'Failed to save: ' + e.message });
        } finally {
            setSaving(false);
        }
    }

    async function handleTest() {
        setTesting(true);
        setAlert(null);
        try {
            const res = await authAPI.testEmail();
            setAlert({ type: 'success', msg: res.message });
        } catch (e) {
            setAlert({ type: 'danger', msg: 'Test failed: ' + e.message });
        } finally {
            setTesting(false);
        }
    }

    function update(key, value) {
        setSettings(s => ({ ...s, [key]: value }));
    }

    if (loading) return <div className="spinner"></div>;

    return (
        <div>
            <div className="flex justify-between items-center mb-3">
                <h2>Email Notification Settings</h2>
            </div>

            {alert && (
                <div style={{ padding: '0.75rem 1rem', borderRadius: '6px', marginBottom: '1rem', background: alert.type === 'success' ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)', color: alert.type === 'success' ? 'var(--success)' : 'var(--danger)', border: `1px solid ${alert.type === 'success' ? 'var(--success)' : 'var(--danger)'}` }}>
                    {alert.msg}
                    <button onClick={() => setAlert(null)} style={{ float: 'right', background: 'none', border: 'none', cursor: 'pointer', color: 'inherit' }}>×</button>
                </div>
            )}

            <form onSubmit={handleSave}>
                <div className="card mb-3">
                    <div className="card-header">
                        <h3 className="card-title">SMTP Configuration</h3>
                        <p className="text-muted" style={{ margin: 0, fontSize: '0.875rem' }}>
                            Configure your SMTP server to send automatic email notifications on asset events (assignment, return, maintenance).
                        </p>
                    </div>
                    <div className="card-body">
                        <div className="grid grid-2">
                            <div className="form-group">
                                <label className="form-label">SMTP Host *</label>
                                <input
                                    className="form-control"
                                    value={settings.host || ''}
                                    onChange={e => update('host', e.target.value)}
                                    placeholder="e.g. smtp.gmail.com or smtp.office365.com"
                                />
                            </div>
                            <div className="form-group">
                                <label className="form-label">SMTP Port</label>
                                <input
                                    className="form-control"
                                    type="number"
                                    value={settings.port || 587}
                                    onChange={e => update('port', Number(e.target.value))}
                                    placeholder="587 (TLS) or 465 (SSL)"
                                />
                            </div>
                            <div className="form-group">
                                <label className="form-label">Username / Email *</label>
                                <input
                                    className="form-control"
                                    value={settings.user || ''}
                                    onChange={e => update('user', e.target.value)}
                                    placeholder="SMTP login email"
                                />
                            </div>
                            <div className="form-group">
                                <label className="form-label">Password *</label>
                                <input
                                    className="form-control"
                                    type="password"
                                    value={settings.pass || ''}
                                    onChange={e => update('pass', e.target.value)}
                                    placeholder="SMTP password or app password"
                                />
                            </div>
                            <div className="form-group">
                                <label className="form-label">From Address</label>
                                <input
                                    className="form-control"
                                    value={settings.from || ''}
                                    onChange={e => update('from', e.target.value)}
                                    placeholder='e.g. IT Support <itsupport@laat.ac.uk>'
                                />
                            </div>
                            <div className="form-group">
                                <label className="form-label">Admin Alert Email</label>
                                <input
                                    className="form-control"
                                    value={settings.admin_email || ''}
                                    onChange={e => update('admin_email', e.target.value)}
                                    placeholder="Email for maintenance alerts"
                                />
                            </div>
                        </div>

                        <div className="form-group">
                            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                                <input
                                    type="checkbox"
                                    checked={!!settings.enabled}
                                    onChange={e => update('enabled', e.target.checked)}
                                />
                                <span>Enable email notifications</span>
                            </label>
                            <div className="text-muted" style={{ fontSize: '0.85rem', marginTop: '0.25rem' }}>
                                When enabled, emails will be sent automatically on: asset assignment, asset return.
                            </div>
                        </div>
                    </div>
                </div>

                <div className="card mb-3">
                    <div className="card-header">
                        <h3 className="card-title">Notification Events</h3>
                    </div>
                    <div className="card-body">
                        <div className="grid grid-3">
                            <div className="stat-card" style={{ opacity: settings.enabled ? 1 : 0.5 }}>
                                <div style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>📧</div>
                                <div className="stat-label">Asset Assigned</div>
                                <div className="text-muted" style={{ fontSize: '0.8rem' }}>Email sent to employee when asset is assigned to them</div>
                                <span className={`badge badge-${settings.enabled ? 'success' : 'danger'}`} style={{ marginTop: '0.5rem' }}>
                                    {settings.enabled ? 'Active' : 'Disabled'}
                                </span>
                            </div>
                            <div className="stat-card" style={{ opacity: settings.enabled ? 1 : 0.5 }}>
                                <div style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>↩️</div>
                                <div className="stat-label">Asset Returned</div>
                                <div className="text-muted" style={{ fontSize: '0.8rem' }}>Email sent to employee when asset is returned</div>
                                <span className={`badge badge-${settings.enabled ? 'success' : 'danger'}`} style={{ marginTop: '0.5rem' }}>
                                    {settings.enabled ? 'Active' : 'Disabled'}
                                </span>
                            </div>
                            <div className="stat-card" style={{ opacity: settings.enabled && settings.admin_email ? 1 : 0.5 }}>
                                <div style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>🔧</div>
                                <div className="stat-label">Maintenance Alert</div>
                                <div className="text-muted" style={{ fontSize: '0.8rem' }}>Alert sent to admin email when asset needs maintenance</div>
                                <span className={`badge badge-${settings.enabled && settings.admin_email ? 'success' : 'danger'}`} style={{ marginTop: '0.5rem' }}>
                                    {settings.enabled && settings.admin_email ? 'Active' : 'Disabled'}
                                </span>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="flex gap-2">
                    <button type="submit" className="btn btn-primary" disabled={saving}>
                        {saving ? 'Saving...' : 'Save Settings'}
                    </button>
                    <button type="button" className="btn btn-secondary" onClick={handleTest} disabled={testing || !settings.host}>
                        {testing ? 'Sending...' : 'Send Test Email'}
                    </button>
                </div>
            </form>
        </div>
    );
}
