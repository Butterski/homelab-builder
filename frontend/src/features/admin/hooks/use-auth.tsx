import { useEffect, useState } from "react"; // Fixed imports
import { api } from "../../../lib/api";
import { toast } from "sonner";
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
            if (token) {
                // Determine if we need to fetch user separately or trust token claims
                // For now, let's fetch 'me'
                // Backend now returns user object directly without "data" wrapper
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
        }
    }

    return {
        user,
        loading,
        loginWithGoogle,
        updatePreferences,
        logout: () => {
             localStorage.removeItem('auth_token');
             setUser(null);
             window.location.reload();
        }
    };
}
