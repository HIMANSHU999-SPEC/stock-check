import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { tidyAPI } from '../services/api';

// Proposes fixes to the register — a category for everything, a brand where
// the name gives it away, and a campus for electronics that have none — and
// applies only the ones that are ticked. Nothing changes until "Apply".

const REASONS = {
    missing: { text: 'no category', tone: 'info' },
    generic: { text: 'only a catch-all category', tone: 'info' },
    rule: { text: 'your rule', tone: 'success' },
    mismatch: { text: 'name suggests otherwise — check', tone: 'warning' },
    unknown: { text: 'could not tell — choose one', tone: 'warning' }
};

const VIEWS = [
    { key: 'all', label: 'Everything' },
    { key: 'category', label: 'Category' },
    { key: 'review', label: 'Needs your say' },
    { key: 'brand', label: 'Brand' },
    { key: 'campus', label: 'Campus' }
];

const needsReview = (p) => p.category && (p.category.reason === 'unknown' || !p.category.apply);

function initialChoices(proposals) {
    const choices = {};
    for (const p of proposals) {
        choices[p.id] = {
            category: Boolean(p.category?.apply),
            categoryTo: p.category?.to || '',
            brand: Boolean(p.brand?.apply),
            campus: Boolean(p.campus?.apply)
        };
    }
    return choices;
}

export default function TidyAssets() {
    const [data, setData] = useState(null);
    const [choices, setChoices] = useState({});
    const [rules, setRules] = useState([]);
    const [view, setView] = useState('all');
    const [search, setSearch] = useState('');
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState(null); // { type, text, link }
    const [newRule, setNewRule] = useState({ keyword: '', category: '' });
    const [aiJob, setAiJob] = useState(null); // the AI run in progress, if any

    // `keep` carries over what has been ticked and chosen so far (after
    // adding a rule, say) wherever the suggestion itself has not changed.
    async function load(keep = false) {
        const [preview, ruleList] = await Promise.all([tidyAPI.preview(), tidyAPI.getRules()]);
        const fresh = initialChoices(preview.proposals);
        if (keep && data) {
            const before = new Map(data.proposals.map((p) => [p.id, p]));
            for (const p of preview.proposals) {
                const old = before.get(p.id);
                if (old && choices[p.id] && (old.category?.to || '') === (p.category?.to || '')) {
                    fresh[p.id] = choices[p.id];
                }
            }
        }
        setData(preview);
        setChoices(fresh);
        setRules(ruleList);
    }

    useEffect(() => {
        load()
            .then(() => tidyAPI.aiStatus())
            // Pick up a run that is still going (started earlier, or by a colleague).
            .then((job) => { if (job.running) setAiJob(job); })
            .catch((err) => setMessage({ type: 'danger', text: err.message }));
    }, []);

    // While the AI is working, follow its progress; when it finishes, show
    // what it suggested.
    useEffect(() => {
        if (!aiJob?.running) return undefined;
        const timer = setTimeout(async () => {
            try {
                const job = await tidyAPI.aiStatus();
                setAiJob(job);
                if (!job.running) {
                    await load(true);
                    setMessage(job.error
                        ? { type: 'danger', text: `The AI stopped after ${job.done} of ${job.total}: ${job.error} What it finished is shown below.` }
                        : { type: 'success', text: `The AI has looked at ${job.done} asset${job.done === 1 ? '' : 's'}. Its suggestions are below — review them, then apply.` });
                }
            } catch (err) {
                setAiJob(null);
                setMessage({ type: 'danger', text: err.message });
            }
        }, 1500);
        return () => clearTimeout(timer);
    }, [aiJob]);

    async function runAi(redo = false) {
        if (redo && !confirm('Ask the AI again about every asset, including the ones it has already looked at?')) return;
        setMessage(null);
        try {
            const job = await tidyAPI.aiRun(redo);
            if (job.total === 0) {
                setMessage({ type: 'info', text: 'The AI has already looked at every asset. Nothing new to ask.' });
                return;
            }
            setAiJob(job);
        } catch (err) {
            setMessage({ type: 'danger', text: err.message });
        }
    }

    // Existing categories, plus any new ones the suggestions would create.
    const categoryOptions = useMemo(() => {
        if (!data) return [];
        const existing = new Set(data.categories.map((c) => c.toLowerCase()));
        const fresh = [...new Set(data.proposals.map((p) => p.category?.to).filter((c) => c && !existing.has(c.toLowerCase())))];
        return [
            ...data.categories.map((name) => ({ name, isNew: false })),
            ...fresh.sort().map((name) => ({ name, isNew: true }))
        ];
    }, [data]);

    const visible = useMemo(() => {
        if (!data) return [];
        const term = search.trim().toLowerCase();
        return data.proposals.filter((p) => {
            if (view === 'category' && !p.category) return false;
            if (view === 'review' && !needsReview(p)) return false;
            if (view === 'brand' && !p.brand) return false;
            if (view === 'campus' && !p.campus) return false;
            if (!term) return true;
            return [p.asset_number, p.name, p.model, p.category?.from, p.category?.to, p.brand?.to]
                .some((v) => (v || '').toLowerCase().includes(term));
        });
    }, [data, view, search]);

    // A campus move that only makes sense with the suggested category is
    // dropped when that category is not being applied as suggested.
    const campusAllowed = (p, choice) => !p.campus?.needs_category
        || (choice.category && choice.categoryTo === p.category.to);

    function update(id, patch) {
        setChoices((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
    }

    function setColumn(key, checked) {
        setChoices((prev) => {
            const next = { ...prev };
            for (const p of visible) {
                if (!p[key]) continue;
                // An empty category cannot be applied; leave those for a choice.
                if (key === 'category' && checked && !next[p.id].categoryTo) continue;
                next[p.id] = { ...next[p.id], [key]: checked };
            }
            return next;
        });
    }

    const changes = useMemo(() => {
        if (!data) return [];
        const list = [];
        for (const p of data.proposals) {
            const choice = choices[p.id];
            if (!choice) continue;
            const change = { id: p.id };
            if (p.category && choice.category && choice.categoryTo) change.category = choice.categoryTo;
            if (p.brand && choice.brand) change.brand = p.brand.to;
            if (p.campus && choice.campus && campusAllowed(p, choice)) change.campus = p.campus.to;
            if (Object.keys(change).length > 1) list.push(change);
        }
        return list;
    }, [data, choices]);

    const totals = {
        category: changes.filter((c) => c.category).length,
        brand: changes.filter((c) => c.brand).length,
        campus: changes.filter((c) => c.campus).length
    };
    const columnState = (key) => {
        const rows = visible.filter((p) => p[key]);
        return rows.length > 0 && rows.every((p) => choices[p.id]?.[key]);
    };

    async function apply() {
        const parts = [];
        if (totals.category) parts.push(`${totals.category} categor${totals.category === 1 ? 'y' : 'ies'}`);
        if (totals.brand) parts.push(`${totals.brand} brand${totals.brand === 1 ? '' : 's'}`);
        if (totals.campus) parts.push(`${totals.campus} move${totals.campus === 1 ? '' : 's'} to ${data.home_campus}`);
        if (!confirm(`Apply ${parts.join(', ')} across ${changes.length} asset${changes.length === 1 ? '' : 's'}?`)) return;

        setBusy(true);
        setMessage(null);
        try {
            const result = await tidyAPI.apply(changes);
            await load();
            setMessage({
                type: 'success',
                text: `Done: ${result.category} recategorised, ${result.brand} brand${result.brand === 1 ? '' : 's'} filled in, ${result.campus} moved to ${data.home_campus}.`,
                link: result.campus > 0 ? data.home_campus : null
            });
        } catch (err) {
            setMessage({ type: 'danger', text: err.message });
        } finally {
            setBusy(false);
        }
    }

    async function addRule(e) {
        e.preventDefault();
        try {
            setRules(await tidyAPI.addRule(newRule.keyword, newRule.category));
            setNewRule({ keyword: '', category: '' });
            await load(true);
            setMessage({ type: 'success', text: 'Rule saved — the suggestions above now use it.' });
        } catch (err) {
            setMessage({ type: 'danger', text: err.message });
        }
    }

    async function removeRule(rule) {
        if (!confirm(`Remove the rule for "${rule.keyword}"?`)) return;
        try {
            setRules(await tidyAPI.removeRule(rule.id));
            await load(true);
        } catch (err) {
            setMessage({ type: 'danger', text: err.message });
        }
    }

    if (!data) {
        return message ? <div className={`alert alert-${message.type}`}>{message.text}</div> : <div className="spinner"></div>;
    }

    const counts = {
        all: data.proposals.length,
        category: data.proposals.filter((p) => p.category).length,
        review: data.proposals.filter(needsReview).length,
        brand: data.summary.brand,
        campus: data.summary.campus
    };

    return (
        <div>
            <div className="flex justify-between items-center mb-2" style={{ flexWrap: 'wrap', gap: '0.5rem' }}>
                <h2 style={{ marginBottom: 0 }}>Tidy up assets</h2>
                <Link to="/assets" className="btn btn-secondary">Back to assets</Link>
            </div>
            <p className="text-muted mb-3">
                Works out each asset's category and brand from its name, and puts electronics that have no campus
                under <strong>{data.home_campus}</strong>, ready to be moved on. Review the suggestions, untick or
                change anything that is wrong, then apply. Nothing changes until you do.
            </p>

            {message && (
                <div className={`alert alert-${message.type}`}>
                    {message.text}{' '}
                    {message.link && (
                        <Link to={`/assets?campus=${encodeURIComponent(message.link)}`} className="text-primary">
                            See what is at {message.link} and move it on
                        </Link>
                    )}
                </div>
            )}

            <div className="card mb-3 ai-panel">
                <div>
                    <h3 className="card-title">✨ Categorise with AI</h3>
                    {!data.ai.configured ? (
                        <p className="text-muted">
                            AI categorising is switched off, so the suggestions below come from built-in rules. To
                            turn it on, an administrator adds an Anthropic API key
                            (<code>ANTHROPIC_API_KEY</code>) to the server's <code>.env</code> file and restarts it.
                        </p>
                    ) : aiJob?.running ? (
                        <>
                            <p>Asking the AI… {aiJob.done} of {aiJob.total} assets done. You can leave this page; it carries on.</p>
                            <div className="ai-progress">
                                <span style={{ width: `${aiJob.total ? Math.round((aiJob.done / aiJob.total) * 100) : 0}%` }} />
                            </div>
                        </>
                    ) : (
                        <p className="text-muted">
                            {data.ai.covered === 0
                                ? 'The AI reads each asset\'s name and works out its category and brand, including names the built-in rules cannot make sense of.'
                                : data.ai.covered >= data.ai.total
                                    ? `The AI has looked at all ${data.ai.total} assets.`
                                    : `The AI has looked at ${data.ai.covered} of ${data.ai.total} assets; the rest use built-in rules until it does.`}{' '}
                            It only suggests: nothing changes until you apply. Only each asset's name, model, brand and
                            current category are sent to Anthropic — nothing about people, serial numbers or prices.
                        </p>
                    )}
                </div>
                {data.ai.configured && !aiJob?.running && (
                    <div className="flex gap-2" style={{ flexWrap: 'wrap' }}>
                        {data.ai.covered < data.ai.total && (
                            <button className="btn btn-primary" onClick={() => runAi(false)}>
                                ✨ {data.ai.covered === 0 ? 'Categorise with AI' : 'Categorise the rest with AI'}
                            </button>
                        )}
                        {data.ai.covered > 0 && (
                            <button className="btn btn-secondary" onClick={() => runAi(true)}>Ask again for all</button>
                        )}
                    </div>
                )}
            </div>

            <div className="stats-grid">
                <div className="stat-card">
                    <div className="stat-label">Categories to fix</div>
                    <div className="stat-value">{data.summary.category}</div>
                    <div className="text-muted">
                        {data.summary.category_unknown > 0
                            ? `plus ${data.summary.category_unknown} we could not tell`
                            : `of ${data.scanned} assets checked`}
                    </div>
                </div>
                <div className="stat-card">
                    <div className="stat-label">Brands to fill in</div>
                    <div className="stat-value">{data.summary.brand}</div>
                    <div className="text-muted">missing, or spelt differently</div>
                </div>
                <div className="stat-card">
                    <div className="stat-label">Electronics with no campus</div>
                    <div className="stat-value">{data.summary.campus}</div>
                    <div className="text-muted">to go under {data.home_campus}</div>
                </div>
            </div>

            {data.proposals.length === 0 ? (
                <div className="card mb-3">
                    <p style={{ marginBottom: 0 }}>
                        ✅ Nothing to tidy. All {data.scanned} assets have a category, and no electronics are without a campus.
                    </p>
                </div>
            ) : (
                <>
                    <div className="tidy-bar">
                        <div className="tabs" style={{ borderBottom: 'none' }}>
                            {VIEWS.map((v) => (
                                <button
                                    key={v.key}
                                    type="button"
                                    className={`tab ${view === v.key ? 'active' : ''}`}
                                    onClick={() => setView(v.key)}
                                >
                                    {v.label} ({counts[v.key]})
                                </button>
                            ))}
                        </div>
                        <input
                            type="text"
                            className="form-control"
                            style={{ maxWidth: '16rem' }}
                            placeholder="Search…"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                        />
                    </div>

                    <div className="card mb-3">
                        <div className="table-container">
                            <table className="table tidy-table">
                                <thead>
                                    <tr>
                                        <th>Asset</th>
                                        <th>
                                            <label className="flex items-center gap-1">
                                                <input
                                                    type="checkbox"
                                                    checked={columnState('category')}
                                                    onChange={(e) => setColumn('category', e.target.checked)}
                                                    aria-label="Tick every category change shown"
                                                />
                                                Category
                                            </label>
                                        </th>
                                        <th>
                                            <label className="flex items-center gap-1">
                                                <input
                                                    type="checkbox"
                                                    checked={columnState('brand')}
                                                    onChange={(e) => setColumn('brand', e.target.checked)}
                                                    aria-label="Tick every brand change shown"
                                                />
                                                Brand
                                            </label>
                                        </th>
                                        <th>
                                            <label className="flex items-center gap-1">
                                                <input
                                                    type="checkbox"
                                                    checked={columnState('campus')}
                                                    onChange={(e) => setColumn('campus', e.target.checked)}
                                                    aria-label="Tick every campus move shown"
                                                />
                                                Campus
                                            </label>
                                        </th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {visible.length === 0 ? (
                                        <tr><td colSpan="4" className="text-center text-muted">Nothing here</td></tr>
                                    ) : visible.map((p) => {
                                        const choice = choices[p.id] || {};
                                        const reason = p.category ? REASONS[p.category.reason] : null;
                                        const canMove = p.campus && campusAllowed(p, choice);
                                        return (
                                            <tr key={p.id}>
                                                <td>
                                                    <Link to={`/assets/${p.id}`} className="text-primary">
                                                        <strong>{p.asset_number}</strong>
                                                    </Link>
                                                    <div className="cell-clamp" title={p.name}>{p.name}</div>
                                                    {p.model && <div className="text-muted" style={{ fontSize: '0.85rem' }}>{p.model}</div>}
                                                </td>
                                                <td>
                                                    {p.category ? (
                                                        <div className="tidy-change">
                                                            <input
                                                                type="checkbox"
                                                                checked={Boolean(choice.category)}
                                                                disabled={!choice.categoryTo}
                                                                onChange={(e) => update(p.id, {
                                                                    category: e.target.checked,
                                                                    // the move that depends on it follows
                                                                    ...(p.campus?.needs_category ? { campus: e.target.checked } : {})
                                                                })}
                                                                aria-label={`Change category of ${p.asset_number}`}
                                                            />
                                                            <div>
                                                                <div>
                                                                    <span className="text-muted">{p.category.from || 'None'} →</span>{' '}
                                                                    <select
                                                                        className="form-control tidy-select"
                                                                        value={choice.categoryTo}
                                                                        onChange={(e) => update(p.id, {
                                                                            categoryTo: e.target.value,
                                                                            category: Boolean(e.target.value),
                                                                            ...(p.campus?.needs_category
                                                                                ? { campus: e.target.value === p.category.to }
                                                                                : {})
                                                                        })}
                                                                    >
                                                                        <option value="">Choose…</option>
                                                                        {categoryOptions.map((c) => (
                                                                            <option key={c.name} value={c.name}>
                                                                                {c.name}{c.isNew ? ' (new)' : ''}
                                                                            </option>
                                                                        ))}
                                                                    </select>
                                                                </div>
                                                                <span className={`badge badge-${reason.tone}`}>{reason.text}</span>
                                                                {p.category.source === 'ai' && (
                                                                    <span className="badge badge-primary" style={{ marginLeft: '0.3rem' }} title="Suggested by the AI">✨ AI</span>
                                                                )}
                                                            </div>
                                                        </div>
                                                    ) : <span className="text-muted">—</span>}
                                                </td>
                                                <td>
                                                    {p.brand ? (
                                                        <label className="tidy-change">
                                                            <input
                                                                type="checkbox"
                                                                checked={Boolean(choice.brand)}
                                                                onChange={(e) => update(p.id, { brand: e.target.checked })}
                                                            />
                                                            <span>
                                                                <span className="text-muted">{p.brand.from || 'None'} →</span>{' '}
                                                                <strong>{p.brand.to}</strong>
                                                            </span>
                                                        </label>
                                                    ) : <span className="text-muted">—</span>}
                                                </td>
                                                <td>
                                                    {p.campus ? (
                                                        <label className="tidy-change" title={canMove ? '' : 'Only applies with the suggested category'}>
                                                            <input
                                                                type="checkbox"
                                                                checked={Boolean(choice.campus) && canMove}
                                                                disabled={!canMove}
                                                                onChange={(e) => update(p.id, { campus: e.target.checked })}
                                                            />
                                                            <span>
                                                                <span className="text-muted">None →</span> <strong>{p.campus.to}</strong>
                                                            </span>
                                                        </label>
                                                    ) : <span className="text-muted">—</span>}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    {/* Stays in view while scrolling a long list */}
                    <div className="tidy-apply">
                        <span>
                            Ticked: <strong>{totals.category}</strong> categor{totals.category === 1 ? 'y' : 'ies'},{' '}
                            <strong>{totals.brand}</strong> brand{totals.brand === 1 ? '' : 's'},{' '}
                            <strong>{totals.campus}</strong> move{totals.campus === 1 ? '' : 's'} to {data.home_campus}
                        </span>
                        <button className="btn btn-primary" onClick={apply} disabled={busy || changes.length === 0}>
                            {busy ? 'Applying…' : `Apply to ${changes.length} asset${changes.length === 1 ? '' : 's'}`}
                        </button>
                    </div>
                </>
            )}

            <div className="card">
                <div className="card-header">
                    <h3 className="card-title">Teach it your own rules</h3>
                </div>
                <p className="text-muted">
                    If it keeps getting something wrong, or cannot tell what something is, say so once: any asset whose
                    name or model contains the text is put in that category. Your rules win over the built-in ones,
                    and apply to new assets as well.
                </p>
                <form onSubmit={addRule} className="flex gap-2 items-center mb-2" style={{ flexWrap: 'wrap' }}>
                    <span>Names containing</span>
                    <input
                        type="text"
                        className="form-control"
                        style={{ maxWidth: '14rem' }}
                        placeholder="e.g. ActivPanel"
                        value={newRule.keyword}
                        onChange={(e) => setNewRule({ ...newRule, keyword: e.target.value })}
                        required
                        minLength={3}
                    />
                    <span>are</span>
                    <select
                        className="form-control"
                        style={{ maxWidth: '14rem' }}
                        value={newRule.category}
                        onChange={(e) => setNewRule({ ...newRule, category: e.target.value })}
                        required
                    >
                        <option value="">Choose a category…</option>
                        {categoryOptions.map((c) => (
                            <option key={c.name} value={c.name}>{c.name}{c.isNew ? ' (new)' : ''}</option>
                        ))}
                    </select>
                    <button type="submit" className="btn btn-primary">Add rule</button>
                </form>
                {rules.length === 0 ? (
                    <p className="text-muted" style={{ marginBottom: 0 }}>No rules of your own yet.</p>
                ) : (
                    <div className="flex gap-1" style={{ flexWrap: 'wrap' }}>
                        {rules.map((rule) => (
                            <span key={rule.id} className="rule-chip">
                                “{rule.keyword}” → <strong>{rule.category}</strong>
                                <button type="button" onClick={() => removeRule(rule)} aria-label={`Remove rule for ${rule.keyword}`}>
                                    ×
                                </button>
                            </span>
                        ))}
                    </div>
                )}
                <p className="text-muted mt-2" style={{ marginBottom: 0, fontSize: '0.9rem' }}>
                    Need a category that is not in the list? Add it under <Link to="/categories" className="text-primary">Categories</Link> first.
                </p>
            </div>
        </div>
    );
}
