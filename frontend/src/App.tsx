import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from './components/theme-provider';
// import MainLayout from './components/layout/main-layout'; // API: Removed unused layout

import { Suspense, lazy } from 'react';
import { LoadingScreen } from './components/ui/loading-screen';

const VisualBuilderPage = lazy(() => import('./features/builder/components/visual-builder'));
const ProjectsPage = lazy(() => import('./features/builder/pages/projects-page'));
const AdminPage = lazy(() => import('./features/admin/pages/admin-page'));
// const ShoppingListPage = lazy(() => import('./features/shopping/pages/shopping-list-page'));
const HardwareCatalogPage = lazy(() => import('./features/catalog/pages/hardware-catalog-page'));
const ServiceCatalogPage = lazy(() => import('./features/catalog/pages/service-catalog-page'));
const ChecklistPage = lazy(() => import('./features/setup-guide/pages/checklist-page'));
const ConfigGeneratorPage = lazy(() => import('./features/builder/pages/config-generator-page'));
const ProfilePage = lazy(() => import('./features/auth/pages/profile-page'));
const DonatePage = lazy(() => import('./features/donate/pages/donate-page'));
const PrivacyPolicyPage = lazy(() => import('./features/legal/pages/privacy-policy-page'));
const TermsOfServicePage = lazy(() => import('./features/legal/pages/terms-of-service-page'));
import { RequireAuth } from './components/auth/require-auth';
import { Sidebar } from './components/layout/sidebar';
import { ThemeToggle } from './components/theme-toggle';
import { Toaster } from './components/ui/sonner';

import { GoogleOAuthProvider } from '@react-oauth/google';

const queryClient = new QueryClient();

import { useLocation } from 'react-router-dom';
import { useAuth } from './features/admin/hooks/use-auth';
import { useTheme } from './components/theme-provider';
import { useBuilderStore } from './features/builder/store/builder-store';
import { useEffect } from 'react';

const LoginPage = lazy(() => import('./features/auth/pages/login-page'));

function AppContent() {
  const location = useLocation();
  const { user } = useAuth();
  const { theme, setTheme } = useTheme();
  const setEdgePreferences = useBuilderStore(s => s.setEdgePreferences);

  useEffect(() => {
    if (user?.preferences) {
      if (user.preferences.theme && user.preferences.theme !== theme) {
        setTheme(user.preferences.theme);
      }
      if (user.preferences.edgePreferences) {
        setEdgePreferences(user.preferences.edgePreferences);
      }
    }
  }, [user]);

  // Hide sidebar only on the "Landing/Login" page (root path) when not logged in
  const isLandingPage = !user && location.pathname === '/';
  const isBuilderRoute = location.pathname.startsWith('/builder/');

  return (
    <div className="flex h-screen bg-background text-foreground overflow-hidden">
      {!isLandingPage && <Sidebar />}
      <main
        className={`flex-1 min-h-0 relative ${isBuilderRoute ? 'overflow-hidden' : 'overflow-auto'}`}
      >
        <div className="absolute top-4 right-4 z-50">
          <ThemeToggle />
        </div>
        <Suspense fallback={<LoadingScreen message="Loading HLBuilder..." />}>
          <Routes>
            <Route path="/" element={user ? <ProjectsPage /> : <LoginPage />} />
            {/* Protected routes */}
            <Route
              path="/builder/:id"
              element={
                <RequireAuth>
                  <VisualBuilderPage />
                </RequireAuth>
              }
            />
            {/* <Route path="/shopping-list" element={<RequireAuth><ShoppingListPage /></RequireAuth>} /> - Disabled for Open Beta */}
            <Route
              path="/generate"
              element={
                <RequireAuth>
                  <ConfigGeneratorPage />
                </RequireAuth>
              }
            />
            <Route
              path="/admin"
              element={
                <RequireAuth>
                  <AdminPage />
                </RequireAuth>
              }
            />
            <Route
              path="/profile"
              element={
                <RequireAuth>
                  <ProfilePage />
                </RequireAuth>
              }
            />
            <Route
              path="/donate"
              element={
                <RequireAuth>
                  <DonatePage />
                </RequireAuth>
              }
            />
            <Route
              path="/checklist"
              element={
                <RequireAuth>
                  <ChecklistPage />
                </RequireAuth>
              }
            />
            {/* Public catalog routes */}
            <Route path="/hardware" element={<HardwareCatalogPage />} />
            <Route path="/services" element={<ServiceCatalogPage />} />
            <Route path="/privacy" element={<PrivacyPolicyPage />} />
            <Route path="/terms" element={<TermsOfServicePage />} />
          </Routes>
        </Suspense>
      </main>
    </div>
  );
}

function App() {
  return (
    <GoogleOAuthProvider clientId={import.meta.env.VITE_GOOGLE_CLIENT_ID || ''}>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <Router>
            <AppContent />
            <Toaster />
          </Router>
        </ThemeProvider>
      </QueryClientProvider>
    </GoogleOAuthProvider>
  );
}

export default App;
