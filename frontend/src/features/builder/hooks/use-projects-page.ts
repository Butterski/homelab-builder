import { useState, useEffect, useRef, useReducer, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { buildApi, type Build } from '../api/builds';
import { useBuilderStore } from '../store/builder-store';
import { useAuth } from '../../admin/hooks/use-auth';
import { toast } from 'sonner';
import { generateFastStartPayload } from '../../../lib/templates';
import { ApiError } from '../../../lib/api';
// ─── Inline helpers (extracted from projects-page.tsx to keep them colocated) ───
const parseDetailsObject = (value: unknown) => {
  if (!value) return {};
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

const summarizeInvalidEdges = (invalidEdges: Array<{ source: string; target: string }>) => {
  if (invalidEdges.length === 0) return null;
  const maxExamples = 3;
  const examples = invalidEdges.slice(0, maxExamples).map(edge => `${edge.source} -> ${edge.target}`).join(', ');
  const extraCount = invalidEdges.length - maxExamples;
  return extraCount > 0
    ? `${invalidEdges.length} invalid edge(s) were skipped (${examples}, +${extraCount} more).`
    : `${invalidEdges.length} invalid edge(s) were skipped (${examples}).`;
};

const sanitizeImportPayload = (parsed: any) => {
  const rawNodes = parsed.nodes || parsed.hardwareNodes || [];
  const normalizedNodes = normalizeNodesForSync(rawNodes);
  const rawEdges = Array.isArray(parsed.edges) ? parsed.edges : [];
  const nodeIdSet = new Set(normalizedNodes.map(node => node.id));
  const validEdges: any[] = [];
  const invalidEdges: Array<{ source: string; target: string }> = [];

  for (const edge of rawEdges) {
    const source = edge.source ?? edge.source_node_id;
    const target = edge.target ?? edge.target_node_id;
    if (nodeIdSet.has(source) && nodeIdSet.has(target)) {
      validEdges.push({ ...edge, source, target });
      continue;
    }
    invalidEdges.push({ source: String(source ?? ''), target: String(target ?? '') });
  }

  const settings = {
    ...(parsed.settings || {}),
    ...(parsed.boughtItems !== undefined ? { boughtItems: parsed.boughtItems } : {}),
    ...(parsed.showBought !== undefined ? { showBought: parsed.showBought } : {}),
  };

  return {
    payload: { nodes: normalizedNodes, edges: validEdges, services: parsed.services || [], settings },
    warning: summarizeInvalidEdges(invalidEdges),
  };
};

// ─── Modal state types ────────────────────────────────────────────────────────
type ModalState = {
  create: { open: boolean; name: string };
  delete: { open: boolean; buildId: string | null };
  rename: { open: boolean; build: Build | null; value: string };
  share: { open: boolean; build: Build | null; copied: boolean };
  fastStart: { open: boolean; generating: boolean };
};

type ModalAction =
  | { type: 'OPEN_CREATE'; name?: string }
  | { type: 'CLOSE_CREATE' }
  | { type: 'SET_CREATE_NAME'; name: string }
  | { type: 'OPEN_DELETE'; buildId: string }
  | { type: 'CLOSE_DELETE' }
  | { type: 'OPEN_RENAME'; build: Build }
  | { type: 'CLOSE_RENAME' }
  | { type: 'SET_RENAME_VALUE'; value: string }
  | { type: 'OPEN_SHARE'; build: Build }
  | { type: 'CLOSE_SHARE' }
  | { type: 'SET_SHARE_COPIED'; copied: boolean }
  | { type: 'OPEN_FAST_START' }
  | { type: 'CLOSE_FAST_START' }
  | { type: 'SET_FAST_START_GENERATING'; value: boolean };

const initialModal: ModalState = {
  create: { open: false, name: 'New Project' },
  delete: { open: false, buildId: null },
  rename: { open: false, build: null, value: '' },
  share: { open: false, build: null, copied: false },
  fastStart: { open: false, generating: false },
};

function modalReducer(state: ModalState, action: ModalAction): ModalState {
  switch (action.type) {
    case 'OPEN_CREATE':
      return { ...state, create: { open: true, name: action.name || 'New Project' } };
    case 'CLOSE_CREATE':
      return { ...state, create: { ...state.create, open: false } };
    case 'SET_CREATE_NAME':
      return { ...state, create: { ...state.create, name: action.name } };
    case 'OPEN_DELETE':
      return { ...state, delete: { open: true, buildId: action.buildId } };
    case 'CLOSE_DELETE':
      return { ...state, delete: { open: false, buildId: null } };
    case 'OPEN_RENAME':
      return { ...state, rename: { open: true, build: action.build, value: action.build.name } };
    case 'CLOSE_RENAME':
      return { ...state, rename: { open: false, build: null, value: '' } };
    case 'SET_RENAME_VALUE':
      return { ...state, rename: { ...state.rename, value: action.value } };
    case 'OPEN_SHARE':
      return { ...state, share: { open: true, build: action.build, copied: false } };
    case 'CLOSE_SHARE':
      return { ...state, share: { open: false, build: null, copied: false } };
    case 'SET_SHARE_COPIED':
      return { ...state, share: { ...state.share, copied: action.copied } };
    case 'OPEN_FAST_START':
      return { ...state, fastStart: { ...state.fastStart, open: true } };
    case 'CLOSE_FAST_START':
      return { ...state, fastStart: { open: false, generating: false } };
    case 'SET_FAST_START_GENERATING':
      return { ...state, fastStart: { ...state.fastStart, generating: action.value } };
    default:
      return state;
  }
}

export function useProjectsPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const isAuthenticated = !!user;
  const { loadBuild } = useBuilderStore();

  const [modal, dispatchModal] = useReducer(modalReducer, initialModal);
  const [builds, setBuilds] = useState<Build[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const importPayloadRef = useRef<{ nodes: any[]; edges: any[]; services: any[]; settings: any } | null>(null);
  const importWarningRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isAuthenticated) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const data = await buildApi.list();
        if (!cancelled) setBuilds(data);
      } catch {
        if (!cancelled) toast.error('Failed to load projects');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [isAuthenticated]);

  const handleCreateNew = useCallback(() => {
    importPayloadRef.current = null;
    importWarningRef.current = null;
    dispatchModal({ type: 'OPEN_CREATE', name: 'New Project' });
  }, []);

  const handleImportClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
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
        const { payload, warning } = sanitizeImportPayload(parsed);
        importPayloadRef.current = payload;
        importWarningRef.current = warning;
        if (warning) {
          toast.warning(`Import warning: ${warning}`);
        }
        let baseName = file.name.replace('.homelab.json', '').replace('.json', '');
        if (!baseName) baseName = 'Imported Project';
        dispatchModal({ type: 'OPEN_CREATE', name: baseName });
      } catch {
        toast.error('Failed to parse JSON');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  }, []);

  const confirmCreate = useCallback(async () => {
    try {
      const name = modal.create.name.trim() || (importPayloadRef.current ? 'Imported Project' : 'New Project');
      const payload = importPayloadRef.current || { nodes: [], edges: [], services: [], settings: {} };
      const newBuild = await buildApi.create({
        name,
        thumbnail: '',
        nodes: payload.nodes,
        edges: payload.edges,
        services: payload.services,
        settings: payload.settings,
      });

      const buildForStore = importPayloadRef.current
        ? { ...newBuild, nodes: payload.nodes, edges: payload.edges, settings: payload.settings } as Build
        : newBuild;
      loadBuild(newBuild.id, newBuild.name, buildForStore);
      toast.success(importPayloadRef.current ? 'Project imported successfully' : 'Project created successfully');
      if (importPayloadRef.current && importWarningRef.current) {
        toast.warning(`Import completed with warnings: ${importWarningRef.current}`);
      }
      navigate(`/builder/${newBuild.id}`);
    } catch (error) {
      if (error instanceof ApiError && error.message.includes('invalid edge references')) {
        toast.error('Import failed: wiring references missing nodes. Re-export and retry.');
      } else {
        toast.error('Failed to create project');
      }
    } finally {
      dispatchModal({ type: 'CLOSE_CREATE' });
      importPayloadRef.current = null;
      importWarningRef.current = null;
    }
  }, [modal.create.name, loadBuild, navigate]);

  const handleFastStartGenerate = useCallback(async (goal: string, scale: string) => {
    dispatchModal({ type: 'SET_FAST_START_GENERATING', value: true });
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
      await buildApi.calculateNetwork(newBuild.id);
      toast.success(`Generated Template: ${payload.name}`);
      navigate(`/builder/${newBuild.id}`);
    } catch {
      toast.error('Failed to generate project template');
    } finally {
      dispatchModal({ type: 'CLOSE_FAST_START' });
    }
  }, [navigate]);

  const handleExport = useCallback(async (e: React.MouseEvent, build: Build) => {
    e.stopPropagation();
    try {
      const fullBuild = await buildApi.get(build.id);
      const rawData = fullBuild;
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
    } catch {
      toast.error('Failed to export project');
    }
  }, []);

  const handleOpen = useCallback((build: Build) => {
    navigate(`/builder/${build.id}`);
  }, [navigate]);

  const handleDelete = useCallback((e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    dispatchModal({ type: 'OPEN_DELETE', buildId: id });
  }, []);

  const confirmDelete = useCallback(async () => {
    const buildId = modal.delete.buildId;
    if (!buildId) return;
    try {
      await buildApi.delete(buildId);
      setBuilds(prev => prev.filter(b => b.id !== buildId));
      toast.success('Project deleted');
    } catch {
      toast.error('Failed to delete project');
    } finally {
      dispatchModal({ type: 'CLOSE_DELETE' });
    }
  }, [modal.delete.buildId]);

  const handleDuplicate = useCallback(async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    try {
      const duplicatedBuild = await buildApi.duplicate(id);
      setBuilds(prev => [duplicatedBuild, ...prev]);
      toast.success('Project duplicated successfully');
    } catch {
      toast.error('Failed to duplicate project');
    }
  }, []);

  const handleRenameClick = useCallback((e: React.MouseEvent, build: Build) => {
    e.stopPropagation();
    dispatchModal({ type: 'OPEN_RENAME', build });
  }, []);

  const confirmRename = useCallback(async () => {
    const build = modal.rename.build;
    const newName = modal.rename.value.trim();
    if (!build || !newName) return;
    try {
      const fullBuild = await buildApi.get(build.id);
      const updated = await buildApi.update(build.id, {
        name: newName,
        thumbnail: fullBuild.thumbnail,
        nodes: normalizeNodesForSync(fullBuild.nodes || []),
        edges: fullBuild.edges || [],
        services: [],
        settings: fullBuild.settings || {},
      });
      setBuilds(prev => prev.map(b => (b.id === updated.id ? { ...b, name: updated.name } : b)));
      toast.success('Project renamed');
    } catch {
      toast.error('Failed to rename project');
    } finally {
      dispatchModal({ type: 'CLOSE_RENAME' });
    }
  }, [modal.rename.build, modal.rename.value]);

  const handleShareClick = useCallback((e: React.MouseEvent, build: Build) => {
    e.stopPropagation();
    dispatchModal({ type: 'OPEN_SHARE', build });
  }, []);

  const handleToggleShare = useCallback(async () => {
    const build = modal.share.build;
    if (!build) return;
    try {
      const updated = build.is_shared
        ? await buildApi.unshare(build.id)
        : await buildApi.share(build.id);
      dispatchModal({ type: 'OPEN_SHARE', build: updated });
      setBuilds(prev => prev.map(b => (b.id === updated.id ? { ...b, ...updated } : b)));
      toast.success(updated.is_shared ? 'Sharing enabled' : 'Sharing disabled');
    } catch {
      toast.error('Failed to update sharing');
    }
  }, [modal.share.build]);

  const handleCopyShareLink = useCallback(() => {
    const build = modal.share.build;
    if (!build?.share_token) return;
    const url = `${window.location.origin}/shared/${build.share_token}`;
    navigator.clipboard.writeText(url).then(() => {
      dispatchModal({ type: 'SET_SHARE_COPIED', copied: true });
      setTimeout(() => dispatchModal({ type: 'SET_SHARE_COPIED', copied: false }), 2000);
    });
  }, [modal.share.build]);

  const handleToggleEditable = useCallback(async () => {
    const build = modal.share.build;
    if (!build?.id) return;
    try {
      const updated = await buildApi.setShareEditable(build.id, !build.shared_editable);
      dispatchModal({ type: 'OPEN_SHARE', build: updated });
      setBuilds(prev => prev.map(b => (b.id === updated.id ? { ...b, ...updated } : b)));
      toast.success(updated.shared_editable ? 'Editing enabled for link viewers' : 'Editing disabled');
    } catch {
      toast.error('Failed to update edit permission');
    }
  }, [modal.share.build]);

  const filteredBuilds = useMemo(() => 
    builds.filter(b => b.name.toLowerCase().includes(search.toLowerCase())),
    [builds, search]
  );

  return {
    user,
    builds,
    loading,
    search,
    setSearch,
    modal,
    dispatchModal,
    fileInputRef,
    buildToShare: modal.share.build,
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
  };
}
