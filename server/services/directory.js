const { entra } = require('../config');
const { graph } = require('./graph');

// Compares people on the staff list with Microsoft 365, to spot those who
// have probably left: their account there is disabled or gone. Read-only,
// needs the User.Read.All application permission. Nothing is changed on
// either side; it only tells IT who to look at.

const CACHE_MS = 10 * 60 * 1000;
const CONCURRENCY = 8;
let cache = { at: 0, states: new Map() };

async function lookUp(email) {
    try {
        const user = await graph('GET', `/users/${encodeURIComponent(email)}?$select=accountEnabled`);
        return user && user.accountEnabled === false ? 'disabled' : 'active';
    } catch (err) {
        if (err.status === 404) return 'not_found';
        // Unknown is not "left": a failed lookup must never flag anyone.
        return 'unknown';
    }
}

/**
 * Resolves with { available, checked_at, states } where states maps a
 * lower-cased email to 'active' | 'disabled' | 'not_found' | 'unknown'.
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

module.exports = { accountStates };
