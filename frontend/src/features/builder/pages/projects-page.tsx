import React from 'react';
import { Link } from 'react-router-dom';
import {
  Plus,
  Folder,
  Clock,
  MoreVertical,
  Trash2,
  Edit2,
  Play,
  HardDrive,
  Search,
  Download,
  Upload,
  Share2,
  Copy,
  Check,
  Globe,
  Lock,
  Pencil,
  Sparkles,
} from 'lucide-react';
import { Button } from '../../../components/ui/button';
import { Card } from '../../../components/ui/card';
import { Badge } from '../../../components/ui/badge';
import { APP_VERSION_LABEL } from '../../../lib/version';
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
    <div className="app-page mx-auto max-w-7xl px-4 py-8">
      <div className="app-hero mb-8 flex flex-col items-start justify-between gap-4 md:flex-row md:items-center">
        <div className="min-w-0">
          <span className="app-chip mb-3">Workspace</span>
          <h1 className="text-3xl font-bold tracking-tight text-balance">My Projects</h1>
          <p className="mt-1 text-muted-foreground">
            Manage your homelab designs and configurations.
          </p>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 md:w-auto md:justify-end">
          <div className="relative min-w-0 flex-1 basis-full sm:basis-64 md:w-64">
            <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
            <Input
              placeholder="Search projects..."
              className="h-10 pl-9"
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
          <Button variant="outline" onClick={handleImportClick} className="flex-1 sm:flex-none">
            <Upload className="mr-2 size-4" /> Import
          </Button>
          <Button asChild className="flex-1 sm:flex-none">
            <Link to="/planner">
              <Sparkles className="mr-2 size-4" />
              Guided Planner
            </Link>
          </Button>
          <Button onClick={handleCreateNew} className="flex-1 sm:flex-none">
            <Plus className="mr-2 size-4" /> New Project
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1, 2, 3].map(i => (
            <div key={i} className="app-card h-64 animate-pulse" />
          ))}
        </div>
      ) : builds.length === 0 ? (
        <FirstProject onCreateEmpty={handleCreateNew} onImport={handleImportClick} />
      ) : filteredBuilds.length === 0 ? (
        <div className="app-empty-state py-16 text-center">
          <h3 className="mb-2 text-lg font-semibold">No project matches &ldquo;{search}&rdquo;</h3>
          <Button variant="outline" onClick={() => setSearch('')}>
            Clear search
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
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

      <ProjectModals
        modal={modal as any}
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

    </div>
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
            <DialogDescription>The new name is used everywhere this project is shown.</DialogDescription>
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
  const KindIcon = kindInfo.icon;

  return (
    <Card
      className="app-card group flex cursor-pointer flex-col overflow-hidden transition-[border-color,transform] hover:-translate-y-0.5 hover:border-primary/50"
      onClick={() => onOpen(build)}
    >
      <div className="relative flex aspect-video items-center justify-center border-b bg-[radial-gradient(circle_at_50%_35%,color-mix(in_srgb,var(--primary)_12%,transparent),transparent_42%),color-mix(in_srgb,var(--muted)_55%,transparent)] transition-colors group-hover:bg-muted/50">
        {build.thumbnail ? (
          <img src={build.thumbnail} alt={build.name} className="w-full h-full object-cover" />
        ) : (
          <div className="flex flex-col items-center gap-2 text-muted-foreground/40">
            <Folder className="size-12" />
          </div>
        )}

        <div className="absolute right-2 top-2 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="secondary"
                size="icon"
                className="size-8"
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
                <Edit2 className="mr-2 size-4" /> Edit
              </DropdownMenuItem>
              <DropdownMenuItem onClick={e => onRenameClick(e, build)}>
                <Edit2 className="mr-2 size-4" /> Rename
              </DropdownMenuItem>
              <DropdownMenuItem onClick={e => onDuplicate(e, build.id)}>
                <Folder className="mr-2 size-4" /> Duplicate
              </DropdownMenuItem>
              <DropdownMenuItem onClick={e => onExport(e, build)}>
                <Download className="mr-2 size-4" /> Export
              </DropdownMenuItem>
              <DropdownMenuItem onClick={e => onShareClick(e, build)}>
                <Share2 className="mr-2 size-4" /> Share
              </DropdownMenuItem>
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={e => onDelete(e, build.id)}
              >
                <Trash2 className="mr-2 size-4" /> Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="flex flex-1 flex-col p-4">
        <div className="mb-2 flex items-start justify-between">
          <h3 className="font-semibold truncate pr-2" title={build.name}>
            {build.name}
          </h3>
          <div className="flex shrink-0 items-center gap-1">
            {isGamingKind(build.kind) && (
              <Badge variant="outline" className="gap-1 text-[10px]">
                <KindIcon className="size-3" />
                {kindInfo.label}
              </Badge>
            )}
            <Badge variant="secondary" className="text-[10px]">
              {APP_VERSION_LABEL}
            </Badge>
          </div>
        </div>

        <div className="mt-auto space-y-3">
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <div className="flex items-center gap-1.5">
              <HardDrive className="size-3.5" />
              {nodeCount} Nodes
            </div>
            <div className="flex items-center gap-1.5">
              <Clock className="size-3.5" />
              {formatDistanceToNow(new Date(build.updated_at), { addSuffix: true })}
            </div>
          </div>

          <div className="flex items-center gap-2 border-t pt-3">
            <Button
              size="sm"
              className="w-full"
              onClick={e => {
                e.stopPropagation();
                onOpen(build);
              }}
            >
              <Play className="mr-2 size-3.5" /> Open Editor
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
});

export default React.memo(ProjectsPage);
