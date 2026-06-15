import { useEffect, useState } from 'react';
import { GoogleLogin } from '@react-oauth/google';
import { useAuth } from '../../features/admin/hooks/use-auth';
import { getAuthConfig, type AuthConfig } from '../../features/auth/lib/auth-config';
import { useTheme } from '../theme-provider';

export function GoogleLoginButton() {
    const { loginWithGoogle, loginWithDev } = useAuth();
    const { resolvedMode } = useTheme();
    const [authConfig, setAuthConfig] = useState<AuthConfig | null>(null);

    useEffect(() => {
        let cancelled = false;
        void getAuthConfig().then(config => {
            if (!cancelled) {
                setAuthConfig(config);
            }
        });
        return () => {
            cancelled = true;
        };
    }, []);

    if (!authConfig) {
        return <div className="min-h-[42px]" />;
    }

    const isAuthDisabled = authConfig.auth_disabled;
    const showLocalOption = isAuthDisabled || import.meta.env.DEV || import.meta.env.VITE_ENABLE_LOCAL_LOGIN === 'true';

    if (isAuthDisabled) {
        return (
            <div className="w-full space-y-2">
                <button
                    type="button"
                    onClick={() => loginWithDev()}
                    className="w-full px-4 py-2.5 border rounded-md font-medium shadow-sm hover:bg-muted transition-colors flex items-center justify-center gap-2"
                >
                    Start local workspace
                </button>
                <p className="text-xs text-muted-foreground">
                    Self-host mode uses a local admin account. No Google setup required.
                </p>
            </div>
        );
    }

    return (
        <div className="w-full space-y-3">
            <GoogleLogin
                onSuccess={credentialResponse => {
                    if (credentialResponse.credential) {
                        loginWithGoogle(credentialResponse.credential);
                    }
                }}
                onError={() => {
                    console.log('Login Failed');
                }}
                theme={resolvedMode === 'dark' ? 'filled_black' : 'outline'}
                shape="pill"
            />
            {showLocalOption && (
                <>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                        <span className="h-px flex-1 bg-border" />
                        <span>or</span>
                        <span className="h-px flex-1 bg-border" />
                    </div>
                    <button
                        type="button"
                        onClick={() => loginWithDev()}
                        className="w-full px-4 py-2.5 border rounded-md font-medium shadow-sm hover:bg-muted transition-colors flex items-center justify-center gap-2"
                    >
                        Use local dev login
                    </button>
                </>
            )}
        </div>
    );
}
