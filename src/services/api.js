function normalizeApiBase(rawBase) {
    if (!rawBase) return null;

    // Remove any trailing slashes to avoid double-slash requests
    const trimmed = rawBase.replace(/\/+$/, '');

    // Append /api if the provided base does not already target the API root
    if (!/\/api$/i.test(trimmed)) {
        return `${trimmed}/api`;
    }

    return trimmed;
}

const isBrowser = typeof window !== 'undefined';
const defaultApiBase = import.meta.env.DEV
    ? 'http://localhost:3001/api'
    : isBrowser
        ? `${window.location.origin}/api`
        : 'http://localhost:3001/api';

const API_BASE =
    normalizeApiBase(import.meta.env.VITE_API_BASE) ||
    normalizeApiBase(defaultApiBase);

// Helper function for API calls
async function apiCall(endpoint, options = {}) {
    const response = await fetch(`${API_BASE}${endpoint}`, {
        headers: {
            'Content-Type': 'application/json',
            ...options.headers,
        },
        ...options,
    });

    if (!response.ok) {
        let message = 'API request failed';

        try {
            const error = await response.json();
            message = error.error || message;
        } catch (_jsonError) {
            const text = await response.text();
            if (text) message = text;
        }

        throw new Error(message);
    }

    return response.json();
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
    getPricing: () => apiCall('/reports/pricing'),
    getCategories: () => apiCall('/categories'),
};
