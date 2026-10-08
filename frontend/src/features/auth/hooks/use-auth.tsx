import { useSyncExternalStore } from "react";
import { api } from "../../../lib/api";
import { toast } from "sonner";
import type { ThemeSettings } from "../../../lib/theme-registry";
import type { User, UserPreferences } from "../../../types";
import { getAuthConfig, peekAuthConfig } from "../lib/auth-config";
import { LOCAL_INSTANCE_KEY } from "../../../lib/prerender";
import { forgetWorkspace } from "../../builder/store/workspace-storage";

interface AuthState {
    user: User | null;
    loading: boolean;
}

// One signed-in user for the whole page: every useAuth() caller reads this, and /auth/me is asked once.
let state: AuthState | null = null;
let checkStarted = false;
const listeners = new Set<() => void>();

function getState(): AuthState {
    // A visitor without a token on an instance with login cannot be signed in:
    // that is known at once, so the landing page is drawn without a loading screen first.
    if (!state) {
        const config = peekAuthConfig();
        const loading = !config || config.auth_disabled || Boolean(localStorage.getItem('auth_token'));
        state = { user: null, loading };
    }
    return state;
}

function setState(patch: Partial<AuthState>) {
    state = { ...getState(), ...patch };
    listeners.forEach(listener => listener());
}

function subscribe(listener: () => void) {
    listeners.add(listener);
    if (!checkStarted) {
        checkStarted = true;
        void checkAuth();
    }
    return () => {
        listeners.delete(listener);
    };
}

async function checkAuth() {
    try {
        const token = localStorage.getItem('auth_token');
        const authConfig = await getAuthConfig();
        // Read by index.html before the app starts, to skip the landing page here next time.
        if (authConfig.auth_disabled) {
            localStorage.setItem(LOCAL_INSTANCE_KEY, '1');
        } else {
            localStorage.removeItem(LOCAL_INSTANCE_KEY);
        }

        if (token || authConfig.auth_disabled) {
            // In local mode without a client ID, backend will automatically return the Local Admin.
            setState({ user: await api.get<User>('/auth/me') });
        }
    } catch (error) {
        console.error("Auth check failed", error);
        localStorage.removeItem('auth_token');
    } finally {
        setState({ loading: false });
    }
}

async function loginWithDev() {
    setState({ loading: true });
    try {
        const data = await api.devLogin('admin@example.com');
        setState({ user: data.user });
        window.location.reload();
    } catch (error) {
        // Fallback for self-hosted auth-disabled mode where /auth/dev may be unavailable.
        try {
            setState({ user: await api.get<User>('/auth/me') });
            window.location.reload();
            return;
        } catch (fallbackError) {
            console.error("Dev Login failed", error);
            console.error("Self-host fallback (/auth/me) failed", fallbackError);
            toast.error("Local login failed. Check backend auth mode configuration.");
        }
    } finally {
        setState({ loading: false });
    }
}

async function loginWithGoogle(credential: string) {
    setState({ loading: true });
    try {
        const data = await api.googleLogin(credential);
        setState({ user: data.user });
        // Everything loaded so far was loaded signed out.
        window.location.reload();
    } catch (error) {
        console.error("Login failed", error);
        toast.error("Login failed. Please try again.");
    } finally {
        setState({ loading: false });
    }
}

async function updatePreferences(prefs: UserPreferences) {
    if (!getState().user) return;
    const updatedUser = await api.put<User>('/auth/preferences', { preferences: prefs });
    setState({ user: updatedUser });
    return updatedUser;
}

async function getThemeSettings() {
    if (!getState().user) return;
    return api.getThemeSettings();
}

async function updateThemeSettings(themeSettings: ThemeSettings) {
    if (!getState().user) return;
    const updatedThemeSettings = await api.updateThemeSettings(themeSettings);
    const user = getState().user;
    if (user) {
        setState({
            user: {
                ...user,
                preferences: {
                    ...user.preferences,
                    theme: updatedThemeSettings.activeThemeId,
                    themeSettings: updatedThemeSettings,
                },
            },
        });
    }
    return updatedThemeSettings;
}

function logout() {
    localStorage.removeItem('auth_token');
    // The next account on this browser starts without this one's open project.
    forgetWorkspace();
    setState({ user: null });
    window.location.reload();
}

export function useAuth() {
    const { user, loading } = useSyncExternalStore(subscribe, getState);
    return {
        user,
        loading,
        loginWithGoogle,
        loginWithDev,
        updatePreferences,
        getThemeSettings,
        updateThemeSettings,
        logout,
    };
}
