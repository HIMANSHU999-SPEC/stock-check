const express = require('express');
const router = express.Router();
const intune = require('../services/intune');
const { logActivity } = require('../utils/activity');

// Compare the register with Microsoft Intune. Read-only: it changes nothing
// on either side. Administrators and sub-administrators only (view-only
// accounts are turned away before they get here).
router.get('/check', async (req, res) => {
    try {
        const refresh = req.query.refresh === '1';
        const result = await intune.check({ refresh });
        if (refresh) {
            const s = result.summary;
            const findings = s.different + s.unassigned_here + s.gone_but_active + s.not_in_register;
            logActivity(req, {
                action: 'intune_check', entity_type: 'asset', entity_id: null,
                description: `Checked the register against Intune: ${result.intune_total} device${result.intune_total === 1 ? '' : 's'} in Intune, ${s.match} agree, ${findings} to look at`
            });
        }
        res.json(result);
    } catch (error) {
        res.status(error.status || 500).json({ error: error.message });
    }
});

module.exports = router;
