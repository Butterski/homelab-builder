import { useEffect, useState } from "react"; // Fixed imports
import { api } from "../../../lib/api";
import { toast } from "sonner";
import type { ThemeSettings } from "../../../lib/theme-registry";
interface User {
    id: string;
    name: string;
    email: string;
    avatar_url?: string;
    is_admin?: boolean;
    preferences?: Record<string, any>;
}

export function useAuth() {
    const [user, setUser] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);
    // const { toast } = useToast(); 

    useEffect(() => {
        checkAuth();
    }, []);

    async function checkAuth() {
        try {
            const token = localStorage.getItem('auth_token');
            const rawClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
            const isAuthDisabled = !rawClientId || rawClientId === "your-client-id" || rawClientId === "your_client_id_here";

            if (token || isAuthDisabled) {
                // In local mode without a client ID, backend will automatically return the Local Admin
                const user = await api.get<User>('/auth/me');
                setUser(user);
            }
        } catch (error) {
            console.error("Auth check failed", error);
            localStorage.removeItem('auth_token'); // Clear invalid token
        } finally {
            setLoading(false);
        }
    }

    async function loginWithDev() {
        setLoading(true);
        try {
            const data = await api.devLogin('admin@example.com');
            localStorage.setItem('auth_token', data.token);
            setUser(data.user);
            window.location.reload();
        } catch (error) {
            // Fallback for self-hosted auth-disabled mode where /auth/dev may be unavailable.
            try {
                const localUser = await api.get<User>('/auth/me');
                setUser(localUser);
                window.location.reload();
                return;
            } catch (fallbackError) {
                console.error("Dev Login failed", error);
                console.error("Self-host fallback (/auth/me) failed", fallbackError);
                toast.error("Local login failed. Check backend auth mode configuration.");
            }
        } finally {
            setLoading(false);
        }
    }

    async function loginWithGoogle(credential: string) {
        setLoading(true);
        try {
            const data = await api.googleLogin(credential);
            localStorage.setItem('auth_token', data.token); // Crucial fix for token persistence
            setUser(data.user);
            // toast({ title: "Logged in", description: `Welcome back, ${data.user.name}` });
            window.location.reload(); // Reload to refresh all data/states dependent on auth
        } catch (error) {
            console.error("Login failed", error);
            toast.error("Login failed. Please try again.");
        } finally {
            setLoading(false);
        }
    }

    async function updatePreferences(prefs: Record<string, any>) {
        if (!user) return;
        try {
            const updatedUser = await api.put<User>('/auth/preferences', { preferences: prefs });
            setUser(updatedUser);
            return updatedUser;
        } catch (error) {
            console.error("Failed to update preferences", error);
            throw error;
        }
    }

    async function getThemeSettings() {
        if (!user) return;
        try {
            return await api.getThemeSettings();
        } catch (error) {
            console.error("Failed to load theme settings", error);
            throw error;
        }
    }

    async function updateThemeSettings(themeSettings: ThemeSettings) {
        if (!user) return;
        try {
            const updatedThemeSettings = await api.updateThemeSettings(themeSettings);
            setUser(prev => {
                if (!prev) return prev;
                return {
                    ...prev,
                    preferences: {
                        ...(prev.preferences ?? {}),
                        theme: updatedThemeSettings.activeThemeId,
                        themeSettings: updatedThemeSettings,
                    },
                };
            });
            return updatedThemeSettings;
        } catch (error) {
            console.error("Failed to update theme settings", error);
            throw error;
        }
    }

    return {
        user,
        loading,
        loginWithGoogle,
        loginWithDev,
        updatePreferences,
        getThemeSettings,
        updateThemeSettings,
        logout: () => {
             localStorage.removeItem('auth_token');
             setUser(null);
             window.location.reload();
        }
    };
}
