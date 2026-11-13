// The link encoded in a printed sticker. Scanning it with any phone camera
// opens the asset in this system; handheld scanners type it into the Scan box.
export function assetScanUrl(baseUrl, assetNumber) {
    const base = (baseUrl || window.location.origin).replace(/\/+$/, '');
    return `${base}/s/${encodeURIComponent(assetNumber)}`;
}

export const STATUS_COLORS = {
    available: 'success',
    assigned: 'info',
    maintenance: 'warning',
    repair: 'warning',
    damaged: 'danger',
    lost: 'danger',
    stolen: 'danger',
    retired: 'danger'
};

export function statusColor(status) {
    return STATUS_COLORS[status] || 'primary';
}

// "3 of 40 assigned" style summary for bulk stock; plain status otherwise.
export function availableQuantity(asset) {
    if (!asset || !['available', 'assigned'].includes(asset.status)) return 0;
    return Math.max(0, (asset.quantity || 1) - (asset.assigned_quantity || 0));
}
