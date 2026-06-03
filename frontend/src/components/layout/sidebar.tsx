import React, { useState, useEffect, type ReactNode } from 'react';
import { NavLink, useNavigate, Link } from 'react-router-dom';
import {
  LayoutDashboard,
  CheckSquare,
  Settings,
  HardDrive,
  BookOpen,
  FileCode,
  ChevronsLeft,
  ChevronsRight,
  Heart,
  Globe,
  ClipboardList,
  CheckCircle2,
  AppWindow,
  Search,
} from 'lucide-react';
import { Github } from '../icons/github';
import { Discord } from '../icons/discord';
import { BuyMeACoffee } from '../icons/buymeacoffee';
import { cn } from '../../lib/utils';
import { useAuth } from '../../features/admin/hooks/use-auth';
import { useBuilderStore } from '../../features/builder/store/builder-store';
import { GoogleLoginButton } from '../auth/google-login-button';
import { LayoutTemplate } from 'lucide-react';
import { Logo } from '../ui/logo';
import { useSurvey } from '../../features/survey/api/use-survey';
import { SurveyModal } from '../../features/survey/components/survey-modal';

const STORAGE_KEY = 'sidebar-collapsed';

const BASE_NAV_ITEMS = [
  { label: 'Projects', href: '/', icon: LayoutDashboard },
  { label: 'Config Generator', href: '/generate', icon: FileCode },
  { label: 'Hardware Catalog', href: '/hardware', icon: HardDrive },
  { label: 'Service Library', href: '/services', icon: AppWindow },
  { label: 'Homelab Guide', href: '/how-to-build-a-homelab', icon: BookOpen },
  // { label: "Shopping List", href: "/shopping-list", icon: ShoppingCart }, // Hidden for Open Beta
  { label: 'Setup Guide', href: '/checklist', icon: CheckSquare },
  { label: 'Admin', href: '/admin', icon: Settings },
];

export const Sidebar = React.memo(function Sidebar({
  className,
  onOpenCommandPalette,
}: {
  className?: string;
  onOpenCommandPalette?: () => void;
}) {
  const { user } = useAuth();
  const { currentBuildId } = useBuilderStore();
  const navigate = useNavigate();

  const [showSurvey, setShowSurvey] = useState(false);
  const { data: survey } = useSurvey({ enabled: !!user });
  const surveyDone = !!survey;

  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, String(collapsed));
    } catch {
      return;
    }
  }, [collapsed]);

  const navItems = [
    BASE_NAV_ITEMS[0],
    ...(currentBuildId
      ? [{ label: 'Active Project', href: `/builder/${currentBuildId}`, icon: LayoutTemplate }]
      : []),
    ...BASE_NAV_ITEMS.slice(1),
  ];

  return (
    <>
      <aside
        className={cn(
          'app-sidebar hidden md:flex h-full flex-col overflow-hidden border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] duration-300 ease-out',
          collapsed ? 'w-16' : 'w-64',
          className,
        )}
      >
        {/* Logo */}
        <button
          type="button"
          className="group flex h-16 w-full shrink-0 select-none items-center border-b border-sidebar-border px-4 text-left transition-colors hover:bg-sidebar-accent/55 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring"
          onClick={() => navigate('/')}
          title="Go to Projects"
        >
          <Logo className="size-8 shrink-0 drop-shadow-sm" interactive />
          <span
            className={cn(
              'ml-3 text-xl font-bold tracking-tight whitespace-nowrap transition-[opacity,width] duration-300',
              collapsed ? 'opacity-0 w-0 overflow-hidden' : 'opacity-100',
            )}
          >
            HLBuilder
          </span>
        </button>

        {/* Navigation */}
        <div className="flex-1 overflow-y-auto py-4">
          <nav className="grid gap-1 px-2">
            {navItems.reduce<ReactNode[]>((acc, item) => {
              if (item.label !== 'Admin' || user?.is_admin) {
                acc.push(
                  <NavLink
                    key={item.href}
                    to={item.href}
                    title={collapsed ? item.label : undefined}
                    className={({ isActive }) =>
                      cn(
                        'group flex min-h-10 items-center rounded-lg px-3 py-2 text-sm font-medium text-sidebar-foreground/68 transition-[background-color,color,box-shadow,transform] hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring',
                        isActive &&
                          'translate-x-0.5 bg-sidebar-accent text-sidebar-accent-foreground shadow-[0_0_0_1px_color-mix(in_oklab,var(--sidebar-primary)_28%,transparent),0_12px_28px_-22px_var(--sidebar-primary)] [&>svg]:rounded-md [&>svg]:bg-sidebar-primary [&>svg]:p-0.5 [&>svg]:text-sidebar-primary-foreground',
                        collapsed && 'justify-center px-2',
                      )
                    }
                  >
                    <item.icon className={cn('size-4 shrink-0', !collapsed && 'mr-2')} aria-hidden="true" />
                    <span
                      className={cn(
                        'whitespace-nowrap transition-[opacity,width] duration-300',
                        collapsed ? 'opacity-0 w-0 overflow-hidden' : 'opacity-100',
                      )}
                    >
                      {item.label}
                    </span>
                  </NavLink>,
                );
              }
              return acc;
            }, [])}
          </nav>
        </div>

        {/* User section */}
        {!collapsed && (
          <div className="border-t border-sidebar-border p-4 animate-in fade-in duration-200">
            <button
              type="button"
              className="flex min-h-14 w-full items-center gap-3 rounded-lg border border-sidebar-border bg-sidebar-accent/45 p-2 text-left transition-colors hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring"
              onClick={() => (user ? navigate('/profile') : undefined)}
              title={user ? 'View profile' : undefined}
            >
              {user ? (
                <>
                  <img
                    src={
                      user.avatar_url ||
                      `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(user.email)}`
                    }
                    className="size-8 rounded-full bg-primary/20 shrink-0"
                    alt={user.name}
                    onError={e => {
                      (e.target as HTMLImageElement).src =
                        `https://api.dicebear.com/7.x/initials/svg?seed=${user.name}`;
                    }}
                  />
                  <div className="flex flex-col overflow-hidden flex-1">
                    <span className="text-sm font-medium truncate" title={user.name}>
                      {user.name}
                    </span>
                    <span className="text-xs text-muted-foreground truncate">{user.email}</span>
                  </div>
                </>
              ) : (
                <div className="w-full">
                  <GoogleLoginButton />
                </div>
              )}
            </button>
          </div>
        )}

        <div className="shrink-0 border-t border-sidebar-border p-2">
          <button
            type="button"
            onClick={onOpenCommandPalette}
            title="Open command palette"
            className={cn(
              'group flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-sidebar-foreground/68 transition-[background-color,color] hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring',
              collapsed && 'justify-center px-2',
            )}
          >
            <Search className={cn('size-4 shrink-0', !collapsed && 'mr-2')} aria-hidden="true" />
            <span
              className={cn(
                'flex min-w-0 flex-1 items-center justify-between gap-2 whitespace-nowrap transition-[opacity,width] duration-300',
                collapsed ? 'w-0 overflow-hidden opacity-0' : 'opacity-100',
              )}
            >
              <span>Command menu</span>
              <kbd className="rounded border border-sidebar-border bg-sidebar px-1.5 py-0.5 text-[10px] text-sidebar-foreground/60">
                Ctrl K
              </kbd>
            </span>
          </button>
        </div>

        {/* Collapsed: show avatar only */}
        {collapsed && user && (
          <div className="flex justify-center border-t border-sidebar-border p-2 animate-in fade-in duration-200">
            <button
            type="button"
            className="rounded-full border-none bg-transparent p-0 transition-shadow hover:ring-2 hover:ring-sidebar-ring/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
            onClick={() => navigate('/profile')}
            title={user.name}
          >
            <img
              src={
                user.avatar_url ||
                `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(user.email)}`
              }
              className="size-8 rounded-full bg-primary/20"
              alt={user.name}
              onError={e => {
                (e.target as HTMLImageElement).src =
                  `https://api.dicebear.com/7.x/initials/svg?seed=${user.name}`;
              }}
            />
          </button>
          </div>
        )}

        {/* Social Links */}
        <div
          className={cn(
            'flex shrink-0 items-center border-t border-sidebar-border p-4',
            collapsed ? 'flex-col p-2 gap-4' : 'justify-center gap-5',
          )}
        >
          <a
            href="https://github.com/Butterski/homelab-builder"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sidebar-foreground/62 transition-colors hover:text-sidebar-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring"
            title="Project Site"
          >
            <Globe className="size-4" aria-hidden="true" />
          </a>
          <a
            href="https://github.com/Butterski"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sidebar-foreground/62 transition-colors hover:text-sidebar-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring"
            title="GitHub"
          >
            <Github className="size-4" />
          </a>
          <a
            href="https://github.com/sponsors/Butterski"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sidebar-foreground/62 transition-colors hover:text-pink-500 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring"
            title="Sponsor"
          >
            <Heart className="size-4" aria-hidden="true" />
          </a>
          <a
            href="https://discord.gg/8PQb2M2fBB"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sidebar-foreground/62 transition-colors hover:text-sidebar-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring"
            title="Discord"
          >
            <Discord className="size-4" />
          </a>
          <a
            href="https://buymeacoffee.com/butterski"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sidebar-foreground/62 transition-colors hover:text-yellow-500 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring"
            title="Buy Me a Coffee"
          >
            <BuyMeACoffee className="size-4" />
          </a>
        </div>

        {/* Legal links */}
        {!collapsed && (
          <div className="px-4 pb-1 flex items-center justify-center gap-2 text-xs text-muted-foreground/60">
            <Link to="/privacy" className="hover:text-muted-foreground transition-colors">
              Privacy
            </Link>
            <span> | </span>
            <Link to="/terms" className="hover:text-muted-foreground transition-colors">
              Terms
            </Link>
          </div>
        )}

        {/* DONATE - Glowing funding goal button */}
        <div className="shrink-0 border-t border-sidebar-border p-2">
          <NavLink
            to="/donate"
            title="Support the Project"
            className={({ isActive }) =>
              cn(
                'group relative flex w-full items-center gap-2 overflow-hidden rounded-lg px-3 py-2 text-sm font-medium transition-[background-color,color] duration-200 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring',
                isActive
                  ? 'bg-pink-500/15 text-pink-500'
                  : 'text-pink-500/80 hover:bg-pink-500/10 hover:text-pink-500',
                collapsed && 'justify-center px-2',
              )
            }
          >
            {/* Subtle animated background shimmer */}
            <div className="absolute inset-0 bg-linear-to-r from-transparent via-pink-500/10 to-transparent -translate-x-full animate-[shimmer_3s_infinite]" />

            <Heart
              className={cn(
                'shrink-0 transition-transform group-hover:scale-110',
                collapsed ? 'size-5' : 'size-4',
              )}
            />

            <div
              className={cn(
                'flex flex-col flex-1 whitespace-nowrap transition-[opacity,width] duration-300',
                collapsed ? 'opacity-0 w-0' : 'opacity-100',
              )}
            >
              <div className="flex justify-between items-center w-full">
                <span className="font-semibold ml-2">Support HLBuilder</span>
              </div>
            </div>
          </NavLink>
        </div>

        {/* Usage survey button */}
        {user && (
          <div className="shrink-0 border-t border-sidebar-border p-2">
            <button
              onClick={() => setShowSurvey(true)}
              type="button"
              title="Usage Survey"
              className={cn(
                'relative flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-[background-color,color] duration-200 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring',
                surveyDone
                  ? 'text-muted-foreground hover:bg-accent hover:text-foreground'
                  : 'text-primary hover:bg-primary/10',
                collapsed && 'justify-center px-2',
              )}
            >
              {/* Glow ring - only if not done */}
              {!surveyDone && (
                <span className="absolute inset-0 rounded-lg animate-pulse ring-2 ring-primary/50 ring-offset-1 ring-offset-background pointer-events-none" />
              )}
              {surveyDone ? (
                <CheckCircle2 className="size-4 shrink-0 text-emerald-500" />
              ) : (
                <ClipboardList className="size-4 shrink-0" />
              )}
              <span
                className={cn(
                  'whitespace-nowrap transition-[opacity,width] duration-300',
                  collapsed ? 'opacity-0 w-0 overflow-hidden' : 'opacity-100',
                )}
              >
                {surveyDone ? 'Survey done' : 'Usage Survey'}
              </span>
            </button>
          </div>
        )}
        {/* Collapse toggle */}
        <div className="flex shrink-0 justify-center border-t border-sidebar-border p-2">
          <button
            onClick={() => setCollapsed(c => !c)}
            type="button"
            className="rounded-md p-2 text-sidebar-foreground/62 transition-colors hover:cursor-pointer hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring"
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? (
              <ChevronsRight className="size-4" />
            ) : (
              <ChevronsLeft className="size-4" />
            )}
          </button>
        </div>
      </aside>
      {showSurvey && <SurveyModal onClose={() => setShowSurvey(false)} />}
    </>
  );
})
