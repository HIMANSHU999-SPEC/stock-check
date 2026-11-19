const express = require('express');
const router = express.Router();
const tidy = require('../services/tidy');
const classifier = require('../services/classifier');
const sharepoint = require('../services/sharepoint');
const { logActivity } = require('../utils/activity');

function handleError(res, error) {
    res.status(error.status || 500).json({ error: error.message });
}

// What a name / model looks like: used by the asset form to suggest a
// category and brand as they are typed.
router.get('/classify', (req, res) => {
    try {
        const guess = tidy.suggest({ name: req.query.name, model: req.query.model, brand: req.query.brand });
        const category = guess.category
            ? tidy.categories().find((c) => c.name.toLowerCase() === guess.category.toLowerCase()) || { id: null, name: guess.category }
            : null;
        res.json({
            category,
            sure: guess.sure,
            matched: guess.matched,
            brand: guess.brand,
            electronic: classifier.isElectronic(guess.category),
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
