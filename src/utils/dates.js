// The server stores times as UTC text ("2026-11-23 19:26:12"). These turn
// them into the reader's own date and time.

function parse(value) {
    if (!value) return null;
    const text = String(value);
    const date = new Date(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(text) ? `${text.replace(' ', 'T')}Z` : text);
    return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDate(value, fallback = '—') {
    const date = parse(value);
    return date ? date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : fallback;
}

export function formatDateTime(value, fallback = '—') {
    const date = parse(value);
    return date
        ? date.toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
        : fallback;
}
