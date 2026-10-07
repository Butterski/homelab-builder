import React, { useState, useEffect } from 'react';
import { NavLink, Link, useLocation } from 'react-router-dom';
import {
  AppWindow,
  BookOpen,
  ChevronsLeft,
  ChevronsRight,
  ChevronsUpDown,
  ClipboardList,
  HardDrive,
  Heart,
  LayoutDashboard,
  Menu,
  Search,
  Settings,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { useAuth } from '../../features/admin/hooks/use-auth';
import { GoogleLoginButton } from '../auth/google-login-button';
import { Logo } from '../ui/logo';
import { UserAvatar } from '../ui/user-avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import { ProjectCard } from './project-card';
import { Sheet, SheetClose, SheetContent, SheetTitle, SheetTrigger } from '../ui/sheet';
import { useSurvey } from '../../features/survey/api/use-survey';
import { SurveyModal } from '../../features/survey/components/survey-modal';

const STORAGE_KEY = 'sidebar-collapsed';

type NavItem = { label: string; href: string; icon: LucideIcon };

// The open project comes right after "Projects" as a card of its own, with
// its pages (canvas, config generator, setup guide) under it: see ProjectCard.
const PROJECTS_ITEM: NavItem = { label: 'Projects', href: '/', icon: LayoutDashboard };
/** What is looked up while planning. */
const REFERENCE_ITEMS: NavItem[] = [
  { label: 'Hardware Catalog', href: '/hardware', icon: HardDrive },
  { label: 'Service Library', href: '/services', icon: AppWindow },
  { label: 'Homelab Guide', href: '/how-to-build-a-homelab', icon: BookOpen },
];
/** The app itself, at the foot of the sidebar. */
const SETTINGS_ITEM: NavItem = { label: 'Settings', href: '/settings', icon: Settings };
const ADMIN_ITEM: NavItem = { label: 'Admin', href: '/admin', icon: ShieldCheck };
const SUPPORT_ITEM: NavItem = { label: 'Support HLBuilder', href: '/donate', icon: Heart };

/** Where the project lives outside the app; listed in the account menu. */
const OUTSIDE_LINKS = [
  { label: 'Planning docs', href: '/docs/' },
  { label: 'Source on GitHub', href: 'https://github.com/Butterski/homelab-builder' },
  { label: 'Discord', href: 'https://discord.gg/8PQb2M2fBB' },
];

const ROW =
  'group flex min-h-9 w-full items-center rounded-lg px-3 py-1.5 text-sm font-medium text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring';
const ROW_ACTIVE = 'bg-sidebar-accent text-sidebar-accent-foreground';

export const MobileNavigation = React.memo(function MobileNavigation({
  onOpenCommandPalette,
}: {
  onOpenCommandPalette?: () => void;
}) {
  const { user } = useAuth();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const items = [
    PROJECTS_ITEM,
    ...REFERENCE_ITEMS,
    ...(user ? [SETTINGS_ITEM] : []),
    ...(user?.is_admin ? [ADMIN_ITEM] : []),
    SUPPORT_ITEM,
  ];
  // Plain links with the class worked out here: the sheet's close button hands
  // its props on as text and cannot pass on NavLink's function form of a class.
  const isCurrent = (href: string) =>
    href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);
  const mobileLink = (item: NavItem, after?: React.ReactNode) => (
    <React.Fragment key={item.href}>
      <SheetClose asChild>
        <Link
          to={item.href}
          aria-current={isCurrent(item.href) ? 'page' : undefined}
          className={cn(
            'flex min-h-11 items-center rounded-lg px-3 text-sm font-medium text-sidebar-foreground/75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring',
            isCurrent(item.href) && ROW_ACTIVE,
          )}
        >
          <item.icon className="mr-3 size-4 shrink-0" aria-hidden="true" />
          {item.label}
        </Link>
      </SheetClose>
      {after}
    </React.Fragment>
  );

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b bg-sidebar px-3 text-sidebar-foreground md:hidden print:hidden">
      <Link
        to="/"
        className="flex min-h-11 items-center gap-2 rounded-lg px-2 font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
      >
        <Logo className="size-7" />
        <span>HLBuilder</span>
      </Link>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <button
            type="button"
            className="grid size-11 place-items-center rounded-lg border border-sidebar-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
            aria-label="Open navigation"
          >
            <Menu className="size-5" />
          </button>
        </SheetTrigger>
        <SheetContent
          side="left"
          className="w-[min(88vw,22rem)] bg-sidebar p-0 text-sidebar-foreground"
        >
          <div className="flex h-14 items-center gap-3 border-b border-sidebar-border px-5">
            <Logo className="size-7" />
            <SheetTitle className="font-semibold">HLBuilder</SheetTitle>
          </div>
          <nav className="grid gap-1 p-3" aria-label="Mobile navigation">
            {items.map(item =>
              mobileLink(
                item,
                // The open project comes right after "Projects", as in the sidebar.
                item === PROJECTS_ITEM && (
                  <div className="py-1">
                    <ProjectCard onNavigate={() => setOpen(false)} />
                  </div>
                ),
              ),
            )}
            {onOpenCommandPalette && (
              <SheetClose asChild>
                <button
                  type="button"
                  onClick={onOpenCommandPalette}
                  className="mt-2 flex min-h-11 items-center rounded-lg border border-sidebar-border px-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
                >
                  <Search className="mr-3 size-4" />
                  Search and commands
                </button>
              </SheetClose>
            )}
          </nav>
        </SheetContent>
      </Sheet>
    </header>
  );
});

export const Sidebar = React.memo(function Sidebar({
  className,
  onOpenCommandPalette,
}: {
  className?: string;
  onOpenCommandPalette?: () => void;
}) {
  const { user } = useAuth();

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

  const label = (text: React.ReactNode) =>
    collapsed ? <span className="sr-only">{text}</span> : <span className="truncate">{text}</span>;

  const navLink = (item: NavItem) => (
    <NavLink
      key={item.href}
      to={item.href}
      title={collapsed ? item.label : undefined}
      className={({ isActive }) =>
        cn(ROW, isActive && ROW_ACTIVE, collapsed && 'justify-center px-2')
      }
    >
      <item.icon className={cn('size-4 shrink-0', !collapsed && 'mr-2.5')} aria-hidden="true" />
      {label(item.label)}
    </NavLink>
  );

  return (
    <>
      <aside
        className={cn(
          'hidden h-full flex-col overflow-hidden border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] duration-200 ease-out md:flex print:hidden',
          collapsed ? 'w-16' : 'w-64',
          className,
        )}
      >
        {/* Brand, and the switch that folds the sidebar away */}
        <div
          className={cn(
            'flex h-14 shrink-0 items-center border-b border-sidebar-border',
            collapsed ? 'justify-center px-2' : 'justify-between pl-4 pr-2',
          )}
        >
          <Link
            to="/"
            title="Go to Projects"
            className="flex min-w-0 items-center gap-2.5 rounded-lg py-1 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring"
          >
            <Logo className="size-7 shrink-0" interactive />
            {!collapsed && (
              <span className="truncate text-base font-semibold tracking-tight">HLBuilder</span>
            )}
          </Link>
          {!collapsed && (
            <button
              type="button"
              onClick={() => setCollapsed(true)}
              title="Collapse sidebar"
              aria-label="Collapse sidebar"
              className="grid size-8 shrink-0 place-items-center rounded-md text-sidebar-foreground/55 transition-colors hover:cursor-pointer hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring"
            >
              <ChevronsLeft className="size-4" aria-hidden="true" />
            </button>
          )}
        </div>

        {/* The work, then what is looked up while doing it */}
        <div className="flex-1 overflow-y-auto py-3">
          <nav className="grid gap-0.5 px-2" aria-label="Main navigation">
            {collapsed && (
              <button
                type="button"
                onClick={() => setCollapsed(false)}
                title="Expand sidebar"
                aria-label="Expand sidebar"
                className={cn(ROW, 'justify-center px-2 hover:cursor-pointer')}
              >
                <ChevronsRight className="size-4 shrink-0" aria-hidden="true" />
              </button>
            )}
            {navLink(PROJECTS_ITEM)}
            <div className="py-1">
              <ProjectCard collapsed={collapsed} />
            </div>
            {REFERENCE_ITEMS.map(navLink)}
          </nav>
        </div>

        {/* The app itself: finding things, settings, a word to its author */}
        <div className="grid shrink-0 gap-0.5 border-t border-sidebar-border p-2">
          <button
            type="button"
            onClick={onOpenCommandPalette}
            title={collapsed ? 'Command menu' : 'Open command palette'}
            className={cn(ROW, 'hover:cursor-pointer', collapsed && 'justify-center px-2')}
          >
            <Search className={cn('size-4 shrink-0', !collapsed && 'mr-2.5')} aria-hidden="true" />
            {collapsed ? (
              <span className="sr-only">Command menu</span>
            ) : (
              <span className="flex min-w-0 flex-1 items-center justify-between gap-2">
                <span className="truncate">Command menu</span>
                <kbd className="shrink-0 whitespace-nowrap rounded border border-sidebar-border px-1.5 py-0.5 font-sans text-[10px] font-normal text-sidebar-foreground/60">
                  Ctrl K
                </kbd>
              </span>
            )}
          </button>
          {user && navLink(SETTINGS_ITEM)}
          {user?.is_admin && navLink(ADMIN_ITEM)}
          {user && !surveyDone && (
            <button
              type="button"
              onClick={() => setShowSurvey(true)}
              title={collapsed ? 'Usage survey' : undefined}
              className={cn(
                ROW,
                'relative hover:cursor-pointer',
                collapsed && 'justify-center px-2',
              )}
            >
              <ClipboardList
                className={cn('size-4 shrink-0', !collapsed && 'mr-2.5')}
                aria-hidden="true"
              />
              {collapsed ? (
                <span className="sr-only">Usage survey, not answered yet</span>
              ) : (
                <span className="flex min-w-0 flex-1 items-center justify-between gap-2">
                  <span className="truncate">Usage survey</span>
                  <span className="text-xs font-normal text-sidebar-foreground/55">2 min</span>
                </span>
              )}
            </button>
          )}
          {navLink(SUPPORT_ITEM)}

          <div className="mt-1.5 border-t border-sidebar-border pt-2">
            {user ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label={`Account: ${user.name}`}
                    title={collapsed ? user.name : undefined}
                    className={cn(
                      'flex w-full items-center gap-2.5 rounded-lg p-1.5 text-left transition-colors hover:cursor-pointer hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring',
                      collapsed && 'justify-center',
                    )}
                  >
                    <UserAvatar name={user.name} src={user.avatar_url} />
                    {!collapsed && (
                      <>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium leading-tight">
                            {user.name}
                          </span>
                          <span className="block truncate text-xs text-sidebar-foreground/60">
                            {user.email}
                          </span>
                        </span>
                        <ChevronsUpDown
                          className="size-4 shrink-0 text-sidebar-foreground/50"
                          aria-hidden="true"
                        />
                      </>
                    )}
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent side="top" align="start" className="w-56">
                  <DropdownMenuLabel className="font-normal">
                    <span className="block truncate text-sm font-medium">{user.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {user.email}
                    </span>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem asChild>
                    <Link to="/profile">Profile</Link>
                  </DropdownMenuItem>
                  {surveyDone && (
                    <DropdownMenuItem onSelect={() => setShowSurvey(true)}>
                      Change survey answers
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator />
                  {OUTSIDE_LINKS.map(link => (
                    <DropdownMenuItem asChild key={link.href}>
                      <a
                        href={link.href}
                        {...(link.href.startsWith('http')
                          ? { target: '_blank', rel: 'noopener noreferrer' }
                          : {})}
                      >
                        {link.label}
                      </a>
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem asChild>
                    <Link to="/privacy">Privacy</Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link to="/terms">Terms</Link>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              !collapsed && <GoogleLoginButton />
            )}
          </div>
        </div>
      </aside>
      {showSurvey && <SurveyModal onClose={() => setShowSurvey(false)} />}
    </>
  );
});
