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
  VirtualNetwork,
  BuildKind,
  GamingPlan,
} from '../../../types';
import { initialVirtualNetwork, removeVirtualEndpoints } from '../lib/virtual-network';
import { withFreshChildIds } from '../lib/hardware-instance';
import { buildApi, type Build } from '../api/builds';
import { proposalApi, type Proposal } from '../api/proposals';
import { mapBuildToFlow } from '../lib/build-mapper';
import { requiredConnectionType } from '../lib/connection-rules';
import { newTableDetails } from '../../gaming/lib/table';
import { newGameInstance, sizeServer } from '../../gaming/lib/sizing';
import {
  buildProposalPreview,
  validationToIssues,
  type ProposalPreviewGraph,
} from '../lib/proposal-preview';
import { api } from '../../../services/api';
import { ApiError } from '../../../lib/api';
import { WORKSPACE_STORAGE_KEY } from './workspace-storage';
import { computeLayout, type LayoutResult, type LayoutStyle } from '../lib/layout';
import { layoutGraphFromFlow } from '../lib/layout/from-flow';
import {
  RACK_U_HEIGHT_PX,
  RACK_WIDTH_PX,
  RACK_HEADER_PX,
  RACK_FOOTER_PX,
} from '../components/rack-node-constants';

let topologyMutationQueue: Promise<void> = Promise.resolve();

// Details the server computes. A key that is missing from the server's answer
// is gone (DHCP was switched off, a gateway stopped routing), so the local copy
// must not keep it.
const DERIVED_DETAIL_KEYS = ['dhcp_pool', 'wan_ip', 'lan_gateway_ip', 'lan_subnet', 'interfaces'];

function mergeServerDetails(
  local: Record<string, unknown> | undefined,
  server: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...(local ?? {}) };
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
export type BuildStatus = 'idle' | 'loading' | 'ready' | 'error';

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

/** The key the store used before 1.3 to keep a whole canvas in the browser. */
const LEGACY_STORAGE_KEY = 'homelab-builder-storage';

/**
 * A save whose answer never arrived. If the next save is refused as stale and
 * the server holds exactly this, the conflict is with ourselves.
 */
let unconfirmedSave: { buildId: string; revision: number; signature: string } | null = null;

type GraphPayload = {
  kind?: string;
  nodes: Array<Record<string, any>>;
  edges: Array<Record<string, any>>;
};

/**
 * What a build looks like structurally: devices, guests, positions and cables.
 * Addresses and other values the server calculates are left out, so a payload
 * we sent and the build the server made of it give the same signature.
 */
export function graphSignature(payload: GraphPayload): string {
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

/** A proposal opened for review, rendered on a read-only canvas over the builder. */
export type ProposalPreviewState = ProposalPreviewGraph & {
  proposal: Proposal;
  /** Nodes the preview canvas should bring into view; nonce re-triggers the same ids. */
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

  // Actions
  autoAssignIP: (nodeId?: string) => string | null;
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
  buildSettings: Record<string, unknown>;

  // Purchase Tracking
  boughtItems: string[];
  markAsBought: (itemName: string) => void;
  unmarkAsBought: (itemName: string) => void;
  showBought: boolean;
  setShowBought: (v: boolean) => void;

  // Visual Preferences
  edgePreferences: {
    routingEngine: 'smart' | 'direct';
    connectionStyle: 'floating' | 'strict';
    lineStyle: 'bezier' | 'step' | 'straight';
    ignoreNetworkLoops: boolean;
    showNetworkZones: boolean;
    showLanZones: boolean;
    showNatZones: boolean;
    zoneOpacity: number;
  };
  setEdgePreferences: (prefs: Partial<BuilderState['edgePreferences']>) => void;

  // Network Validation
  validationIssues: HardwareNodeValidationIssue[];
  validateNetwork: () => Promise<void>;

  clear: () => void;

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
  projectThumbnail: string;
  setProjectName: (name: string) => void;

  loadBuild: (id: string, name: string, data: Build) => void;
  openBuild: (id: string) => Promise<void>;
  getBuildData: () => any;

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
  applyProposal: (proposalId: string) => Promise<void>;

  // Computed getters
  totalCpu: () => number;
  totalRam: () => number;
  totalStorage: () => number;

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
        set({
          historyPast: [
            ...state.historyPast,
            { nodes: state.nodes, edges: state.edges, hardwareNodes: state.hardwareNodes },
          ].slice(-50),
          historyFuture: [],
        });
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
      boughtItems: [],
      showBought: false,
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
          const res = await api.getServices();
          set({ availableServices: res.data || [] });
        } catch (e) {
          console.error('Failed to fetch services', e);
        }
      },

      setEdgePreferences: prefs =>
        set(state => ({
          edgePreferences: { ...state.edgePreferences, ...prefs },
        })),

      projectName: 'My Homelab',
      projectThumbnail: '',
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

        const placed = new Map(nodes.map(node => [node.id, node.position]));
        set({
          historyPast: [
            ...state.historyPast,
            { nodes: state.nodes, edges: state.edges, hardwareNodes: state.hardwareNodes },
          ].slice(-50),
          historyFuture: [],
          nodes,
          hardwareNodes: state.hardwareNodes.map(node => {
            const position = placed.get(node.id);
            return position && (position.x !== node.x || position.y !== node.y)
              ? { ...node, x: position.x, y: position.y }
              : node;
          }),
          layoutMotion: state.layoutMotion + 1,
        });
        get().requestCanvasFocus(null);
        return moved;
      },
      lastSyncedFingerprint: '',
      proposalPreview: null,

      onNodesChange: changes => {
        const state = get();
        const dragEnds = changes.filter(c => c.type === 'position' && !(c as any).dragging);
        const removals = changes.filter(c => c.type === 'remove');
        if (dragEnds.length === 0 && removals.length === 0) {
          set({ nodes: applyNodeChanges(changes, state.nodes) });
          return;
        }

        const snap: Snapshot = {
          nodes: state.nodes,
          edges: state.edges,
          hardwareNodes: state.hardwareNodes,
        };
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
        if (dragEnds.length > 0) {
          const moved = new Map(nodes.map(node => [node.id, node.position]));
          hardwareNodes = hardwareNodes.map(node => {
            const position = moved.get(node.id);
            return position && (position.x !== node.x || position.y !== node.y)
              ? { ...node, x: position.x, y: position.y }
              : node;
          });
        }
        set({
          historyPast: [...state.historyPast, snap].slice(-50),
          historyFuture: [],
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
          const snap: Snapshot = {
            nodes: state.nodes,
            edges: state.edges,
            hardwareNodes: state.hardwareNodes,
          };
          set({
            historyPast: [...state.historyPast, snap].slice(-50),
            historyFuture: [],
            edges: applyEdgeChanges(changes, state.edges),
          });
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
        const snap: Snapshot = {
          nodes: state.nodes,
          edges: state.edges,
          hardwareNodes: state.hardwareNodes,
        };
        const hardwareById = new Map(state.hardwareNodes.map(n => [n.id, n]));
        const sourceHardware = connection.source ? hardwareById.get(connection.source) : undefined;
        const targetHardware = connection.target ? hardwareById.get(connection.target) : undefined;
        // A LAN table is always cabled, also when a wireless default would apply.
        const required = requiredConnectionType(sourceHardware?.type, targetHardware?.type);
        const isAccessPointLink =
          required !== 'ethernet' &&
          (sourceHardware?.type === 'access_point' || targetHardware?.type === 'access_point');

        // Default new edges to custom type
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
        set({
          historyPast: [...state.historyPast, snap].slice(-50),
          historyFuture: [],
          edges: newEdges,
          validationIssues: [],
        });

        // Trigger graph-aware IP recalculation whenever a new edge is drawn
        setTimeout(() => {
          void get()
            .reassignAllIPs()
            .catch(() => undefined);
        }, 0);
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
          const snap: Snapshot = {
            nodes: state.nodes,
            edges: state.edges,
            hardwareNodes: state.hardwareNodes,
          };

          const isRack = hardwareNode.type === 'rack';
          const rackSize = hardwareNode.details?.rack_size || 24;
          const totalHeight = RACK_HEADER_PX + rackSize * RACK_U_HEIGHT_PX + RACK_FOOTER_PX;

          const reactFlowNode: Node = {
            id: hardwareNode.id,
            type: isRack ? 'rack' : 'hardware',
            position: { x: hardwareNode.x, y: hardwareNode.y },
            data: { label: hardwareNode.name, ...hardwareNode },
            ...(isRack
              ? {
                  style: { width: RACK_WIDTH_PX, height: totalHeight },
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
            historyPast: [...state.historyPast, snap].slice(-50),
            historyFuture: [],
            hardwareNodes: [...state.hardwareNodes, hardwareNode],
            nodes: [...state.nodes, reactFlowNode],
          };
        });
      },

      removeHardware: nodeId =>
        set(state => {
          const snap: Snapshot = {
            nodes: state.nodes,
            edges: state.edges,
            hardwareNodes: state.hardwareNodes,
          };
          // If removing a rack, also remove all children
          const removedNode = state.hardwareNodes.find(n => n.id === nodeId);
          const isRack = removedNode?.type === 'rack';
          const childIds = new Set<string>();
          if (isRack) {
            for (const n of state.hardwareNodes) {
              if (n.parent_id === nodeId) childIds.add(n.id);
            }
          }
          const allRemovedIds = new Set([nodeId, ...childIds]);

          return {
            historyPast: [...state.historyPast, snap].slice(-50),
            historyFuture: [],
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
        const dup = withFreshChildIds({
          ...orig,
          id: newId,
          name: `${orig.name} (copy)`,
          ip: '',
          x: orig.x + 40,
          y: orig.y + 40,
          vms: [],
          details: { ...orig.details, virtual_network: undefined },
          parent_id: orig.parent_id,
        });

        const rfNode: Node = {
          id: newId,
          type: 'hardware',
          position: { x: dup.x, y: dup.y },
          data: { label: dup.name, ...dup },
          ...(dup.parent_id ? { parentId: dup.parent_id, extent: 'parent' as const } : {}),
        };
        const snap: Snapshot = {
          nodes: state.nodes,
          edges: state.edges,
          hardwareNodes: state.hardwareNodes,
        };
        set({
          historyPast: [...state.historyPast, snap].slice(-50),
          historyFuture: [],
          hardwareNodes: [...state.hardwareNodes, dup],
          nodes: [...state.nodes, rfNode],
          selectedNodeId: newId,
        });
      },

      addInternalComponent: (nodeId, component) => {
        set(state => {
          const snap: Snapshot = {
            nodes: state.nodes,
            edges: state.edges,
            hardwareNodes: state.hardwareNodes,
          };
          const updated = state.hardwareNodes.map(n =>
            n.id === nodeId
              ? { ...n, internal_components: [...(n.internal_components || []), component] }
              : n,
          );
          return {
            historyPast: [...state.historyPast, snap].slice(-50),
            historyFuture: [],
            hardwareNodes: updated,
            nodes: state.nodes.map(n =>
              n.id === nodeId
                ? {
                    ...n,
                    data: {
                      ...n.data,
                      internal_components: updated.find(h => h.id === nodeId)?.internal_components,
                    },
                  }
                : n,
            ),
          };
        });
      },

      removeInternalComponent: (nodeId, componentId) => {
        set(state => {
          const snap: Snapshot = {
            nodes: state.nodes,
            edges: state.edges,
            hardwareNodes: state.hardwareNodes,
          };
          const updated = state.hardwareNodes.map(n =>
            n.id === nodeId
              ? {
                  ...n,
                  internal_components: (n.internal_components || []).filter(
                    c => c.id !== componentId,
                  ),
                }
              : n,
          );
          return {
            historyPast: [...state.historyPast, snap].slice(-50),
            historyFuture: [],
            hardwareNodes: updated,
            nodes: state.nodes.map(n =>
              n.id === nodeId
                ? {
                    ...n,
                    data: {
                      ...n.data,
                      internal_components: updated.find(h => h.id === nodeId)?.internal_components,
                    },
                  }
                : n,
            ),
          };
        });
      },

      updateInternalComponent: (nodeId, componentId, updates) => {
        set(state => {
          const updated = state.hardwareNodes.map(n =>
            n.id === nodeId
              ? {
                  ...n,
                  internal_components: (n.internal_components || []).map(c =>
                    c.id === componentId ? { ...c, ...updates } : c,
                  ),
                }
              : n,
          );
          return {
            hardwareNodes: updated,
            nodes: state.nodes.map(n =>
              n.id === nodeId
                ? {
                    ...n,
                    data: {
                      ...n.data,
                      internal_components: updated.find(h => h.id === nodeId)?.internal_components,
                    },
                  }
                : n,
            ),
          };
        });
      },

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
          const snap: Snapshot = {
            nodes: state.nodes,
            edges: state.edges,
            hardwareNodes: state.hardwareNodes,
          };
          let updatedNodes = [...state.hardwareNodes];
          const hostIndex = updatedNodes.findIndex(n => n.id === nodeId);
          if (hostIndex === -1) return state;

          let hostNode = updatedNodes[hostIndex];
          // Logic removed: Client-side IP assignment.
          // Just add the VM. Backend will assign IP.
          const vmWithIP = vm;

          const finalHost = { ...hostNode, vms: [...(hostNode.vms || []), vmWithIP] };
          updatedNodes[hostIndex] = finalHost;

          return {
            historyPast: [...state.historyPast, snap].slice(-50),
            historyFuture: [],
            hardwareNodes: updatedNodes,
            // Sync React Flow node data so the card re-renders
            nodes: state.nodes.map(n =>
              n.id === nodeId
                ? {
                    ...n,
                    data: {
                      ...n.data,
                      ip: finalHost.ip,
                      vms: finalHost.vms,
                    },
                  }
                : n,
            ),
          };
        });

        // Automatically assign IP when VM is added
        setTimeout(() => {
          void get()
            .reassignAllIPs()
            .catch(() => undefined);
        }, 0);
      },

      removeVM: (nodeId, vmId) => {
        set(state => {
          const snap: Snapshot = {
            nodes: state.nodes,
            edges: state.edges,
            hardwareNodes: state.hardwareNodes,
          };
          const updated = state.hardwareNodes.map(n =>
            n.id === nodeId
              ? {
                  ...n,
                  vms: (n.vms || []).filter(v => v.id !== vmId),
                  details: {
                    ...n.details,
                    ...(n.details?.virtual_network
                      ? {
                          virtual_network: removeVirtualEndpoints(
                            n.details.virtual_network,
                            new Set([vmId]),
                          ),
                        }
                      : {}),
                  },
                }
              : n,
          );
          return {
            historyPast: [...state.historyPast, snap].slice(-50),
            historyFuture: [],
            hardwareNodes: updated,
            nodes: state.nodes.map(n =>
              n.id === nodeId
                ? {
                    ...n,
                    data: {
                      ...n.data,
                      vms: updated.find(h => h.id === nodeId)?.vms,
                      details: updated.find(h => h.id === nodeId)?.details,
                    },
                  }
                : n,
            ),
          };
        });

        // Automatically recalculate IPs when VM is removed
        setTimeout(() => {
          void get()
            .reassignAllIPs()
            .catch(() => undefined);
        }, 0);
      },

      updateVM: (nodeId, vmId, updates) => {
        set(state => {
          const updated = state.hardwareNodes.map(n =>
            n.id === nodeId
              ? { ...n, vms: (n.vms || []).map(v => (v.id === vmId ? { ...v, ...updates } : v)) }
              : n,
          );
          return {
            historyPast: [
              ...state.historyPast,
              { nodes: state.nodes, edges: state.edges, hardwareNodes: state.hardwareNodes },
            ].slice(-50),
            historyFuture: [],
            hardwareNodes: updated,
            nodes: state.nodes.map(n =>
              n.id === nodeId
                ? { ...n, data: { ...n.data, vms: updated.find(h => h.id === nodeId)?.vms } }
                : n,
            ),
          };
        });
      },

      autoAssignIP: _nodeId => {
        // Deprecated. Backend only.
        void get()
          .reassignAllIPs()
          .catch(() => undefined);
        return null;
      },

      undo: () => {
        const state = get();
        if (state.proposalPreview || state.historyPast.length === 0) return;
        const past = [...state.historyPast];
        const snap = past.pop()!;
        // A step that changed the name, kind or plan takes them back as well;
        // the step for redo then has to remember what they are now.
        const current: Snapshot = {
          nodes: state.nodes,
          edges: state.edges,
          hardwareNodes: state.hardwareNodes,
          ...(snap.meta ? { meta: currentMeta(snap.meta, state) } : {}),
        };
        set({
          historyPast: past,
          virtualHostId: snap.hardwareNodes.some(
            node => node.id === state.virtualHostId && node.details?.virtual_network,
          )
            ? state.virtualHostId
            : null,
          historyFuture: [current, ...state.historyFuture].slice(0, 50),
          nodes: snap.nodes,
          edges: snap.edges,
          hardwareNodes: snap.hardwareNodes,
          selectedNodeId: snap.nodes.some(node => node.id === state.selectedNodeId)
            ? state.selectedNodeId
            : null,
          ...(snap.meta ?? {}),
        });
      },

      redo: () => {
        const state = get();
        if (state.proposalPreview || state.historyFuture.length === 0) return;
        const future = [...state.historyFuture];
        const snap = future.shift()!;
        const current: Snapshot = {
          nodes: state.nodes,
          edges: state.edges,
          hardwareNodes: state.hardwareNodes,
          ...(snap.meta ? { meta: currentMeta(snap.meta, state) } : {}),
        };
        set({
          historyPast: [...state.historyPast, current].slice(-50),
          virtualHostId: snap.hardwareNodes.some(
            node => node.id === state.virtualHostId && node.details?.virtual_network,
          )
            ? state.virtualHostId
            : null,
          historyFuture: future,
          nodes: snap.nodes,
          edges: snap.edges,
          hardwareNodes: snap.hardwareNodes,
          selectedNodeId: snap.nodes.some(node => node.id === state.selectedNodeId)
            ? state.selectedNodeId
            : null,
          ...(snap.meta ?? {}),
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

            // Build a lookup: "id" → { nodeIp, vmIps }
            type VmIpMap = Map<string, string>;
            interface NodeIpEntry {
              nodeIp: string;
              vmMap: VmIpMap;
              details: Record<string, unknown>;
            }
            const parseDetails = (details: unknown): Record<string, unknown> => {
              if (!details) return {};
              if (typeof details === 'string') {
                try {
                  const parsed = JSON.parse(details);
                  return parsed && typeof parsed === 'object' ? parsed : {};
                } catch {
                  return {};
                }
              }
              return typeof details === 'object' ? (details as Record<string, unknown>) : {};
            };
            const ipById = new Map<string, NodeIpEntry>();
            ((build as any).nodes ?? []).forEach((n: any) => {
              const vmIps: VmIpMap = new Map();
              (n.virtual_machines ?? []).forEach((vm: any) => {
                vmIps.set(vm.id, vm.ip || '');
              });
              const details = parseDetails(n.details);
              delete details.virtual_network;
              ipById.set(n.id, { nodeIp: n.ip, vmMap: vmIps, details });
            });

            // Patch local state
            const hardwareNodesWithIPs = get().hardwareNodes.map(hn => {
              const entry = ipById.get(hn.id);
              if (!entry) return hn;
              return {
                ...hn,
                ip: entry.nodeIp,
                details: mergeServerDetails(
                  hn.details as Record<string, unknown> | undefined,
                  entry.details,
                ),
                vms: hn.vms?.map(vm => ({ ...vm, ip: entry.vmMap.get(vm.id) ?? vm.ip })),
              };
            });

            const reactFlowNodesWithIPs = get().nodes.map(rfn => {
              const entry = ipById.get(rfn.id);
              if (!entry) return rfn;
              return {
                ...rfn,
                data: {
                  ...rfn.data,
                  ip: entry.nodeIp,
                  details: mergeServerDetails(
                    rfn.data?.details as Record<string, unknown> | undefined,
                    entry.details,
                  ),
                  vms: (Array.isArray(rfn.data?.vms) ? rfn.data.vms : []).map((vm: any) => ({
                    ...vm,
                    ip: entry.vmMap.get(vm.id) ?? vm.ip,
                  })),
                },
              };
            });

            // Edits made while the request was in flight are not on the server yet.
            const editedDuringSave = JSON.stringify(get().getBuildData()) !== sentFingerprint;
            set({
              hardwareNodes: hardwareNodesWithIPs as HardwareNode[],
              nodes: reactFlowNodesWithIPs as Node[],
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
              const issues: HardwareNodeValidationIssue[] = [
                ...(response.validation.errors || []).map(issue => ({
                  ...issue,
                  type: 'error' as const,
                })),
                ...(response.validation.warnings || []).map(issue => ({
                  ...issue,
                  type: 'warning' as const,
                })),
              ];
              set({ validationIssues: issues });
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
                set({ historyPast: [...past, mine].slice(-50), historyFuture: [] });
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
          // Ensure response is the nested JSON from hlbIPAM (it might be wrapped by our API)
          const data = response?.data || response || {};

          const issues: HardwareNodeValidationIssue[] = [];

          if (data.errors && Array.isArray(data.errors)) {
            data.errors.forEach((e: any) => issues.push({ ...e, type: 'error' }));
          }
          if (data.warnings && Array.isArray(data.warnings)) {
            data.warnings.forEach((w: any) => issues.push({ ...w, type: 'warning' }));
          }

          set({ validationIssues: issues });
        } catch (e) {
          console.error('Failed to validate network', e);
          set({ validationIssues: [] });
        }
      },

      // ── Purchase Tracking ──────────────────────────────────────────────
      markAsBought: itemName =>
        set(state => ({ boughtItems: [...new Set([...state.boughtItems, itemName])] })),

      unmarkAsBought: itemName =>
        set(state => ({ boughtItems: state.boughtItems.filter(n => n !== itemName) })),

      setShowBought: v => set({ showBought: v }),

      clear: () => set({ hardwareNodes: [], nodes: [], edges: [], boughtItems: [] }),

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
          boughtItems: [],
          showBought: false,
          historyPast: [],
          historyFuture: [],
          lastSyncedFingerprint: '',
          proposalPreview: null,
          canvasFocus: null,
        });
      },
      setProjectName: name => set({ projectName: name }),

      loadBuild: (id, name, build: Build) => {
        const settings = build.settings || {};
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
          buildSettings: settings,
          boughtItems: settings.boughtItems || [],
          showBought: settings.showBought || false,
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
            historyPast: [...past, snapshot].slice(-50),
            historyFuture: [],
            proposalPreview: null,
            validationIssues: validationToIssues(result.validation),
          });
          // Bring what was applied into view: new devices may be off screen.
          const applied = new Set(get().nodes.map(node => node.id));
          const visible = touched.filter(nodeId => applied.has(nodeId));
          if (visible.length > 0) get().requestCanvasFocus(visible);
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
        const hwMap = new Map<string, HardwareNode>(state.hardwareNodes.map(n => [n.id, n]));

        // Construct the payload structure exactly matching backend DTO definitions
        const nodesPayload = state.nodes.map(rfn => {
          const hw = hwMap.get(rfn.id) || ({} as any);
          return {
            id: rfn.id,
            type: rfn.data?.type || hw.type,
            name: rfn.data?.name || hw.name,
            x: rfn.position.x,
            y: rfn.position.y,
            power_draw: Number(rfn.data?.power_draw ?? hw.power_draw ?? 0) || 0,
            ip: rfn.data?.ip || hw.ip || '',
            mac_address: rfn.data?.mac_address || hw.mac_address || '',
            details: rfn.data?.details || hw.details || {},
            vms: rfn.data?.vms || hw.vms || [],
            internal_components: rfn.data?.internal_components || hw.internal_components || [],
            parent_id: hw.parent_id || undefined,
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
          settings: {
            ...state.buildSettings,
            boughtItems: state.boughtItems,
            showBought: state.showBought,
          },
        };
      },

      totalCpu: () => {
        const { hardwareNodes } = get();
        return hardwareNodes.reduce(
          (acc, node) => acc + (node.vms?.reduce((vAcc, vm) => vAcc + (vm.cpu_cores || 0), 0) || 0),
          0,
        );
      },
      totalRam: () => {
        const { hardwareNodes } = get();
        return hardwareNodes.reduce(
          (acc, node) => acc + (node.vms?.reduce((vAcc, vm) => vAcc + (vm.ram_mb || 0), 0) || 0),
          0,
        );
      },
      totalStorage: () => 0,
    }),
    {
      // Only which project is open survives a reload. Its canvas is read from
      // the server again: a copy kept here would be shown, and trusted, long
      // after it stopped being true.
      name: WORKSPACE_STORAGE_KEY,
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
