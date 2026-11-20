const crypto = require('crypto');
const db = require('../database');
const classifier = require('./classifier');
const assignments = require('./assignments');
const ai = require('./aiClassifier');

// Keeps the register tidy: every asset in a real category, with a brand, and
// electronics that have no campus held at the home campus until they are
// moved on. Used when an asset is added (so it starts out right) and by the
// tidy-up screen, which proposes fixes to what is already there and changes
// nothing until someone approves them.

// Where IT stock lives until it is sent somewhere else.
const HOME_CAMPUS = (process.env.HOME_CAMPUS || 'Towerhill').trim();
const MAX_CHANGES = 2000;

class TidyError extends Error {
    constructor(message, status = 400) {
        super(message);
        this.status = status;
    }
}

const norm = (value) => String(value || '').trim().toLowerCase();

function categories() {
    return db.prepare('SELECT id, name FROM categories ORDER BY name').all();
}

function customRules() {
    return db.prepare(`
      SELECT r.id, r.keyword, r.category_id, c.name AS category, r.created_by, r.created_at
      FROM category_rules r JOIN categories c ON r.category_id = c.id
      ORDER BY r.keyword
    `).all();
}

// Find a category by name (any capitalisation), creating it if it is new.
function ensureCategory(name) {
    const clean = String(name || '').trim().replace(/\s+/g, ' ').slice(0, 60);
    if (!clean) throw new TidyError('A category name is required');
    const existing = db.prepare('SELECT id, name FROM categories WHERE LOWER(name) = LOWER(?)').get(clean);
    if (existing) return existing;
    const id = db.prepare('INSERT INTO categories (name, description) VALUES (?, ?)').run(clean, '').lastInsertRowid;
    return { id, name: clean };
}

// ---------------------------------------------------------------------------
// Where a suggestion comes from, in order of authority:
//   1. the organisation's own rules ("names containing X are Y")
//   2. the AI, when an API key is configured
//   3. the built-in rules, as the fallback
// ---------------------------------------------------------------------------

// The AI is asked again only when what it was shown has changed.
function inputHash(asset) {
    return crypto.createHash('sha1').update(`${norm(asset.name)}|${norm(asset.model)}`).digest('hex');
}

function storedAiAnswers() {
    const rows = db.prepare('SELECT * FROM ai_suggestions').all();
    return new Map(rows.map((row) => [row.asset_id, row]));
}

function rememberAi(assetId, asset, answer) {
    if (!assetId || !answer) return;
    db.prepare(`
      INSERT INTO ai_suggestions (asset_id, input_hash, category, brand, electronic, confident, model, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(asset_id) DO UPDATE SET
        input_hash = excluded.input_hash, category = excluded.category, brand = excluded.brand,
        electronic = excluded.electronic, confident = excluded.confident, model = excluded.model,
        created_at = excluded.created_at
    `).run(assetId, inputHash(asset), answer.category || '', answer.brand || '',
        answer.electronic ? 1 : 0, answer.confident ? 1 : 0, ai.MODEL);
}

// An AI answer in the same shape as a rule-based one.
function fromAi(answer, names) {
    return {
        category: classifier.resolveCategoryName(answer.category, names),
        canonical: answer.category,
        matched: '',
        sure: Boolean(answer.confident),
        brand: classifier.normaliseBrand(answer.brand),
        electronic: Boolean(answer.electronic),
        source: 'ai',
        answer
    };
}

function fromRules(asset, rules, names) {
    const result = classifier.classify(asset, rules);
    const category = result.custom ? result.category : classifier.resolveCategoryName(result.category, names);
    return {
        ...result,
        category,
        canonical: result.category,
        electronic: classifier.isElectronic(category),
        source: result.custom ? 'rule' : 'builtin'
    };
}

/**
 * Best suggestion already to hand for one asset: an own rule, else a stored
 * AI answer, else the built-in rules. Never calls the AI itself.
 * Returns { category, brand, sure, electronic, source, … }, category '' when
 * nothing fits.
 */
function suggest(asset, context = {}) {
    const rules = context.rules || customRules();
    const names = context.names || categories().map((c) => c.name);
    const byRule = fromRules(asset, rules, names);
    if (byRule.custom) return byRule;

    const stored = context.ai && asset.id ? context.ai.get(asset.id) : null;
    if (stored && stored.input_hash === inputHash(asset)) {
        return fromAi({
            category: stored.category, brand: stored.brand,
            electronic: stored.electronic, confident: stored.confident
        }, names);
    }
    return byRule;
}

/**
 * Suggestions for things that are not in the register yet (the asset form,
 * an Excel or invoice import). Asks the AI when it is configured and falls
 * back to the built-in rules if it is not, or if the call fails, so adding
 * assets never depends on the AI being reachable.
 * `items` is [{ name, model, brand, ask? }]; resolves with one suggestion each.
 */
async function suggestForNew(items, { timeout } = {}) {
    const rules = customRules();
    const names = categories().map((c) => c.name);
    const guesses = items.map((item) => fromRules(item, rules, names));
    if (!ai.isConfigured()) return guesses;

    // An own rule settles it; only the rest need asking.
    const ask = [];
    items.forEach((item, index) => {
        // `ask: false` marks a row that already has everything it needs.
        if (item.ask !== false && !guesses[index].custom && String(item.name || '').trim()) {
            ask.push({
                id: index,
                name: String(item.name).trim().slice(0, 200),
                ...(item.model ? { model: String(item.model).trim().slice(0, 100) } : {}),
                ...(item.brand ? { brand: String(item.brand).trim().slice(0, 60) } : {})
            });
        }
    });
    if (ask.length === 0) return guesses;

    try {
        const answers = await ai.classifyMany(ask, names, rules, { timeout });
        answers.forEach((answer, index) => {
            guesses[index] = fromAi(answer, names);
        });
    } catch (error) {
        console.error('AI categorising failed, using the built-in rules:', error.message);
    }
    return guesses;
}

/**
 * Fill in what a new asset was not given: its category, its brand, and the
 * home campus for electronics with nowhere else to be. `fields.category` is
 * a category name, `fields.category_id` an id; either may be missing.
 * `context.guess` is a suggestion from suggestForNew; without one the rules
 * and any stored answer are used. Returns the values to store.
 */
function defaultsForNew(fields, context = {}) {
    const guess = context.guess || suggest({ name: fields.name, model: fields.model, brand: fields.brand }, context);

    let categoryId = fields.category_id ? Number(fields.category_id) : null;
    let categoryName = '';
    let guessed = false;
    if (categoryId) {
        categoryName = (db.prepare('SELECT name FROM categories WHERE id = ?').get(categoryId) || {}).name || '';
    } else if (String(fields.category || '').trim()) {
        ({ id: categoryId, name: categoryName } = ensureCategory(fields.category));
    } else if (guess.category) {
        ({ id: categoryId, name: categoryName } = ensureCategory(guess.category));
        guessed = true;
    }

    // A category we recognise says whether it is electronics; for one of the
    // register's own, go by what the suggestion made of the item.
    const recognised = classifier.canonicalsOf(categoryName).length > 0 || classifier.isGeneric(categoryName);
    const electronic = guessed || !recognised
        ? Boolean(guess.electronic) || classifier.isElectronic(categoryName)
        : classifier.isElectronic(categoryName);

    const givenBrand = String(fields.brand || '').trim();
    const campus = String(fields.campus || '').trim();
    return {
        category_id: categoryId,
        category: categoryName,
        brand: (givenBrand ? classifier.normaliseBrand(givenBrand) : guess.brand) || null,
        campus: campus || (electronic ? HOME_CAMPUS : ''),
        // kept so the answer can be stored against the new asset
        ai_answer: guess.source === 'ai' ? guess.answer : null
    };
}

function sameKind(current, guess) {
    const mine = classifier.canonicalsOf(current);
    const theirs = new Set([guess.canonical, ...classifier.canonicalsOf(guess.category)]);
    return mine.some((c) => theirs.has(c));
}

/** Everything the tidy-up screen offers to change, without changing it. */
function preview() {
    const context = { rules: customRules(), names: categories().map((c) => c.name), ai: storedAiAnswers() };
    const assets = db.prepare(`
      SELECT a.id, a.asset_number, a.name, a.model, a.brand, a.campus, a.quantity, a.status,
             c.name AS category
      FROM assets a LEFT JOIN categories c ON a.category_id = c.id
      WHERE a.deleted_at IS NULL
      ORDER BY a.asset_number
    `).all();

    const proposals = [];
    let covered = 0;
    for (const asset of assets) {
        const current = asset.category || '';
        const guess = suggest(asset, context);
        if (guess.source === 'ai') covered += 1;
        const proposal = { id: asset.id, asset_number: asset.asset_number, name: asset.name, model: asset.model || '' };

        // --- category
        const uncategorised = classifier.isGeneric(current);
        if (guess.category && norm(guess.category) !== norm(current)) {
            let reason = null;
            if (!current) reason = 'missing';
            else if (uncategorised) reason = 'generic';
            else if (guess.custom) reason = 'rule';
            else if (guess.sure && !sameKind(current, guess)) {
                // Only question a category somebody chose when the name clearly
                // says something else. The built-in rules leave the register's
                // own categories be; the AI was shown them, so it may differ.
                if (guess.source === 'ai' || classifier.canonicalsOf(current).length) reason = 'mismatch';
            }
            if (reason) {
                proposal.category = {
                    from: current,
                    to: guess.category,
                    reason,
                    source: guess.source,
                    matched: guess.matched,
                    // A different category from the one somebody chose is
                    // never pre-ticked, nor is a guess we are unsure of.
                    apply: reason !== 'mismatch' && guess.sure
                };
            }
        } else if (uncategorised && !guess.category) {
            // Could not tell: listed so a person can say what it is.
            proposal.category = { from: current, to: '', reason: 'unknown', source: guess.source, matched: '', apply: false };
        }

        // --- brand
        const brand = String(asset.brand || '').trim();
        if (!brand && guess.brand) {
            proposal.brand = { from: '', to: guess.brand, reason: 'missing', source: guess.source, apply: true };
        } else if (brand && classifier.normaliseBrand(brand) !== brand) {
            proposal.brand = { from: brand, to: classifier.normaliseBrand(brand), reason: 'spelling', source: 'builtin', apply: true };
        }

        // --- campus: electronics with none go to the home campus
        if (!String(asset.campus || '').trim()) {
            if (guess.source === 'ai') {
                // The AI judged the item itself, whatever category it ends up in.
                if (guess.electronic) {
                    proposal.campus = { from: '', to: HOME_CAMPUS, needs_category: false, apply: guess.sure };
                }
            } else {
                const effective = proposal.category && proposal.category.to ? proposal.category.to : current;
                if (classifier.isElectronic(effective)) {
                    // When it only counts as electronics because of the new
                    // category, the move goes ahead only if that is accepted too.
                    const needsCategory = !classifier.isElectronic(current);
                    proposal.campus = {
                        from: '',
                        to: HOME_CAMPUS,
                        needs_category: needsCategory,
                        apply: !needsCategory || proposal.category.apply
                    };
                }
            }
        }

        if (proposal.category || proposal.brand || proposal.campus) proposals.push(proposal);
    }

    const count = (key, test = () => true) => proposals.filter((p) => p[key] && test(p[key])).length;
    return {
        home_campus: HOME_CAMPUS,
        scanned: assets.length,
        categories: context.names,
        proposals,
        summary: {
            category: count('category', (c) => c.reason !== 'unknown'),
            category_unknown: count('category', (c) => c.reason === 'unknown'),
            brand: count('brand'),
            campus: count('campus')
        },
        ai: { configured: ai.isConfigured(), model: ai.MODEL, covered, total: assets.length, job: aiJobStatus() }
    };
}

// ---------------------------------------------------------------------------
// Running the AI over the register. It takes a little while, so it runs in
// the background and the screen polls for progress. Answers are stored as
// each batch arrives; nothing in the register changes until they are applied.
// ---------------------------------------------------------------------------
let aiJob = { running: false, total: 0, done: 0, error: null, started_at: null, finished_at: null, tokens: { input: 0, output: 0 } };

function aiJobStatus() {
    return { ...aiJob, tokens: { ...aiJob.tokens } };
}

/**
 * Ask the AI about every asset it has not already answered for (or all of
 * them with `redo`). Returns the job status straight away.
 */
function startAiRun({ redo = false } = {}) {
    if (!ai.isConfigured()) {
        throw new TidyError('AI categorising is not set up: add ANTHROPIC_API_KEY to the server\'s .env file');
    }
    if (aiJob.running) return aiJobStatus();

    const rules = customRules();
    const names = categories().map((c) => c.name);
    const stored = storedAiAnswers();
    const assets = db.prepare(`
      SELECT a.id, a.name, a.model, a.brand, c.name AS category
      FROM assets a LEFT JOIN categories c ON a.category_id = c.id
      WHERE a.deleted_at IS NULL
      ORDER BY a.id
    `).all();

    const byId = new Map(assets.map((asset) => [asset.id, asset]));
    const items = assets
        .filter((asset) => String(asset.name || '').trim())
        // An own rule already settles these.
        .filter((asset) => !fromRules(asset, rules, names).custom)
        .filter((asset) => redo || !stored.has(asset.id) || stored.get(asset.id).input_hash !== inputHash(asset))
        .map((asset) => ({
            id: asset.id,
            name: String(asset.name).trim().slice(0, 200),
            ...(asset.model ? { model: String(asset.model).trim().slice(0, 100) } : {}),
            ...(asset.brand ? { brand: String(asset.brand).trim().slice(0, 60) } : {}),
            ...(asset.category ? { current_category: asset.category } : {})
        }));

    aiJob = {
        running: items.length > 0, total: items.length, done: 0, error: null,
        started_at: new Date().toISOString(), finished_at: items.length > 0 ? null : new Date().toISOString(),
        tokens: { input: 0, output: 0 }
    };
    if (items.length === 0) return aiJobStatus();

    const job = aiJob;
    ai.classifyMany(items, names, rules, {
        onChunk: (chunk, results, usage) => {
            db.transaction(() => {
                results.forEach((answer) => rememberAi(answer.id, byId.get(answer.id), answer));
            })();
            job.done += chunk.length;
            job.tokens.input += usage.input;
            job.tokens.output += usage.output;
        }
    }).catch((error) => {
        job.error = error.message;
        console.error('AI categorising run failed:', error.message);
    }).finally(() => {
        job.running = false;
        job.finished_at = new Date().toISOString();
    });
    return aiJobStatus();
}

/**
 * Apply approved changes: [{ id, category?, brand?, campus? }]. Each asset
 * gets a history entry saying what changed. Returns counts and the ids touched.
 */
function apply(changes, user) {
    if (!Array.isArray(changes) || changes.length === 0) throw new TidyError('Nothing was selected to change');
    if (changes.length > MAX_CHANGES) throw new TidyError(`Apply at most ${MAX_CHANGES} assets at a time`);

    const result = { category: 0, brand: 0, campus: 0, ids: [], skipped: [] };
    db.transaction(() => {
        for (const change of changes) {
            const asset = db.prepare(`
              SELECT a.*, c.name AS category_name
              FROM assets a LEFT JOIN categories c ON a.category_id = c.id
              WHERE a.id = ? AND a.deleted_at IS NULL
            `).get(Number(change.id));
            if (!asset) {
                result.skipped.push({ id: change.id, reason: 'Asset no longer exists' });
                continue;
            }
            const notes = [];

            if (change.category !== undefined && String(change.category).trim()) {
                const category = ensureCategory(change.category);
                if (category.id !== asset.category_id) {
                    db.prepare('UPDATE assets SET category_id = ? WHERE id = ?').run(category.id, asset.id);
                    notes.push(`category changed from ${asset.category_name || 'none'} to ${category.name}`);
                    result.category += 1;
                }
            }

            if (change.brand !== undefined && String(change.brand).trim()) {
                const brand = String(change.brand).trim().slice(0, 60);
                if (brand !== String(asset.brand || '').trim()) {
                    db.prepare('UPDATE assets SET brand = ? WHERE id = ?').run(brand, asset.id);
                    notes.push(asset.brand ? `brand corrected from ${asset.brand} to ${brand}` : `brand set to ${brand}`);
                    result.brand += 1;
                }
            }

            if (notes.length) {
                db.prepare('UPDATE assets SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(asset.id);
                db.prepare('INSERT INTO asset_history (asset_id, action, notes, performed_by) VALUES (?, ?, ?, ?)')
                    .run(asset.id, 'updated', `Tidy-up: ${notes.join('; ')}`, user?.email || null);
            }

            let moved = false;
            if (change.campus !== undefined && String(change.campus).trim()) {
                try {
                    assignments.transfer(asset.id, { campus: String(change.campus).trim().slice(0, 80), notes: 'tidy-up' }, user);
                    result.campus += 1;
                    moved = true;
                } catch (err) {
                    // Already there: nothing to do for this one.
                    if (!(err instanceof assignments.AssignmentError)) throw err;
                }
            }

            if (notes.length || moved) result.ids.push(asset.id);
        }
    })();
    return result;
}

function addRule({ keyword, category }, user) {
    const clean = String(keyword || '').trim().replace(/\s+/g, ' ');
    if (clean.length < 3) throw new TidyError('Type at least 3 characters to match on');
    if (clean.length > 60) throw new TidyError('Keep the text to match under 60 characters');
    const target = ensureCategory(category);
    db.prepare(`
      INSERT INTO category_rules (keyword, category_id, created_by) VALUES (?, ?, ?)
      ON CONFLICT(keyword) DO UPDATE SET category_id = excluded.category_id, created_by = excluded.created_by
    `).run(clean, target.id, user?.email || null);
    return customRules();
}

function removeRule(id) {
    db.prepare('DELETE FROM category_rules WHERE id = ?').run(Number(id));
    return customRules();
}

module.exports = {
    HOME_CAMPUS,
    TidyError,
    categories,
    customRules,
    ensureCategory,
    suggest,
    suggestForNew,
    defaultsForNew,
    rememberAi,
    preview,
    startAiRun,
    aiJobStatus,
    apply,
    addRule,
    removeRule
};
