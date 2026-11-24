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
