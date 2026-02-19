import { GoogleLogin } from '@react-oauth/google';
import { useAuth } from '../../features/admin/hooks/use-auth';
import { useTheme } from '../theme-provider';

export function GoogleLoginButton() {
    const { loginWithGoogle } = useAuth();
    const { theme } = useTheme();

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
                theme={theme === 'dark' ? 'filled_black' : 'outline'}
                shape="pill"
            />
        </div>
    );
}
