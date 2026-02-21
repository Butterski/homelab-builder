import { create } from 'zustand'
import { persist } from 'zustand/middleware'
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
} from '@xyflow/react'
import type { Service, HardwareNode, VirtualMachine, HardwareType, HardwareComponent } from '../../../types'
import { buildApi } from '../api/builds'
import { api } from '../../../services/api'

// Types that never get an IP address
export const NON_NETWORK_TYPES: HardwareType[] = ['disk', 'gpu', 'hba', 'pcie', 'pdu', 'ups']

interface BuilderState {
    // Data Logic
    availableServices: Service[]
    fetchServices: () => Promise<void>
    hardwareNodes: HardwareNode[]

    // Visual Logic (React Flow Source of Truth)
    nodes: Node[]
    edges: Edge[]
    onNodesChange: OnNodesChange
    onEdgesChange: OnEdgesChange
    updateEdge: (id: string, updates: Partial<Edge>) => void
    onConnect: OnConnect

    // Selection
    selectedNodeId: string | null
    selectNode: (nodeId: string | null) => void

    // Hardware Actions
    addHardware: (node: HardwareNode) => void
    removeHardware: (nodeId: string) => void
    updateHardware: (nodeId: string, updates: Partial<HardwareNode>) => void
    duplicateHardware: (nodeId: string) => void

    addInternalComponent: (nodeId: string, component: HardwareComponent) => void
    removeInternalComponent: (nodeId: string, componentId: string) => void
    updateInternalComponent: (nodeId: string, componentId: string, updates: Partial<HardwareComponent>) => void

    // VM / Container Management
    addVM: (nodeId: string, vm: VirtualMachine) => void
    removeVM: (nodeId: string, vmId: string) => void
    updateVM: (nodeId: string, vmId: string, updates: Partial<VirtualMachine>) => void

    // Actions
    autoAssignIP: (nodeId?: string) => string | null
    reassignAllIPs: () => Promise<void>

    // Purchase Tracking
    boughtItems: string[]
    markAsBought: (itemName: string) => void
    unmarkAsBought: (itemName: string) => void
    showBought: boolean
    setShowBought: (v: boolean) => void

    clear: () => void

    // ── API Persistence ────────────────────────────────────────────────
    currentBuildId: string | null
    setCurrentBuildId: (id: string | null) => void
    clearCurrentBuild: () => void

    projectName: string
    projectThumbnail: string
    setProjectName: (name: string) => void

    loadBuild: (id: string, name: string, data: any) => void
    getBuildData: () => any

    // Computed getters
    totalCpu: () => number
    totalRam: () => number
    totalStorage: () => number
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
            availableServices: [],
            fetchServices: async () => {
                try {
                    const res = await api.getServices()
                    set({ availableServices: res.data || [] })
                } catch (e) {
                    console.error("Failed to fetch services", e)
                }
            },
            projectName: "My Homelab",
            projectThumbnail: "",
            currentBuildId: null,

            onNodesChange: (changes) => {
                set({ nodes: applyNodeChanges(changes, get().nodes) });
            },
            onEdgesChange: (changes) => {
                set({ edges: applyEdgeChanges(changes, get().edges) });
            },
            updateEdge: (id, updates) => {
                set((state) => ({
                    edges: state.edges.map(e => e.id === id ? { ...e, ...updates } : e)
                }))
            },
            onConnect: (connection: Connection) => {
                const state = get()
                // Default new edges to custom type
                const newEdges = addEdge({ ...connection, type: 'custom' }, state.edges)
                set({ edges: newEdges })

                // Trigger graph-aware IP recalculation whenever a new edge is drawn
                setTimeout(() => get().reassignAllIPs(), 0)
            },

            selectNode: (nodeId) => set({ selectedNodeId: nodeId }),

            addHardware: (hardwareNode) => {
                set((state) => {
                    const reactFlowNode: Node = {
                        id: hardwareNode.id,
                        type: 'hardware',
                        position: { x: hardwareNode.x, y: hardwareNode.y },
                        data: { label: hardwareNode.name, ...hardwareNode }
                    };

                    return {
                        hardwareNodes: [...state.hardwareNodes, hardwareNode],
                        nodes: [...state.nodes, reactFlowNode]
                    };
                });
            },

            removeHardware: (nodeId) =>
                set((state) => ({
                    hardwareNodes: state.hardwareNodes.filter((n) => n.id !== nodeId),
                    nodes: state.nodes.filter((n) => n.id !== nodeId),
                    edges: state.edges.filter((e) => e.source !== nodeId && e.target !== nodeId),
                    selectedNodeId: state.selectedNodeId === nodeId ? null : state.selectedNodeId
                })),

            updateHardware: (nodeId, updates) =>
                set((state) => ({
                    hardwareNodes: state.hardwareNodes.map((n) =>
                        n.id === nodeId ? { ...n, ...updates } : n
                    ),
                    nodes: state.nodes.map((n) =>
                        n.id === nodeId ? { ...n, data: { ...n.data, ...updates, label: updates.name ?? n.data.label } } : n
                    )
                })),

            duplicateHardware: (nodeId) => {
                const state = get()
                const orig = state.hardwareNodes.find(n => n.id === nodeId)
                if (!orig) return
                const newId = `node-${Date.now()}`
                const dup: HardwareNode = {
                    ...orig,
                    id: newId,
                    name: `${orig.name} (copy)`,
                    ip: '',
                    x: orig.x + 40,
                    y: orig.y + 40,
                    vms: [],
                }

                const rfNode: Node = {
                    id: newId,
                    type: 'hardware',
                    position: { x: dup.x, y: dup.y },
                    data: { label: dup.name, ...dup },
                }
                set({
                    hardwareNodes: [...state.hardwareNodes, dup],
                    nodes: [...state.nodes, rfNode],
                    selectedNodeId: newId,
                })
            },

            addInternalComponent: (nodeId, component) => {
                set((state) => {
                    const updated = state.hardwareNodes.map(n =>
                        n.id === nodeId
                            ? { ...n, internal_components: [...(n.internal_components || []), component] }
                            : n
                    )
                    return {
                        hardwareNodes: updated,
                        nodes: state.nodes.map(n =>
                            n.id === nodeId
                                ? { ...n, data: { ...n.data, internal_components: updated.find(h => h.id === nodeId)?.internal_components } }
                                : n
                        )
                    }
                })
            },

            removeInternalComponent: (nodeId, componentId) => {
                set((state) => {
                    const updated = state.hardwareNodes.map(n =>
                        n.id === nodeId
                            ? { ...n, internal_components: (n.internal_components || []).filter(c => c.id !== componentId) }
                            : n
                    )
                    return {
                        hardwareNodes: updated,
                        nodes: state.nodes.map(n =>
                            n.id === nodeId
                                ? { ...n, data: { ...n.data, internal_components: updated.find(h => h.id === nodeId)?.internal_components } }
                                : n
                        )
                    }
                })
            },

            updateInternalComponent: (nodeId, componentId, updates) => {
                set((state) => {
                    const updated = state.hardwareNodes.map(n =>
                        n.id === nodeId
                            ? {
                                ...n,
                                internal_components: (n.internal_components || []).map(c =>
                                    c.id === componentId ? { ...c, ...updates } : c
                                )
                            }
                            : n
                    )
                    return {
                        hardwareNodes: updated,
                        nodes: state.nodes.map(n =>
                            n.id === nodeId
                                ? { ...n, data: { ...n.data, internal_components: updated.find(h => h.id === nodeId)?.internal_components } }
                                : n
                        )
                    }
                })
            },

            // ── VM Management ──────────────────────────────────────────────────
            addVM: (nodeId, vm) => {
                set((state) => {
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
                                        vms: finalHost.vms
                                    }
                                }
                                : n
                        )
                    }
                });

                // Automatically assign IP when VM is added
                setTimeout(() => get().reassignAllIPs(), 0);
            },

            removeVM: (nodeId, vmId) => {
                set((state) => {
                    const updated = state.hardwareNodes.map(n =>
                        n.id === nodeId
                            ? { ...n, vms: (n.vms || []).filter(v => v.id !== vmId) }
                            : n
                    )
                    return {
                        hardwareNodes: updated,
                        nodes: state.nodes.map(n =>
                            n.id === nodeId
                                ? { ...n, data: { ...n.data, vms: updated.find(h => h.id === nodeId)?.vms } }
                                : n
                        )
                    }
                });

                // Automatically recalculate IPs when VM is removed
                setTimeout(() => get().reassignAllIPs(), 0);
            },

            updateVM: (nodeId, vmId, updates) => {
                set((state) => {
                    const updated = state.hardwareNodes.map(n =>
                        n.id === nodeId
                            ? { ...n, vms: (n.vms || []).map(v => v.id === vmId ? { ...v, ...updates } : v) }
                            : n
                    )
                    return {
                        hardwareNodes: updated,
                        nodes: state.nodes.map(n =>
                            n.id === nodeId
                                ? { ...n, data: { ...n.data, vms: updated.find(h => h.id === nodeId)?.vms } }
                                : n
                        )
                    }
                })
            },

            autoAssignIP: (_nodeId) => {
                // Deprecated. Backend only.
                get().reassignAllIPs()
                return null
            },


            reassignAllIPs: async () => {
                const { currentBuildId, projectName, getBuildData } = get()
                if (!currentBuildId) {
                    console.error("No build ID, cannot calculate network")
                    return
                }

                try {
                    // Step 1: Save current local state to the backend FIRST.
                    // This is critical: the backend's CalculateNetwork reads the relational
                    // nodes table, which is only populated when buildApi.update is called.
                    // Without this save, the backend works on stale/empty data and returns
                    // "no router found" even when a router exists in local state.
                    const data = getBuildData()
                    await buildApi.update(currentBuildId, {
                        name: projectName || 'Untitled Project',
                        data: JSON.stringify(data),
                        thumbnail: '',
                    })

                    // Step 2: Ask the backend to calculate and assign IPs.
                    await buildApi.calculateNetwork(currentBuildId)

                    // Step 3: Reload the build so the UI shows the newly assigned IPs.
                    // Because we saved in step 1, build.data now contains ALL current nodes
                    // (including ones added since the last auto-save). We overlay IPs from
                    // the relational nodes table (updated by calculateNetwork) on top of the
                    // blob, so nothing is lost and IPs are always fresh.
                    const build = await buildApi.get(currentBuildId)
                    const savedData = JSON.parse(build.data || '{}')

                    // Build a lookup: "id" → { nodeIp, vmIps }
                    type VmIpMap = Map<string, string>
                    interface NodeIpEntry { nodeIp: string; vmMap: VmIpMap }
                    const ipById = new Map<string, NodeIpEntry>()
                        ; ((build as any).nodes ?? []).forEach((n: any) => {
                            if (!n.ip) return
                            const vmMap: VmIpMap = new Map()
                                ; (n.virtual_machines ?? []).forEach((vm: any) => {
                                    if (vm.ip) vmMap.set(vm.id, vm.ip)
                                })
                            ipById.set(n.id, { nodeIp: n.ip, vmMap })
                        })

                    // Overlay IPs onto the saved blob's hardwareNodes
                    const hardwareNodesWithIPs = (savedData.hardwareNodes ?? []).map((hn: any) => {
                        const entry = ipById.get(hn.id)
                        if (!entry) return hn
                        const vmsWithIPs = (hn.vms ?? []).map((vm: any) => {
                            const vmIp = entry.vmMap.get(vm.id)
                            return vmIp ? { ...vm, ip: vmIp } : vm
                        })
                        return { ...hn, ip: entry.nodeIp, vms: vmsWithIPs }
                    })

                    // its IP from node.data.ip, not from hardwareNodes directly.
                    const nodeMap = new Map<string, any>(
                        hardwareNodesWithIPs.map((hn: any) => [hn.id, hn])
                    )
                    const reactFlowNodesWithIPs = (savedData.nodes ?? []).map((rfn: any) => {
                        const hn = nodeMap.get(rfn.id)
                        return hn
                            ? { ...rfn, data: { ...rfn.data, ip: hn.ip, vms: hn.vms } }
                            : rfn
                    })

                    get().loadBuild(build.id, build.name, {
                        ...savedData,
                        hardwareNodes: hardwareNodesWithIPs,
                        nodes: reactFlowNodesWithIPs,
                    })

                } catch (e) {
                    console.error("Failed to reassign IPs", e)
                }
            },

            // ── Purchase Tracking ──────────────────────────────────────────────
            markAsBought: (itemName) =>
                set((state) => ({ boughtItems: [...new Set([...state.boughtItems, itemName])] })),

            unmarkAsBought: (itemName) =>
                set((state) => ({ boughtItems: state.boughtItems.filter(n => n !== itemName) })),

            setShowBought: (v) => set({ showBought: v }),

            clear: () => set({ hardwareNodes: [], nodes: [], edges: [], boughtItems: [] }),

            // ── API Persistence ────────────────────────────────────────────────
            setCurrentBuildId: (id) => set({ currentBuildId: id }),
            clearCurrentBuild: () => set({
                currentBuildId: null,
                projectName: 'Untitled Project',
                nodes: [],
                edges: [],
                hardwareNodes: [],
            }),
            setProjectName: (name) => set({ projectName: name }),

            loadBuild: (id, name, data) => {
                const hardwareNodes: HardwareNode[] = data.hardwareNodes || []

                // Build a lookup for fast access
                const hwMap = new Map<string, HardwareNode>(hardwareNodes.map(n => [n.id, n]))

                // Merge authoritative internal_components and vms from hardwareNodes into
                // the React Flow node .data objects — they may have diverged if the RF nodes
                // were saved before these fields were introduced or failed to sync.
                const syncedRfNodes = (data.nodes || []).map((rfn: any) => {
                    const hw = hwMap.get(rfn.id)
                    if (!hw) return rfn
                    return {
                        ...rfn,
                        data: {
                            ...rfn.data,
                            internal_components: hw.internal_components ?? rfn.data?.internal_components ?? [],
                            vms: hw.vms ?? rfn.data?.vms ?? [],
                            details: hw.details ?? rfn.data?.details,
                        }
                    }
                })

                set({
                    currentBuildId: id,
                    projectName: name,
                    hardwareNodes,
                    nodes: syncedRfNodes,
                    edges: data.edges || [],
                    boughtItems: data.boughtItems || [],
                    showBought: data.showBought || false
                });
            },

            getBuildData: () => {
                // Return a JSON-serializable snapshot.
                // Sync hardwareNodes data (authoritative) into the RF node .data
                // objects before saving so internal_components are never lost.
                const state = get();
                const hwMap = new Map<string, HardwareNode>(state.hardwareNodes.map(n => [n.id, n]))
                const syncedNodes = state.nodes.map(rfn => {
                    const hw = hwMap.get(rfn.id)
                    if (!hw) return rfn
                    return {
                        ...rfn,
                        data: {
                            ...rfn.data,
                            internal_components: hw.internal_components ?? [],
                            vms: hw.vms ?? [],
                            details: hw.details,
                        }
                    }
                })
                return {
                    hardwareNodes: state.hardwareNodes,
                    nodes: syncedNodes,
                    edges: state.edges,
                    boughtItems: state.boughtItems,
                    showBought: state.showBought
                };
            },

            totalCpu: () => {
                const { hardwareNodes } = get();
                return hardwareNodes.reduce((acc, node) => acc + (node.vms?.reduce((vAcc, vm) => vAcc + (vm.cpu_cores || 0), 0) || 0), 0);
            },
            totalRam: () => {
                const { hardwareNodes } = get();
                return hardwareNodes.reduce((acc, node) => acc + (node.vms?.reduce((vAcc, vm) => vAcc + (vm.ram_mb || 0), 0) || 0), 0);
            },
            totalStorage: () => 0,
        }),
        {
            name: 'homelab-builder-storage',
            partialize: (state) => ({
                hardwareNodes: state.hardwareNodes,
                nodes: state.nodes,
                edges: state.edges,
                boughtItems: state.boughtItems,
                showBought: state.showBought,
                projectName: state.projectName,
            }),
        }
    )
)
