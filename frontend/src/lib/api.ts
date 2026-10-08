import { apiUrl } from './api-base';
import type { ThemeSettings } from './theme-registry';
import type { User } from '../types';

export class ApiError extends Error {
    public status: number;
    public code: string;
    public data: unknown;

    constructor(status: number, code: string, message: string, data?: unknown) {
        super(message);
        this.name = 'ApiError';
        this.status = status;
        this.code = code;
        this.data = data;
    }
}

/** The Authorization header of the signed-in session, for requests made with fetch directly. */
export function authHeaders(): Record<string, string> {
    const token = localStorage.getItem('auth_token');
    return token ? { Authorization: `Bearer ${token}` } : {};
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
    const headers: HeadersInit = {
        'Content-Type': 'application/json',
        ...authHeaders(),
        ...options?.headers,
    };

    const res = await fetch(apiUrl(path), { ...options, headers });

    if (!res.ok) {
        const errorData = await res.json().catch(() => ({ error: 'Request failed' }));
        throw new ApiError(res.status, errorData.code || 'UNKNOWN', errorData.error || res.statusText, errorData);
    }

    // Some endpoints might return empty body
    if (res.status === 204) return {} as T;

    return res.json();
}

async function login(path: string, body: unknown) {
    const res = await request<{ token: string, user: User }>(path, { method: 'POST', body: JSON.stringify(body) });
    localStorage.setItem('auth_token', res.token);
    return res;
}

export const api = {
    get: <T>(path: string) => request<T>(path, { method: 'GET' }),
    post: <T>(path: string, body: unknown) => request<T>(path, { method: 'POST', body: JSON.stringify(body) }),
    put: <T>(path: string, body: unknown) => request<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
    patch: <T>(path: string, body: unknown) => request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
    del: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
    devLogin: (email: string) => login('/auth/dev', { email }),
    googleLogin: (credential: string) => login('/auth/google', { credential }),

    getThemeSettings: () => request<ThemeSettings>('/auth/themes', { method: 'GET' }),
    updateThemeSettings: (themeSettings: ThemeSettings) =>
        request<ThemeSettings>('/auth/themes', { method: 'PUT', body: JSON.stringify(themeSettings) }),
};
