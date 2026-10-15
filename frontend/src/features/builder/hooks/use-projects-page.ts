import { useState, useEffect, useRef, useReducer, useCallback, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  buildApi,
  type Build,
  type BuildEdgeInput,
  type BuildNodeInput,
  type BuildSettings,
  type CreateBuildParams,
} from '../api/builds';
import { createBuildWithTopology } from '../api/create-build';
import { useBuilds, useUpdateBuilds } from '../api/use-builds';
import { useBuilderStore } from '../store/builder-store';
import { useAuth } from '../../auth/hooks/use-auth';
import { toast } from 'sonner';
import { ApiError } from '../../../lib/api';
import { BUILD_KINDS } from '../../gaming/lib/kind';
import { parseDetails } from '../lib/build-mapper';
import type { BuildKind, GamingPlan, HardwareComponent } from '../../../types';

/** A node of a .homelab.json file: details may still be JSON strings. */
type ImportedNode = Omit<BuildNodeInput, 'details' | 'internal_components'> & {
  details?: unknown;
  internal_components?: Array<Omit<HardwareComponent, 'details'> & { details?: unknown }>;
};

/** An edge of a .homelab.json file, under the payload's names or the server's. */
type ImportedEdge = Partial<BuildEdgeInput> & { source_node_id?: string; target_node_id?: string };

/**
 * A .homelab.json file. Older exports also carry the purchase list; it stays
 * inside the settings, where the server keeps it untouched.
 */
type ImportFile = {
  nodes?: ImportedNode[];
  hardwareNodes?: ImportedNode[];
  edges?: unknown;
  services?: CreateBuildParams['services'];
  settings?: BuildSettings;
  kind?: unknown;
  gaming_plan?: unknown;
};

type ImportPayload = Omit<CreateBuildParams, 'name' | 'thumbnail'>;

const normalizeNodesForSync = (nodes: ImportedNode[] = []): BuildNodeInput[] =>
  nodes.map(node => ({
    ...node,
    details: parseDetails(node.details),
    internal_components: (node.internal_components || []).map(component => ({
      ...component,
      details: parseDetails(component.details),
    })),
  }));

const summarizeInvalidEdges = (invalidEdges: Array<{ source: string; target: string }>) => {
  if (invalidEdges.length === 0) return null;
  const maxExamples = 3;
  const examples = invalidEdges
    .slice(0, maxExamples)
    .map(edge => `${edge.source} -> ${edge.target}`)
    .join(', ');
  const extraCount = invalidEdges.length - maxExamples;
  return extraCount > 0
    ? `${invalidEdges.length} invalid edge(s) were skipped (${examples}, +${extraCount} more).`
    : `${invalidEdges.length} invalid edge(s) were skipped (${examples}).`;
};

const isBuildKind = (value: unknown): value is BuildKind =>
  BUILD_KINDS.some(entry => entry.kind === value);

const sanitizeImportPayload = (parsed: ImportFile) => {
  const rawNodes = parsed.nodes || parsed.hardwareNodes || [];
  const normalizedNodes = normalizeNodesForSync(rawNodes);
  const rawEdges: ImportedEdge[] = Array.isArray(parsed.edges) ? parsed.edges : [];
  const nodeIdSet = new Set(normalizedNodes.map(node => node.id));
  const validEdges: BuildEdgeInput[] = [];
  const invalidEdges: Array<{ source: string; target: string }> = [];

  for (const edge of rawEdges) {
    const source = edge.source ?? edge.source_node_id;
    const target = edge.target ?? edge.target_node_id;
    if (source && target && nodeIdSet.has(source) && nodeIdSet.has(target)) {
      validEdges.push({ ...edge, source, target });
      continue;
    }
    invalidEdges.push({ source: String(source ?? ''), target: String(target ?? '') });
  }

  const payload: ImportPayload = {
    nodes: normalizedNodes,
    edges: validEdges,
    services: parsed.services || [],
    settings: parsed.settings || {},
    kind: isBuildKind(parsed.kind) ? parsed.kind : undefined,
    gaming_plan:
      parsed.gaming_plan && typeof parsed.gaming_plan === 'object'
        ? (parsed.gaming_plan as Partial<GamingPlan>)
        : undefined,
  };
  return { payload, warning: summarizeInvalidEdges(invalidEdges) };
};

// ─── Modal state types ────────────────────────────────────────────────────────
type ModalState = {
  create: { open: boolean; name: string; kind: BuildKind };
  delete: { open: boolean; buildId: string | null };
  rename: { open: boolean; build: Build | null; value: string };
  share: { open: boolean; build: Build | null; copied: boolean };
};

type ModalAction =
  | { type: 'OPEN_CREATE'; name?: string; kind?: BuildKind }
  | { type: 'CLOSE_CREATE' }
  | { type: 'SET_CREATE_NAME'; name: string }
  | { type: 'SET_CREATE_KIND'; kind: BuildKind }
  | { type: 'OPEN_DELETE'; buildId: string }
  | { type: 'CLOSE_DELETE' }
  | { type: 'OPEN_RENAME'; build: Build }
  | { type: 'CLOSE_RENAME' }
  | { type: 'SET_RENAME_VALUE'; value: string }
  | { type: 'OPEN_SHARE'; build: Build }
  | { type: 'CLOSE_SHARE' }
  | { type: 'SET_SHARE_COPIED'; copied: boolean };

const initialModal: ModalState = {
  create: { open: false, name: 'New Project', kind: 'homelab' },
  delete: { open: false, buildId: null },
  rename: { open: false, build: null, value: '' },
  share: { open: false, build: null, copied: false },
};

function modalReducer(state: ModalState, action: ModalAction): ModalState {
  switch (action.type) {
    case 'OPEN_CREATE':
      return {
        ...state,
        create: { open: true, name: action.name || 'New Project', kind: action.kind || 'homelab' },
      };
    case 'CLOSE_CREATE':
      return { ...state, create: { ...state.create, open: false } };
    case 'SET_CREATE_NAME':
      return { ...state, create: { ...state.create, name: action.name } };
    case 'SET_CREATE_KIND':
      return { ...state, create: { ...state.create, kind: action.kind } };
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
    default:
      return state;
  }
}

const EMPTY_BUILDS: Build[] = [];

export function useProjectsPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const isAuthenticated = !!user;
  const loadBuild = useBuilderStore(state => state.loadBuild);

  // "New project" in the sidebar's switcher leads here with the dialog open.
  const location = useLocation();
  const createRequested = !!(location.state as { createProject?: boolean } | null)?.createProject;
  const [modal, dispatchModal] = useReducer(modalReducer, initialModal, initial =>
    createRequested ? modalReducer(initial, { type: 'OPEN_CREATE', name: 'New Project' }) : initial,
  );
  useEffect(() => {
    // Asked for once: going back to this page later should not open it again.
    if (createRequested) navigate(location.pathname, { replace: true, state: null });
  }, [createRequested, location.pathname, navigate]);
  // The list is shared with the sidebar's project switcher and Settings; this
  // page is its home, so it asks the server again every time it is opened.
  const list = useBuilds({ enabled: isAuthenticated, fresh: true });
  const builds = useMemo(() => list.data ?? EMPTY_BUILDS, [list.data]);
  const setBuilds = useUpdateBuilds();
  const loading = isAuthenticated && list.isPending;
  const [search, setSearch] = useState('');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const importPayloadRef = useRef<ImportPayload | null>(null);
  const importWarningRef = useRef<string | null>(null);

  const loadFailed = list.isError;
  useEffect(() => {
    if (loadFailed) toast.error('Failed to load projects');
  }, [loadFailed]);

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
        const parsed: ImportFile = JSON.parse(text);
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
        dispatchModal({ type: 'OPEN_CREATE', name: baseName, kind: payload.kind });
      } catch {
        toast.error('Failed to parse JSON');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  }, []);

  const confirmCreate = useCallback(async () => {
    try {
      const name =
        modal.create.name.trim() || (importPayloadRef.current ? 'Imported Project' : 'New Project');
      const payload: ImportPayload = importPayloadRef.current || {
        nodes: [],
        edges: [],
        services: [],
        settings: {},
      };
      const newBuild = await createBuildWithTopology({
        name,
        thumbnail: '',
        kind: modal.create.kind,
        ...(payload.gaming_plan ? { gaming_plan: payload.gaming_plan } : {}),
        nodes: payload.nodes,
        edges: payload.edges,
        services: payload.services,
        settings: payload.settings,
      });

      loadBuild(newBuild.id, newBuild.name, newBuild);
      toast.success(
        importPayloadRef.current ? 'Project imported successfully' : 'Project created successfully',
      );
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
  }, [modal.create.name, modal.create.kind, loadBuild, navigate]);

  const handleExport = useCallback(async (e: React.MouseEvent, build: Build) => {
    e.stopPropagation();
    try {
      const fullBuild = await buildApi.get(build.id);
      const payload = {
        version: 1,
        name: fullBuild.name,
        kind: fullBuild.kind || 'homelab',
        gaming_plan: fullBuild.gaming_plan || {},
        exportedAt: new Date().toISOString(),
        // Node notes live in details.notes. Normalize details to an object in
        // the file so all node specs, including notes, round-trip as JSON data.
        nodes: (fullBuild.nodes || []).map(node => ({
          ...node,
          ...(node.details == null ? {} : { details: parseDetails(node.details) }),
        })),
        edges: fullBuild.edges || [],
        settings: fullBuild.settings || {},
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

  const handleOpen = useCallback(
    (build: Build) => {
      navigate(`/builder/${build.id}`);
    },
    [navigate],
  );

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
      // The deleted project may be the one that is open everywhere else.
      if (useBuilderStore.getState().currentBuildId === buildId) {
        useBuilderStore.getState().clearCurrentBuild();
      }
      toast.success('Project deleted');
    } catch {
      toast.error('Failed to delete project');
    } finally {
      dispatchModal({ type: 'CLOSE_DELETE' });
    }
  }, [modal.delete.buildId, setBuilds]);

  const handleDuplicate = useCallback(async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    try {
      const duplicatedBuild = await buildApi.duplicate(id);
      setBuilds(prev => [duplicatedBuild, ...prev]);
      toast.success('Project duplicated successfully');
    } catch {
      toast.error('Failed to duplicate project');
    }
  }, [setBuilds]);

  const handleRenameClick = useCallback((e: React.MouseEvent, build: Build) => {
    e.stopPropagation();
    dispatchModal({ type: 'OPEN_RENAME', build });
  }, []);

  const confirmRename = useCallback(async () => {
    const build = modal.rename.build;
    const newName = modal.rename.value.trim();
    if (!build || !newName) return;
    try {
      let updated: Build;
      try {
        updated = await buildApi.rename(build.id, newName, build.revision);
      } catch (error) {
        // The list can be older than the build (it was saved in the builder
        // since). The refusal carries the current build: rename that one.
        const latest =
          error instanceof ApiError && error.status === 409
            ? (error.data as { build?: Build | null } | undefined)?.build
            : null;
        if (!latest) throw error;
        updated = await buildApi.rename(build.id, newName, latest.revision);
      }
      setBuilds(prev => prev.map(b => (b.id === updated.id ? { ...b, ...updated } : b)));
      // The open project carries its name and revision in the store.
      const store = useBuilderStore.getState();
      if (store.currentBuildId === updated.id) {
        useBuilderStore.setState({
          projectName: updated.name,
          ...(store.buildStatus === 'ready' ? { currentRevision: updated.revision } : {}),
        });
      }
      toast.success('Project renamed');
    } catch {
      toast.error('Failed to rename project');
    } finally {
      dispatchModal({ type: 'CLOSE_RENAME' });
    }
  }, [modal.rename.build, modal.rename.value, setBuilds]);

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
  }, [modal.share.build, setBuilds]);

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
      toast.success(
        updated.shared_editable ? 'Editing enabled for link viewers' : 'Editing disabled',
      );
    } catch {
      toast.error('Failed to update edit permission');
    }
  }, [modal.share.build, setBuilds]);

  const filteredBuilds = useMemo(
    () => builds.filter(b => b.name.toLowerCase().includes(search.toLowerCase())),
    [builds, search],
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
