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
  HardwareType,
  HardwareComponent,
} from '../../../types';
import { buildApi, type Build } from '../api/builds';
import { api } from '../../../services/api';

// Types that never get an IP address
export const NON_NETWORK_TYPES: HardwareType[] = ['disk', 'gpu', 'hba', 'pcie', 'pdu', 'ups'];

interface BuilderState {
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
  };
  setEdgePreferences: (prefs: Partial<BuilderState['edgePreferences']>) => void;

  // Network Validation
  validationIssues: { node_id: string; message: string; type: 'error' | 'warning' }[];
  validateNetwork: () => Promise<void>;

  clear: () => void;

  // ── API Persistence ────────────────────────────────────────────────
  currentBuildId: string | null;
  setCurrentBuildId: (id: string | null) => void;
  clearCurrentBuild: () => void;

  projectName: string;
  projectThumbnail: string;
  setProjectName: (name: string) => void;

  loadBuild: (id: string, name: string, data: any) => void;
  getBuildData: () => any;

  // Computed getters
  totalCpu: () => number;
  totalRam: () => number;
  totalStorage: () => number;
}

export const useBuilderStore = create<BuilderState>()(
  persist(
    (set, get) => ({
      hardwareNodes: [],
      nodes: [],
      edges: [],
      selectedNodeId: null,
      boughtItems: [],
      showBought: false,
      edgePreferences: {
        routingEngine: 'direct',
        connectionStyle: 'strict',
        lineStyle: 'step',
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

      onNodesChange: changes => {
        set({ nodes: applyNodeChanges(changes, get().nodes) });
      },
      onEdgesChange: changes => {
        set({ edges: applyEdgeChanges(changes, get().edges) });
      },
      updateEdge: (id, updates) => {
        set(state => ({
          edges: state.edges.map(e => (e.id === id ? { ...e, ...updates } : e)),
        }));
      },
      onConnect: (connection: Connection) => {
        const state = get();
        // Default new edges to custom type
        const newEdges = addEdge({ ...connection, type: 'custom' }, state.edges);
        set({ edges: newEdges });

        // Trigger graph-aware IP recalculation whenever a new edge is drawn
        setTimeout(() => get().reassignAllIPs(), 0);
      },

      selectNode: nodeId => set({ selectedNodeId: nodeId }),

      addHardware: hardwareNode => {
        set(state => {
          const reactFlowNode: Node = {
            id: hardwareNode.id,
            type: 'hardware',
            position: { x: hardwareNode.x, y: hardwareNode.y },
            data: { label: hardwareNode.name, ...hardwareNode },
          };

          return {
            hardwareNodes: [...state.hardwareNodes, hardwareNode],
            nodes: [...state.nodes, reactFlowNode],
          };
        });
      },

      removeHardware: nodeId =>
        set(state => ({
          hardwareNodes: state.hardwareNodes.filter(n => n.id !== nodeId),
          nodes: state.nodes.filter(n => n.id !== nodeId),
          edges: state.edges.filter(e => e.source !== nodeId && e.target !== nodeId),
          selectedNodeId: state.selectedNodeId === nodeId ? null : state.selectedNodeId,
        })),

      updateHardware: (nodeId, updates) =>
        set(state => ({
          hardwareNodes: state.hardwareNodes.map(n => (n.id === nodeId ? { ...n, ...updates } : n)),
          nodes: state.nodes.map(n =>
            n.id === nodeId
              ? { ...n, data: { ...n.data, ...updates, label: updates.name ?? n.data.label } }
              : n,
          ),
        })),

      duplicateHardware: nodeId => {
        const state = get();
        const orig = state.hardwareNodes.find(n => n.id === nodeId);
        if (!orig) return;
        const newId = crypto.randomUUID();
        const dup: HardwareNode = {
          ...orig,
          id: newId,
          name: `${orig.name} (copy)`,
          ip: '',
          x: orig.x + 40,
          y: orig.y + 40,
          vms: [],
        };

        const rfNode: Node = {
          id: newId,
          type: 'hardware',
          position: { x: dup.x, y: dup.y },
          data: { label: dup.name, ...dup },
        };
        set({
          hardwareNodes: [...state.hardwareNodes, dup],
          nodes: [...state.nodes, rfNode],
          selectedNodeId: newId,
        });
      },

      addInternalComponent: (nodeId, component) => {
        set(state => {
          const updated = state.hardwareNodes.map(n =>
            n.id === nodeId
              ? { ...n, internal_components: [...(n.internal_components || []), component] }
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

      removeInternalComponent: (nodeId, componentId) => {
        set(state => {
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
      addVM: (nodeId, vm) => {
        set(state => {
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
        setTimeout(() => get().reassignAllIPs(), 0);
      },

      removeVM: (nodeId, vmId) => {
        set(state => {
          const updated = state.hardwareNodes.map(n =>
            n.id === nodeId ? { ...n, vms: (n.vms || []).filter(v => v.id !== vmId) } : n,
          );
          return {
            hardwareNodes: updated,
            nodes: state.nodes.map(n =>
              n.id === nodeId
                ? { ...n, data: { ...n.data, vms: updated.find(h => h.id === nodeId)?.vms } }
                : n,
            ),
          };
        });

        // Automatically recalculate IPs when VM is removed
        setTimeout(() => get().reassignAllIPs(), 0);
      },

      updateVM: (nodeId, vmId, updates) => {
        set(state => {
          const updated = state.hardwareNodes.map(n =>
            n.id === nodeId
              ? { ...n, vms: (n.vms || []).map(v => (v.id === vmId ? { ...v, ...updates } : v)) }
              : n,
          );
          return {
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
        get().reassignAllIPs();
        return null;
      },

      reassignAllIPs: async () => {
        const { currentBuildId, projectName, getBuildData } = get();
        if (!currentBuildId) {
          console.error('No build ID, cannot calculate network');
          return;
        }

        try {
          // Step 1: Save current local state to the backend FIRST.
          // This is critical: the backend's CalculateNetwork reads the relational
          // nodes table, which is only populated when buildApi.update is called.
          // Without this save, the backend works on stale/empty data and returns
          // "no router found" even when a router exists in local state.
          const data = getBuildData();
          await buildApi.update(currentBuildId, {
            name: projectName || 'Untitled Project',
            thumbnail: '',
            ...data,
          });

          // Step 2: Ask the backend to calculate and assign IPs.
          await buildApi.calculateNetwork(currentBuildId);

          // Step 3: Reload the build so the UI shows the newly assigned IPs.
          // Because we saved in step 1, build.data now contains ALL current nodes
          // (including ones added since the last auto-save). We overlay IPs from
          // the relational nodes table (updated by calculateNetwork) on top of the
          // blob, so nothing is lost and IPs are always fresh.
          const build = await buildApi.get(currentBuildId);

          // Build a lookup: "id" → { nodeIp, vmIps }
          type VmIpMap = Map<string, string>;
          interface NodeIpEntry {
            nodeIp: string;
            vmMap: VmIpMap;
          }
          const ipById = new Map<string, NodeIpEntry>();
          ((build as any).nodes ?? []).forEach((n: any) => {
            const vmIps: VmIpMap = new Map();
            (n.virtual_machines ?? []).forEach((vm: any) => {
              if (vm.ip) vmIps.set(vm.id, vm.ip);
            });
            ipById.set(n.id, { nodeIp: n.ip, vmMap: vmIps });
          });

          // Patch local state
          const hardwareNodesWithIPs = get().hardwareNodes.map(hn => {
            const entry = ipById.get(hn.id);
            if (!entry) return hn;
            return {
              ...hn,
              ip: entry.nodeIp,
              vms: hn.vms?.map(vm => ({ ...vm, ip: entry.vmMap.get(vm.id) || vm.ip })),
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
                vms: (Array.isArray(rfn.data?.vms) ? rfn.data.vms : []).map((vm: any) => ({
                  ...vm,
                  ip: entry.vmMap.get(vm.id) || vm.ip,
                })),
              },
            };
          });

          set({
            hardwareNodes: hardwareNodesWithIPs as HardwareNode[],
            nodes: reactFlowNodesWithIPs as Node[],
          });

          // Step 4: Validate the network automatically after assignment
          await get().validateNetwork();
        } catch (e) {
          console.error('Failed to reassign IPs', e);
        }
      },

      validateNetwork: async () => {
        const { currentBuildId } = get();
        if (!currentBuildId) return;

        try {
          const response = await buildApi.validateNetwork(currentBuildId);
          // Ensure response is the nested JSON from hlbIPAM (it might be wrapped by our API)
          const data = response.data || response;

          const issues: { node_id: string; message: string; type: 'error' | 'warning' }[] = [];

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
          currentBuildId: null,
          projectName: 'Untitled Project',
          nodes: [],
          edges: [],
          hardwareNodes: [],
        }),
      setProjectName: name => set({ projectName: name }),

      loadBuild: (id, name, build: Build) => {
        const settings = build.settings || {};

        // Map relational `nodes` back into flattened array structure
        const hardwareNodes: HardwareNode[] = (build.nodes || []).map((n: any) => ({
          id: n.id,
          type: n.type as any,
          name: n.name,
          ip: n.ip,
          x: n.x || 0,
          y: n.y || 0,
          vms: n.virtual_machines || [],
          internal_components: n.internal_components || [],
          details: typeof n.details === 'string' ? JSON.parse(n.details) : n.details || {},
        }));

        const hwMap = new Map<string, HardwareNode>(hardwareNodes.map((n: any) => [n.id, n]));

        // Construct React Flow nodes from the relational DB nodes
        const rfNodes = (build.nodes || []).map((n: any) => ({
          id: n.id,
          type: 'hardware',
          position: { x: n.x, y: n.y },
          data: { ...(hwMap.get(n.id) || {}), label: n.name },
        }));

        // Map DB edges to React Flow edges
        const rfEdges = (build.edges || []).map((e: any) => ({
          id: String(e.id || `${e.source_node_id}-${e.target_node_id}`),
          source: String(e.source_node_id),
          sourceHandle: e.source_handle || undefined,
          target: String(e.target_node_id),
          targetHandle: e.target_handle || undefined,
          type: e.type && e.type !== 'ethernet' ? e.type : 'custom',
          data: {
            speed: e.speed || '1 GbE',
            subnet: e.subnet || '',
          },
        }));

        set({
          currentBuildId: id,
          projectName: name,
          hardwareNodes,
          nodes: rfNodes,
          edges: rfEdges,
          boughtItems: settings.boughtItems || [],
          showBought: settings.showBought || false,
        });
      },

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
            ip: rfn.data?.ip || hw.ip || '',
            details: rfn.data?.details || hw.details || {},
            vms: rfn.data?.vms || hw.vms || [],
            internal_components: rfn.data?.internal_components || hw.internal_components || [],
          };
        });

        const edgesPayload = state.edges.map(e => ({
          source: e.source,
          source_handle: e.sourceHandle || '',
          target: e.target,
          target_handle: e.targetHandle || '',
          speed: (e.data?.speed as string) || '1 GbE',
          subnet: (e.data?.subnet as string) || '',
        }));

        return {
          nodes: nodesPayload,
          edges: edgesPayload,
          services: [],
          settings: {
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
