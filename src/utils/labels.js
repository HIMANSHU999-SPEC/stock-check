// The stored name of an action ("status_change", "sale_undone") as words a
// person would use ("Status change", "Sale undone").
const SPECIAL = {
    sso_login: 'Signed in with Microsoft',
    login: 'Signed in',
    ai_categorise_started: 'AI categorising started',
    intune_check: 'Intune check'
};

export function actionLabel(action) {
    if (!action) return '—';
    const key = String(action).toLowerCase();
    if (SPECIAL[key]) return SPECIAL[key];
    const words = key.replace(/_/g, ' ').trim();
    return words.charAt(0).toUpperCase() + words.slice(1);
}

// What the totals leave out, in words: "Excludes sold items", or with lost,
// stolen and retired added when the organisation has chosen not to count them.
export function notCountedNote(statuses) {
    const list = Array.isArray(statuses) && statuses.length ? statuses : ['sold'];
    const words = list.length === 1 ? list[0] : `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
    return `Excludes ${words} items`;
}
