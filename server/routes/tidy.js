const express = require('express');
const router = express.Router();
const tidy = require('../services/tidy');
const sharepoint = require('../services/sharepoint');
const { logActivity } = require('../utils/activity');

function handleError(res, error) {
    res.status(error.status || 500).json({ error: error.message });
}

// The form asks again as the name is typed, corrected and retyped; remember
// recent answers for a while so the same text is not sent to the AI twice.
const recent = new Map();
const RECENT_MAX = 300;
const RECENT_MS = 15 * 60 * 1000;

async function suggestOnce(fields) {
    const key = [fields.name, fields.model, fields.brand].map((v) => String(v || '').trim().toLowerCase()).join('|');
    const hit = recent.get(key);
    if (hit && Date.now() - hit.at < RECENT_MS) return hit.guess;
    const [guess] = await tidy.suggestForNew([fields], { timeout: 8000 });
    // Only an AI answer is worth keeping; the rules are instant anyway, and a
    // rules answer may just mean the AI was briefly unreachable.
    if (guess.source === 'ai') {
        if (recent.size >= RECENT_MAX) recent.delete(recent.keys().next().value);
        recent.set(key, { guess, at: Date.now() });
    }
    return guess;
}

// What a name / model looks like: used by the asset form to suggest a
// category and brand as they are typed.
router.get('/classify', async (req, res) => {
    try {
        const guess = await suggestOnce({ name: req.query.name, model: req.query.model, brand: req.query.brand });
        const category = guess.category
            ? tidy.categories().find((c) => c.name.toLowerCase() === guess.category.toLowerCase()) || { id: null, name: guess.category }
            : null;
        res.json({
            category,
            sure: guess.sure,
            matched: guess.matched,
            brand: guess.brand,
            electronic: Boolean(guess.electronic),
            source: guess.source,
            home_campus: tidy.HOME_CAMPUS
        });
    } catch (error) {
        handleError(res, error);
    }
});

// Proposed fixes to the existing register. Read-only.
router.get('/preview', (req, res) => {
    try {
        res.json(tidy.preview());
    } catch (error) {
        handleError(res, error);
    }
});

// Ask the AI about the register, in the background. Changes nothing in the
// register: its answers show up as suggestions in the preview.
router.post('/ai-run', (req, res) => {
    try {
        const job = tidy.startAiRun({ redo: Boolean(req.body?.redo) });
        if (job.total > 0 && job.done === 0) {
            logActivity(req, {
                action: 'ai_categorise_started', entity_type: 'asset', entity_id: null,
                description: `Asked the AI to categorise ${job.total} asset${job.total === 1 ? '' : 's'}`
            });
        }
        res.status(202).json(job);
    } catch (error) {
        handleError(res, error);
    }
});

router.get('/ai-status', (req, res) => {
    res.json(tidy.aiJobStatus());
});

// Apply the fixes a person approved
router.post('/apply', (req, res) => {
    try {
        const result = tidy.apply(req.body?.changes, req.user);
        if (result.ids.length > 0) {
            const parts = [];
            if (result.category) parts.push(`${result.category} recategorised`);
            if (result.brand) parts.push(`${result.brand} brand${result.brand === 1 ? '' : 's'} filled in`);
            if (result.campus) parts.push(`${result.campus} moved to their campus`);
            logActivity(req, {
                action: 'assets_tidied', entity_type: 'asset', entity_id: null,
                description: `Tidied ${result.ids.length} asset${result.ids.length === 1 ? '' : 's'}: ${parts.join(', ')}`
            });
            result.ids.forEach((id) => sharepoint.enqueue(id));
        }
        res.json({ changed: result.ids.length, category: result.category, brand: result.brand, campus: result.campus, skipped: result.skipped });
    } catch (error) {
        handleError(res, error);
    }
});

// The organisation's own "name contains X -> category Y" rules
router.get('/rules', (req, res) => {
    try {
        res.json(tidy.customRules());
    } catch (error) {
        handleError(res, error);
    }
});

router.post('/rules', (req, res) => {
    try {
        const rules = tidy.addRule(req.body || {}, req.user);
        recent.clear();
        logActivity(req, {
            action: 'category_rule_added', entity_type: 'settings',
            description: `Category rule: names containing "${String(req.body.keyword).trim()}" are ${String(req.body.category).trim()}`
        });
        res.status(201).json(rules);
    } catch (error) {
        handleError(res, error);
    }
});

router.delete('/rules/:id', (req, res) => {
    try {
        res.json(tidy.removeRule(req.params.id));
    } catch (error) {
        handleError(res, error);
    }
});

module.exports = router;
