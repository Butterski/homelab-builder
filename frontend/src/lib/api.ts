// Dynamically resolve API base. If not explicitly set or heavily defaulted, assume standard backend port 8080 relative to current host
let defaultApiBase = 'http://localhost:8080';
if (typeof window !== 'undefined') {
    defaultApiBase = `${window.location.protocol}//${window.location.hostname}:8080`;
}

// In production docker builds, VITE_API_URL defaults to http://localhost:8080. We override it dynamically.
const rawApiUrl = import.meta.env.VITE_API_URL;
const API_BASE = rawApiUrl && rawApiUrl !== 'http://localhost:8080' ? rawApiUrl : defaultApiBase;

// Assuming User type is defined elsewhere or needs a placeholder


export class ApiError extends Error {
    public status: number;
    public code: string;

    constructor(status: number, code: string, message: string) {
        super(message);
        this.name = 'ApiError';
        this.status = status;
        this.code = code;
    }
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
    const token = localStorage.getItem('auth_token');
    const headers: HeadersInit = {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options?.headers,
    };

    const res = await fetch(`${API_BASE}${path}`, { ...options, headers });

    if (!res.ok) {
        const errorData = await res.json().catch(() => ({ error: 'Request failed' }));
        throw new ApiError(res.status, errorData.code || 'UNKNOWN', errorData.error || res.statusText);
    }

    // Some endpoints might return empty body
    if (res.status === 204) return {} as T;

    return res.json();
}

export const api = {
    get: <T>(path: string) => request<T>(path, { method: 'GET' }),
    post: <T>(path: string, body: unknown) => request<T>(path, { method: 'POST', body: JSON.stringify(body) }),
    put: <T>(path: string, body: unknown) => request<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
    patch: <T>(path: string, body: unknown) => request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
    del: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
    async devLogin(email: string) {
        const res = await this.post<{ token: string, user: any }>('/auth/dev', { email });
        localStorage.setItem('auth_token', res.token);
        return res;
    },

    async googleLogin(credential: string) {
        const res = await this.post<{ token: string, user: any }>('/auth/google', { credential });
        localStorage.setItem('auth_token', res.token);
        return res;
    },
};
