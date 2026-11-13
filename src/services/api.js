// Relative base so API calls resolve against the current origin. In production
// nginx proxies /api/ to the backend; in dev the Vite server proxies /api to
// http://localhost:3001 (see vite.config.js). Override with VITE_API_BASE if needed.
const API_BASE = import.meta.env.VITE_API_BASE || '/api';
const TOKEN_KEY = 'auth_token';

function getAuthToken() {
    if (typeof localStorage === 'undefined') return null;
    return localStorage.getItem(TOKEN_KEY);
}

function withTokenQuery(endpoint) {
    const token = getAuthToken();
    if (!token) return endpoint;
    const separator = endpoint.includes('?') ? '&' : '?';
    return `${endpoint}${separator}token=${encodeURIComponent(token)}`;
}

async function apiDownload(endpoint, options = {}) {
    const token = getAuthToken();
    let response;
    try {
        response = await fetch(`${API_BASE}${withTokenQuery(endpoint)}`, {
            headers: {
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
                ...options.headers,
            },
            ...options,
        });
    } catch (err) {
        throw new Error('Network error while contacting export API');
    }

    if (!response.ok) {
        let errorMsg = 'API request failed';
        try {
            const err = await response.json();
            errorMsg = err.error || errorMsg;
        } catch (e) {
            try {
                const text = await response.text();
                errorMsg = text || errorMsg;
            } catch (e2) {
                // ignore parse errors
            }
        }
        throw new Error(errorMsg);
    }

    return response.blob();
}

export async function downloadCsv(endpoint, filename, options = {}) {
    const blob = await apiDownload(endpoint, options);
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
}

export async function downloadFile(endpoint, filename, options = {}) {
    return downloadCsv(endpoint, filename, options);
}

// Helper function for API calls
async function apiCall(endpoint, options = {}) {
    const token = getAuthToken();
    const response = await fetch(`${API_BASE}${withTokenQuery(endpoint)}`, {
        headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...options.headers,
        },
        ...options,
    });

    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'API request failed');
    }

    return response.json();
}

export function saveAuthToken(token) {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(TOKEN_KEY, token);
}

export function clearAuthToken() {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(TOKEN_KEY);
}

// Assets API
export const assetsAPI = {
    getAll: (params = {}) => {
        const query = new URLSearchParams(params).toString();
        return apiCall(`/assets${query ? `?${query}` : ''}`);
    },
    getById: (id) => apiCall(`/assets/${id}`),
    create: (data) => apiCall('/assets', { method: 'POST', body: JSON.stringify(data) }),
    update: (id, data) => apiCall(`/assets/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id) => apiCall(`/assets/${id}`, { method: 'DELETE' }),
    assign: (id, data) => apiCall(`/assets/${id}/assign`, { method: 'POST', body: JSON.stringify(data) }),
    return: (id, data) => apiCall(`/assets/${id}/return`, { method: 'POST', body: JSON.stringify(data) }),
    confirmHolder: (id, assignmentId) => apiCall(`/assets/${id}/assignments/${assignmentId}/confirm`, { method: 'POST' }),
    reassign: (id, data) => apiCall(`/assets/${id}/reassign`, { method: 'POST', body: JSON.stringify(data) }),
    transfer: (id, data) => apiCall(`/assets/${id}/transfer`, { method: 'POST', body: JSON.stringify(data) }),
    // Move many assets to one campus: { ids, campus, location?, notes? }
    bulkTransfer: (data) => apiCall('/assets/bulk-transfer', { method: 'POST', body: JSON.stringify(data) }),
    // Resolve a scanned sticker (link or bare number) or a typed serial number
    lookup: (code) => apiCall(`/assets/lookup?code=${encodeURIComponent(code)}`),
    sendEmail: (id, template, assignmentId) =>
        apiCall(`/assets/${id}/email`, {
            method: 'POST',
            body: JSON.stringify({ template, assignment_id: assignmentId })
        }),
    importBulk: (items, createMissingCategories = true) =>
        apiCall('/assets/import', { method: 'POST', body: JSON.stringify({ items, createMissingCategories }) }),
    restore: (id, password) =>
        apiCall(`/assets/${id}/restore`, { method: 'POST', body: JSON.stringify({ password }) }),
    recycleBin: {
        list: () => apiCall('/assets/bin'),
        get: (id) => apiCall(`/assets/bin/${id}`)
    },
    exportByCategory: (category) =>
        downloadCsv(`/assets/export/by-category${category ? `?category=${category}` : ''}`, 'assets-by-category.csv'),
    exportBySupplier: (supplier) =>
        downloadCsv(
            `/assets/export/by-supplier${supplier !== undefined ? `?supplier=${encodeURIComponent(supplier)}` : ''}`,
            'assets-by-supplier.csv'
        ),
    exportByCampus: (campus) =>
        downloadCsv(
            `/assets/export/by-campus${campus !== undefined ? `?campus=${encodeURIComponent(campus)}` : ''}`,
            'assets-by-campus.csv'
        ),
    exportByModel: (model) =>
        downloadCsv(
            `/assets/export/by-model${model !== undefined ? `?model=${encodeURIComponent(model)}` : ''}`,
            'assets-by-model.csv'
        ),
    exportAssignments: (employeeIds = []) => {
        const ids = Array.isArray(employeeIds) ? employeeIds.filter(Boolean) : [];
        if (ids.length === 1) {
            const id = ids[0];
            return downloadFile(`/assets/export/by-employees?employee_ids=${encodeURIComponent(id)}`, `assigned-assets-${id}.pdf`);
        }
        if (ids.length > 1) {
            return downloadFile('/assets/export/by-employees', 'assigned-assets.zip', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ employee_ids: ids })
            });
        }
        // No selection: export all assigned as ZIP
        return downloadFile('/assets/export/by-employees', 'assigned-assets.zip');
    }
};

// Employees API
export const employeesAPI = {
    getAll: () => apiCall('/employees'),
    getById: (id) => apiCall(`/employees/${id}`),
    create: (data) => apiCall('/employees', { method: 'POST', body: JSON.stringify(data) }),
    update: (id, data) => apiCall(`/employees/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id) => apiCall(`/employees/${id}`, { method: 'DELETE' }),
    deactivate: (id, note) =>
        apiCall(`/employees/${id}/deactivate`, { method: 'POST', body: JSON.stringify({ note }) }),
    confirmAssets: (id) => apiCall(`/employees/${id}/confirm-assets`, { method: 'POST' }),
    reactivate: (id) => apiCall(`/employees/${id}/reactivate`, { method: 'POST' }),
    exportReport: (id) => downloadFile(`/employees/${id}/report`, `employee-${id}-report.pdf`),
};

// Categories API
export const categoriesAPI = {
    getAll: () => apiCall('/categories'),
    getById: (id) => apiCall(`/categories/${id}`),
    create: (data) => apiCall('/categories', { method: 'POST', body: JSON.stringify(data) }),
    update: (id, data) => apiCall(`/categories/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id) => apiCall(`/categories/${id}`, { method: 'DELETE' }),
};

// Reports API
export const reportsAPI = {
    getSummary: () => apiCall('/reports/summary'),
    getByCategory: () => apiCall('/reports/by-category'),
    getByStatus: () => apiCall('/reports/by-status'),
    getBySupplier: () => apiCall('/reports/by-supplier'),
    getByCampus: () => apiCall('/reports/by-campus'),
    getByModel: () => apiCall('/reports/by-model'),
    getByBrand: () => apiCall('/reports/by-brand'),
    getCategories: () => apiCall('/categories'),
};

// Books / Library API
export const booksAPI = {
    getAll: (params = {}) => {
        const query = new URLSearchParams(params).toString();
        return apiCall(`/books${query ? `?${query}` : ''}`);
    },
    getById: (id) => apiCall(`/books/${id}`),
    lookup: (number) => apiCall(`/books/lookup?number=${encodeURIComponent(number)}`),
    lookupIsbn: (isbn) => apiCall(`/books/isbn/${encodeURIComponent(isbn)}`),
    rapidAdd: (isbn, extras = {}) =>
        apiCall('/books/rapid', { method: 'POST', body: JSON.stringify({ isbn, ...extras }) }),
    adjustQuantity: (id, delta) =>
        apiCall(`/books/${id}/quantity`, { method: 'POST', body: JSON.stringify({ delta }) }),
    getSettings: () => apiCall('/books/settings'),
    saveSettings: (data) => apiCall('/books/settings', { method: 'PUT', body: JSON.stringify(data) }),
    create: (data) => apiCall('/books', { method: 'POST', body: JSON.stringify(data) }),
    update: (id, data) => apiCall(`/books/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id) => apiCall(`/books/${id}`, { method: 'DELETE' }),
    importBulk: (items) => apiCall('/books/import', { method: 'POST', body: JSON.stringify({ items }) }),
    summary: () => apiCall('/books/summary'),
    // Loans
    issue: (data) => apiCall('/books/issue', { method: 'POST', body: JSON.stringify(data) }),
    getLoans: (params = {}) => {
        const query = new URLSearchParams(params).toString();
        return apiCall(`/books/loans${query ? `?${query}` : ''}`);
    },
    returnLoan: (loanId, notes) =>
        apiCall(`/books/loans/${loanId}/return`, { method: 'POST', body: JSON.stringify({ notes }) }),
    exportInventory: () => downloadCsv('/books/export', 'books-inventory.csv'),
};

// Borrowers API (students & staff)
export const borrowersAPI = {
    getAll: (params = {}) => {
        const query = new URLSearchParams(params).toString();
        return apiCall(`/borrowers${query ? `?${query}` : ''}`);
    },
    getById: (id) => apiCall(`/borrowers/${id}`),
    create: (data) => apiCall('/borrowers', { method: 'POST', body: JSON.stringify(data) }),
    update: (id, data) => apiCall(`/borrowers/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id) => apiCall(`/borrowers/${id}`, { method: 'DELETE' }),
};

// Invoice import: parse a supplier invoice PDF, then create the reviewed items
export const invoiceAPI = {
    parse: async (file) => {
        const token = getAuthToken();
        const form = new FormData();
        form.append('file', file);
        const response = await fetch(`${API_BASE}/assets/parse-invoice`, {
            method: 'POST',
            headers: token ? { Authorization: `Bearer ${token}` } : {},
            body: form
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || 'Could not parse the invoice');
        return data;
    },
    import: (payload) => apiCall('/assets/import-invoice', { method: 'POST', body: JSON.stringify(payload) })
};

// Asset documents (purchase invoices etc.)
export const documentsAPI = {
    list: (assetId) => apiCall(`/assets/${assetId}/documents`),
    upload: async (assetId, file) => {
        const token = getAuthToken();
        const form = new FormData();
        form.append('file', file);
        const response = await fetch(`${API_BASE}/assets/${assetId}/documents`, {
            method: 'POST',
            headers: token ? { Authorization: `Bearer ${token}` } : {},
            body: form
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(data.error || 'Upload failed');
        }
        return data;
    },
    delete: (assetId, docId) => apiCall(`/assets/${assetId}/documents/${docId}`, { method: 'DELETE' }),
    viewUrl: (assetId, docId) => `${API_BASE}${withTokenQuery(`/assets/${assetId}/documents/${docId}/download`)}`
};

// Users API (admin-only)
export const usersAPI = {
    getAll: () => apiCall('/users'),
    staffCandidates: () => apiCall('/users/staff-candidates'),
    create: (data) => apiCall('/users', { method: 'POST', body: JSON.stringify(data) }),
    update: (id, data) => apiCall(`/users/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id) => apiCall(`/users/${id}`, { method: 'DELETE' }),
};

// Activity log / audit trail API
export const activityAPI = {
    list: (params = {}) => {
        const query = new URLSearchParams(params).toString();
        return apiCall(`/activity${query ? `?${query}` : ''}`);
    },
};

// Campus-wise stock position
export const inventoryAPI = {
    summary: () => apiCall('/inventory/summary'),
    locations: (campus) =>
        apiCall(`/inventory/locations${campus !== undefined ? `?campus=${encodeURIComponent(campus)}` : ''}`),
};

// Settings: integrations, email templates, SharePoint sync
let publicSettingsPromise = null;
export const settingsAPI = {
    // Needed on most screens, so fetched once and shared.
    getPublic: () => {
        if (!publicSettingsPromise) {
            publicSettingsPromise = apiCall('/settings/public').catch((err) => {
                publicSettingsPromise = null;
                throw err;
            });
        }
        return publicSettingsPromise;
    },
    clearPublicCache: () => { publicSettingsPromise = null; },
    getIntegrations: () => apiCall('/settings/integrations'),
    saveIntegrations: (data) => apiCall('/settings/integrations', { method: 'PUT', body: JSON.stringify(data) }),
    getTemplates: () => apiCall('/settings/email-templates'),
    saveTemplate: (key, data) =>
        apiCall(`/settings/email-templates/${key}`, { method: 'PUT', body: JSON.stringify(data) }),
    resetTemplate: (key) => apiCall(`/settings/email-templates/${key}/reset`, { method: 'POST' }),
    previewTemplate: (key, data) =>
        apiCall(`/settings/email-templates/${key}/preview`, { method: 'POST', body: JSON.stringify(data) }),
    sendTestEmail: (data) => apiCall('/settings/email-test', { method: 'POST', body: JSON.stringify(data) }),
    getEmailLog: (limit = 100) => apiCall(`/settings/email-log?limit=${limit}`),
    testSharePoint: () => apiCall('/settings/sharepoint/test', { method: 'POST' }),
    syncSharePoint: () => apiCall('/settings/sharepoint/sync-all', { method: 'POST' }),
    retrySharePoint: () => apiCall('/settings/sharepoint/retry-failed', { method: 'POST' }),
};

// Emails that are not about a single asset
export const mailAPI = {
    libraryOverdue: (borrowerId) =>
        apiCall('/mail/library-overdue', { method: 'POST', body: JSON.stringify({ borrower_id: borrowerId }) }),
};

// What is recorded against the person signed in (open to all staff)
export const myAPI = {
    assets: () => apiCall('/my/assets'),
    confirm: (assignmentId) => apiCall(`/my/assets/${assignmentId}/confirm`, { method: 'POST' }),
    report: (data) => apiCall('/my/reports', { method: 'POST', body: JSON.stringify(data) }),
};

// Problems staff have raised, for IT
export const staffReportsAPI = {
    list: () => apiCall('/staff-reports'),
    count: () => apiCall('/staff-reports/count'),
    leavers: (refresh = false) => apiCall(`/staff-reports/leavers${refresh ? '?refresh=1' : ''}`),
    resolve: (id, note) => apiCall(`/staff-reports/${id}/resolve`, { method: 'POST', body: JSON.stringify({ note }) }),
};

// Auth & license
export const authAPI = {
    login: (email, password) => apiCall('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
    me: () => apiCall('/auth/me'),
    license: () => apiCall('/auth/license'),
    ssoConfig: () => apiCall('/auth/sso/config'),
    // A full-page navigation, not a fetch: the browser has to follow the
    // redirect to Microsoft and back.
    ssoLoginUrl: (returnTo = '/') => `${API_BASE}/auth/sso/login?returnTo=${encodeURIComponent(returnTo)}`,
};
