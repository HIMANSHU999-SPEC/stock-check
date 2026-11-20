const { entra } = require('../config');
const { graph } = require('./graph');

// Compares people on the staff list with Microsoft 365, to spot those who
// have left: their account there is blocked (disabled) or gone, or it no
// longer carries the licence every current member of staff has. Read-only,
// needs the User.Read.All application permission. Nothing is changed on
// either side; it only tells IT who to look at.

// The licence that marks someone as current staff (Microsoft 365 A5 for
// faculty). Set STAFF_LICENCE_SKU to change it, or to "none" to skip the check.
const STAFF_LICENCE = (process.env.STAFF_LICENCE_SKU || 'M365EDU_A5_FACULTY').trim();
const CACHE_MS = 10 * 60 * 1000;
const CONCURRENCY = 8;
let cache = { at: 0, states: new Map() };

async function lookUp(email) {
    try {
        const user = await graph('GET', `/users/${encodeURIComponent(email)}?$select=accountEnabled`);
        if (user && user.accountEnabled === false) return 'disabled';
        if (STAFF_LICENCE && STAFF_LICENCE.toLowerCase() !== 'none') {
            const licences = await graph('GET', `/users/${encodeURIComponent(email)}/licenseDetails?$select=skuPartNumber`);
            const held = (licences.value || []).map((l) => String(l.skuPartNumber || '').toUpperCase());
            if (!held.includes(STAFF_LICENCE.toUpperCase())) return 'no_licence';
        }
        return 'active';
    } catch (err) {
        if (err.status === 404) return 'not_found';
        // Unknown is not "left": a failed lookup must never flag anyone.
        return 'unknown';
    }
}

/**
 * Resolves with { available, checked_at, states } where states maps a
 * lower-cased email to 'active' | 'disabled' | 'no_licence' | 'not_found' |
 * 'unknown'.
 */
async function accountStates(emails, { refresh = false } = {}) {
    if (!entra.configured) return { available: false, checked_at: null, states: new Map() };
    const wanted = [...new Set(emails.map((e) => String(e || '').trim().toLowerCase()).filter((e) => e.includes('@')))];
    if (refresh || Date.now() - cache.at > CACHE_MS) cache = { at: Date.now(), states: new Map() };

    const todo = wanted.filter((email) => !cache.states.has(email));
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, todo.length) }, async () => {
        while (next < todo.length) {
            const email = todo[next++];
            const state = await lookUp(email);
            // Don't remember a failure; try again next time.
            if (state !== 'unknown') cache.states.set(email, state);
        }
    }));

    const states = new Map(wanted.map((email) => [email, cache.states.get(email) || 'unknown']));
    return { available: true, checked_at: new Date(cache.at).toISOString(), states };
}

module.exports = { accountStates, STAFF_LICENCE };
