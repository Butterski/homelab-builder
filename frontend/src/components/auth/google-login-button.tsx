import { GoogleLogin } from '@react-oauth/google';
import { useAuth } from '../../features/admin/hooks/use-auth';
import { useTheme } from '../theme-provider';

export function GoogleLoginButton() {
    const { loginWithGoogle, loginWithDev } = useAuth();
    const { resolvedMode } = useTheme();

    const rawClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';
    const isAuthDisabled = !rawClientId || rawClientId === "your-client-id" || rawClientId === "your_client_id_here";

    if (isAuthDisabled) {
        return (
            <div className="w-full flex justify-center">
                <button
                    onClick={() => loginWithDev()}
                    className="w-full max-w-sm px-4 py-2 border rounded-full font-medium shadow-sm hover:bg-muted transition-colors flex items-center justify-center gap-2"
                >
                    Continue as Local Dev
                </button>
            </div>
        );
    }

    return (
        <div className="w-full flex justify-center">
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
        </div>
    );
}
