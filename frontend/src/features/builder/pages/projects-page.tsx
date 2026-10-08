import React, { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Copy, Check, Globe, Lock, MoreVertical, Pencil, Search } from 'lucide-react';
import { Page, PageHeader } from '../../../components/layout/page';
import { Button } from '../../../components/ui/button';
import { BUILD_KINDS, buildKindInfo, isGamingKind } from '../../gaming/lib/kind';
import type { BuildKind } from '../../../types';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../../components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../components/ui/dialog';
import { Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';
import type { Build } from '../api/builds';
import { formatDistanceToNow } from 'date-fns';
import { useProjectsPage } from '../hooks/use-projects-page';
import { FirstProject } from '../components/first-project';
import { LayoutThumbnail } from '../components/layout-thumbnail';
import { mapBuildToFlow } from '../lib/build-mapper';
import { pictureOf } from '../lib/layout';
import { layoutGraphFromFlow } from '../lib/layout/from-flow';

// ─── ProjectsPage ─────────────────────────────────────────────────────────────
function ProjectsPage() {
  const {
    loading,
    builds,
    search,
    setSearch,
    modal,
    dispatchModal,
    fileInputRef,
    buildToShare,
    filteredBuilds,
    handleCreateNew,
    handleImportClick,
    handleFileChange,
    confirmCreate,
    handleExport,
    handleOpen,
    handleDelete,
    confirmDelete,
    handleDuplicate,
    handleRenameClick,
    confirmRename,
    handleShareClick,
    handleToggleShare,
    handleCopyShareLink,
    handleToggleEditable,
  } = useProjectsPage();

  return (
    <Page>
      <PageHeader
        title="Projects"
        lede="Your homelab designs, LAN parties and game servers."
        actions={
          <>
            <div className="relative min-w-0 flex-1 basis-full sm:basis-56">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                type="search"
                aria-label="Search projects"
                placeholder="Search projects..."
                className="pl-9"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
            <input
              type="file"
              ref={fileInputRef}
              accept=".json,.homelab.json"
              className="hidden"
              onChange={handleFileChange}
            />
            <Button variant="outline" onClick={handleImportClick}>
              Import
            </Button>
            <Button variant="outline" asChild>
              <Link to="/planner">Guided Planner</Link>
            </Button>
            <Button onClick={handleCreateNew}>New project</Button>
          </>
        }
      />

      <div className="pt-6">
        {loading ? (
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="app-card h-56 animate-pulse" />
            ))}
          </div>
        ) : builds.length === 0 ? (
          <FirstProject onCreateEmpty={handleCreateNew} onImport={handleImportClick} />
        ) : filteredBuilds.length === 0 ? (
          <div className="app-empty-state px-6 py-12">
            <h2 className="font-semibold">No project matches &ldquo;{search}&rdquo;</h2>
            <Button variant="outline" className="mt-4" onClick={() => setSearch('')}>
              Clear search
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
            {filteredBuilds.map(build => (
              <BuildCard
                key={build.id}
                build={build}
                onOpen={handleOpen}
                onRenameClick={handleRenameClick}
                onDuplicate={handleDuplicate}
                onExport={handleExport}
                onShareClick={handleShareClick}
                onDelete={handleDelete}
              />
            ))}
          </div>
        )}
      </div>

      <ProjectModals
        modal={modal}
        onConfirmCreate={confirmCreate}
        onConfirmDelete={confirmDelete}
        onConfirmRename={confirmRename}
        onSetCreateName={(name: string) => dispatchModal({ type: 'SET_CREATE_NAME', name })}
        onSetCreateKind={(kind: BuildKind) => dispatchModal({ type: 'SET_CREATE_KIND', kind })}
        onSetRenameValue={(value: string) => dispatchModal({ type: 'SET_RENAME_VALUE', value })}
        onCloseCreate={() => dispatchModal({ type: 'CLOSE_CREATE' })}
        onCloseDelete={() => dispatchModal({ type: 'CLOSE_DELETE' })}
        onCloseRename={() => dispatchModal({ type: 'CLOSE_RENAME' })}
      />

      <ShareModal
        build={buildToShare}
        open={modal.share.open}
        copied={modal.share.copied}
        onClose={() => dispatchModal({ type: 'CLOSE_SHARE' })}
        onToggleShare={handleToggleShare}
        onToggleEditable={handleToggleEditable}
        onCopyLink={handleCopyShareLink}
      />
    </Page>
  );
}

// ─── ProjectModals ────────────────────────────────────────────────────────────
function ProjectModals({
  modal,
  onConfirmCreate,
  onConfirmDelete,
  onConfirmRename,
  onSetCreateName,
  onSetCreateKind,
  onSetRenameValue,
  onCloseCreate,
  onCloseDelete,
  onCloseRename,
}: {
  modal: {
    create: { open: boolean; name: string; kind: BuildKind };
    delete: { open: boolean };
    rename: { open: boolean; value: string };
  };
  onConfirmCreate: () => void;
  onConfirmDelete: () => void;
  onConfirmRename: () => void;
  onSetCreateName: (name: string) => void;
  onSetCreateKind: (kind: BuildKind) => void;
  onSetRenameValue: (value: string) => void;
  onCloseCreate: () => void;
  onCloseDelete: () => void;
  onCloseRename: () => void;
}) {
  return (
    <>
      <Dialog open={modal.create.open} onOpenChange={onCloseCreate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create New Project</DialogTitle>
            <DialogDescription>
              Name the project and say what it is for. Both can be changed later.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Label htmlFor="project-name" className="mb-2 block">
              Project Name
            </Label>
            <Input
              id="project-name"
              value={modal.create.name}
              onChange={e => onSetCreateName(e.target.value)}
              placeholder="e.g. Dream Lab 2026"
              autoFocus
              onKeyDown={e => {
                if (e.key === 'Enter') onConfirmCreate();
              }}
            />
            <fieldset className="mt-4">
              <legend className="mb-2 text-sm font-medium">What are you planning?</legend>
              <div className="grid gap-2 sm:grid-cols-3">
                {BUILD_KINDS.map(({ kind, label, description, icon: Icon }) => {
                  const selected = modal.create.kind === kind;
                  return (
                    <button
                      key={kind}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => onSetCreateKind(kind)}
                      className={`rounded-lg border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                        selected
                          ? 'border-primary bg-primary/10'
                          : 'border-border hover:border-primary/40 hover:bg-muted/30'
                      }`}
                    >
                      <Icon
                        className={`size-4 ${selected ? 'text-primary' : 'text-muted-foreground'}`}
                      />
                      <div className="mt-2 text-sm font-medium">{label}</div>
                      <p className="mt-0.5 text-xs leading-snug text-muted-foreground">
                        {description}
                      </p>
                    </button>
                  );
                })}
              </div>
            </fieldset>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={onCloseCreate}>
              Cancel
            </Button>
            <Button onClick={onConfirmCreate}>Create Project</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={modal.delete.open} onOpenChange={onCloseDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Project?</DialogTitle>
            <DialogDescription>This action cannot be undone.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={onCloseDelete}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={onConfirmDelete}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={modal.rename.open} onOpenChange={onCloseRename}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename Project</DialogTitle>
            <DialogDescription>
              The new name is used everywhere this project is shown.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Label htmlFor="rename-project" className="mb-2 block">
              New Project Name
            </Label>
            <Input
              id="rename-project"
              value={modal.rename.value}
              onChange={e => onSetRenameValue(e.target.value)}
              autoFocus
              onKeyDown={e => {
                if (e.key === 'Enter') onConfirmRename();
              }}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={onCloseRename}>
              Cancel
            </Button>
            <Button onClick={onConfirmRename}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─── ShareModal ───────────────────────────────────────────────────────────────
function ShareModal({
  build,
  open,
  copied,
  onClose,
  onToggleShare,
  onToggleEditable,
  onCopyLink,
}: {
  build: Build | null;
  open: boolean;
  copied: boolean;
  onClose: () => void;
  onToggleShare: () => void;
  onToggleEditable: () => void;
  onCopyLink: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Share Layout</DialogTitle>
          <DialogDescription>
            Control who can view or edit this layout via a link.
          </DialogDescription>
        </DialogHeader>
        <div className="py-4 space-y-4">
          <div className="flex items-center justify-between p-3 rounded-lg border">
            <div className="flex items-center gap-2">
              {build?.is_shared ? (
                <Globe className="size-4 text-green-500" />
              ) : (
                <Lock className="size-4 text-muted-foreground" />
              )}
              <span className="text-sm font-medium">
                {build?.is_shared ? 'Public — anyone with the link' : 'Private — only you'}
              </span>
            </div>
            <Button
              variant={build?.is_shared ? 'outline' : 'default'}
              size="sm"
              onClick={onToggleShare}
            >
              {build?.is_shared ? 'Disable sharing' : 'Enable sharing'}
            </Button>
          </div>

          {build?.is_shared && (
            <div className="flex items-center justify-between p-3 rounded-lg border">
              <div className="flex items-center gap-2">
                <Pencil
                  className={`size-4 ${build.shared_editable ? 'text-blue-500' : 'text-muted-foreground'}`}
                />
                <div>
                  <span className="text-sm font-medium">
                    {build.shared_editable ? 'Editing allowed' : 'View only'}
                  </span>
                  <p className="text-xs text-muted-foreground">
                    {build.shared_editable
                      ? 'Anyone with the link can move nodes and reconnect cables'
                      : 'Viewers cannot make changes'}
                  </p>
                </div>
              </div>
              <Button
                variant={build.shared_editable ? 'outline' : 'secondary'}
                size="sm"
                onClick={onToggleEditable}
              >
                {build.shared_editable ? 'Make read-only' : 'Allow editing'}
              </Button>
            </div>
          )}

          {build?.is_shared && build.share_token && (
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Share link</Label>
              <div className="flex gap-2">
                <Input
                  readOnly
                  value={`${window.location.origin}/shared/${build.share_token}`}
                  className="text-xs font-mono"
                />
                <Button
                  size="icon"
                  variant="outline"
                  onClick={onCopyLink}
                  aria-label="Copy Share Link"
                >
                  {copied ? (
                    <Check className="size-4 text-green-500" />
                  ) : (
                    <Copy className="size-4" />
                  )}
                </Button>
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── BuildCard ────────────────────────────────────────────────────────────────

/** The build in miniature, drawn from what the list of projects knows about it. */
const ProjectPicture = React.memo(function ProjectPicture({ build }: { build: Build }) {
  const picture = useMemo(() => {
    const flow = mapBuildToFlow(build);
    if (flow.nodes.length === 0) return null;
    return pictureOf(layoutGraphFromFlow(flow.nodes, flow.edges, flow.hardwareNodes));
  }, [build]);

  if (build.thumbnail) {
    return <img src={build.thumbnail} alt="" className="size-full object-cover" />;
  }
  if (!picture) {
    return <p className="text-sm text-muted-foreground">Nothing on the canvas yet</p>;
  }
  return (
    <LayoutThumbnail
      picture={picture}
      label={`${build.name}: the canvas in miniature`}
      className="size-full"
    />
  );
});

const BuildCard = React.memo(function BuildCard({
  build,
  onOpen,
  onRenameClick,
  onDuplicate,
  onExport,
  onShareClick,
  onDelete,
}: {
  build: Build;
  onOpen: (b: Build) => void;
  onRenameClick: (e: React.MouseEvent, b: Build) => void;
  onDuplicate: (e: React.MouseEvent, id: string) => void;
  onExport: (e: React.MouseEvent, b: Build) => void;
  onShareClick: (e: React.MouseEvent, b: Build) => void;
  onDelete: (e: React.MouseEvent, id: string) => void;
}) {
  const nodeCount = build.nodes && Array.isArray(build.nodes) ? build.nodes.length : 0;
  const kindInfo = buildKindInfo(build.kind);

  return (
    <article
      className="app-card group flex cursor-pointer flex-col overflow-hidden transition-colors focus-within:border-muted-foreground/70 hover:border-muted-foreground/70"
      onClick={() => onOpen(build)}
    >
      <div className="grid h-36 place-items-center border-b bg-muted/30 p-3">
        <ProjectPicture build={build} />
      </div>

      <div className="flex items-start gap-2 p-4">
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-medium" title={build.name}>
            <button
              type="button"
              className="rounded-sm text-left hover:cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              onClick={e => {
                e.stopPropagation();
                onOpen(build);
              }}
            >
              {build.name}
            </button>
          </h3>
          <p className="mt-1 flex gap-3 text-sm text-muted-foreground">
            <span className="shrink-0">
              {isGamingKind(build.kind) && (
                <>
                  <span>{kindInfo.label}</span>,{' '}
                </>
              )}
              {nodeCount} {nodeCount === 1 ? 'device' : 'devices'}
            </span>
            <span className="min-w-0 flex-1 truncate text-right">
              {formatDistanceToNow(new Date(build.updated_at), { addSuffix: true })}
            </span>
          </p>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="-mr-2 -mt-1 size-8 shrink-0 text-muted-foreground"
              onClick={e => e.stopPropagation()}
              aria-label={`Open Actions For ${build.name}`}
            >
              <MoreVertical className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onClick={e => {
                e.stopPropagation();
                onOpen(build);
              }}
            >
              Open
            </DropdownMenuItem>
            <DropdownMenuItem onClick={e => onRenameClick(e, build)}>Rename</DropdownMenuItem>
            <DropdownMenuItem onClick={e => onDuplicate(e, build.id)}>Duplicate</DropdownMenuItem>
            <DropdownMenuItem onClick={e => onExport(e, build)}>Export</DropdownMenuItem>
            <DropdownMenuItem onClick={e => onShareClick(e, build)}>Share</DropdownMenuItem>
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onClick={e => onDelete(e, build.id)}
            >
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </article>
  );
});

export default React.memo(ProjectsPage);
