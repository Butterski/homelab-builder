const DEFAULT_DEV_API_BASE = 'http://localhost:8080';

export function resolveApiBase(): string {
    const rawApiUrl = import.meta.env.VITE_API_URL?.trim();
    if (rawApiUrl) {
        return rawApiUrl.replace(/\/+$/, '');
    }

    if (import.meta.env.DEV) {
        if (typeof window !== 'undefined') {
            return `${window.location.protocol}//${window.location.hostname}:8080`;
        }
        return DEFAULT_DEV_API_BASE;
    }

    return '';
}

export function apiUrl(path: string): string {
    return `${resolveApiBase()}${path}`;
}
