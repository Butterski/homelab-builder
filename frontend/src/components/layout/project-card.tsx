import { useEffect, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  CheckSquare,
  ChevronsUpDown,
  FileCode,
  FolderOpen,
  LayoutTemplate,
  Plus,
  Sparkles,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';
import { useAuth } from '../../features/admin/hooks/use-auth';
import { useSyncState } from '../../features/builder/api/proposals';
import { useBuilds } from '../../features/builder/api/use-builds';
import { LayoutThumbnail } from '../../features/builder/components/layout-thumbnail';
import { SaveStateChip, saveStateLabel } from '../../features/builder/components/save-state-chip';
import { useCurrentProject } from '../../features/builder/hooks/use-current-project';
import { pictureOf, type LayoutPicture } from '../../features/builder/lib/layout';
import { layoutGraphFromFlow } from '../../features/builder/lib/layout/from-flow';
import { useBuilderStore } from '../../features/builder/store/builder-store';
import { buildKindInfo } from '../../features/gaming/lib/kind';

/** How often the card asks whether a proposal is waiting, away from the canvas (which asks itself). */
const PROPOSAL_POLL_MS = 20_000;
/** How long the canvas has to rest before its miniature is drawn again. */
const THUMBNAIL_DELAY_MS = 500;
/** How many other projects the switcher lists. */
const RECENT_PROJECTS = 5;

const NAV_LINK =
  'group flex min-h-9 items-center rounded-lg px-3 py-1.5 text-sm font-medium text-sidebar-foreground/68 transition-[background-color,color,box-shadow] hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring';
const NAV_LINK_ACTIVE =
  'bg-sidebar-accent text-sidebar-accent-foreground shadow-[0_0_0_1px_color-mix(in_oklab,var(--sidebar-primary)_28%,transparent)] [&>svg]:rounded-md [&>svg]:bg-sidebar-primary [&>svg]:p-0.5 [&>svg]:text-sidebar-primary-foreground';

function drawCanvas(): LayoutPicture | null {
  const state = useBuilderStore.getState();
  if (state.buildStatus !== 'ready' || state.nodes.length === 0) return null;
  return pictureOf(layoutGraphFromFlow(state.nodes, state.edges, state.hardwareNodes));
}

/**
 * The open canvas in miniature. It is drawn again a moment after the canvas
 * has come to rest, not on every frame of a drag.
 */
function ProjectThumbnail({ name }: { name: string }) {
  const [picture, setPicture] = useState(drawCanvas);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = useBuilderStore.subscribe((state, previous) => {
      if (
        state.nodes === previous.nodes &&
        state.edges === previous.edges &&
        state.buildStatus === previous.buildStatus
      ) {
        return;
      }
      clearTimeout(timer);
      timer = setTimeout(() => setPicture(drawCanvas()), THUMBNAIL_DELAY_MS);
    });
    return () => {
      unsubscribe();
      clearTimeout(timer);
    };
  }, []);

  if (!picture) return null;
  return (
    <LayoutThumbnail
      picture={picture}
      label={`${name}: the canvas in miniature`}
      className="h-20 w-full rounded-md bg-sidebar/60"
    />
  );
}

/** The other projects, most recently changed first, and the ways to get to more. */
function ProjectSwitcher({ currentId, onNavigate }: { currentId: string; onNavigate?: () => void }) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  // Fetched when the menu opens; the Projects page keeps the same list fresh.
  const { data: builds, isPending } = useBuilds({ enabled: open });
  const others = (builds ?? [])
    .filter(build => build.id !== currentId)
    .toSorted((a, b) => b.updated_at.localeCompare(a.updated_at))
    .slice(0, RECENT_PROJECTS);

  const go = (to: string, state?: unknown) => {
    setOpen(false);
    onNavigate?.();
    navigate(to, state ? { state } : undefined);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Switch project"
          title="Switch project"
          className="grid size-7 shrink-0 place-items-center rounded-md text-sidebar-foreground/60 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring"
        >
          <ChevronsUpDown className="size-4" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" side="right" className="w-64 p-1.5">
        <p className="px-2 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Recent projects
        </p>
        {isPending ? (
          <p className="px-2 py-2 text-xs text-muted-foreground">Loading…</p>
        ) : others.length === 0 ? (
          <p className="px-2 py-2 text-xs text-muted-foreground">No other projects yet.</p>
        ) : (
          <ul>
            {others.map(build => {
              const Icon = buildKindInfo(build.kind).icon;
              return (
                <li key={build.id}>
                  <button
                    type="button"
                    onClick={() => go(`/builder/${build.id}`)}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:cursor-pointer hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                  >
                    <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate">{build.name || 'Untitled project'}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <div className="mt-1 border-t pt-1">
          <button
            type="button"
            onClick={() => go('/')}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:cursor-pointer hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
          >
            <FolderOpen className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            All projects
          </button>
          <button
            type="button"
            onClick={() => go('/', { createProject: true })}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:cursor-pointer hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
          >
            <Plus className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            New project
          </button>
          <button
            type="button"
            onClick={() => go('/planner')}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:cursor-pointer hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
          >
            <Sparkles className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            Plan one with the guided planner
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

type ProjectCardProps = {
  /** The sidebar is reduced to icons. */
  collapsed?: boolean;
  /** Called when a link was followed, e.g. to close the mobile menu. */
  onNavigate?: () => void;
};

const STATE_DOT: Record<string, string> = {
  saved: 'bg-emerald-500',
  unsaved: 'bg-amber-500',
  saving: 'bg-amber-500',
  error: 'bg-destructive',
};

/**
 * The project the user is working on, in the sidebar: what it is, whether it
 * is saved, whether an AI proposal is waiting, and its pages. Which project
 * that is survives a reload; the details come from the canvas once it is
 * loaded.
 */
export function ProjectCard({ collapsed = false, onNavigate }: ProjectCardProps) {
  const { user } = useAuth();
  const { pathname } = useLocation();
  const project = useCurrentProject({ load: false });
  const devices = useBuilderStore(state => state.hardwareNodes.length);
  const saveState = useBuilderStore(state => state.saveState);
  const saveError = useBuilderStore(state => state.saveError);
  const reachable = useBuilderStore(state => state.serverReachable);

  // On the canvas the builder polls and this card reads what it fetched.
  const onCanvas = pathname.startsWith('/builder/');
  const { data: sync } = useSyncState(project.id, !!user && !onCanvas, PROPOSAL_POLL_MS);
  const waiting = sync?.pending ?? null;

  if (!project.id) {
    if (collapsed) return null;
    return (
      <Link
        to="/"
        onClick={onNavigate}
        className="mx-1 flex items-center gap-2 rounded-lg border border-dashed border-sidebar-border px-3 py-2 text-xs text-sidebar-foreground/60 transition-colors hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring"
      >
        <FolderOpen className="size-4 shrink-0" aria-hidden="true" />
        No project open. Choose one.
      </Link>
    );
  }

  const kind = buildKindInfo(project.kind);
  const name = project.name || 'Untitled project';
  const canvas = `/builder/${project.id}`;
  const pages: Array<{ label: string; href: string; icon: LucideIcon }> = [
    { label: 'Canvas', href: canvas, icon: LayoutTemplate },
    { label: 'Config Generator', href: '/generate', icon: FileCode },
    { label: 'Setup Guide', href: '/checklist', icon: CheckSquare },
  ];
  const retrySave = () => void useBuilderStore.getState().reassignAllIPs().catch(() => undefined);

  if (collapsed) {
    const status = project.ready ? saveStateLabel(saveState, reachable) : kind.label;
    return (
      <div className="grid gap-1">
        <Tooltip>
          {/* A plain link with its class worked out here: the tooltip trigger merges
              class names as text and cannot pass on NavLink's function form. */}
          <TooltipTrigger asChild>
            <Link
              to={canvas}
              aria-label={`${name}: open the canvas`}
              aria-current={pathname === canvas ? 'page' : undefined}
              className={cn(NAV_LINK, 'relative justify-center px-2', pathname === canvas && NAV_LINK_ACTIVE)}
            >
              <kind.icon className="size-4 shrink-0" aria-hidden="true" />
              {project.ready && (
                <span
                  className={cn('absolute right-1.5 top-1.5 size-2 rounded-full ring-2 ring-sidebar', STATE_DOT[saveState])}
                  aria-hidden="true"
                />
              )}
              {waiting && (
                <span
                  className="absolute bottom-1.5 right-1.5 size-2 rounded-full bg-sidebar-primary ring-2 ring-sidebar"
                  aria-hidden="true"
                />
              )}
            </Link>
          </TooltipTrigger>
          <TooltipContent side="right">
            <p className="font-medium">{name}</p>
            <p className="text-muted-foreground">
              {status}
              {waiting ? ' · a proposal is waiting' : ''}
            </p>
          </TooltipContent>
        </Tooltip>
        {pages.slice(1).map(page => (
          <NavLink
            key={page.href}
            to={page.href}
            title={page.label}
            aria-label={page.label}
            className={({ isActive }) => cn(NAV_LINK, 'justify-center px-2', isActive && NAV_LINK_ACTIVE)}
          >
            <page.icon className="size-4 shrink-0" aria-hidden="true" />
          </NavLink>
        ))}
      </div>
    );
  }

  return (
    <section
      aria-label="Current project"
      className="rounded-xl border border-sidebar-border bg-sidebar-accent/35 p-2"
    >
      {project.ready && (
        // The name below is the link for keyboards and screen readers; the
        // picture is the same link for a mouse.
        <Link to={canvas} onClick={onNavigate} tabIndex={-1} aria-hidden="true" className="block rounded-lg">
          <ProjectThumbnail name={name} />
        </Link>
      )}
      <div className="mt-1.5 flex items-start gap-1 pl-1">
        <Link
          to={canvas}
          onClick={onNavigate}
          className="min-w-0 flex-1 rounded-md focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring"
        >
          <span className="block truncate text-sm font-semibold leading-tight" title={name}>
            {name}
          </span>
          <span className="mt-0.5 flex items-center gap-1 text-xs text-sidebar-foreground/60">
            <kind.icon className="size-3 shrink-0" aria-hidden="true" />
            <span className="truncate">
              {kind.label}
              {project.ready && ` · ${devices} ${devices === 1 ? 'device' : 'devices'}`}
            </span>
          </span>
        </Link>
        <ProjectSwitcher currentId={project.id} onNavigate={onNavigate} />
      </div>
      {(project.ready || waiting) && (
        <div className="mt-1.5 flex min-h-5 items-center justify-between gap-2 pl-1">
          {project.ready ? (
            <SaveStateChip state={saveState} error={saveError} reachable={reachable} onRetry={retrySave} />
          ) : (
            <span />
          )}
          {waiting && (
            <Link
              to={`${canvas}?proposal=${waiting.id}`}
              onClick={onNavigate}
              title={waiting.summary || 'An AI proposal is waiting for your review'}
              className="inline-flex shrink-0 items-center gap-1 rounded-full bg-sidebar-primary px-2 py-0.5 text-[10px] font-semibold text-sidebar-primary-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring"
            >
              <Sparkles className="size-3" aria-hidden="true" />
              1 proposal
            </Link>
          )}
        </div>
      )}
      <nav aria-label="Pages of this project" className="mt-2 grid gap-0.5 border-t border-sidebar-border pt-2">
        {pages.map(page => (
          <NavLink
            key={page.href}
            to={page.href}
            onClick={onNavigate}
            className={({ isActive }) => cn(NAV_LINK, isActive && NAV_LINK_ACTIVE)}
          >
            <page.icon className="mr-2 size-4 shrink-0" aria-hidden="true" />
            <span className="truncate">{page.label}</span>
          </NavLink>
        ))}
      </nav>
    </section>
  );
}
