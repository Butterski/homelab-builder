import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../admin/hooks/use-auth';
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
} from 'lucide-react';
// Removed unused imports: ExternalLink, Cpu
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
import { toast } from 'sonner';
import { buildApi, type Build } from '../api/builds';
import { useBuilderStore } from '../store/builder-store';
import { formatDistanceToNow } from 'date-fns';
import { FastStartWizard } from '../components/fast-start-wizard';
import { generateFastStartPayload } from '../../../lib/templates';

const parseDetailsObject = (value: unknown) => {
  if (!value) {
    return {};
  }

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  return typeof value === 'object' ? value : {};
};

const normalizeNodesForSync = (nodes: any[] = []) =>
  nodes.map(node => ({
    ...node,
    details: parseDetailsObject(node.details),
    internal_components: (node.internal_components || []).map((component: any) => ({
      ...component,
      details: parseDetailsObject(component.details),
    })),
  }));

export default function ProjectsPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const isAuthenticated = !!user;
  const { loadBuild } = useBuilderStore();
  const [builds, setBuilds] = useState<Build[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  // Modal states
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [projectToDelete, setProjectToDelete] = useState<string | null>(null);
  const [isRenameOpen, setIsRenameOpen] = useState(false);
  const [projectToRename, setProjectToRename] = useState<Build | null>(null);
  const [renameValue, setRenameValue] = useState('');

  // Fast Start Wizard State
  const [isFastStartOpen, setIsFastStartOpen] = useState(false);
  const [isGeneratingFastStart, setIsGeneratingFastStart] = useState(false);

  useEffect(() => {
    if (isAuthenticated) {
      fetchBuilds();
    } else {
      setLoading(false);
    }
  }, [isAuthenticated]);

  // Import states
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importData, setImportData] = useState<string | null>(null);

  const fetchBuilds = async () => {
    try {
      const data = await buildApi.list();
      setBuilds(data);
    } catch (error) {
      console.error('Failed to fetch builds', error);
      toast.error('Failed to load projects');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateNew = () => {
    setImportData(null);
    setNewProjectName('New Project');
    setIsCreateOpen(true);
  };

  const handleImportClick = () => {
    if (fileInputRef.current) fileInputRef.current.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const text = ev.target?.result as string;
      try {
        const parsed = JSON.parse(text);
        if (!parsed.hardwareNodes && !parsed.nodes) {
          toast.error('Invalid .homelab.json file');
          return;
        }
        setImportData(text);
        let baseName = file.name.replace('.homelab.json', '').replace('.json', '');
        if (!baseName) baseName = 'Imported Project';
        setNewProjectName(baseName);
        setIsCreateOpen(true);
      } catch (_) {
        toast.error('Failed to parse JSON');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const confirmCreate = async () => {
    try {
      const name = newProjectName.trim() || (importData ? 'Imported Project' : 'New Project');
      const parsedData = importData ? JSON.parse(importData) : {};
      const newBuild = await buildApi.create({
        name: name,
        thumbnail: '',
        nodes: parsedData.nodes || [],
        edges: parsedData.edges || [],
        services: parsedData.services || [],
        settings: parsedData.settings || {},
      });

      loadBuild(newBuild.id, newBuild.name, importData ? JSON.parse(importData) : {});
      toast.success(importData ? 'Project imported successfully' : 'Project created successfully');
      navigate(`/builder/${newBuild.id}`);
    } catch (error) {
      console.error('Failed to create', error);
      toast.error('Failed to create project');
    } finally {
      setIsCreateOpen(false);
      setImportData(null);
    }
  };

  const handleFastStartGenerate = async (goal: string, scale: string) => {
    setIsGeneratingFastStart(true);
    try {
      const payload = generateFastStartPayload(goal, scale);
      const newBuild = await buildApi.create({
        name: payload.name,
        thumbnail: '',
        nodes: payload.nodes,
        edges: payload.edges,
        services: [],
        settings: {},
      });
      // generate dynamic IPs instantly
      await buildApi.calculateNetwork(newBuild.id);

      toast.success(`Generated Template: ${payload.name}`);
      navigate(`/builder/${newBuild.id}`);
    } catch (err) {
      console.error('Failed to generate wizard template', err);
      toast.error('Failed to generate project template');
    } finally {
      setIsGeneratingFastStart(false);
      setIsFastStartOpen(false);
    }
  };

  const handleExport = async (e: React.MouseEvent, build: Build) => {
    e.stopPropagation();
    try {
      // The list view might have truncated relationships, so we fetch the full representation.
      const fullBuild = await buildApi.get(build.id);
      const rawData = fullBuild;
      // Assemble a .homelab.json standard file using relational tables mapped into flat arrays
      const payload = {
        version: 1,
        name: fullBuild.name,
        exportedAt: new Date().toISOString(),
        nodes: rawData.nodes || [],
        edges: rawData.edges || [],
        boughtItems: rawData.settings?.boughtItems || [],
        showBought: rawData.settings?.showBought || false,
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${fullBuild.name.replace(/[^a-z0-9]/gi, '-')}.homelab.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('Project exported');
    } catch (_) {
      toast.error('Failed to export project');
    }
  };

  const handleOpen = (build: Build) => {
    // Just navigate, let the builder page fetch the full data
    navigate(`/builder/${build.id}`);
  };

  const handleDelete = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setProjectToDelete(id);
    setIsDeleteOpen(true);
  };

  const confirmDelete = async () => {
    if (!projectToDelete) return;
    try {
      await buildApi.delete(projectToDelete);
      setBuilds(prev => prev.filter(b => b.id !== projectToDelete));
      toast.success('Project deleted');
    } catch (error) {
      console.error('Failed to delete', error);
      toast.error('Failed to delete project');
    } finally {
      setIsDeleteOpen(false);
      setProjectToDelete(null);
    }
  };

  const handleDuplicate = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    try {
      const duplicatedBuild = await buildApi.duplicate(id);
      setBuilds(prev => [duplicatedBuild, ...prev]);
      toast.success('Project duplicated successfully');
    } catch (error) {
      console.error('Failed to duplicate', error);
      toast.error('Failed to duplicate project');
    }
  };

  const handleRenameClick = (e: React.MouseEvent, build: Build) => {
    e.stopPropagation();
    setProjectToRename(build);
    setRenameValue(build.name);
    setIsRenameOpen(true);
  };

  const confirmRename = async () => {
    if (!projectToRename || !renameValue.trim()) return;
    try {
      const newName = renameValue.trim();
      // We need full build data to rename cleanly if we use update endpoint since data is required
      // However, it's safer to fetch the original, rename, and save.
      const fullBuild = await buildApi.get(projectToRename.id);
      const updated = await buildApi.update(projectToRename.id, {
        name: newName,
        thumbnail: fullBuild.thumbnail,
        nodes: normalizeNodesForSync(fullBuild.nodes || []),
        edges: fullBuild.edges || [],
        services: [],
        settings: fullBuild.settings || {},
      });
      // Update local state listing
      setBuilds(prev => prev.map(b => (b.id === updated.id ? { ...b, name: updated.name } : b)));
      toast.success('Project renamed');
    } catch (error) {
      console.error('Failed to rename', error);
      toast.error('Failed to rename project');
    } finally {
      setIsRenameOpen(false);
      setProjectToRename(null);
    }
  };

  const filteredBuilds = builds.filter(b => b.name.toLowerCase().includes(search.toLowerCase()));

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
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
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
            <Upload className="mr-2 h-4 w-4" /> Import
          </Button>
          <Button
            variant="outline"
            className="text-amber-600 border-amber-200 hover:bg-amber-50 hover:text-amber-700 dark:border-amber-800/30 dark:hover:bg-amber-900/20 dark:hover:text-amber-400"
            onClick={() => setIsFastStartOpen(true)}
          >
            <Zap className="mr-2 h-4 w-4" /> Fast Start
          </Button>
          <Button onClick={handleCreateNew}>
            <Plus className="mr-2 h-4 w-4" /> New Project
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
            <Folder className="h-8 w-8 text-primary" />
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
          {filteredBuilds.map(build => {
            // The backend preloads the structural `nodes` array for counting
            let nodeCount = 0;
            if (build.nodes && Array.isArray(build.nodes)) {
              nodeCount = build.nodes.length;
            }

            return (
              <Card
                key={build.id}
                className="group cursor-pointer hover:border-primary/50 transition-all overflow-hidden flex flex-col"
                onClick={() => handleOpen(build)}
              >
                <div className="aspect-video bg-muted/30 relative border-b flex items-center justify-center group-hover:bg-muted/50 transition-colors">
                  {build.thumbnail ? (
                    <img
                      src={build.thumbnail}
                      alt={build.name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="flex flex-col items-center gap-2 text-muted-foreground/40">
                      <Folder className="h-12 w-12" />
                    </div>
                  )}

                  <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="secondary"
                          size="icon"
                          className="h-8 w-8"
                          onClick={e => e.stopPropagation()}
                        >
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={e => {
                            e.stopPropagation();
                            handleOpen(build);
                          }}
                        >
                          <Edit2 className="mr-2 h-4 w-4" /> Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={e => handleRenameClick(e, build)}>
                          <Edit2 className="mr-2 h-4 w-4" /> Rename
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={e => handleDuplicate(e, build.id)}>
                          <Folder className="mr-2 h-4 w-4" /> Duplicate
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={e => handleExport(e, build)}>
                          <Download className="mr-2 h-4 w-4" /> Export
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onClick={e => handleDelete(e, build.id)}
                        >
                          <Trash2 className="mr-2 h-4 w-4" /> Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>

                <div className="p-4 flex-1 flex flex-col">
                  <div className="flex items-start justify-between mb-2">
                    <h3 className="font-semibold truncate pr-2" title={build.name}>
                      {build.name}
                    </h3>
                    <Badge variant="secondary" className="text-[10px] shrink-0">
                      v1.0
                    </Badge>
                  </div>

                  <div className="mt-auto space-y-3">
                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                      <div className="flex items-center gap-1.5">
                        <HardDrive className="h-3.5 w-3.5" />
                        {nodeCount} Nodes
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Clock className="h-3.5 w-3.5" />
                        {formatDistanceToNow(new Date(build.updated_at), { addSuffix: true })}
                      </div>
                    </div>

                    <div className="pt-3 border-t flex items-center gap-2">
                      <Button
                        size="sm"
                        className="w-full"
                        onClick={e => {
                          e.stopPropagation();
                          handleOpen(build);
                        }}
                      >
                        <Play className="mr-2 h-3.5 w-3.5" /> Open Editor
                      </Button>
                    </div>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Create Project Modal */}
      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create New Project</DialogTitle>
            <DialogDescription>
              Give your homelab project a name to get started. You can change this later.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Label htmlFor="project-name" className="mb-2 block">
              Project Name
            </Label>
            <Input
              id="project-name"
              value={newProjectName}
              onChange={e => setNewProjectName(e.target.value)}
              placeholder="e.g. Dream Lab 2026"
              autoFocus
              onKeyDown={e => {
                if (e.key === 'Enter') confirmCreate();
              }}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCreateOpen(false)}>
              Cancel
            </Button>
            <Button onClick={confirmCreate}>Create Project</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Modal */}
      <Dialog open={isDeleteOpen} onOpenChange={setIsDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Project?</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this project? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDeleteOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmDelete}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rename Modal */}
      <Dialog open={isRenameOpen} onOpenChange={setIsRenameOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename Project</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <Label htmlFor="rename-project" className="mb-2 block">
              New Project Name
            </Label>
            <Input
              id="rename-project"
              value={renameValue}
              onChange={e => setRenameValue(e.target.value)}
              autoFocus
              onKeyDown={e => {
                if (e.key === 'Enter') confirmRename();
              }}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsRenameOpen(false)}>
              Cancel
            </Button>
            <Button onClick={confirmRename}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <FastStartWizard
        isOpen={isFastStartOpen}
        onClose={() => setIsFastStartOpen(false)}
        onGenerate={handleFastStartGenerate}
        isGenerating={isGeneratingFastStart}
      />
    </div>
  );
}
