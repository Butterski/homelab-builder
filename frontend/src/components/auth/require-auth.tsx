import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../../features/auth/hooks/use-auth'

/** Layout route for pages that need a signed-in user; anyone else is sent to the home page. */
export function RequireAuth() {
    const { user, loading } = useAuth()

    // While the token is being validated, render nothing to avoid flash
    if (loading) {
        return (
            <div className="flex h-screen items-center justify-center">
                <div className="animate-spin rounded-full size-8 border-b-2 border-primary" />
            </div>
        )
    }

    if (!user) {
        return <Navigate to="/" replace />
    }

    return <Outlet />
}
