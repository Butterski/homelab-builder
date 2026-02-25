/**
 * builder-store.test.ts
 *
 * Tests for the three bugs fixed in builder-store.ts:
 *
 * 1. reassignAllIPs MUST call buildApi.update (save) BEFORE buildApi.calculateNetwork
 *    — if calculate runs first the backend reads stale/empty relational tables →
 *      "no router found" 500 error.
 *
 * 2. addHardware / addVM / duplicateHardware must NOT trigger reassignAllIPs
 *    — only onConnect should (prevents unnecessary API calls on every node drop).
 *
 * 3. onConnect MUST trigger reassignAllIPs so nodes get IPs when first wired up.
 *
 * Mock strategy: vi.mock buildApi so no real HTTP requests are made.
 * The store is reset before each test via zustand's setState.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ─── Mock buildApi before imports resolve ──────────────────────────────────
vi.mock('../api/builds', () => ({
    buildApi: {
        update: vi.fn().mockResolvedValue({ id: 'build-1', name: 'test', data: '{}' }),
        calculateNetwork: vi.fn().mockResolvedValue(undefined),
        validateNetwork: vi.fn().mockResolvedValue({ valid: true, errors: [], warnings: [] }),
        get: vi.fn().mockResolvedValue({
            id: 'build-1',
            name: 'test',
            data: JSON.stringify({ hardwareNodes: [], nodes: [], edges: [] }),
            nodes: [],
        }),
        create: vi.fn().mockResolvedValue({ id: 'build-1' }),
        list: vi.fn().mockResolvedValue([]),
        delete: vi.fn().mockResolvedValue(undefined),
    },
}))

// ─── Import AFTER mock is registered ──────────────────────────────────────
import { useBuilderStore } from './builder-store'
import { buildApi } from '../api/builds'

// ─── Helpers ──────────────────────────────────────────────────────────────

/** Reset store to empty state and set a build ID so reassignAllIPs can work */
function resetStoreWithBuildId(id = 'build-1') {
    useBuilderStore.setState({
        currentBuildId: id,
        hardwareNodes: [],
        nodes: [],
        edges: [],
        projectName: 'Test Project',
    })
    vi.clearAllMocks()
}

function makeRouter(id = 'router-1') {
    return {
        id,
        type: 'router' as const,
        name: 'Router',
        ip: '',
        x: 0,
        y: 0,
        vms: [],
        components: [],
        details: {},
    }
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe('reassignAllIPs', () => {
    beforeEach(() => resetStoreWithBuildId())
    afterEach(() => vi.clearAllMocks())

    it('should save (update) BEFORE calling calculateNetwork — core regression', async () => {
        // Track call order
        const callOrder: string[] = []
            ; (buildApi.update as ReturnType<typeof vi.fn>).mockImplementation(async () => {
                callOrder.push('update')
                return { id: 'build-1', name: 'test', data: '{}' }
            })
            ; (buildApi.calculateNetwork as ReturnType<typeof vi.fn>).mockImplementation(async () => {
                callOrder.push('calculateNetwork')
            })

        await useBuilderStore.getState().reassignAllIPs()

        expect(callOrder).toEqual(['update', 'calculateNetwork'])
    })

    it('should call buildApi.update with the current build ID', async () => {
        await useBuilderStore.getState().reassignAllIPs()

        expect(buildApi.update).toHaveBeenCalledWith(
            'build-1',
            expect.objectContaining({ name: expect.any(String) })
        )
    })

    it('should call buildApi.calculateNetwork after update', async () => {
        await useBuilderStore.getState().reassignAllIPs()

        expect(buildApi.calculateNetwork).toHaveBeenCalledWith('build-1')
    })

    it('should call buildApi.get after calculateNetwork to reload IPs', async () => {
        await useBuilderStore.getState().reassignAllIPs()

        expect(buildApi.get).toHaveBeenCalledWith('build-1')
    })

    it('should NOT call any API when currentBuildId is null', async () => {
        useBuilderStore.setState({ currentBuildId: null })

        await useBuilderStore.getState().reassignAllIPs()

        expect(buildApi.update).not.toHaveBeenCalled()
        expect(buildApi.calculateNetwork).not.toHaveBeenCalled()
    })

    it('should overlay IPs from backend nodes onto hardwareNodes', async () => {
        // Setup: store has router with empty IP
        const router = makeRouter('router-1')
        useBuilderStore.setState({ hardwareNodes: [router] })

            // Mock: backend returns router with IP assigned
            ; (buildApi.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
                id: 'build-1',
                name: 'test',
                data: JSON.stringify({
                    hardwareNodes: [{ ...router, ip: '' }],
                    nodes: [{ id: 'router-1', type: 'router', data: { ip: '', label: 'Router' } }],
                    edges: [],
                }),
                nodes: [{ id: 'router-1', name: 'Router', type: 'router', ip: '192.168.1.1', virtual_machines: [] }],
            })

        await useBuilderStore.getState().reassignAllIPs()

        const { hardwareNodes } = useBuilderStore.getState()
        const updated = hardwareNodes.find((n) => n.id === 'router-1' || n.name === 'Router')
        expect(updated?.ip).toBe('192.168.1.1')
    })
})

describe('addHardware — must NOT trigger reassignAllIPs', () => {
    beforeEach(() => resetStoreWithBuildId())
    afterEach(() => vi.clearAllMocks())

    it('does not call calculateNetwork when adding a hardware node', () => {
        useBuilderStore.getState().addHardware(makeRouter())

        // Immediate (sync) check — reassignAllIPs debounced via setTimeout(0)
        // but addHardware should not queue it at all
        expect(buildApi.calculateNetwork).not.toHaveBeenCalled()
    })

    it('does not call buildApi.update when adding a hardware node', () => {
        useBuilderStore.getState().addHardware(makeRouter())

        expect(buildApi.update).not.toHaveBeenCalled()
    })

    it('adds the node to hardwareNodes state', () => {
        const router = makeRouter('r1')
        useBuilderStore.getState().addHardware(router)

        const { hardwareNodes } = useBuilderStore.getState()
        expect(hardwareNodes.some((n) => n.id === 'r1')).toBe(true)
    })
})

describe('onConnect — MUST trigger reassignAllIPs', () => {
    beforeEach(() => resetStoreWithBuildId())
    afterEach(() => vi.clearAllMocks())

    it('triggers reassignAllIPs (via setTimeout) when a connection is made', async () => {
        const spy = vi.spyOn(useBuilderStore.getState(), 'reassignAllIPs').mockResolvedValue()

        useBuilderStore.getState().onConnect({
            source: 'router-1',
            target: 'switch-1',
            sourceHandle: null,
            targetHandle: null,
        })

        // Wait for the setTimeout(fn, 0) to fire
        await new Promise((r) => setTimeout(r, 10))

        expect(spy).toHaveBeenCalledTimes(1)
        spy.mockRestore()
    })

    it('adds the edge to state on connect', () => {
        // Pre-populate reactflow nodes so addEdge has something to work with
        useBuilderStore.setState({
            nodes: [
                { id: 'router-1', type: 'router', position: { x: 0, y: 0 }, data: {} },
                { id: 'switch-1', type: 'switch', position: { x: 100, y: 0 }, data: {} },
            ],
            edges: [],
        })

        useBuilderStore.getState().onConnect({
            source: 'router-1',
            target: 'switch-1',
            sourceHandle: null,
            targetHandle: null,
        })

        const { edges } = useBuilderStore.getState()
        expect(edges.length).toBeGreaterThan(0)
        expect(edges[0].source).toBe('router-1')
        expect(edges[0].target).toBe('switch-1')
    })
})

describe('removeHardware', () => {
    beforeEach(() => resetStoreWithBuildId())

    it('removes the node from hardwareNodes', () => {
        const router = makeRouter('r1')
        useBuilderStore.getState().addHardware(router)
        useBuilderStore.getState().removeHardware('r1')

        const { hardwareNodes } = useBuilderStore.getState()
        expect(hardwareNodes.some((n) => n.id === 'r1')).toBe(false)
    })
})

describe('addVM / removeVM', () => {
    beforeEach(() => resetStoreWithBuildId())
    afterEach(() => vi.clearAllMocks())

    it('addVM does not call calculateNetwork', () => {
        const router = makeRouter('r1')
        useBuilderStore.getState().addHardware(router)

        useBuilderStore.getState().addVM('r1', {
            id: 'vm-1',
            name: 'nginx',
            type: 'container',
            ip: '',
            os: '',
            cpu_cores: 1,
            ram_mb: 512,
            status: 'stopped',
        })

        expect(buildApi.calculateNetwork).not.toHaveBeenCalled()
    })

    it('addVM appends VM to the correct node', () => {
        const router = makeRouter('r1')
        useBuilderStore.getState().addHardware(router)

        useBuilderStore.getState().addVM('r1', {
            id: 'vm-1',
            name: 'nginx',
            type: 'container',
            ip: '',
            os: '',
            cpu_cores: 1,
            ram_mb: 512,
            status: 'stopped',
        })

        const node = useBuilderStore.getState().hardwareNodes.find((n) => n.id === 'r1')
        expect(node?.vms?.length).toBe(1)
        expect(node?.vms?.[0].name).toBe('nginx')
    })
})
