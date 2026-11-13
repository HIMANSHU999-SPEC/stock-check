import React, { useEffect, useRef, useState } from 'react';
import { settingsAPI } from '../services/api';
import LicencePanel from './LicencePanel';

const TABS = [
    { key: 'integrations', label: 'Microsoft 365' },
    { key: 'templates', label: 'Email templates' },
    { key: 'log', label: 'Email log' },
    { key: 'licence', label: 'Licence' }
];

function StatusPill({ ok, okText, offText }) {
    return (
        <span className={`badge badge-${ok ? 'success' : 'warning'}`}>{ok ? okText : offText}</span>
    );
}

function when(value) {
    if (!value) return '—';
    const d = new Date(value.includes('T') ? value : value.replace(' ', 'T') + 'Z');
    return Number.isNaN(d.getTime()) ? value : d.toLocaleString();
}

function Integrations() {
    const [data, setData] = useState(null);
    const [form, setForm] = useState(null);
    const [message, setMessage] = useState(null); // { type, text }
    const [busy, setBusy] = useState('');
    const [testTo, setTestTo] = useState('');

    async function load() {
        const result = await settingsAPI.getIntegrations();
        setData(result);
        setForm((prev) => prev || result.settings);
        return result;
    }

    useEffect(() => {
        load().catch((err) => setMessage({ type: 'danger', text: err.message }));
    }, []);

    // While a sync is draining, keep the counts fresh.
    useEffect(() => {
        if (!data || data.sharepoint.pending === 0) return undefined;
        const timer = setTimeout(() => load().catch(() => {}), 4000);
        return () => clearTimeout(timer);
    }, [data]);

    async function run(name, fn) {
        setBusy(name);
        setMessage(null);
        try {
            await fn();
        } catch (err) {
            setMessage({ type: 'danger', text: err.message });
        } finally {
            setBusy('');
        }
    }

    const save = () => run('save', async () => {
        const result = await settingsAPI.saveIntegrations(form);
        setForm(result.settings);
        settingsAPI.clearPublicCache();
        await load();
        setMessage({ type: 'success', text: 'Settings saved.' });
    });

    const sendTest = () => run('mail', async () => {
        const result = await settingsAPI.sendTestEmail({ to: testTo || undefined });
        setMessage(result.status === 'sent'
            ? { type: 'success', text: `Test email sent to ${result.to}. Check the inbox (and the mailbox's Sent Items).` }
            : { type: 'danger', text: `Test email failed: ${result.error}` });
    });

    const testSharePoint = () => run('sp-test', async () => {
        const result = await settingsAPI.testSharePoint();
        await load();
        setMessage(result.ok
            ? { type: 'success', text: result.created ? 'Connected — the list was created in SharePoint.' : 'Connected to the SharePoint list.' }
            : { type: 'danger', text: `SharePoint connection failed: ${result.error}` });
    });

    const syncAll = () => run('sp-sync', async () => {
        const result = await settingsAPI.syncSharePoint();
        await load();
        setMessage({ type: 'success', text: `${result.queued} asset(s) queued — they are being sent to SharePoint now.` });
    });

    const retry = () => run('sp-retry', async () => {
        await settingsAPI.retrySharePoint();
        await load();
    });

    if (!data || !form) {
        return message ? <div className={`alert alert-${message.type}`}>{message.text}</div> : <div className="spinner"></div>;
    }

    const set = (key) => (e) =>
        setForm({ ...form, [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
    const sp = data.sharepoint;

    return (
        <div>
            {message && <div className={`alert alert-${message.type}`}>{message.text}</div>}

            <div className="card mb-3">
                <div className="card-header">
                    <div className="flex justify-between items-center">
                        <h3 className="card-title">Microsoft 365 connection</h3>
                        <StatusPill ok={data.microsoft.configured} okText="Connected" offText="Not set up" />
                    </div>
                </div>
                {data.microsoft.configured ? (
                    <p className="text-muted">
                        The app registration credentials are set on the server. Single sign-on, email and the
                        SharePoint sync all use this one registration.
                    </p>
                ) : (
                    <>
                        <p>
                            Create an app registration in Microsoft Entra, then set these on the server (in the
                            <code> .env</code> file next to the app) and restart it:
                        </p>
                        <ul className="plain-list">
                            {data.microsoft.missing.map((name) => <li key={name}><code>{name}</code></li>)}
                        </ul>
                        <p className="text-muted">Step-by-step instructions are in <code>docs/MICROSOFT365_SETUP.md</code>.</p>
                    </>
                )}
                {data.auth_secret_default && (
                    <div className="alert alert-danger mt-2">
                        <strong>AUTH_SECRET is not set.</strong> Login sessions are being signed with the default
                        secret from the public source code, which means they can be forged. Set a random
                        <code> AUTH_SECRET</code> on the server (<code>openssl rand -hex 32</code>) and restart.
                    </div>
                )}
            </div>

            <div className="card mb-3">
                <div className="card-header">
                    <div className="flex justify-between items-center">
                        <h3 className="card-title">Single sign-on</h3>
                        <StatusPill ok={data.sso.enabled} okText="On" offText="Off" />
                    </div>
                </div>
                {data.sso.enabled ? (
                    <>
                        <p>
                            Staff can use <strong>Sign in with Microsoft</strong>. Only people listed under
                            <strong> Users</strong> are let in — add someone there (no password needed) to give them access.
                        </p>
                        <p className="text-muted">
                            Password sign-in is {data.sso.password_login ? 'still allowed' : 'turned off'}.
                            {data.sso.password_login && ' Set DISABLE_PASSWORD_LOGIN=true on the server once everyone signs in with Microsoft.'}
                        </p>
                    </>
                ) : (
                    <ul className="plain-list">
                        {data.sso.problems.map((p) => <li key={p}>{p}</li>)}
                    </ul>
                )}
                {data.sso.redirect_uri && (
                    <div className="form-group mt-2">
                        <label className="form-label">Redirect URI to enter in the Entra app registration (type: Web)</label>
                        <input type="text" className="form-control" readOnly value={data.sso.redirect_uri} onFocus={(e) => e.target.select()} />
                    </div>
                )}
            </div>

            <div className="card mb-3">
                <div className="card-header">
                    <div className="flex justify-between items-center">
                        <h3 className="card-title">Email</h3>
                        <StatusPill ok={data.mail.configured} okText="Ready to send" offText="Not sending" />
                    </div>
                </div>
                {!data.mail.configured && (
                    <ul className="plain-list">
                        {data.mail.problems.map((p) => <li key={p}>{p}</li>)}
                    </ul>
                )}
                <div className="grid grid-2">
                    <div className="form-group">
                        <label className="form-label">Send from (mailbox)</label>
                        <input
                            type="email" className="form-control" placeholder="itsupport@yourdomain.ac.uk"
                            value={form.mail_from} onChange={set('mail_from')}
                        />
                        <div className="text-muted" style={{ fontSize: '0.85rem' }}>
                            A user or shared mailbox in your tenant. Needs the <code>Mail.Send</code> application permission.
                        </div>
                    </div>
                    <div className="form-group">
                        <label className="form-label">Copy every email to (optional)</label>
                        <input
                            type="text" className="form-control" placeholder="e.g. itsupport@yourdomain.ac.uk"
                            value={form.mail_cc} onChange={set('mail_cc')}
                        />
                        <div className="text-muted" style={{ fontSize: '0.85rem' }}>Separate several addresses with commas.</div>
                    </div>
                    <div className="form-group">
                        <label className="form-label">Send staff reports to (optional)</label>
                        <input
                            type="email" className="form-control" placeholder="Leave empty to use the sending mailbox"
                            value={form.support_email || ''} onChange={set('support_email')}
                        />
                        <div className="text-muted" style={{ fontSize: '0.85rem' }}>
                            Where a message goes when a member of staff reports a problem from “My assets”.
                        </div>
                    </div>
                    <div className="form-group">
                        <label className="form-label">Organisation name (used in emails and on stickers)</label>
                        <input type="text" className="form-control" value={form.org_name} onChange={set('org_name')} />
                    </div>
                    <div className="form-group">
                        <label className="form-label">Send automatically</label>
                        <label className="flex items-center gap-1">
                            <input type="checkbox" checked={form.mail_on_assign} onChange={set('mail_on_assign')} />
                            <span>when an asset is assigned or reassigned</span>
                        </label>
                        <label className="flex items-center gap-1">
                            <input type="checkbox" checked={form.mail_on_return} onChange={set('mail_on_return')} />
                            <span>when an asset is returned</span>
                        </label>
                        <div className="text-muted" style={{ fontSize: '0.85rem' }}>
                            This sets the tick-box default; it can be changed each time.
                        </div>
                    </div>
                </div>
                <div className="flex gap-2 items-center" style={{ flexWrap: 'wrap' }}>
                    <button className="btn btn-primary" onClick={save} disabled={busy === 'save'}>
                        {busy === 'save' ? 'Saving…' : 'Save'}
                    </button>
                    <span className="text-muted">Send a test to</span>
                    <input
                        type="email" className="form-control" style={{ maxWidth: '18rem' }}
                        placeholder="your own address" value={testTo} onChange={(e) => setTestTo(e.target.value)}
                    />
                    <button className="btn btn-secondary" onClick={sendTest} disabled={busy === 'mail' || !data.mail.configured}>
                        {busy === 'mail' ? 'Sending…' : 'Send test email'}
                    </button>
                </div>
            </div>

            <div className="card">
                <div className="card-header">
                    <div className="flex justify-between items-center">
                        <h3 className="card-title">SharePoint list</h3>
                        <StatusPill ok={sp.configured} okText="Syncing" offText="Off" />
                    </div>
                </div>
                <p className="text-muted">
                    Keeps a SharePoint list in step with the asset register — every asset, who or where it is
                    assigned to, campus and status. Changes made here appear there within a few seconds; the list
                    is a read-only copy, so edit assets here, not in SharePoint.
                </p>
                <div className="grid grid-2">
                    <div className="form-group">
                        <label className="form-label">SharePoint site address</label>
                        <input
                            type="text" className="form-control" placeholder="https://yourtenant.sharepoint.com/sites/IT"
                            value={form.sharepoint_site} onChange={set('sharepoint_site')}
                        />
                    </div>
                    <div className="form-group">
                        <label className="form-label">List name (created if it does not exist)</label>
                        <input type="text" className="form-control" value={form.sharepoint_list} onChange={set('sharepoint_list')} />
                    </div>
                </div>
                <label className="flex items-center gap-1 mb-2">
                    <input type="checkbox" checked={form.sharepoint_enabled} onChange={set('sharepoint_enabled')} />
                    <span>Keep the SharePoint list up to date</span>
                </label>

                {sp.configured && (
                    <div className="scan-facts mb-2">
                        <div><span className="text-muted">In SharePoint</span>{sp.synced} asset(s)</div>
                        <div><span className="text-muted">Waiting to send</span>{sp.pending}</div>
                        <div><span className="text-muted">Failed</span>{sp.failed}</div>
                        <div><span className="text-muted">Last update sent</span>{when(sp.last_success_at)}</div>
                    </div>
                )}
                {sp.last_error && <div className="alert alert-danger">Last problem: {sp.last_error}</div>}

                <div className="flex gap-2" style={{ flexWrap: 'wrap' }}>
                    <button className="btn btn-primary" onClick={save} disabled={busy === 'save'}>
                        {busy === 'save' ? 'Saving…' : 'Save'}
                    </button>
                    <button className="btn btn-secondary" onClick={testSharePoint} disabled={busy === 'sp-test' || !sp.configured}>
                        {busy === 'sp-test' ? 'Checking…' : 'Test connection'}
                    </button>
                    <button className="btn btn-secondary" onClick={syncAll} disabled={busy === 'sp-sync' || !sp.configured}>
                        {busy === 'sp-sync' ? 'Queuing…' : 'Sync everything now'}
                    </button>
                    {sp.failed > 0 && (
                        <button className="btn btn-secondary" onClick={retry} disabled={busy === 'sp-retry'}>
                            Retry {sp.failed} failed
                        </button>
                    )}
                    {sp.list_url && (
                        <a className="btn btn-secondary" href={sp.list_url} target="_blank" rel="noreferrer">Open the list ↗</a>
                    )}
                </div>
            </div>
        </div>
    );
}

function Templates() {
    const [templates, setTemplates] = useState([]);
    const [activeKey, setActiveKey] = useState('');
    const [draft, setDraft] = useState({ subject: '', body: '' });
    const [preview, setPreview] = useState(null);
    const [message, setMessage] = useState(null);
    const [busy, setBusy] = useState('');
    const bodyRef = useRef(null);

    const active = templates.find((t) => t.key === activeKey);
    const dirty = active && (draft.subject !== active.subject || draft.body !== active.body);

    useEffect(() => {
        settingsAPI.getTemplates()
            .then((list) => {
                setTemplates(list);
                if (list[0]) select(list[0]);
            })
            .catch((err) => setMessage({ type: 'danger', text: err.message }));
    }, []);

    function select(template) {
        setActiveKey(template.key);
        setDraft({ subject: template.subject, body: template.body });
        setMessage(null);
    }

    // Live preview with sample details, a moment after typing stops.
    useEffect(() => {
        if (!activeKey) return undefined;
        const timer = setTimeout(() => {
            settingsAPI.previewTemplate(activeKey, draft).then(setPreview).catch(() => setPreview(null));
        }, 300);
        return () => clearTimeout(timer);
    }, [activeKey, draft.subject, draft.body]);

    function replaceTemplate(updated) {
        setTemplates((list) => list.map((t) => (t.key === updated.key ? updated : t)));
        setDraft({ subject: updated.subject, body: updated.body });
    }

    function insertPlaceholder(name) {
        const token = `{{${name}}}`;
        const el = bodyRef.current;
        const start = el ? el.selectionStart : draft.body.length;
        const end = el ? el.selectionEnd : draft.body.length;
        setDraft((d) => ({ ...d, body: d.body.slice(0, start) + token + d.body.slice(end) }));
        if (el) {
            requestAnimationFrame(() => {
                el.focus();
                el.setSelectionRange(start + token.length, start + token.length);
            });
        }
    }

    async function run(name, fn) {
        setBusy(name);
        setMessage(null);
        try {
            await fn();
        } catch (err) {
            setMessage({ type: 'danger', text: err.message });
        } finally {
            setBusy('');
        }
    }

    const save = () => run('save', async () => {
        replaceTemplate(await settingsAPI.saveTemplate(activeKey, draft));
        setMessage({ type: 'success', text: 'Template saved. New emails use this wording from now on.' });
    });

    const reset = () => {
        if (!confirm('Put this template back to the original wording?')) return;
        run('reset', async () => {
            replaceTemplate(await settingsAPI.resetTemplate(activeKey));
            setMessage({ type: 'success', text: 'Template reset to the original wording.' });
        });
    };

    const sendTest = () => run('test', async () => {
        const result = await settingsAPI.sendTestEmail({ template: activeKey, subject: draft.subject, body: draft.body });
        setMessage(result.status === 'sent'
            ? { type: 'success', text: `Test sent to ${result.to} (your own address) using the wording shown here.` }
            : { type: 'danger', text: `Could not send the test: ${result.error}` });
    });

    if (templates.length === 0) {
        return message ? <div className={`alert alert-${message.type}`}>{message.text}</div> : <div className="spinner"></div>;
    }

    return (
        <div className="template-editor">
            <div className="template-list">
                {templates.map((t) => (
                    <button
                        key={t.key}
                        type="button"
                        className={`template-item ${t.key === activeKey ? 'active' : ''}`}
                        onClick={() => {
                            if (dirty && !confirm('Discard the unsaved changes to this template?')) return;
                            select(t);
                        }}
                    >
                        <strong>{t.name}</strong>
                        {t.customised && <span className="badge badge-info" style={{ marginLeft: '0.4rem' }}>edited</span>}
                        <div className="text-muted" style={{ fontSize: '0.8rem' }}>{t.description}</div>
                    </button>
                ))}
            </div>

            {active && (
                <div className="card" style={{ flex: '1 1 28rem', minWidth: 0 }}>
                    {message && <div className={`alert alert-${message.type}`}>{message.text}</div>}
                    <div className="form-group">
                        <label className="form-label">Subject</label>
                        <input
                            type="text" className="form-control" value={draft.subject}
                            onChange={(e) => setDraft({ ...draft, subject: e.target.value })}
                        />
                    </div>
                    <div className="form-group">
                        <label className="form-label">Message</label>
                        <textarea
                            ref={bodyRef} className="form-control" rows="14" value={draft.body}
                            style={{ fontFamily: 'inherit' }}
                            onChange={(e) => setDraft({ ...draft, body: e.target.value })}
                        />
                    </div>
                    <div className="form-group">
                        <label className="form-label">Insert a detail (filled in automatically when the email is sent)</label>
                        <div className="flex gap-1" style={{ flexWrap: 'wrap' }}>
                            {active.placeholders.map((name) => (
                                <button key={name} type="button" className="chip" onClick={() => insertPlaceholder(name)}>
                                    {`{{${name}}}`}
                                </button>
                            ))}
                        </div>
                    </div>
                    <div className="flex gap-2" style={{ flexWrap: 'wrap' }}>
                        <button className="btn btn-primary" onClick={save} disabled={!dirty || busy === 'save'}>
                            {busy === 'save' ? 'Saving…' : 'Save template'}
                        </button>
                        <button className="btn btn-secondary" onClick={sendTest} disabled={busy === 'test'}>
                            {busy === 'test' ? 'Sending…' : 'Send me a test'}
                        </button>
                        <button className="btn btn-secondary" onClick={reset} disabled={!active.customised || busy === 'reset'}>
                            Reset to original
                        </button>
                    </div>

                    {preview && (
                        <div className="mt-3">
                            <div className="form-label">Preview with sample details</div>
                            <div className="email-preview">
                                <div className="email-preview-subject">{preview.subject}</div>
                                <div style={{ whiteSpace: 'pre-wrap' }}>{preview.body}</div>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

function EmailLog() {
    const [rows, setRows] = useState(null);
    const [error, setError] = useState('');

    useEffect(() => {
        settingsAPI.getEmailLog(200).then(setRows).catch((err) => setError(err.message));
    }, []);

    if (error) return <div className="alert alert-danger">{error}</div>;
    if (!rows) return <div className="spinner"></div>;

    return (
        <div className="card">
            <p className="text-muted">The most recent 200 emails the system sent or tried to send.</p>
            <div className="table-container">
                <table className="table">
                    <thead>
                        <tr>
                            <th>When</th>
                            <th>To</th>
                            <th>Subject</th>
                            <th>Result</th>
                            <th>Sent by</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.length === 0 ? (
                            <tr><td colSpan="5" className="text-center text-muted">No emails yet</td></tr>
                        ) : rows.map((row) => (
                            <tr key={row.id}>
                                <td style={{ whiteSpace: 'nowrap' }}>{when(row.created_at)}</td>
                                <td>{row.to_email}</td>
                                <td>{row.subject}</td>
                                <td>
                                    <span className={`badge badge-${row.status === 'sent' ? 'success' : 'danger'}`}>{row.status}</span>
                                    {row.error && <div className="text-muted" style={{ fontSize: '0.8rem' }}>{row.error}</div>}
                                </td>
                                <td>{row.user_email || '—'}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

export default function Settings({ currentUser, license }) {
    const [tab, setTab] = useState('integrations');

    if (currentUser?.role !== 'admin') {
        return (
            <div className="card">
                <p className="text-muted">Only administrators can change settings.</p>
            </div>
        );
    }

    return (
        <div>
            <h2>Settings</h2>
            <div className="tabs mb-3">
                {TABS.map((t) => (
                    <button
                        key={t.key}
                        type="button"
                        className={`tab ${tab === t.key ? 'active' : ''}`}
                        onClick={() => setTab(t.key)}
                    >
                        {t.label}
                    </button>
                ))}
            </div>
            {tab === 'integrations' && <Integrations />}
            {tab === 'templates' && <Templates />}
            {tab === 'log' && <EmailLog />}
            {tab === 'licence' && <LicencePanel license={license} />}
        </div>
    );
}
