import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  type Node,
  type Edge,
  type OnNodesChange,
  type OnEdgesChange,
  type OnConnect,
  applyNodeChanges,
  applyEdgeChanges,
  addEdge,
  type Connection,
} from '@xyflow/react';
import type {
  Service,
  HardwareNode,
  VirtualMachine,
  HardwareComponent,
  HardwareNodeValidationIssue,
  HardwareSpec,
  VirtualNetwork,
  BuildKind,
  GamingPlan,
  EdgePreferences,
} from '../../../types';
import { initialVirtualNetwork, removeVirtualEndpoints } from '../lib/virtual-network';
import { withFreshChildIds } from '../lib/hardware-instance';
import {
  buildApi,
  type Build,
  type BuildEdgeInput,
  type BuildNodeInput,
  type BuildSettings,
  type CreateBuildParams,
} from '../api/builds';
import { proposalApi, type Proposal } from '../api/proposals';
import { mapBuildToFlow, parseDetails } from '../lib/build-mapper';
import { requiredConnectionType } from '../lib/connection-rules';
import { newTableDetails } from '../../gaming/lib/table';
import { newGameInstance, sizeServer } from '../../gaming/lib/sizing';
import {
  buildProposalPreview,
  validationToIssues,
  type ProposalPreviewGraph,
} from '../lib/proposal-preview';
import { fetchServices as loadServices } from '../../catalog/api/use-services';
import { ApiError } from '../../../lib/api';
import { WORKSPACE_STORAGE_KEY, workspaceStorage } from './workspace-storage';
import { withoutAssetLink } from '../../../lib/asset-link';
import { computeLayout, type LayoutResult, type LayoutStyle } from '../lib/layout';
import { layoutGraphFromFlow } from '../lib/layout/from-flow';
import { RACK_WIDTH_PX, rackHeightPx } from '../components/rack-node-constants';

let topologyMutationQueue: Promise<void> = Promise.resolve();

// Details the server computes. A key that is missing from the server's answer
// is gone (DHCP was switched off, a gateway stopped routing), so the local copy
// must not keep it.
const DERIVED_DETAIL_KEYS: Array<keyof HardwareSpec> = [
  'dhcp_pool',
  'wan_ip',
  'lan_gateway_ip',
  'lan_subnet',
  'interfaces',
];

function mergeServerDetails(local: HardwareSpec | undefined, server: HardwareSpec): HardwareSpec {
  const merged: HardwareSpec = { ...(local ?? {}) };
  for (const key of DERIVED_DETAIL_KEYS) delete merged[key];
  return { ...merged, ...server };
}

function enqueueTopologyMutation(mutation: () => Promise<void>): Promise<void> {
  const queued = topologyMutationQueue.then(mutation, mutation);
  topologyMutationQueue = queued.catch(() => undefined);
  return queued;
}

/**
 * The build was saved elsewhere first. The store now holds that newer revision,
 * and the canvas as it was here is one undo step away.
 */
export class BuildConflictError extends Error {
  constructor() {
    super('This project was changed elsewhere. The latest version is loaded; Undo brings yours back.');
    this.name = 'BuildConflictError';
  }
}

/** Whether the graph in the store belongs to `currentBuildId`. */
type BuildStatus = 'idle' | 'loading' | 'ready' | 'error';

/** "unsaved" means the canvas differs from the server and a save is due. */
export type SaveState = 'saved' | 'unsaved' | 'saving' | 'error';

/**
 * What an undo step restores besides the canvas. A step only lists what it
 * changed: an applied proposal can rename the build, a reload after a save
 * conflict cannot be allowed to undo a rename made elsewhere.
 */
type SnapshotMeta = {
  projectName?: string;
  buildKind?: BuildKind;
  gamingPlan?: Partial<GamingPlan>;
};

/** The same fields as `meta`, with the values the store holds now. */
function currentMeta(
  meta: SnapshotMeta,
  state: { projectName: string; buildKind: BuildKind; gamingPlan: Partial<GamingPlan> },
): SnapshotMeta {
  return {
    ...('projectName' in meta ? { projectName: state.projectName } : {}),
    ...('buildKind' in meta ? { buildKind: state.buildKind } : {}),
    ...('gamingPlan' in meta ? { gamingPlan: state.gamingPlan } : {}),
  };
}

type Snapshot = {
  nodes: Node[];
  edges: Edge[];
  hardwareNodes: HardwareNode[];
  meta?: SnapshotMeta;
};

/** How many steps Undo can go back. */
const HISTORY_LIMIT = 50;

/** The undo stack with `step` on top. A new step drops whatever Redo could bring back. */
function withStep(past: Snapshot[], step: Snapshot) {
  return { historyPast: [...past, step].slice(-HISTORY_LIMIT), historyFuture: [] as Snapshot[] };
}

type Canvas = Pick<Snapshot, 'nodes' | 'edges' | 'hardwareNodes'>;

/** The undo step for an edit of the canvas `state` holds now. */
function recordEdit(state: Canvas & { historyPast: Snapshot[] }) {
  return withStep(state.historyPast, {
    nodes: state.nodes,
    edges: state.edges,
    hardwareNodes: state.hardwareNodes,
  });
}

/**
 * Merges what `change` returns into one device, in the device list and in the
 * data of its card, so the card shows it at once.
 */
function changeDevice(
  state: Canvas,
  nodeId: string,
  change: (device: HardwareNode) => Partial<HardwareNode>,
): Pick<Canvas, 'nodes' | 'hardwareNodes'> {
  const device = state.hardwareNodes.find(node => node.id === nodeId);
  if (!device) return { nodes: state.nodes, hardwareNodes: state.hardwareNodes };
  const patch = change(device);
  return {
    hardwareNodes: state.hardwareNodes.map(node => (node === device ? { ...device, ...patch } : node)),
    nodes: state.nodes.map(node =>
      node.id === nodeId ? { ...node, data: { ...node.data, ...patch } } : node,
    ),
  };
}

/** The devices, each at the position its canvas node has now. */
function withNodePositions(hardwareNodes: HardwareNode[], nodes: Node[]): HardwareNode[] {
  const placed = new Map(nodes.map(node => [node.id, node.position]));
  return hardwareNodes.map(node => {
    const position = placed.get(node.id);
    return position && (position.x !== node.x || position.y !== node.y)
      ? { ...node, x: position.x, y: position.y }
      : node;
  });
}

/** Recalculates the addresses (a save) once the change being made is in the store. */
function reassignSoon(store: () => BuilderState) {
  setTimeout(() => {
    void store()
      .reassignAllIPs()
      .catch(() => undefined);
  }, 0);
}

/** The step that undoes `snap`: the canvas now, with the fields `snap` would change. */
function stepBack(state: BuilderState, snap: Snapshot): Snapshot {
  return {
    nodes: state.nodes,
    edges: state.edges,
    hardwareNodes: state.hardwareNodes,
    ...(snap.meta ? { meta: currentMeta(snap.meta, state) } : {}),
  };
}

/** What brings back `snap`, keeping the selection and open network where they still exist. */
function restoreStep(state: BuilderState, snap: Snapshot) {
  return {
    virtualHostId: snap.hardwareNodes.some(
      node => node.id === state.virtualHostId && node.details?.virtual_network,
    )
      ? state.virtualHostId
      : null,
    nodes: snap.nodes,
    edges: snap.edges,
    hardwareNodes: snap.hardwareNodes,
    selectedNodeId: snap.nodes.some(node => node.id === state.selectedNodeId)
      ? state.selectedNodeId
      : null,
    ...(snap.meta ?? {}),
  };
}

/** A node as the store saves it, every field filled in. */
type SavedNode = Required<Omit<BuildNodeInput, 'parent_id'>> & Pick<BuildNodeInput, 'parent_id'>;

/** What a save sends besides the name and revision. */
type BuildData = Omit<CreateBuildParams, 'name' | 'thumbnail' | 'nodes' | 'edges'> & {
  nodes: SavedNode[];
  edges: Array<Required<BuildEdgeInput>>;
};

/** The key the store used before 1.3 to keep a whole canvas in the browser. */
const LEGACY_STORAGE_KEY = 'homelab-builder-storage';

/**
 * A save whose answer never arrived. If the next save is refused as stale and
 * the server holds exactly this, the conflict is with ourselves.
 */
let unconfirmedSave: { buildId: string; revision: number; signature: string } | null = null;

/** What the signature reads of a node, under the names the save payload and the server use. */
type SignedNode = {
  id: string;
  type?: unknown;
  name?: unknown;
  x?: unknown;
  y?: unknown;
  parent_id?: unknown;
  vms?: unknown;
  virtual_machines?: unknown;
  internal_components?: unknown;
};

/** The same for a cable. */
type SignedEdge = {
  source?: unknown;
  source_node_id?: unknown;
  source_handle?: unknown;
  target?: unknown;
  target_node_id?: unknown;
  target_handle?: unknown;
  type?: unknown;
};

type GraphPayload = {
  kind?: string;
  nodes: SignedNode[];
  edges: SignedEdge[];
};

/**
 * What a build looks like structurally: devices, guests, positions and cables.
 * Addresses and other values the server calculates are left out, so a payload
 * we sent and the build the server made of it give the same signature.
 */
function graphSignature(payload: GraphPayload): string {
  const nodes = payload.nodes
    .map(node => ({
      id: node.id,
      type: node.type,
      name: node.name,
      x: Math.round(Number(node.x) || 0),
      y: Math.round(Number(node.y) || 0),
      parent: node.parent_id || '',
      vms: ((node.vms ?? node.virtual_machines ?? []) as Array<{ id: string; name: string }>)
        .map(vm => `${vm.id}:${vm.name}`)
        .sort(),
      components: ((node.internal_components ?? []) as Array<{ id: string }>)
        .map(component => component.id)
        .sort(),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const edges = payload.edges
    .map(edge =>
      [
        edge.source ?? edge.source_node_id,
        edge.source_handle || '',
        edge.target ?? edge.target_node_id,
        edge.target_handle || '',
        edge.type || 'ethernet',
      ].join('|'),
    )
    .sort();
  return JSON.stringify({ kind: payload.kind || 'homelab', nodes, edges });
}

/** The parts of a loaded node React Flow needs to keep showing it without measuring again. */
function keepMeasured(next: Node, previous: Node | undefined): Node {
  if (!previous) return next;
  return {
    ...next,
    ...(previous.measured ? { measured: previous.measured } : {}),
    ...(previous.width !== undefined ? { width: previous.width } : {}),
    ...(previous.height !== undefined ? { height: previous.height } : {}),
    ...(previous.selected ? { selected: true } : {}),
  };
}

/**
 * A proposal opened for review. While it is set the builder's canvas draws this
 * graph, read-only, instead of the live `nodes` and `edges`.
 */
export type ProposalPreviewState = ProposalPreviewGraph & {
  proposal: Proposal;
  /** Nodes the canvas should bring into view; nonce re-triggers the same ids. */
  focus: { ids: string[]; nonce: number } | null;
};

interface BuilderState {
  virtualHostId: string | null;
  openVirtualNetwork: (hostId: string | null) => void;
  updateVirtualNetwork: (hostId: string, network: VirtualNetwork) => void;
  // Data Logic
  availableServices: Service[];
  fetchServices: () => Promise<void>;
  hardwareNodes: HardwareNode[];

  // Visual Logic (React Flow Source of Truth)
  nodes: Node[];
  edges: Edge[];
  onNodesChange: OnNodesChange;
  onEdgesChange: OnEdgesChange;
  updateEdge: (id: string, updates: Partial<Edge>) => void;
  onConnect: OnConnect;

  // Selection
  selectedNodeId: string | null;
  selectNode: (nodeId: string | null) => void;

  // Hardware Actions
  addHardware: (node: HardwareNode) => void;
  removeHardware: (nodeId: string) => void;
  updateHardware: (nodeId: string, updates: Partial<HardwareNode>) => void;
  duplicateHardware: (nodeId: string) => void;

  addInternalComponent: (nodeId: string, component: HardwareComponent) => void;
  removeInternalComponent: (nodeId: string, componentId: string) => void;
  updateInternalComponent: (
    nodeId: string,
    componentId: string,
    updates: Partial<HardwareComponent>,
  ) => void;

  // VM / Container Management
  addVM: (nodeId: string, vm: VirtualMachine) => void;
  removeVM: (nodeId: string, vmId: string) => void;
  updateVM: (nodeId: string, vmId: string, updates: Partial<VirtualMachine>) => void;

  reassignAllIPs: () => Promise<void>;

  // What the open build is planned for, and its gaming plan as loaded. The plan
  // object is replaced only by a user edit: it is part of the autosave
  // fingerprint, and rebuilding it elsewhere would look like an unsaved change.
  buildKind: BuildKind;
  gamingPlan: Partial<GamingPlan>;
  setBuildKind: (kind: BuildKind) => void;
  setGamingPlan: (plan: GamingPlan) => void;

  // Build settings as loaded from the server. Keys this store does not manage
  // itself are sent back unchanged, because a save replaces the whole object.
  buildSettings: BuildSettings;
  /** Which steps of the setup guide are ticked off. Kept in the settings, so it is saved with the build. */
  setSetupDone: (stepIds: string[]) => void;

  // Visual Preferences
  edgePreferences: EdgePreferences;
  setEdgePreferences: (prefs: Partial<EdgePreferences>) => void;

  // Network Validation
  validationIssues: HardwareNodeValidationIssue[];
  validateNetwork: () => Promise<void>;

  // ── API Persistence ────────────────────────────────────────────────
  currentBuildId: string | null;
  currentRevision: number;
  /** "ready" once the graph below is the one of `currentBuildId`. Nothing is saved before that. */
  buildStatus: BuildStatus;
  setCurrentBuildId: (id: string | null) => void;
  clearCurrentBuild: () => void;

  // Save state, shared by the canvas header and the sidebar's project card.
  saveState: SaveState;
  lastSavedAt: number | null;
  saveError: string | null;
  /** False after the sync poll failed several times in a row. */
  serverReachable: boolean;
  setServerReachable: (reachable: boolean) => void;
  /** Compares the canvas with the last synced copy and updates `saveState`. */
  refreshSaveState: () => boolean;

  /** Nodes the canvas should bring into view (null: everything); nonce re-triggers. */
  canvasFocus: { ids: string[] | null; nonce: number } | null;
  requestCanvasFocus: (ids?: string[] | null) => void;

  // ── Layout ─────────────────────────────────────────────────────────
  /**
   * Arranges the canvas ("Polish"). The new positions are written at once and
   * are one undo step; the glide to them is only drawn. Returns what was done,
   * or null when nothing may be moved now (no build open, a proposal in review).
   */
  polishLayout: (style: LayoutStyle) => (LayoutResult & { moved: number }) | null;
  /** Moves top-level nodes to the given places. Returns how many moved. */
  applyLayout: (positions: LayoutResult['positions']) => number;
  /** Counts arrangements, so the canvas can animate each one once. */
  layoutMotion: number;

  projectName: string;
  setProjectName: (name: string) => void;

  loadBuild: (id: string, name: string, data: Build) => void;
  openBuild: (id: string) => Promise<void>;
  getBuildData: () => BuildData;

  /** Fingerprint of the topology as last loaded from or saved to the server. */
  lastSyncedFingerprint: string;
  hasUnsavedChanges: () => boolean;
  /** Loads a newer server revision when nothing local is waiting to be saved. */
  syncWithServer: (serverRevision: number) => Promise<boolean>;

  // ── LLM proposals ──────────────────────────────────────────────────
  proposalPreview: ProposalPreviewState | null;
  startProposalPreview: (proposal: Proposal) => void;
  endProposalPreview: () => void;
  focusProposalNodes: (ids: string[]) => void;
  /**
   * While a proposal is reviewed the canvas shows the preview graph. React Flow
   * still has to store what it measures for the cards it draws; nothing else
   * about a preview can change.
   */
  applyPreviewNodeChanges: OnNodesChange;
  applyProposal: (proposalId: string) => Promise<void>;
  /** The devices of the proposal applied last, so the canvas can light them up once. */
  appliedGlow: { ids: string[]; nonce: number } | null;

  // Undo / Redo
  historyPast: Snapshot[];
  historyFuture: Snapshot[];
  undo: () => void;
  redo: () => void;
}

export const useBuilderStore = create<BuilderState>()(
  persist(
    (set, get) => ({
      virtualHostId: null,
      openVirtualNetwork: hostId => {
        const host = get().hardwareNodes.find(node => node.id === hostId);
        if (host && !host.details?.virtual_network) {
          get().updateVirtualNetwork(host.id, initialVirtualNetwork(host));
        }
        set({ virtualHostId: host?.id ?? null, selectedNodeId: null });
      },
      updateVirtualNetwork: (hostId, network) => {
        const state = get();
        const host = state.hardwareNodes.find(node => node.id === hostId);
        if (!host) return;
        set(recordEdit(state));
        get().updateHardware(hostId, { details: { ...host.details, virtual_network: network } });
      },
      hardwareNodes: [],
      nodes: [],
      edges: [],
      selectedNodeId: null,
      buildKind: 'homelab',
      gamingPlan: {},
      setBuildKind: kind => set({ buildKind: kind }),
      setGamingPlan: plan => set({ gamingPlan: plan }),
      buildSettings: {},
      setSetupDone: stepIds =>
        set(state => {
          // Nothing ticked and nothing stored: leave the object alone, or an
          // untouched build would look changed.
          if (stepIds.length === 0 && !('setupDone' in state.buildSettings)) return state;
          return { buildSettings: { ...state.buildSettings, setupDone: stepIds } };
        }),
      historyPast: [],
      historyFuture: [],
      edgePreferences: {
        routingEngine: 'direct',
        connectionStyle: 'strict',
        lineStyle: 'step',
        ignoreNetworkLoops: false,
        showNetworkZones: true,
        showLanZones: false,
        showNatZones: true,
        zoneOpacity: 0.7,
      },
      validationIssues: [],
      availableServices: [],
      fetchServices: async () => {
        try {
          set({ availableServices: await loadServices() });
        } catch (e) {
          console.error('Failed to fetch services', e);
        }
      },

      setEdgePreferences: prefs =>
        set(state => ({
          edgePreferences: { ...state.edgePreferences, ...prefs },
        })),

      projectName: 'My Homelab',
      currentBuildId: null,
      currentRevision: 0,
      buildStatus: 'idle',
      saveState: 'saved',
      lastSavedAt: null,
      saveError: null,
      serverReachable: true,
      setServerReachable: reachable => {
        if (get().serverReachable !== reachable) set({ serverReachable: reachable });
      },
      refreshSaveState: () => {
        const state = get();
        const dirty = state.hasUnsavedChanges();
        // A running save reports its own outcome; a failed one stays failed
        // until the canvas is in sync again.
        if (state.saveState !== 'saving') {
          const next: SaveState = !dirty ? 'saved' : state.saveState === 'error' ? 'error' : 'unsaved';
          if (next !== state.saveState) {
            set({ saveState: next, ...(next === 'saved' ? { saveError: null } : {}) });
          }
        }
        return dirty;
      },
      canvasFocus: null,
      requestCanvasFocus: (ids = null) =>
        set(state => ({ canvasFocus: { ids, nonce: (state.canvasFocus?.nonce ?? 0) + 1 } })),

      layoutMotion: 0,
      polishLayout: style => {
        const state = get();
        if (state.proposalPreview || state.buildStatus !== 'ready') return null;
        const result = computeLayout(
          layoutGraphFromFlow(state.nodes, state.edges, state.hardwareNodes),
          { style },
        );
        return { ...result, moved: get().applyLayout(result.positions) };
      },
      applyLayout: positions => {
        const state = get();
        if (state.proposalPreview || state.buildStatus !== 'ready') return 0;
        const target = new Map(positions.map(position => [position.id, position]));
        let moved = 0;
        // Node objects are kept and only given a new position: React Flow hides
        // a node that comes back without its measured size. A device in a rack
        // stays where it is in the rack.
        const nodes = state.nodes.map(node => {
          const to = target.get(node.id);
          if (!to || node.parentId) return node;
          if (Math.abs(node.position.x - to.x) < 0.5 && Math.abs(node.position.y - to.y) < 0.5) {
            return node;
          }
          moved += 1;
          return { ...node, position: { x: to.x, y: to.y } };
        });
        if (moved === 0) return 0;

        set({
          ...recordEdit(state),
          nodes,
          hardwareNodes: withNodePositions(state.hardwareNodes, nodes),
          layoutMotion: state.layoutMotion + 1,
        });
        get().requestCanvasFocus(null);
        return moved;
      },
      lastSyncedFingerprint: '',
      proposalPreview: null,

      onNodesChange: changes => {
        const state = get();
        const dragEnds = changes.filter(c => c.type === 'position' && !c.dragging);
        const removals = changes.filter(c => c.type === 'remove');
        if (dragEnds.length === 0 && removals.length === 0) {
          set({ nodes: applyNodeChanges(changes, state.nodes) });
          return;
        }

        const step = recordEdit(state);
        let nodes = applyNodeChanges(changes, state.nodes);
        let hardwareNodes = state.hardwareNodes;
        let edges = state.edges;
        let selectedNodeId = state.selectedNodeId;

        if (removals.length > 0) {
          // React Flow deletes what is selected on the canvas; the device list
          // has to follow, together with whatever sat in a deleted rack.
          const gone = new Set(removals.map(change => (change as { id: string }).id));
          for (const node of state.hardwareNodes) {
            if (node.parent_id && gone.has(node.parent_id)) gone.add(node.id);
          }
          nodes = nodes.filter(node => !gone.has(node.id));
          hardwareNodes = hardwareNodes.filter(node => !gone.has(node.id));
          edges = edges.filter(edge => !gone.has(edge.source) && !gone.has(edge.target));
          if (selectedNodeId && gone.has(selectedNodeId)) selectedNodeId = null;
        }
        if (dragEnds.length > 0) hardwareNodes = withNodePositions(hardwareNodes, nodes);
        set({
          ...step,
          nodes,
          hardwareNodes,
          edges,
          selectedNodeId,
        });
      },
      onEdgesChange: changes => {
        const removals = changes.filter(c => c.type === 'remove');
        if (removals.length > 0) {
          const state = get();
          set({ ...recordEdit(state), edges: applyEdgeChanges(changes, state.edges) });
        } else {
          set({ edges: applyEdgeChanges(changes, get().edges) });
        }
      },
      updateEdge: (id, updates) => {
        set(state => {
          const types = new Map(state.hardwareNodes.map(node => [node.id, node.type]));
          return {
            edges: state.edges.map(e => {
              if (e.id !== id) return e;
              const next = { ...e, ...updates };
              // Some links have only one valid medium: keep it whatever was picked.
              const required = requiredConnectionType(types.get(next.source), types.get(next.target));
              if (required && next.data && next.data.connection_type !== required) {
                next.data = {
                  ...next.data,
                  connection_type: required,
                  wireless_standard:
                    required === 'wireless' ? next.data.wireless_standard || 'Wi-Fi 6' : '',
                };
              }
              return next;
            }),
          };
        });
      },
      onConnect: (connection: Connection) => {
        const state = get();
        const step = recordEdit(state);
        const hardwareById = new Map(state.hardwareNodes.map(n => [n.id, n]));
        const sourceHardware = connection.source ? hardwareById.get(connection.source) : undefined;
        const targetHardware = connection.target ? hardwareById.get(connection.target) : undefined;
        // A LAN table is always cabled, also when a wireless default would apply.
        const required = requiredConnectionType(sourceHardware?.type, targetHardware?.type);
        const isAccessPointLink =
          required !== 'ethernet' &&
          (sourceHardware?.type === 'access_point' || targetHardware?.type === 'access_point');

        const newEdges = addEdge(
          {
            ...connection,
            type: 'custom',
            data: {
              connection_type: isAccessPointLink ? 'wireless' : 'ethernet',
              speed: '1 GbE',
              subnet: '',
              wireless_standard: isAccessPointLink ? 'Wi-Fi 6' : '',
              direction: 'auto',
            },
          },
          state.edges,
        );
        set({ ...step, edges: newEdges, validationIssues: [] });
        // A new cable can change which network a device is in.
        reassignSoon(get);
      },

      selectNode: nodeId => set({ selectedNodeId: nodeId }),

      addHardware: rawNode => {
        // A LAN table always has its seats, switch and power figure, wherever it comes from.
        const hardwareNode =
          rawNode.type === 'lan_table' && rawNode.details?.seats === undefined
            ? {
                ...rawNode,
                name: rawNode.name === 'New lan_table' ? 'LAN Table' : rawNode.name,
                details: { ...newTableDetails().details, ...(rawNode.details ?? {}) },
                power_draw: rawNode.power_draw || newTableDetails().power_draw,
              }
            : rawNode;
        set(state => {
          const isRack = hardwareNode.type === 'rack';
          const reactFlowNode: Node = {
            id: hardwareNode.id,
            type: isRack ? 'rack' : 'hardware',
            position: { x: hardwareNode.x, y: hardwareNode.y },
            data: { label: hardwareNode.name, ...hardwareNode },
            ...(isRack
              ? {
                  style: {
                    width: RACK_WIDTH_PX,
                    height: rackHeightPx(hardwareNode.details?.rack_size),
                  },
                  zIndex: -1,
                }
              : {}),
            ...(hardwareNode.parent_id
              ? {
                  parentId: hardwareNode.parent_id,
                  extent: 'parent' as const,
                }
              : {}),
          };

          return {
            ...recordEdit(state),
            hardwareNodes: [...state.hardwareNodes, hardwareNode],
            nodes: [...state.nodes, reactFlowNode],
          };
        });
      },

      removeHardware: nodeId =>
        set(state => {
          // A rack goes together with what is mounted in it.
          const removedNode = state.hardwareNodes.find(n => n.id === nodeId);
          const allRemovedIds = new Set([nodeId]);
          if (removedNode?.type === 'rack') {
            for (const n of state.hardwareNodes) {
              if (n.parent_id === nodeId) allRemovedIds.add(n.id);
            }
          }

          return {
            ...recordEdit(state),
            hardwareNodes: state.hardwareNodes.filter(n => !allRemovedIds.has(n.id)),
            nodes: state.nodes.filter(n => !allRemovedIds.has(n.id)),
            edges: state.edges.filter(
              e => !allRemovedIds.has(e.source) && !allRemovedIds.has(e.target),
            ),
            selectedNodeId: allRemovedIds.has(state.selectedNodeId ?? '')
              ? null
              : state.selectedNodeId,
          };
        }),

      updateHardware: (nodeId, updates) =>
        set(state => ({
          hardwareNodes: state.hardwareNodes.map(n => (n.id === nodeId ? { ...n, ...updates } : n)),
          nodes: state.nodes.map(n => {
            if (n.id !== nodeId) return n;
            const newN = {
              ...n,
              data: { ...n.data, ...updates, label: updates.name ?? n.data.label },
            };
            if (updates.x !== undefined || updates.y !== undefined) {
              newN.position = { x: updates.x ?? n.position.x, y: updates.y ?? n.position.y };
            }
            if ('parent_id' in updates) {
              if (updates.parent_id) {
                newN.parentId = updates.parent_id;
                newN.extent = 'parent';
              } else {
                delete newN.parentId;
                delete newN.extent;
              }
            }
            return newN;
          }),
        })),

      duplicateHardware: nodeId => {
        const state = get();
        const orig = state.hardwareNodes.find(n => n.id === nodeId);
        if (!orig) return;
        // Don't duplicate racks (too complex with children)
        if (orig.type === 'rack') return;
        const newId = crypto.randomUUID();
        // A copy cannot be the same physical machine, nor hold the same parts:
        // the links to the owner's inventory stay with the original.
        const dup = withFreshChildIds({
          ...orig,
          id: newId,
          name: `${orig.name} (copy)`,
          ip: '',
          mac_address: '',
          x: orig.x + 40,
          y: orig.y + 40,
          vms: [],
          details: withoutAssetLink({ ...orig.details, virtual_network: undefined }),
          internal_components: (orig.internal_components ?? []).map(component => ({
            ...component,
            details: component.details ? withoutAssetLink(component.details) : component.details,
          })),
          parent_id: orig.parent_id,
        });

        const rfNode: Node = {
          id: newId,
          type: 'hardware',
          position: { x: dup.x, y: dup.y },
          data: { label: dup.name, ...dup },
          ...(dup.parent_id ? { parentId: dup.parent_id, extent: 'parent' as const } : {}),
        };
        set({
          ...recordEdit(state),
          hardwareNodes: [...state.hardwareNodes, dup],
          nodes: [...state.nodes, rfNode],
          selectedNodeId: newId,
        });
      },

      addInternalComponent: (nodeId, component) =>
        set(state => ({
          ...recordEdit(state),
          ...changeDevice(state, nodeId, device => ({
            internal_components: [...(device.internal_components || []), component],
          })),
        })),

      removeInternalComponent: (nodeId, componentId) =>
        set(state => ({
          ...recordEdit(state),
          ...changeDevice(state, nodeId, device => ({
            internal_components: (device.internal_components || []).filter(
              c => c.id !== componentId,
            ),
          })),
        })),

      updateInternalComponent: (nodeId, componentId, updates) =>
        set(state =>
          changeDevice(state, nodeId, device => ({
            internal_components: (device.internal_components || []).map(c =>
              c.id === componentId ? { ...c, ...updates } : c,
            ),
          })),
        ),

      // ── VM Management ──────────────────────────────────────────────────
      addVM: (nodeId, rawVM) => {
        // A game from the catalog becomes a game server: LAN-only, for the usual
        // group, with the memory and cores that group needs.
        const game = get().availableServices.find(
          service => service.id === rawVM.details?.catalog_service_id,
        )?.game;
        let vm = rawVM;
        if (game && !rawVM.details?.game) {
          const instance = newGameInstance(game);
          const sizing = sizeServer(game, instance.players);
          vm = {
            ...rawVM,
            cpu_cores: sizing.cpu_cores,
            ram_mb: sizing.ram_mb,
            details: { ...(rawVM.details ?? {}), game: instance },
          };
        }
        set(state => {
          if (!state.hardwareNodes.some(n => n.id === nodeId)) return state;
          return {
            ...recordEdit(state),
            ...changeDevice(state, nodeId, host => ({ vms: [...(host.vms || []), vm] })),
          };
        });
        // The server gives the new guest its address.
        reassignSoon(get);
      },

      removeVM: (nodeId, vmId) => {
        set(state => ({
          ...recordEdit(state),
          ...changeDevice(state, nodeId, host => ({
            vms: (host.vms || []).filter(v => v.id !== vmId),
            details: {
              ...host.details,
              ...(host.details?.virtual_network
                ? {
                    virtual_network: removeVirtualEndpoints(
                      host.details.virtual_network,
                      new Set([vmId]),
                    ),
                  }
                : {}),
            },
          })),
        }));
        reassignSoon(get);
      },

      updateVM: (nodeId, vmId, updates) =>
        set(state => ({
          ...recordEdit(state),
          ...changeDevice(state, nodeId, host => ({
            vms: (host.vms || []).map(v => (v.id === vmId ? { ...v, ...updates } : v)),
          })),
        })),

      undo: () => {
        const state = get();
        if (state.proposalPreview || state.historyPast.length === 0) return;
        const past = [...state.historyPast];
        const snap = past.pop()!;
        set({
          historyPast: past,
          historyFuture: [stepBack(state, snap), ...state.historyFuture].slice(0, HISTORY_LIMIT),
          ...restoreStep(state, snap),
        });
      },

      redo: () => {
        const state = get();
        if (state.proposalPreview || state.historyFuture.length === 0) return;
        const future = [...state.historyFuture];
        const snap = future.shift()!;
        set({
          historyPast: [...state.historyPast, stepBack(state, snap)].slice(-HISTORY_LIMIT),
          historyFuture: future,
          ...restoreStep(state, snap),
        });
      },

      reassignAllIPs: () => {
        const mutation = async (retried = false): Promise<void> => {
          const { currentBuildId, currentRevision, projectName, getBuildData, buildStatus } = get();
          // An id without its graph (after a reload, or while another build is
          // being opened) must never be saved: that would store an empty canvas.
          if (!currentBuildId || buildStatus !== 'ready') {
            throw new Error('No build is open');
          }

          let sentSignature = '';
          try {
            // The backend saves this revision and calculates its network in one transaction.
            const data = getBuildData();
            const sentFingerprint = JSON.stringify(data);
            sentSignature = graphSignature(data);
            set({ saveState: 'saving' });
            const response = await buildApi.updateTopology(currentBuildId, {
              name: projectName || 'Untitled Project',
              thumbnail: '',
              revision: currentRevision,
              ...data,
            });

            unconfirmedSave = null;
            if (get().currentBuildId !== currentBuildId) return;
            const build = response.build;

            // The addresses and derived details the server calculated, by node id.
            const fromServer = new Map<
              string,
              { ip?: string; vmIps: Map<string, string>; details: HardwareSpec }
            >();
            for (const node of build.nodes ?? []) {
              const details = parseDetails(node.details);
              delete details.virtual_network;
              fromServer.set(node.id, {
                ip: node.ip,
                vmIps: new Map((node.virtual_machines ?? []).map(vm => [vm.id, vm.ip || ''])),
                details,
              });
            }

            const hardwareNodesWithIPs = get().hardwareNodes.map(hn => {
              const entry = fromServer.get(hn.id);
              if (!entry) return hn;
              return {
                ...hn,
                ip: entry.ip,
                details: mergeServerDetails(hn.details, entry.details),
                vms: hn.vms?.map(vm => ({ ...vm, ip: entry.vmIps.get(vm.id) ?? vm.ip })),
              };
            });

            const reactFlowNodesWithIPs = get().nodes.map(rfn => {
              const entry = fromServer.get(rfn.id);
              if (!entry) return rfn;
              const data: Partial<HardwareNode> = rfn.data;
              return {
                ...rfn,
                data: {
                  ...rfn.data,
                  ip: entry.ip,
                  details: mergeServerDetails(data.details, entry.details),
                  vms: (data.vms ?? []).map(vm => ({ ...vm, ip: entry.vmIps.get(vm.id) ?? vm.ip })),
                },
              };
            });

            // Edits made while the request was in flight are not on the server yet.
            const editedDuringSave = JSON.stringify(get().getBuildData()) !== sentFingerprint;
            set({
              hardwareNodes: hardwareNodesWithIPs,
              nodes: reactFlowNodesWithIPs,
              currentRevision: build.revision,
            });
            if (!editedDuringSave) {
              set({ lastSyncedFingerprint: JSON.stringify(get().getBuildData()) });
            }
            set({
              saveState: editedDuringSave ? 'unsaved' : 'saved',
              lastSavedAt: Date.now(),
              saveError: null,
              serverReachable: true,
            });

            if (response.validation) {
              set({ validationIssues: validationToIssues(response.validation) });
            }
          } catch (e) {
            if (get().currentBuildId !== currentBuildId) throw e;

            if (e instanceof ApiError && e.status === 409) {
              // Every later save would repeat the stale revision, so the newer
              // build has to be taken over here instead of failing until reload.
              let latest = (e.data as { build?: Build | null } | undefined)?.build ?? null;
              if (!latest) {
                latest = await buildApi.get(currentBuildId).catch(() => null);
              }
              if (latest && get().currentBuildId === currentBuildId) {
                const ours =
                  unconfirmedSave !== null &&
                  unconfirmedSave.buildId === currentBuildId &&
                  latest.revision === unconfirmedSave.revision + 1 &&
                  graphSignature({
                    kind: latest.kind,
                    nodes: latest.nodes ?? [],
                    edges: latest.edges ?? [],
                  }) === unconfirmedSave.signature;
                unconfirmedSave = null;
                if (ours && !retried) {
                  // The server has the save whose answer was lost. Nobody else
                  // changed the build: continue from its revision with the edits
                  // made since.
                  set({ currentRevision: latest.revision });
                  return mutation(true);
                }

                // A real change from elsewhere wins, but the canvas as it was
                // here stays one undo step away.
                const before = get();
                // Kind and plan are part of what was being saved; the name is
                // not edited here, so a rename made elsewhere stays.
                const mine: Snapshot = {
                  nodes: before.nodes,
                  edges: before.edges,
                  hardwareNodes: before.hardwareNodes,
                  meta: { buildKind: before.buildKind, gamingPlan: before.gamingPlan },
                };
                const past = before.historyPast;
                get().loadBuild(latest.id, latest.name, latest);
                set(withStep(past, mine));
                void get().validateNetwork();
                throw new BuildConflictError();
              }
            }

            if (!(e instanceof ApiError)) {
              // No answer at all: the save may or may not have reached the server.
              unconfirmedSave = {
                buildId: currentBuildId,
                revision: currentRevision,
                signature: sentSignature,
              };
            }
            set({
              saveState: 'error',
              saveError:
                e instanceof ApiError && e.status === 422 && e.message
                  ? e.message
                  : e instanceof ApiError
                    ? 'The server could not save this project.'
                    : 'The server could not be reached.',
            });
            console.error('Failed to save the build', e);
            throw e;
          }
        };
        return enqueueTopologyMutation(() => mutation());
      },

      validateNetwork: async () => {
        const { currentBuildId } = get();
        if (!currentBuildId) return;

        try {
          const response = await buildApi.validateNetwork(currentBuildId);
          // The build may have been closed or switched while the check ran.
          if (get().currentBuildId !== currentBuildId) return;
          set({ validationIssues: validationToIssues(response) });
        } catch (e) {
          console.error('Failed to validate network', e);
          set({ validationIssues: [] });
        }
      },

      // ── API Persistence ────────────────────────────────────────────────
      setCurrentBuildId: id => set({ currentBuildId: id }),
      clearCurrentBuild: () => {
        unconfirmedSave = null;
        set({
          virtualHostId: null,
          currentBuildId: null,
          currentRevision: 0,
          buildStatus: 'idle',
          saveState: 'saved',
          lastSavedAt: null,
          saveError: null,
          projectName: 'Untitled Project',
          nodes: [],
          edges: [],
          hardwareNodes: [],
          selectedNodeId: null,
          validationIssues: [],
          buildKind: 'homelab',
          gamingPlan: {},
          buildSettings: {},
          historyPast: [],
          historyFuture: [],
          lastSyncedFingerprint: '',
          proposalPreview: null,
          canvasFocus: null,
          appliedGlow: null,
        });
      },
      setProjectName: name => set({ projectName: name }),

      loadBuild: (id, name, build: Build) => {
        const previous = get();
        const sameBuild = previous.currentBuildId === id && previous.buildStatus === 'ready';

        const { hardwareNodes, nodes: loadedNodes, edges: rfEdges } = mapBuildToFlow(build);
        // React Flow hides a node that has no measured size and forgets where
        // its handles are. Nodes that stay keep what was measured, so reloading
        // the same build does not blank the canvas for a frame.
        const previousNodes = sameBuild
          ? new Map(previous.nodes.map(node => [node.id, node]))
          : new Map<string, Node>();
        const rfNodes = loadedNodes.map(node => keepMeasured(node, previousNodes.get(node.id)));
        const stillThere = (nodeId: string | null) =>
          sameBuild && !!nodeId && rfNodes.some(node => node.id === nodeId);

        set({
          currentBuildId: id,
          buildStatus: 'ready',
          virtualHostId: null,
          currentRevision: build.revision,
          projectName: name,
          hardwareNodes,
          nodes: rfNodes,
          edges: rfEdges,
          buildKind: build.kind || 'homelab',
          gamingPlan: build.gaming_plan || {},
          buildSettings: build.settings || {},
          historyPast: [],
          historyFuture: [],
          selectedNodeId: stillThere(previous.selectedNodeId) ? previous.selectedNodeId : null,
          // Issues found for another build, or another revision, say nothing here.
          validationIssues: [],
          // A preview is drawn against the canvas it was opened on.
          proposalPreview: null,
          saveState: 'saved',
          saveError: null,
        });
        set({ lastSyncedFingerprint: JSON.stringify(get().getBuildData()) });
      },

      hasUnsavedChanges: () => {
        const state = get();
        if (!state.currentBuildId || state.buildStatus !== 'ready') return false;
        return JSON.stringify(state.getBuildData()) !== state.lastSyncedFingerprint;
      },

      syncWithServer: serverRevision => {
        let reloaded = false;
        return enqueueTopologyMutation(async () => {
          const { currentBuildId, currentRevision, buildStatus } = get();
          if (!currentBuildId || buildStatus !== 'ready' || serverRevision <= currentRevision) return;
          // A pending local edit is saved first; if that save is stale it adopts
          // the newer build through the conflict path.
          if (get().hasUnsavedChanges()) return;
          const build = await buildApi.get(currentBuildId);
          if (get().currentBuildId !== currentBuildId) return;
          if (build.revision <= get().currentRevision || get().hasUnsavedChanges()) return;
          get().loadBuild(build.id, build.name, build);
          void get().validateNetwork();
          reloaded = true;
        }).then(() => reloaded);
      },

      // ── LLM proposals ──────────────────────────────────────────────────
      startProposalPreview: proposal => {
        const state = get();
        const graph = buildProposalPreview(proposal, {
          hardwareNodes: state.hardwareNodes,
          nodes: state.nodes,
          edges: state.edges,
        });
        set({
          selectedNodeId: null,
          proposalPreview: {
            ...graph,
            proposal,
            focus: graph.changedNodeIds.length ? { ids: graph.changedNodeIds, nonce: 0 } : null,
          },
        });
      },

      endProposalPreview: () => set({ proposalPreview: null }),

      applyPreviewNodeChanges: changes => {
        const measured = changes.filter(change => change.type === 'dimensions');
        if (measured.length === 0) return;
        set(state =>
          state.proposalPreview
            ? {
                proposalPreview: {
                  ...state.proposalPreview,
                  nodes: applyNodeChanges(measured, state.proposalPreview.nodes),
                },
              }
            : state,
        );
      },
      appliedGlow: null,

      focusProposalNodes: ids =>
        set(state =>
          state.proposalPreview
            ? {
                proposalPreview: {
                  ...state.proposalPreview,
                  focus: { ids, nonce: (state.proposalPreview.focus?.nonce ?? 0) + 1 },
                },
              }
            : state,
        ),

      applyProposal: async proposalId => {
        // Anything edited but not saved yet must reach the server first, or the
        // reload after applying would silently drop it.
        if (get().hasUnsavedChanges()) {
          await get().reassignAllIPs();
        }
        return enqueueTopologyMutation(async () => {
          const { currentBuildId } = get();
          if (!currentBuildId) throw new Error('No build is open');
          const result = await proposalApi.apply(currentBuildId, proposalId);
          if (get().currentBuildId !== currentBuildId) return;

          const before = get();
          // A proposal can also rename the build or change its kind and plan,
          // so the undo step remembers those too.
          const snapshot: Snapshot = {
            nodes: before.nodes,
            edges: before.edges,
            hardwareNodes: before.hardwareNodes,
            meta: {
              projectName: before.projectName,
              buildKind: before.buildKind,
              gamingPlan: before.gamingPlan,
            },
          };
          const past = before.historyPast;
          const touched = before.proposalPreview?.changedNodeIds ?? [];
          get().loadBuild(result.build.id, result.build.name, result.build);
          // One undo step takes the canvas back to how it was before the proposal.
          set({
            ...withStep(past, snapshot),
            proposalPreview: null,
            validationIssues: validationToIssues(result.validation),
          });
          // Bring what was applied into view: new devices may be off screen.
          const applied = new Set(get().nodes.map(node => node.id));
          const visible = touched.filter(nodeId => applied.has(nodeId));
          if (visible.length > 0) {
            set(state => ({ appliedGlow: { ids: visible, nonce: (state.appliedGlow?.nonce ?? 0) + 1 } }));
            get().requestCanvasFocus(visible);
          }
        });
      },

      openBuild: id =>
        // Queued behind pending saves so the loaded revision already contains them.
        enqueueTopologyMutation(async () => {
          const opened = get();
          if (opened.currentBuildId !== id || opened.buildStatus !== 'ready') {
            // Another build, or this one after a page reload: there is no graph
            // for it here yet, and what is left of the previous one must not be
            // shown or saved under the new id.
            unconfirmedSave = null;
            set({
              currentBuildId: id,
              buildStatus: 'loading',
              currentRevision: 0,
              virtualHostId: null,
              nodes: [],
              edges: [],
              hardwareNodes: [],
              selectedNodeId: null,
              validationIssues: [],
              historyPast: [],
              historyFuture: [],
              proposalPreview: null,
              saveState: 'saved',
              saveError: null,
              ...(opened.currentBuildId !== id
                ? { projectName: '', buildKind: 'homelab' as BuildKind, gamingPlan: {}, buildSettings: {} }
                : {}),
            });
          }
          try {
            const build = await buildApi.get(id);
            // The user may have moved on to another build while this one loaded.
            if (get().currentBuildId !== id) return;
            get().loadBuild(build.id, build.name, build);
            void get().validateNetwork();
          } catch (error) {
            if (get().currentBuildId === id && get().buildStatus === 'loading') {
              set({ buildStatus: 'error' });
            }
            throw error;
          }
        }),

      getBuildData: () => {
        const state = get();
        const hwMap = new Map(state.hardwareNodes.map(n => [n.id, n]));

        // Construct the payload structure exactly matching backend DTO definitions
        const nodesPayload = state.nodes.map((rfn): SavedNode => {
          const hw = hwMap.get(rfn.id);
          const data: Partial<HardwareNode> = rfn.data ?? {};
          return {
            id: rfn.id,
            type: data.type || hw?.type || '',
            name: data.name || hw?.name || '',
            x: rfn.position.x,
            y: rfn.position.y,
            power_draw: Number(data.power_draw ?? hw?.power_draw ?? 0) || 0,
            ip: data.ip || hw?.ip || '',
            mac_address: data.mac_address || hw?.mac_address || '',
            details: data.details || hw?.details || {},
            vms: data.vms || hw?.vms || [],
            internal_components: data.internal_components || hw?.internal_components || [],
            parent_id: hw?.parent_id || undefined,
          };
        });

        const edgesPayload = state.edges.map(e => ({
          source: e.source,
          source_handle: e.sourceHandle || '',
          target: e.target,
          target_handle: e.targetHandle || '',
          type: (e.data?.connection_type as string) || 'ethernet',
          speed: (e.data?.speed as string) || '1 GbE',
          subnet: (e.data?.subnet as string) || '',
          wireless_standard: (e.data?.wireless_standard as string) || '',
          direction: (e.data?.direction as string) || 'auto',
        }));

        const validNodeIDs = new Set(nodesPayload.map(n => n.id));
        const sanitizedEdgesPayload = edgesPayload.filter(
          e => validNodeIDs.has(e.source) && validNodeIDs.has(e.target),
        );

        return {
          kind: state.buildKind,
          // An untouched plan is not sent, so the server keeps what it has.
          ...(Object.keys(state.gamingPlan).length > 0 ? { gaming_plan: state.gamingPlan } : {}),
          nodes: nodesPayload,
          edges: sanitizedEdgesPayload,
          services: [],
          settings: state.buildSettings,
        };
      },
    }),
    {
      // Only which project is open survives a reload. Its canvas is read from
      // the server again: a copy kept here would be shown, and trusted, long
      // after it stopped being true.
      name: WORKSPACE_STORAGE_KEY,
      storage: workspaceStorage,
      partialize: state => ({
        currentBuildId: state.currentBuildId,
        projectName: state.projectName,
        buildKind: state.buildKind,
      }),
    },
  ),
);

// Earlier versions kept a whole canvas under this key.
try {
  localStorage.removeItem(LEGACY_STORAGE_KEY);
} catch {
  // Storage can be unavailable (private mode); nothing to clean up then.
}
