/**
 * builder-store.test.ts
 *
 * Tests for the three bugs fixed in builder-store.ts:
 *
 * 1. reassignAllIPs MUST call buildApi.update (save) BEFORE buildApi.calculateNetwork
 *    - if calculate runs first the backend reads stale/empty relational tables →
 *      "no router found" 500 error.
 *
 * 2. addHardware / addVM / duplicateHardware must NOT trigger reassignAllIPs
 *    - only onConnect should (prevents unnecessary API calls on every node drop).
 *
 * 3. onConnect MUST trigger reassignAllIPs so nodes get IPs when first wired up.
 *
 * Mock strategy: vi.mock buildApi so no real HTTP requests are made.
 * The store is reset before each test via zustand's setState.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Mock buildApi before imports resolve ──────────────────────────────────
vi.mock('../api/builds', () => ({
  buildApi: {
    updateTopology: vi.fn().mockResolvedValue({
      build: { id: 'build-1', name: 'test', revision: 2, nodes: [] },
      validation: { valid: true, errors: [], warnings: [] },
    }),
    calculateNetwork: vi.fn().mockResolvedValue(undefined),
    get: vi.fn().mockResolvedValue({ id: 'build-1', name: 'test', revision: 2, nodes: [] }),
    validateNetwork: vi.fn().mockResolvedValue({ valid: true, errors: [], warnings: [] }),
    create: vi.fn().mockResolvedValue({ id: 'build-1', revision: 1 }),
    list: vi.fn().mockResolvedValue([]),
    delete: vi.fn().mockResolvedValue(undefined),
  },
}));

// ─── Import AFTER mock is registered ──────────────────────────────────────
import { useBuilderStore } from './builder-store';
import { buildApi } from '../api/builds';
import type { HardwareNode } from '../../../types';

describe('virtual network persistence', () => {
  beforeEach(() => resetStoreWithBuildId());
  it('saves virtual links and removes links to a deleted VM', () => {
    vi.useFakeTimers();
    const host: HardwareNode = {
      id: 'host',
      type: 'server',
      name: 'Host',
      x: 0,
      y: 0,
      vms: [{ id: 'vm', name: 'Guest', type: 'vm', status: 'running' }],
    };
    useBuilderStore.getState().addHardware(host);
    useBuilderStore.getState().openVirtualNetwork(host.id);
    expect(
      useBuilderStore.getState().getBuildData().nodes[0].details.virtual_network.edges,
    ).toHaveLength(2);
    useBuilderStore.getState().removeVM(host.id, 'vm');
    expect(
      useBuilderStore.getState().getBuildData().nodes[0].details.virtual_network.edges,
    ).toHaveLength(1);
    useBuilderStore.getState().undo();
    expect(
      useBuilderStore.getState().getBuildData().nodes[0].details.virtual_network.edges,
    ).toHaveLength(2);
    vi.clearAllTimers();
    vi.useRealTimers();
  });
  it('clears disconnected VM addresses and preserves links edited during a save', async () => {
    useBuilderStore
      .getState()
      .addHardware({
        id: 'host',
        type: 'server',
        name: 'Host',
        x: 0,
        y: 0,
        vms: [{ id: 'vm', name: 'Guest', type: 'vm', status: 'running', ip: '192.168.1.151' }],
      });
    useBuilderStore.getState().openVirtualNetwork('host');
    const oldNetwork = useBuilderStore.getState().hardwareNodes[0].details!.virtual_network!;
    vi.mocked(buildApi.updateTopology).mockImplementationOnce(async () => {
      useBuilderStore.getState().updateVirtualNetwork('host', { ...oldNetwork, edges: [] });
      return {
        build: {
          id: 'build-1',
          revision: 3,
          nodes: [
            {
              id: 'host',
              ip: '192.168.1.150',
              virtual_machines: [{ id: 'vm', ip: '' }],
              details: { virtual_network: oldNetwork },
            },
          ],
        },
      } as any;
    });
    await useBuilderStore.getState().reassignAllIPs();
    const host = useBuilderStore.getState().hardwareNodes[0];
    expect(host.vms![0].ip).toBe('');
    expect(host.details!.virtual_network!.edges).toEqual([]);
    expect(useBuilderStore.getState().getBuildData().nodes[0].vms[0].ip).toBe('');
  });
});

// ─── Helpers ──────────────────────────────────────────────────────────────

/** Reset store to empty state and set a build ID so reassignAllIPs can work */
function resetStoreWithBuildId(id = 'build-1') {
  useBuilderStore.setState({
    currentBuildId: id,
    hardwareNodes: [],
    nodes: [],
    currentRevision: 1,
    edges: [],
    projectName: 'Test Project',
  });
  vi.clearAllMocks();
  (buildApi.updateTopology as ReturnType<typeof vi.fn>).mockReset().mockResolvedValue({
    build: { id: 'build-1', name: 'test', revision: 2, nodes: [] },
    validation: { valid: true, errors: [], warnings: [] },
  });
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
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe('reassignAllIPs', () => {
  beforeEach(() => resetStoreWithBuildId());
  afterEach(() => vi.clearAllMocks());

  it('commits save and IP calculation through one atomic endpoint', async () => {
    await useBuilderStore.getState().reassignAllIPs();

    expect(buildApi.updateTopology).toHaveBeenCalledTimes(1);
    expect(buildApi.calculateNetwork).not.toHaveBeenCalled();
    expect(buildApi.get).not.toHaveBeenCalled();
  });

  it('submits the current build ID and revision', async () => {
    await useBuilderStore.getState().reassignAllIPs();

    expect(buildApi.updateTopology).toHaveBeenCalledWith(
      'build-1',
      expect.objectContaining({ name: expect.any(String), revision: 1 }),
    );
  });

  it('advances the local revision from the committed response', async () => {
    await useBuilderStore.getState().reassignAllIPs();
    expect(useBuilderStore.getState().currentRevision).toBe(2);
  });

  it('serializes overlapping saves so each request uses the committed revision', async () => {
    let revision = 1;
    (buildApi.updateTopology as ReturnType<typeof vi.fn>).mockImplementation(
      async (_id, params) => {
        expect(params.revision).toBe(revision);
        revision += 1;
        return {
          build: { id: 'build-1', name: 'test', revision, nodes: [] },
          validation: { valid: true, errors: [], warnings: [] },
        };
      },
    );

    await Promise.all([
      useBuilderStore.getState().reassignAllIPs(),
      useBuilderStore.getState().reassignAllIPs(),
    ]);

    expect(buildApi.updateTopology).toHaveBeenCalledTimes(2);
    expect(useBuilderStore.getState().currentRevision).toBe(3);
  });

  it('does not call the API when no build is open', async () => {
    useBuilderStore.setState({ currentBuildId: null });

    await expect(useBuilderStore.getState().reassignAllIPs()).rejects.toThrow('No build is open');
    expect(buildApi.updateTopology).not.toHaveBeenCalled();
  });

  it('should overlay IPs from backend nodes onto hardwareNodes', async () => {
    // Setup: store has router with empty IP
    const router = makeRouter('router-1');
    useBuilderStore.setState({ hardwareNodes: [router] });
    (buildApi.updateTopology as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      build: {
        id: 'build-1',
        name: 'test',
        revision: 2,
        nodes: [
          {
            id: 'router-1',
            name: 'Router',
            type: 'router',
            ip: '192.168.1.1',
            virtual_machines: [],
          },
        ],
      },
      validation: { valid: true, errors: [], warnings: [] },
    });

    await useBuilderStore.getState().reassignAllIPs();

    const { hardwareNodes } = useBuilderStore.getState();
    const updated = hardwareNodes.find(n => n.id === 'router-1' || n.name === 'Router');
    expect(updated?.ip).toBe('192.168.1.1');
  });

  it('should overlay generated interface details from backend nodes', async () => {
    const server = {
      id: 'server-1',
      type: 'server_v2' as const,
      name: 'NAT Server',
      ip: '192.168.0.136',
      x: 0,
      y: 0,
      vms: [],
      internal_components: [],
      details: { nat_enabled: true, dhcp_enabled: true },
    };
    useBuilderStore.setState({
      hardwareNodes: [server],
      nodes: [
        {
          id: 'server-1',
          type: 'hardware',
          position: { x: 0, y: 0 },
          data: { type: 'server_v2', label: 'NAT Server', details: server.details },
        },
      ],
    });
    (buildApi.updateTopology as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      build: {
        id: 'build-1',
        name: 'test',
        revision: 2,
        nodes: [
          {
            id: 'server-1',
            name: 'NAT Server',
            type: 'server_v2',
            ip: '192.168.0.136',
            details: {
              nat_enabled: true,
              dhcp_enabled: true,
              wan_ip: '192.168.0.136',
              lan_gateway_ip: '192.168.1.1',
              lan_subnet: '192.168.1.1/24',
              interfaces: [
                { name: 'WAN', role: 'wan', ip: '192.168.0.136' },
                { name: 'LAN', role: 'lan', ip: '192.168.1.1', subnet: '192.168.1.1/24' },
              ],
            },
            virtual_machines: [],
          },
        ],
      },
      validation: { valid: true, errors: [], warnings: [] },
    });

    await useBuilderStore.getState().reassignAllIPs();

    const updated = useBuilderStore.getState().hardwareNodes.find(n => n.id === 'server-1');
    expect(updated?.details?.wan_ip).toBe('192.168.0.136');
    expect(updated?.details?.lan_gateway_ip).toBe('192.168.1.1');
    expect(updated?.details?.interfaces?.some(iface => iface.role === 'lan')).toBe(true);
  });
});

describe('addHardware - must NOT trigger reassignAllIPs', () => {
  beforeEach(() => resetStoreWithBuildId());
  afterEach(() => vi.clearAllMocks());

  it('does not call calculateNetwork when adding a hardware node', () => {
    useBuilderStore.getState().addHardware(makeRouter());

    // Immediate (sync) check - reassignAllIPs debounced via setTimeout(0)
    // but addHardware should not queue it at all
    expect(buildApi.calculateNetwork).not.toHaveBeenCalled();
  });

  it('does not call buildApi.updateTopology when adding a hardware node', () => {
    useBuilderStore.getState().addHardware(makeRouter());

    expect(buildApi.updateTopology).not.toHaveBeenCalled();
  });

  it('adds the node to hardwareNodes state', () => {
    const router = makeRouter('r1');
    useBuilderStore.getState().addHardware(router);

    const { hardwareNodes } = useBuilderStore.getState();
    expect(hardwareNodes.some(n => n.id === 'r1')).toBe(true);
  });
});

describe('onConnect - MUST trigger reassignAllIPs', () => {
  beforeEach(() => resetStoreWithBuildId());
  afterEach(() => vi.clearAllMocks());

  it('triggers reassignAllIPs (via setTimeout) when a connection is made', async () => {
    const spy = vi.spyOn(useBuilderStore.getState(), 'reassignAllIPs').mockResolvedValue();

    useBuilderStore.getState().onConnect({
      source: 'router-1',
      target: 'switch-1',
      sourceHandle: null,
      targetHandle: null,
    });

    // Wait for the setTimeout(fn, 0) to fire
    await new Promise(r => setTimeout(r, 10));

    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('adds the edge to state on connect', () => {
    // Pre-populate reactflow nodes so addEdge has something to work with
    useBuilderStore.setState({
      nodes: [
        { id: 'router-1', type: 'router', position: { x: 0, y: 0 }, data: {} },
        { id: 'switch-1', type: 'switch', position: { x: 100, y: 0 }, data: {} },
      ],
      edges: [],
    });

    useBuilderStore.getState().onConnect({
      source: 'router-1',
      target: 'switch-1',
      sourceHandle: null,
      targetHandle: null,
    });

    const { edges } = useBuilderStore.getState();
    expect(edges.length).toBeGreaterThan(0);
    expect(edges[0].source).toBe('router-1');
    expect(edges[0].target).toBe('switch-1');
  });

  it('defaults any access point connection to wireless', () => {
    useBuilderStore.setState({
      nodes: [
        { id: 'ap-1', type: 'hardware', position: { x: 0, y: 0 }, data: { type: 'access_point' } },
        { id: 'pc-1', type: 'hardware', position: { x: 100, y: 0 }, data: { type: 'pc' } },
      ],
      hardwareNodes: [
        {
          id: 'ap-1',
          type: 'access_point',
          name: 'Access Point',
          ip: '',
          x: 0,
          y: 0,
          vms: [],
          internal_components: [],
          details: {},
        },
        {
          id: 'pc-1',
          type: 'pc',
          name: 'PC',
          ip: '',
          x: 100,
          y: 0,
          vms: [],
          internal_components: [],
          details: {},
        },
      ],
      edges: [],
    });

    useBuilderStore.getState().onConnect({
      source: 'ap-1',
      target: 'pc-1',
      sourceHandle: null,
      targetHandle: null,
    });

    const { edges } = useBuilderStore.getState();
    expect(edges[0].data?.connection_type).toBe('wireless');
    expect(edges[0].data?.wireless_standard).toBe('Wi-Fi 6');
  });
});

describe('removeHardware', () => {
  beforeEach(() => resetStoreWithBuildId());

  it('removes the node from hardwareNodes', () => {
    const router = makeRouter('r1');
    useBuilderStore.getState().addHardware(router);
    useBuilderStore.getState().removeHardware('r1');

    const { hardwareNodes } = useBuilderStore.getState();
    expect(hardwareNodes.some(n => n.id === 'r1')).toBe(false);
  });
});

describe('getBuildData edge sanitization', () => {
  beforeEach(() => resetStoreWithBuildId());

  it('filters out edges that reference missing node IDs', () => {
    useBuilderStore.setState({
      nodes: [
        {
          id: 'router-1',
          type: 'hardware',
          position: { x: 0, y: 0 },
          data: { type: 'router', name: 'Router' },
        },
      ],
      edges: [
        {
          id: 'valid-edge',
          source: 'router-1',
          target: 'router-1',
          type: 'custom',
          data: { speed: '1 GbE', subnet: '' },
        },
        {
          id: 'dangling-edge',
          source: 'router-1',
          target: 'missing-node',
          type: 'custom',
          data: { speed: '10 GbE', subnet: 'VLAN 10' },
        },
      ] as any,
    });

    const payload = useBuilderStore.getState().getBuildData();
    expect(payload.edges).toHaveLength(1);
    expect(payload.edges[0].source).toBe('router-1');
    expect(payload.edges[0].target).toBe('router-1');
  });

  it('serializes edge connection metadata', () => {
    useBuilderStore.setState({
      nodes: [
        {
          id: 'router-1',
          type: 'hardware',
          position: { x: 0, y: 0 },
          data: { type: 'router', name: 'Router' },
        },
        {
          id: 'ap-1',
          type: 'hardware',
          position: { x: 100, y: 0 },
          data: { type: 'access_point', name: 'AP' },
        },
      ],
      edges: [
        {
          id: 'wireless-edge',
          source: 'router-1',
          target: 'ap-1',
          type: 'custom',
          data: {
            connection_type: 'wireless',
            wireless_standard: 'Wi-Fi 6',
            direction: 'lan',
            speed: '1 GbE',
            subnet: 'VLAN 20',
          },
        },
      ] as any,
    });

    const payload = useBuilderStore.getState().getBuildData();
    expect(payload.edges[0]).toEqual(
      expect.objectContaining({
        type: 'wireless',
        wireless_standard: 'Wi-Fi 6',
        direction: 'lan',
        subnet: 'VLAN 20',
      }),
    );
  });
});

describe('addVM / removeVM', () => {
  beforeEach(() => resetStoreWithBuildId());
  afterEach(() => vi.clearAllMocks());

  it('addVM does not call calculateNetwork', () => {
    const router = makeRouter('r1');
    useBuilderStore.getState().addHardware(router);

    useBuilderStore.getState().addVM('r1', {
      id: 'vm-1',
      name: 'nginx',
      type: 'container',
      ip: '',
      os: '',
      cpu_cores: 1,
      ram_mb: 512,
      status: 'stopped',
    });

    expect(buildApi.calculateNetwork).not.toHaveBeenCalled();
  });

  it('addVM appends VM to the correct node', () => {
    const router = makeRouter('r1');
    useBuilderStore.getState().addHardware(router);

    useBuilderStore.getState().addVM('r1', {
      id: 'vm-1',
      name: 'nginx',
      type: 'container',
      ip: '',
      os: '',
      cpu_cores: 1,
      ram_mb: 512,
      status: 'stopped',
    });

    const node = useBuilderStore.getState().hardwareNodes.find(n => n.id === 'r1');
    expect(node?.vms?.length).toBe(1);
    expect(node?.vms?.[0].name).toBe('nginx');
  });
});
