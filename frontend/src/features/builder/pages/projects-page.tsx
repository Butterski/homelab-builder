import React from 'react';
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
  Zap,
  Share2,
  Copy,
  Check,
  Globe,
  Lock,
  Pencil,
} from 'lucide-react';
import { Button } from '../../../components/ui/button';
import { Card } from '../../../components/ui/card';
import { Badge } from '../../../components/ui/badge';
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
import { FastStartWizard } from '../components/fast-start-wizard';
import { useProjectsPage } from '../hooks/use-projects-page';

// ─── ProjectsPage ─────────────────────────────────────────────────────────────
function ProjectsPage() {
  const {
    loading,
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
    handleFastStartGenerate,
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
    <div className="container mx-auto py-8 px-4 max-w-7xl">
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">My Projects</h1>
          <p className="text-muted-foreground mt-1">
            Manage your homelab designs and configurations.
          </p>
        </div>
        <div className="flex items-center gap-2 w-full md:w-auto">
          <div className="relative flex-1 md:w-64">
            <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
            <Input
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
            <Upload className="mr-2 size-4" /> Import
          </Button>
          <Button
            variant="outline"
            className="text-amber-600 border-amber-200 hover:bg-amber-50 hover:text-amber-700 dark:border-amber-800/30 dark:hover:bg-amber-900/20 dark:hover:text-amber-400"
            onClick={() => dispatchModal({ type: 'OPEN_FAST_START' })}
          >
            <Zap className="mr-2 size-4" /> Fast Start
          </Button>
          <Button onClick={handleCreateNew}>
            <Plus className="mr-2 size-4" /> New Project
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-64 rounded-xl border bg-muted/20 animate-pulse" />
          ))}
        </div>
      ) : filteredBuilds.length === 0 ? (
        <div className="text-center py-20 border-2 border-dashed rounded-xl">
          <div className="bg-primary/10 p-4 rounded-full w-fit mx-auto mb-4">
            <Folder className="size-8 text-primary" />
          </div>
          <h3 className="text-lg font-semibold mb-2">No projects found</h3>
          <p className="text-muted-foreground mb-6 max-w-sm mx-auto">
            Get started by creating your first homelab design. You can visualize your network and
            generate configs.
          </p>
          <Button onClick={handleCreateNew}>Create Project</Button>
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

      <FastStartWizard
        isOpen={modal.fastStart.open}
        onClose={() => dispatchModal({ type: 'CLOSE_FAST_START' })}
        onGenerate={handleFastStartGenerate}
        isGenerating={modal.fastStart.generating}
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
  onSetRenameValue,
  onCloseCreate,
  onCloseDelete,
  onCloseRename,
}: {
  modal: { create: { open: boolean; name: string }; delete: { open: boolean }; rename: { open: boolean; value: string } };
  onConfirmCreate: () => void;
  onConfirmDelete: () => void;
  onConfirmRename: () => void;
  onSetCreateName: (name: string) => void;
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
            <DialogDescription>Give your homelab project a name to get started. You can change this later.</DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Label htmlFor="project-name" className="mb-2 block">Project Name</Label>
            <Input
              id="project-name"
              value={modal.create.name}
              onChange={e => onSetCreateName(e.target.value)}
              placeholder="e.g. Dream Lab 2026"
              autoFocus
              onKeyDown={e => { if (e.key === 'Enter') onConfirmCreate(); }}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={onCloseCreate}>Cancel</Button>
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
            <Button variant="outline" onClick={onCloseDelete}>Cancel</Button>
            <Button variant="destructive" onClick={onConfirmDelete}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={modal.rename.open} onOpenChange={onCloseRename}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename Project</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <Label htmlFor="rename-project" className="mb-2 block">New Project Name</Label>
            <Input
              id="rename-project"
              value={modal.rename.value}
              onChange={e => onSetRenameValue(e.target.value)}
              autoFocus
              onKeyDown={e => { if (e.key === 'Enter') onConfirmRename(); }}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={onCloseRename}>Cancel</Button>
            <Button onClick={onConfirmRename}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─── ShareModal ───────────────────────────────────────────────────────────────
function ShareModal({ build, open, copied, onClose, onToggleShare, onToggleEditable, onCopyLink }: {
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
          <DialogDescription>Control who can view or edit this layout via a link.</DialogDescription>
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
            <Button variant={build?.is_shared ? 'outline' : 'default'} size="sm" onClick={onToggleShare}>
              {build?.is_shared ? 'Disable sharing' : 'Enable sharing'}
            </Button>
          </div>

          {build?.is_shared && (
            <div className="flex items-center justify-between p-3 rounded-lg border">
              <div className="flex items-center gap-2">
                <Pencil className={`size-4 ${build.shared_editable ? 'text-blue-500' : 'text-muted-foreground'}`} />
                <div>
                  <span className="text-sm font-medium">{build.shared_editable ? 'Editing allowed' : 'View only'}</span>
                  <p className="text-xs text-muted-foreground">
                    {build.shared_editable ? 'Anyone with the link can move nodes and reconnect cables' : 'Viewers cannot make changes'}
                  </p>
                </div>
              </div>
              <Button variant={build.shared_editable ? 'outline' : 'secondary'} size="sm" onClick={onToggleEditable}>
                {build.shared_editable ? 'Make read-only' : 'Allow editing'}
              </Button>
            </div>
          )}

          {build?.is_shared && build.share_token && (
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Share link</Label>
              <div className="flex gap-2">
                <Input readOnly value={`${window.location.origin}/shared/${build.share_token}`} className="text-xs font-mono" />
                <Button size="icon" variant="outline" onClick={onCopyLink}>
                  {copied ? <Check className="size-4 text-green-500" /> : <Copy className="size-4" />}
                </Button>
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
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

  return (
    <Card
      className="group cursor-pointer hover:border-primary/50 transition-all overflow-hidden flex flex-col"
      onClick={() => onOpen(build)}
    >
      <div className="aspect-video bg-muted/30 relative border-b flex items-center justify-center group-hover:bg-muted/50 transition-colors">
        {build.thumbnail ? (
          <img src={build.thumbnail} alt={build.name} className="w-full h-full object-cover" />
        ) : (
          <div className="flex flex-col items-center gap-2 text-muted-foreground/40">
            <Folder className="size-12" />
          </div>
        )}

        <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="secondary" size="icon" className="size-8" onClick={e => e.stopPropagation()}>
                <MoreVertical className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={e => { e.stopPropagation(); onOpen(build); }}>
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
              <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={e => onDelete(e, build.id)}>
                <Trash2 className="mr-2 size-4" /> Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="p-4 flex-1 flex flex-col">
        <div className="flex items-start justify-between mb-2">
          <h3 className="font-semibold truncate pr-2" title={build.name}>{build.name}</h3>
          <Badge variant="secondary" className="text-[10px] shrink-0">v1.0</Badge>
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

          <div className="pt-3 border-t flex items-center gap-2">
            <Button size="sm" className="w-full" onClick={e => { e.stopPropagation(); onOpen(build); }}>
              <Play className="mr-2 size-3.5" /> Open Editor
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
});

export default React.memo(ProjectsPage);
