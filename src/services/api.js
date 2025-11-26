const API_BASE = 'http://localhost:3001/api';
const TOKEN_KEY = 'auth_token';

function getAuthToken() {
    if (typeof localStorage === 'undefined') return null;
    return localStorage.getItem(TOKEN_KEY);
}

// Helper function for API calls
async function apiCall(endpoint, options = {}) {
    const token = getAuthToken();
    const response = await fetch(`${API_BASE}${endpoint}`, {
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
};

// Employees API
export const employeesAPI = {
    getAll: () => apiCall('/employees'),
    getById: (id) => apiCall(`/employees/${id}`),
    create: (data) => apiCall('/employees', { method: 'POST', body: JSON.stringify(data) }),
    update: (id, data) => apiCall(`/employees/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id) => apiCall(`/employees/${id}`, { method: 'DELETE' }),
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
