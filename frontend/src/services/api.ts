const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8080';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
    const token = localStorage.getItem('auth_token');
    const headers: HeadersInit = {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options?.headers,
    };

    const res = await fetch(`${API_BASE}${path}`, { ...options, headers });

    if (!res.ok) {
        if (res.status === 401) {
            // Token expired or invalid
            localStorage.removeItem('auth_token');
            // Only redirect if we're not already on the login page or checking /me
            if (window.location.pathname !== '/login' && path !== '/auth/me') {
                window.location.href = '/login';
            }
        }

        const error = await res.json().catch(() => ({ error: 'Request failed' }));
        throw new Error(error.error || `HTTP ${res.status}`);
    }

    return res.json();
}

export const api = {
    // Services
    getServices: () =>
        request<{ data: import('../types').Service[] }>('/api/services'),

    getService: (id: string) =>
        request<{ data: import('../types').Service }>(`/api/services/${id}`),

    // Recommendations
    getRecommendations: (serviceIds: string[]) =>
        request<{ data: import('../types').RecommendationResponse }>('/api/recommendations', {
            method: 'POST',
            body: JSON.stringify({ service_ids: serviceIds }),
        }),

    // Shopping List
    getShoppingList: (recommendationId: string) =>
        request<{ data: import('../types').ShoppingListResponse }>('/api/shopping-list', {
            method: 'POST',
            body: JSON.stringify({ recommendation_id: recommendationId }),
        }),

    // Auth
    googleLogin: (data: { google_id: string; email: string; name: string; avatar_url: string }) =>
        request<{ data: { token: string; user: import('../types').User } }>('/auth/google', {
            method: 'POST',
            body: JSON.stringify(data),
        }),

    getCurrentUser: () =>
        request<{ data: import('../types').User }>('/auth/me'),

    // Selections
    getSelections: () =>
        request<{ data: import('../types').UserSelection[] }>('/api/selections'),

    addSelection: (serviceId: string) =>
        request<{ data: import('../types').UserSelection }>('/api/selections', {
            method: 'POST',
            body: JSON.stringify({ service_id: serviceId }),
        }),

    removeSelection: (selectionId: string) =>
        request<{ message: string }>(`/api/selections/${selectionId}`, {
            method: 'DELETE',
        }),

    // Admin
    getAdminStats: () =>
        request<{ data: { total_users: number; total_services: number; total_selections: number } }>('/admin/dashboard'),

    getUsers: () =>
        request<{ data: import('../types').User[] }>('/admin/users'),

    toggleService: (id: string, active: boolean) =>
        request<{ message: string }>(`/admin/services/${id}/toggle`, {
            method: 'POST',
            body: JSON.stringify({ active }),
        }),

    createService: (data: Record<string, unknown>) =>
        request<{ data: import('../types').Service }>('/api/services', {
            method: 'POST',
            body: JSON.stringify(data),
        }),

    // Hardware & Admin
    getHardwareAdmin: () => request<any>('/admin/hardware?limit=100'),
    updateHardwareBuyUrls: (id: string, data: { buy_urls: any[], affiliate_tag: string }) =>
        request<any>(`/admin/hardware/${id}/buy-urls`, {
            method: 'PATCH',
            body: JSON.stringify(data)
        }),
    getHardwarePublic: () => request<any>('/api/hardware?limit=1000'),

    // Steering Rules
    getSteeringRules: () => request<any>('/admin/steering'),
    upsertSteeringRule: (category: string, retailer_order: string[]) => request<any>(`/admin/steering/${category}`, {
        method: 'PUT',
        body: JSON.stringify({ retailer_order })
    }),
    deleteSteeringRule: (category: string) => request<any>(`/admin/steering/${category}`, { method: 'DELETE' }),

    // Catalog Components / Mass Planner
    getCatalogComponents: () => request<any>('/admin/catalog-components'),
    createCatalogComponent: (data: any) => request<any>('/admin/catalog-components', { method: 'POST', body: JSON.stringify(data) }),
    updateCatalogComponent: (id: string, data: any) => request<any>(`/admin/catalog-components/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    deleteCatalogComponent: (id: string) => request<any>(`/admin/catalog-components/${id}`, { method: 'DELETE' }),

    // BETA_SURVEY - Remove after beta ends
    getSurvey: () => request<any>('/api/survey'),
    submitSurvey: (data: any) => request<any>('/api/survey', { method: 'POST', body: JSON.stringify(data) }),
    updateSurvey: (data: any) => request<any>('/api/survey', { method: 'PUT', body: JSON.stringify(data) }),
    // END BETA_SURVEY
};
