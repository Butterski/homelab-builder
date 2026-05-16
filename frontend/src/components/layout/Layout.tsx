
import { NavLink, useLocation } from 'react-router-dom';
import { useState, useEffect } from 'react';
import './Layout.css';
import { api } from '../../services/api';
import type { User } from '../../types';

interface LayoutProps {
  children: React.ReactNode;
}

export function Layout({ children }: LayoutProps) {
  const [user, setUser] = useState<User | null>(null);
  const routerLocation = useLocation();

  useEffect(() => {
    api.getCurrentUser().then(res => setUser(res.data)).catch(() => setUser(null));
  }, [routerLocation.pathname]);

  return (
    <div className="layout-root">
      <aside className="sidebar">
        <div className="sidebar-header">
          <NavLink to="/" className="brand-logo">
            <span className="logo-icon">🏗️</span>
            <span className="logo-text">HLBuilder</span>
          </NavLink>
        </div>
        
        <nav className="sidebar-nav">
          <div className="nav-group">
            <span className="nav-label">Main</span>
            <NavLink to="/" end className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
              🏠 Home
            </NavLink>
            <NavLink to="/services" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
              📦 Services
            </NavLink>
          </div>

          <div className="nav-group">
            <span className="nav-label">Tools</span>
            <NavLink to="/shopping-list" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
              🛒 Shopping List
            </NavLink>
            <NavLink to="/checklist" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
              📝 Setup Guide
            </NavLink>
          </div>

          <div className="nav-group">
             <span className="nav-label">System</span>
             {user?.is_admin && (
               <NavLink to="/admin" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                 ⚙️ Admin Panel
               </NavLink>
             )}
          </div>
        </nav>

        <div className="sidebar-footer">
          {user ? (
            <div className="user-profile">
              <img src={user.avatar_url} alt={user.name} className="user-avatar" />
              <div className="user-info">
                <span className="user-name">{user.name}</span>
                <span className="user-email" title={user.email}>{user.email}</span>
              </div>
            </div>
          ) : (
             <button className="btn btn-sm btn-secondary btn-full">Login</button>
          )}
        </div>
      </aside>

      <main className="main-content-area">
        <header className="top-bar">
          <h2 className="page-title">{getPageTitle(location.pathname)}</h2>
          <div className="top-actions">
            {/* Global search or actions could go here */}
          </div>
        </header>
        <div className="content-scroll">
          <div className="content-wrapper">{children}</div>
        </div>
      </main>
    </div>
  );
}

function getPageTitle(path: string): string {
  if (path === '/') return 'Dashboard';
  if (path.startsWith('/services')) return 'Service Catalog';
  if (path === '/recommendations') return 'Hardware Recommendations';
  if (path === '/shopping-list') return 'Shopping List';
  if (path === '/checklist') return 'Setup Guide';
  if (path.startsWith('/admin')) return 'Admin Panel';
  return 'HLBuilder';
}
