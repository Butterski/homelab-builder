import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../../features/admin/hooks/use-auth'

interface RequireAuthProps {
    children: React.ReactNode
}

/**
 * Route guard – redirects unauthenticated users to the login page
 * while preserving the originally-requested URL for post-login redirect.
 */
export function RequireAuth({ children }: RequireAuthProps) {
    const { user, loading } = useAuth()
    const location = useLocation()

    // While the token is being validated, render nothing to avoid flash
    if (loading) {
        return (
            <div className="flex h-screen items-center justify-center">
                <div className="animate-spin rounded-full size-8 border-b-2 border-primary" />
            </div>
        )
    }

    if (!user) {
        // Redirect to the home/login page, carrying the attempted URL so we
        // can redirect back after a successful login (future enhancement).
        return <Navigate to="/" state={{ from: location }} replace />
    }

    return <>{children}</>
}
