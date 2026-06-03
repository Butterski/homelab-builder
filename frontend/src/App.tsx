import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from './components/theme-provider';
// import MainLayout from './components/layout/main-layout'; // API: Removed unused layout

import { Suspense, lazy } from 'react';
import { LoadingScreen } from './components/ui/loading-screen';

const VisualBuilderPage = lazy(() => import('./features/builder/components/visual-builder'));
const SharedBuildPage = lazy(() => import('./features/builder/pages/shared-build-page'));
const ProjectsPage = lazy(() => import('./features/builder/pages/projects-page'));
const AdminPage = lazy(() => import('./features/admin/pages/admin-page'));
// const ShoppingListPage = lazy(() => import('./features/shopping/pages/shopping-list-page'));
const HardwareCatalogPage = lazy(() => import('./features/catalog/pages/hardware-catalog-page'));
const ServiceCatalogPage = lazy(() => import('./features/catalog/pages/service-catalog-page'));
const ChecklistPage = lazy(() => import('./features/setup-guide/pages/checklist-page'));
const HomelabGuidePage = lazy(() => import('./features/guides/pages/homelab-guide-page'));
const ArticleVisualPage = lazy(() => import('./features/guides/pages/article-visual-page'));
const ConfigGeneratorPage = lazy(() => import('./features/builder/pages/config-generator-page'));
const ProfilePage = lazy(() => import('./features/auth/pages/profile-page'));
const DonatePage = lazy(() => import('./features/donate/pages/donate-page'));
const PrivacyPolicyPage = lazy(() => import('./features/legal/pages/privacy-policy-page'));
const TermsOfServicePage = lazy(() => import('./features/legal/pages/terms-of-service-page'));
import { RequireAuth } from './components/auth/require-auth';
import { Sidebar } from './components/layout/sidebar';
import { Toaster } from './components/ui/sonner';
import { CommandPalette } from './components/command-palette';

import { GoogleOAuthProvider } from '@react-oauth/google';

const queryClient = new QueryClient();

import { useLocation } from 'react-router-dom';
import { useAuth } from './features/admin/hooks/use-auth';
import { useTheme } from './components/theme-provider';
import { useBuilderStore } from './features/builder/store/builder-store';
import { useEffect, useRef, useState } from 'react';
import { themeSettingsFromPreferences } from './lib/theme-registry';

const LoginPage = lazy(() => import('./features/auth/pages/login-page'));

function AppContent() {
  const location = useLocation();
  const { user, getThemeSettings } = useAuth();
  const { replaceThemeSettings } = useTheme();
  const setEdgePreferences = useBuilderStore(s => s.setEdgePreferences);
  const loadedPrefsFor = useRef<string | null>(null);
  const [commandOpen, setCommandOpen] = useState(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setCommandOpen(open => !open);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    let cancelled = false;

    if (!user) {
      loadedPrefsFor.current = null;
      return;
    }

    if (loadedPrefsFor.current === user.id) {
      return;
    }
    loadedPrefsFor.current = user.id;

    if (user.preferences?.edgePreferences) {
      setEdgePreferences(user.preferences.edgePreferences);
    }

    void (async () => {
      try {
        const backendThemeSettings = await getThemeSettings();
        if (!cancelled && backendThemeSettings) {
          replaceThemeSettings(backendThemeSettings);
          return;
        }
      } catch {
        // Fallback below if themes endpoint is temporarily unavailable.
      }

      if (!cancelled && user.preferences) {
        replaceThemeSettings(themeSettingsFromPreferences(user.preferences));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [getThemeSettings, replaceThemeSettings, setEdgePreferences, user]);

  // Hide sidebar only on the "Landing/Login" page (root path) when not logged in, and on shared views
  const isLandingPage = !user && location.pathname === '/';
  const isSharedRoute = location.pathname.startsWith('/shared/');
  const isBuilderRoute = location.pathname.startsWith('/builder/');
  const isArticleVisualRoute = location.pathname.startsWith('/docs/visuals/');

  return (
    <div className="flex h-screen bg-background text-foreground overflow-hidden">
      {!isLandingPage && !isSharedRoute && !isArticleVisualRoute && <Sidebar onOpenCommandPalette={() => setCommandOpen(true)} />}
      {!isLandingPage && !isSharedRoute && !isArticleVisualRoute && (
        <CommandPalette open={commandOpen} onOpenChange={setCommandOpen} />
      )}
      <main
        className={`flex-1 min-h-0 relative ${isBuilderRoute || isSharedRoute || isArticleVisualRoute ? 'overflow-hidden' : 'overflow-auto'}`}
      >
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
            <Route path="/how-to-build-a-homelab" element={<HomelabGuidePage />} />
            <Route path="/docs/visuals/:slug" element={<ArticleVisualPage />} />
            <Route path="/privacy" element={<PrivacyPolicyPage />} />
            <Route path="/terms" element={<TermsOfServicePage />} />
            {/* Public shared build viewer */}
            <Route path="/shared/:token" element={<SharedBuildPage />} />
          </Routes>
        </Suspense>
      </main>
    </div>
  );
}

function App() {
  const rawClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';
  const isAuthDisabled =
    !rawClientId || rawClientId === 'your-client-id' || rawClientId === 'your_client_id_here';

  const appProviders = (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <Router>
          <AppContent />
          <Toaster />
        </Router>
      </ThemeProvider>
    </QueryClientProvider>
  );

  if (isAuthDisabled) {
    return appProviders;
  }

  return <GoogleOAuthProvider clientId={rawClientId}>{appProviders}</GoogleOAuthProvider>;
}

export default App;
