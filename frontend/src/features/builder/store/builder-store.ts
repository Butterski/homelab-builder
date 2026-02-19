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

// ─── IP Logic moved to Backend (Phase 2) ────────────────────────────────────
// Local constants removed to prevent "Split Brain" logic.
// See internal/services/ip_service.go for the Source of Truth.


// Types that never get an IP address
export const NON_NETWORK_TYPES: HardwareType[] = ['disk', 'gpu', 'hba', 'pcie', 'pdu', 'ups']


// Helper functions removed.
// subnetPrefix, collectUsedOffsets, collectUsedIPs, assignIP, assignVMIP -> GONE.
// findGateway kept for UI check? No, backend handles it.
// Actually, `findGateway` is used in `autoAssignIP`? Yes.
// But we are removing `autoAssignIP` too.


interface BuilderState {
    // Data Logic
    selectedServices: Service[]
    hardwareNodes: HardwareNode[]

    addService: (service: Service) => void
    removeService: (serviceId: string) => void
    toggleService: (service: Service) => void

    // Visual Logic (React Flow Source of Truth)
    nodes: Node[]
    edges: Edge[]
    onNodesChange: OnNodesChange
    onEdgesChange: OnEdgesChange
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

    // Export / Import
    exportLab: (name?: string) => void
    importLab: (json: string) => { ok: boolean; error?: string }

    // API Persistence
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
            selectedServices: [],
            hardwareNodes: [],
            nodes: [],
            edges: [],
            selectedNodeId: null,
            boughtItems: [],
            showBought: false,
            projectName: "My Homelab",
            projectThumbnail: "",
            currentBuildId: null,

            onNodesChange: (changes) => {
                set({ nodes: applyNodeChanges(changes, get().nodes) });
            },
            onEdgesChange: (changes) => {
                set({ edges: applyEdgeChanges(changes, get().edges) });
            },
            onConnect: (connection: Connection) => {
                const state = get()
                const newEdges = addEdge(connection, state.edges)
                set({ edges: newEdges })

                set({ edges: newEdges })

                // Trigger backend recalculation
                get().reassignAllIPs()

            },

            addService: (service) => {
                set((state) => {
                    const newNode: Node = {
                        id: service.id,
                        type: 'service',
                        data: { label: service.name },
                        position: { x: Math.random() * 400, y: Math.random() * 400 + 300 },
                    };
                    return {
                        selectedServices: [...state.selectedServices, service],
                        nodes: [...state.nodes, newNode]
                    };
                });
            },

            removeService: (serviceId) => {
                set((state) => ({
                    selectedServices: state.selectedServices.filter((s) => s.id !== serviceId),
                    nodes: state.nodes.filter((n) => n.id !== serviceId),
                    edges: state.edges.filter((e) => e.source !== serviceId && e.target !== serviceId)
                }));
            },

            toggleService: (service) => {
                const { selectedServices } = get()
                const exists = selectedServices.find((s) => s.id === service.id)
                if (exists) get().removeService(service.id)
                else get().addService(service)
            },

            selectNode: (nodeId) => set({ selectedNodeId: nodeId }),

            addHardware: (hardwareNode) => {
                set((state) => {
                    // Logic removed. Just add the node without IP.
                    // Backend will assign it eventually.
                    const nodeWithIP = hardwareNode;

                    const reactFlowNode: Node = {
                        id: nodeWithIP.id,
                        type: 'hardware',
                        position: { x: nodeWithIP.x, y: nodeWithIP.y },
                        data: { label: nodeWithIP.name, ...nodeWithIP }
                    };

                    return {
                        hardwareNodes: [...state.hardwareNodes, nodeWithIP],
                        nodes: [...state.nodes, reactFlowNode]
                    };
                });

                // Trigger async recalculation
                setTimeout(() => get().reassignAllIPs(), 0);
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
                // IP assignment moved to backend
                const newIp = ''
                const dup: HardwareNode = {
                    ...orig,
                    id: newId,
                    name: `${orig.name} (copy)`,
                    ip: newIp,
                    x: orig.x + 40,
                    y: orig.y + 40,
                    vms: [],  // don't duplicate VMs
                }

                // Trigger recalc
                setTimeout(() => get().reassignAllIPs(), 0);

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

                // Trigger async recalculation
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
                })
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

                    // Build a lookup: "name|type" → { nodeIp, vmIps }
                    type VmIpMap = Map<string, string>
                    interface NodeIpEntry { nodeIp: string; vmMap: VmIpMap }
                    const ipByNameType = new Map<string, NodeIpEntry>()
                    ;((build as any).nodes ?? []).forEach((n: any) => {
                        if (!n.ip) return
                        const vmMap: VmIpMap = new Map()
                        ;(n.virtual_machines ?? []).forEach((vm: any) => {
                            if (vm.ip) vmMap.set(vm.name + '|' + vm.type, vm.ip)
                        })
                        ipByNameType.set(n.name + '|' + n.type, { nodeIp: n.ip, vmMap })
                    })

                    // Overlay IPs onto the saved blob's hardwareNodes
                    const hardwareNodesWithIPs = (savedData.hardwareNodes ?? []).map((hn: any) => {
                        const entry = ipByNameType.get(hn.name + '|' + hn.type)
                        if (!entry) return hn
                        const vmsWithIPs = (hn.vms ?? []).map((vm: any) => {
                            const vmIp = entry.vmMap.get(vm.name + '|' + vm.type)
                            return vmIp ? { ...vm, ip: vmIp } : vm
                        })
                        return { ...hn, ip: entry.nodeIp, vms: vmsWithIPs }
                    })

                    // Also patch the ReactFlow nodes array — the hardware card reads
                    // its IP from node.data.ip, not from hardwareNodes directly.
                    const ipByNodeId = new Map<string, string>(
                        hardwareNodesWithIPs.map((hn: any) => [hn.id, hn.ip])
                    )
                    const reactFlowNodesWithIPs = (savedData.nodes ?? []).map((rfn: any) => {
                        const newIp = ipByNodeId.get(rfn.id)
                        return newIp
                            ? { ...rfn, data: { ...rfn.data, ip: newIp } }
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

            clear: () => set({ selectedServices: [], hardwareNodes: [], nodes: [], edges: [], boughtItems: [] }),

            // ── Export / Import ────────────────────────────────────────────────
            exportLab: (name = 'my-homelab') => {
                const { selectedServices, hardwareNodes, nodes, edges } = get()
                const payload = {
                    version: 1,
                    name,
                    exportedAt: new Date().toISOString(),
                    selectedServices,
                    hardwareNodes,
                    nodes,
                    edges,
                }
                const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
                const url = URL.createObjectURL(blob)
                const a = document.createElement('a')
                a.href = url
                a.download = `${name.replace(/[^a-z0-9]/gi, '-')}.homelab.json`
                a.click()
                URL.revokeObjectURL(url)
            },

            importLab: (json: string) => {
                try {
                    const payload = JSON.parse(json)
                    if (!payload.version || !Array.isArray(payload.selectedServices)) {
                        return { ok: false, error: 'Invalid .homelab.json format' }
                    }
                    set({
                        selectedServices: payload.selectedServices ?? [],
                        hardwareNodes: payload.hardwareNodes ?? [],
                        nodes: payload.nodes ?? [],
                        edges: payload.edges ?? [],
                    })
                    return { ok: true }
                } catch {
                    return { ok: false, error: 'Failed to parse JSON' }
                }
            },

            // ── API Persistence ────────────────────────────────────────────────
            setCurrentBuildId: (id) => set({ currentBuildId: id }),
            clearCurrentBuild: () => set({
                currentBuildId: null,
                projectName: 'Untitled Project',
                nodes: [],
                edges: [],
                hardwareNodes: [],
                selectedServices: []
            }),
            setProjectName: (name) => set({ projectName: name }),

            loadBuild: (id, name, data) => {
                set({
                    currentBuildId: id,
                    projectName: name,
                    selectedServices: data.selectedServices || [],
                    hardwareNodes: data.hardwareNodes || [],
                    nodes: data.nodes || [],
                    edges: data.edges || [],
                    boughtItems: data.boughtItems || [],
                    showBought: data.showBought || false
                });
            },

            getBuildData: () => {
                // Return a JSON-serializable snapshot
                const state = get();
                return {
                    selectedServices: state.selectedServices,
                    hardwareNodes: state.hardwareNodes,
                    nodes: state.nodes,
                    edges: state.edges,
                    boughtItems: state.boughtItems,
                    showBought: state.showBought
                };
            },

            totalCpu: () => get().selectedServices.reduce((acc, s) => acc + (s.requirements?.min_cpu_cores || 0), 0),
            totalRam: () => get().selectedServices.reduce((acc, s) => acc + (s.requirements?.min_ram_mb || 0), 0),
            totalStorage: () => get().selectedServices.reduce((acc, s) => acc + (s.requirements?.min_storage_gb || 0), 0),
        }),
        {
            name: 'homelab-builder-storage',
            partialize: (state) => ({
                selectedServices: state.selectedServices,
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
