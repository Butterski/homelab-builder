import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from './components/theme-provider';
// import MainLayout from './components/layout/main-layout'; // API: Removed unused layout

import VisualBuilderPage from './features/builder/components/visual-builder';
import ProjectsPage from './features/builder/pages/projects-page';
import AdminPage from './features/admin/pages/admin-page';
import ShoppingListPage from './features/shopping/pages/shopping-list-page';
import HardwareCatalogPage from './features/catalog/pages/hardware-catalog-page';
import ServiceCatalogPage from './features/catalog/pages/service-catalog-page';
import ChecklistPage from './features/setup-guide/pages/checklist-page';
import ConfigGeneratorPage from './features/builder/pages/config-generator-page';
import { Sidebar } from './components/layout/sidebar';
import { ThemeToggle } from './components/theme-toggle'; 
import { Toaster } from './components/ui/sonner';

import { GoogleOAuthProvider } from '@react-oauth/google';

const queryClient = new QueryClient();

import { useLocation } from 'react-router-dom';
import { useAuth } from './features/admin/hooks/use-auth';

import LoginPage from './features/auth/pages/login-page';

function AppContent() {
  const location = useLocation();
  const { user } = useAuth();
  
  // Hide sidebar only on the "Landing/Login" page (root path) when not logged in
  const isLandingPage = !user && location.pathname === '/';

  return (
    <div className="flex h-screen bg-background text-foreground overflow-hidden">
        {!isLandingPage && <Sidebar />}
        <main className="flex-1 overflow-auto relative">
            <div className="absolute top-4 right-4 z-50">
            <ThemeToggle />
            </div>
            <Routes>
            <Route path="/" element={user ? <ProjectsPage /> : <LoginPage />} />
            <Route path="/builder/:id" element={<VisualBuilderPage />} />

            <Route path="/shopping-list" element={<ShoppingListPage />} />
            <Route path="/generate" element={<ConfigGeneratorPage />} />
            <Route path="/admin" element={<AdminPage />} />
            {/* Catalog routes */}
            <Route path="/hardware" element={<HardwareCatalogPage />} />
            <Route path="/services" element={<ServiceCatalogPage />} />
            {/* Redirect legacy routes */}
            <Route path="/checklist" element={<ChecklistPage />} />
            </Routes>
        </main>
    </div>
  );
}

function App() {
  return (
    <GoogleOAuthProvider clientId={import.meta.env.VITE_GOOGLE_CLIENT_ID || ""}>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <Router>
             <AppContent />
             <Toaster />
          </Router>
        </ThemeProvider>
      </QueryClientProvider>
    </GoogleOAuthProvider>
  )
}

export default App;
