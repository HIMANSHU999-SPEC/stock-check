const API_BASE = 'http://localhost:3001/api';
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
    importBulk: (items, createMissingCategories = true) =>
        apiCall('/assets/import', { method: 'POST', body: JSON.stringify({ items, createMissingCategories }) }),
    exportByCategory: (category) =>
        downloadCsv(`/assets/export/by-category${category ? `?category=${category}` : ''}`, 'assets-by-category.csv'),
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
    getCategories: () => apiCall('/categories'),
};

// Auth & license
export const authAPI = {
    login: (email, password) => apiCall('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
    me: () => apiCall('/auth/me'),
    license: () => apiCall('/auth/license'),
    activate: (code) => apiCall('/auth/activate', { method: 'POST', body: JSON.stringify({ code }) }),
};
