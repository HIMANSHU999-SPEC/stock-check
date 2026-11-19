const db = require('../database');
const classifier = require('./classifier');
const assignments = require('./assignments');

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

/**
 * Best guess for one asset, using the register's own category names.
 * Returns { category, sure, matched, brand, custom } with category '' when
 * nothing fits.
 */
function suggest(asset, context = {}) {
    const rules = context.rules || customRules();
    const names = context.names || categories().map((c) => c.name);
    const result = classifier.classify(asset, rules);
    return {
        ...result,
        category: result.custom ? result.category : classifier.resolveCategoryName(result.category, names),
        canonical: result.category
    };
}

/**
 * Fill in what a new asset was not given: its category (from the name), its
 * brand, and the home campus for electronics with nowhere else to be.
 * `fields.category` is a category name, `fields.category_id` an id; either
 * may be missing. Returns the values to store.
 */
function defaultsForNew(fields, context = {}) {
    const guess = suggest({ name: fields.name, model: fields.model, brand: fields.brand }, context);

    let categoryId = fields.category_id ? Number(fields.category_id) : null;
    let categoryName = '';
    if (categoryId) {
        categoryName = (db.prepare('SELECT name FROM categories WHERE id = ?').get(categoryId) || {}).name || '';
    } else if (String(fields.category || '').trim()) {
        ({ id: categoryId, name: categoryName } = ensureCategory(fields.category));
    } else if (guess.category) {
        ({ id: categoryId, name: categoryName } = ensureCategory(guess.category));
    }

    const givenBrand = String(fields.brand || '').trim();
    const campus = String(fields.campus || '').trim();
    return {
        category_id: categoryId,
        category: categoryName,
        brand: (givenBrand ? classifier.normaliseBrand(givenBrand) : guess.brand) || null,
        campus: campus || (classifier.isElectronic(categoryName) ? HOME_CAMPUS : '')
    };
}

/** Everything the tidy-up screen offers to change, without changing it. */
function preview() {
    const context = { rules: customRules(), names: categories().map((c) => c.name) };
    const assets = db.prepare(`
      SELECT a.id, a.asset_number, a.name, a.model, a.brand, a.campus, a.quantity, a.status,
             c.name AS category
      FROM assets a LEFT JOIN categories c ON a.category_id = c.id
      WHERE a.deleted_at IS NULL
      ORDER BY a.asset_number
    `).all();

    const proposals = [];
    for (const asset of assets) {
        const current = asset.category || '';
        const guess = suggest(asset, context);
        const proposal = { id: asset.id, asset_number: asset.asset_number, name: asset.name, model: asset.model || '' };

        // --- category
        const uncategorised = classifier.isGeneric(current);
        if (guess.category && norm(guess.category) !== norm(current)) {
            let reason = null;
            if (!current) reason = 'missing';
            else if (uncategorised) reason = 'generic';
            else if (guess.custom) reason = 'rule';
            else {
                // Only question a real category when the name clearly says
                // something else; the register's own categories are left be.
                const stands = classifier.canonicalsOf(current);
                if (stands.length && !stands.includes(guess.canonical) && guess.sure) reason = 'mismatch';
            }
            if (reason) {
                proposal.category = {
                    from: current,
                    to: guess.category,
                    reason,
                    matched: guess.matched,
                    // A different category from the one somebody chose is
                    // never pre-ticked, nor is a guess we are unsure of.
                    apply: reason !== 'mismatch' && guess.sure
                };
            }
        } else if (uncategorised && !guess.category) {
            // Could not tell: listed so a person can say what it is.
            proposal.category = { from: current, to: '', reason: 'unknown', matched: '', apply: false };
        }

        // --- brand
        const brand = String(asset.brand || '').trim();
        if (!brand && guess.brand) {
            proposal.brand = { from: '', to: guess.brand, reason: 'missing', apply: true };
        } else if (brand && classifier.normaliseBrand(brand) !== brand) {
            proposal.brand = { from: brand, to: classifier.normaliseBrand(brand), reason: 'spelling', apply: true };
        }

        // --- campus: electronics with none go to the home campus
        if (!String(asset.campus || '').trim()) {
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
        }
    };
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
    defaultsForNew,
    preview,
    apply,
    addRule,
    removeRule
};
