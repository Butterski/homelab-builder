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

/** The build was saved elsewhere first; the store now holds that newer revision. */
export class BuildConflictError extends Error {
  constructor() {
    super('This project was changed elsewhere. Loaded the latest version - please try again.');
    this.name = 'BuildConflictError';
  }
}

// Removed hardcoded NON_NETWORK_TYPES and using isNetworkNode instead.

type Snapshot = { nodes: Node[]; edges: Edge[]; hardwareNodes: HardwareNode[] };

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
  setCurrentBuildId: (id: string | null) => void;
  clearCurrentBuild: () => void;

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
      lastSyncedFingerprint: '',
      proposalPreview: null,

      onNodesChange: changes => {
        const dragEnds = changes.filter(c => c.type === 'position' && !(c as any).dragging);
        const removals = changes.filter(c => c.type === 'remove');
        if (dragEnds.length > 0 || removals.length > 0) {
          const state = get();
          const snap: Snapshot = {
            nodes: state.nodes,
            edges: state.edges,
            hardwareNodes: state.hardwareNodes,
          };
          set({
            historyPast: [...state.historyPast, snap].slice(-50),
            historyFuture: [],
            nodes: applyNodeChanges(changes, state.nodes),
          });
        } else {
          set({ nodes: applyNodeChanges(changes, get().nodes) });
        }
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
        const current: Snapshot = {
          nodes: state.nodes,
          edges: state.edges,
          hardwareNodes: state.hardwareNodes,
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
        });
      },

      reassignAllIPs: () => {
        const mutation = async () => {
          const { currentBuildId, currentRevision, projectName, getBuildData } = get();
          if (!currentBuildId) {
            console.error('No build ID, cannot calculate network');
            throw new Error('No build is open');
          }

          try {
            // The backend saves this revision and calculates its network in one transaction.
            const data = getBuildData();
            const sentFingerprint = JSON.stringify(data);
            const response = await buildApi.updateTopology(currentBuildId, {
              name: projectName || 'Untitled Project',
              thumbnail: '',
              revision: currentRevision,
              ...data,
            });

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
            const latest =
              e instanceof ApiError && e.status === 409
                ? (e.data as { build?: Build } | undefined)?.build
                : undefined;
            if (latest && get().currentBuildId === currentBuildId) {
              // Every later save would repeat the stale revision, so adopt the
              // committed one instead of failing until the page is reloaded.
              get().loadBuild(latest.id, latest.name, latest);
              throw new BuildConflictError();
            }
            console.error('Failed to reassign IPs', e);
            throw e;
          }
        };
        return enqueueTopologyMutation(mutation);
      },

      validateNetwork: async () => {
        const { currentBuildId } = get();
        if (!currentBuildId) return;

        try {
          const response = await buildApi.validateNetwork(currentBuildId);
          // Ensure response is the nested JSON from hlbIPAM (it might be wrapped by our API)
          const data = response.data || response;

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
      clearCurrentBuild: () =>
        set({
          virtualHostId: null,
          currentBuildId: null,
          currentRevision: 0,
          projectName: 'Untitled Project',
          nodes: [],
          edges: [],
          hardwareNodes: [],
          buildKind: 'homelab',
          gamingPlan: {},
          buildSettings: {},
          historyPast: [],
          historyFuture: [],
          lastSyncedFingerprint: '',
          proposalPreview: null,
        }),
      setProjectName: name => set({ projectName: name }),

      loadBuild: (id, name, build: Build) => {
        const settings = build.settings || {};

        const { hardwareNodes, nodes: rfNodes, edges: rfEdges } = mapBuildToFlow(build);

        set({
          currentBuildId: id,
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
        });
        set({ lastSyncedFingerprint: JSON.stringify(get().getBuildData()) });
      },

      hasUnsavedChanges: () => {
        const state = get();
        if (!state.currentBuildId) return false;
        return JSON.stringify(state.getBuildData()) !== state.lastSyncedFingerprint;
      },

      syncWithServer: serverRevision => {
        let reloaded = false;
        return enqueueTopologyMutation(async () => {
          const { currentBuildId, currentRevision } = get();
          if (!currentBuildId || serverRevision <= currentRevision) return;
          // A pending local edit is saved first; if that save is stale it adopts
          // the newer build through the conflict path.
          if (get().hasUnsavedChanges()) return;
          const build = await buildApi.get(currentBuildId);
          if (get().currentBuildId !== currentBuildId) return;
          if (build.revision <= get().currentRevision || get().hasUnsavedChanges()) return;
          get().loadBuild(build.id, build.name, build);
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
          const snapshot: Snapshot = {
            nodes: before.nodes,
            edges: before.edges,
            hardwareNodes: before.hardwareNodes,
          };
          const past = before.historyPast;
          get().loadBuild(result.build.id, result.build.name, result.build);
          // One undo step takes the canvas back to how it was before the proposal.
          set({
            historyPast: [...past, snapshot].slice(-50),
            historyFuture: [],
            proposalPreview: null,
            validationIssues: validationToIssues(result.validation),
          });
        });
      },

      openBuild: id =>
        // Queued behind pending saves so the loaded revision already contains them.
        enqueueTopologyMutation(async () => {
          const build = await buildApi.get(id);
          get().loadBuild(build.id, build.name, build);
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
      name: 'homelab-builder-storage',
      partialize: state => ({
        hardwareNodes: state.hardwareNodes,
        nodes: state.nodes,
        edges: state.edges,
        boughtItems: state.boughtItems,
        showBought: state.showBought,
        projectName: state.projectName,
      }),
    },
  ),
);
