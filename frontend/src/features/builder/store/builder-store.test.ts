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
import { BuildConflictError, useBuilderStore } from './builder-store';
import { buildApi } from '../api/builds';
import { ApiError } from '../../../lib/api';
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

  it('adopts the committed build after a revision conflict so the next save succeeds', async () => {
    const latest = {
      id: 'build-1',
      name: 'Renamed elsewhere',
      revision: 7,
      nodes: [{ id: 'router-1', type: 'router', name: 'Router', ip: '192.168.1.1' }],
      edges: [],
    };
    vi.mocked(buildApi.updateTopology).mockRejectedValueOnce(
      new ApiError(409, 'UNKNOWN', 'build revision conflict: expected 7, received 1', {
        error: 'build revision conflict: expected 7, received 1',
        build: latest,
      }),
    );

    await expect(useBuilderStore.getState().reassignAllIPs()).rejects.toBeInstanceOf(
      BuildConflictError,
    );
    const state = useBuilderStore.getState();
    expect(state.currentRevision).toBe(7);
    expect(state.projectName).toBe('Renamed elsewhere');
    expect(state.hardwareNodes.map(n => n.id)).toEqual(['router-1']);

    await useBuilderStore.getState().reassignAllIPs();
    expect(buildApi.updateTopology).toHaveBeenLastCalledWith(
      'build-1',
      expect.objectContaining({ revision: 7 }),
    );
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

describe('openBuild', () => {
  beforeEach(() => resetStoreWithBuildId());

  it('loads the server revision even when the build is already open', async () => {
    useBuilderStore.setState({ currentRevision: 3 });
    vi.mocked(buildApi.get).mockResolvedValueOnce({
      id: 'build-1',
      name: 'Renamed',
      revision: 4,
      nodes: [],
      edges: [],
    } as any);

    await useBuilderStore.getState().openBuild('build-1');

    expect(useBuilderStore.getState().currentRevision).toBe(4);
    expect(useBuilderStore.getState().projectName).toBe('Renamed');
  });

  it('sends back settings keys it does not manage itself', () => {
    // A save replaces the whole settings object on the server, so a key written
    // elsewhere (the Guided Planner's answers) must survive a load and a save.
    useBuilderStore.getState().loadBuild('build-1', 'Planned', {
      id: 'build-1',
      name: 'Planned',
      revision: 1,
      nodes: [],
      edges: [],
      settings: { planner: { goals: ['media'] }, showBought: true, boughtItems: ['Router'] },
    } as any);

    const state = useBuilderStore.getState();
    expect(state.getBuildData().settings).toEqual({
      planner: { goals: ['media'] },
      showBought: true,
      boughtItems: ['Router'],
    });
    // Loading must not look like an unsaved change, or the autosave would loop.
    expect(state.hasUnsavedChanges()).toBe(false);

    state.markAsBought('Switch');
    expect(useBuilderStore.getState().getBuildData().settings).toEqual({
      planner: { goals: ['media'] },
      showBought: true,
      boughtItems: ['Router', 'Switch'],
    });
    expect(useBuilderStore.getState().hasUnsavedChanges()).toBe(true);
  });

  it('keeps the kind and the gaming plan of a build across load and save', () => {
    const plan = {
      uplink: { down_mbps: 300, up_mbps: 30, cgnat: 'no', public_host: 'play.example.org' },
      power: { mains_voltage: 230, circuits: [{ id: 'c1', label: 'Hall', breaker_amps: 16 }] },
      event: { date: '2026-11-14', hours: 24 },
    };
    useBuilderStore.getState().loadBuild('build-1', 'Party', {
      id: 'build-1',
      name: 'Party',
      kind: 'lan_party',
      gaming_plan: plan,
      revision: 1,
      nodes: [],
      edges: [],
      settings: {},
    } as any);

    const data = useBuilderStore.getState().getBuildData();
    expect(data.kind).toBe('lan_party');
    expect(data.gaming_plan).toEqual(plan);
    expect(useBuilderStore.getState().hasUnsavedChanges()).toBe(false);

    // Editing the plan is a change the autosave has to pick up.
    useBuilderStore.getState().setGamingPlan({
      ...plan,
      uplink: { ...plan.uplink, up_mbps: 50 },
    } as any);
    expect(useBuilderStore.getState().hasUnsavedChanges()).toBe(true);
    expect(useBuilderStore.getState().getBuildData().gaming_plan.uplink.up_mbps).toBe(50);
  });

  it('does not send a plan for a build that never had one', () => {
    // Builds saved before 1.3 come back without a kind and with an empty plan.
    useBuilderStore.getState().loadBuild('build-1', 'Lab', {
      id: 'build-1',
      name: 'Lab',
      gaming_plan: {},
      revision: 1,
      nodes: [],
      edges: [],
      settings: {},
    } as any);

    const data = useBuilderStore.getState().getBuildData();
    expect(data.kind).toBe('homelab');
    expect(data).not.toHaveProperty('gaming_plan');
    expect(useBuilderStore.getState().hasUnsavedChanges()).toBe(false);

    useBuilderStore.getState().setBuildKind('game_server');
    expect(useBuilderStore.getState().getBuildData().kind).toBe('game_server');
    expect(useBuilderStore.getState().hasUnsavedChanges()).toBe(true);
  });

  it('forgets the settings of the previous build when the builder is closed', () => {
    useBuilderStore.getState().loadBuild('build-1', 'Planned', {
      id: 'build-1',
      name: 'Planned',
      revision: 1,
      nodes: [],
      edges: [],
      settings: { planner: { goals: ['media'] } },
    } as any);

    useBuilderStore.getState().clearCurrentBuild();

    expect(useBuilderStore.getState().getBuildData().settings).not.toHaveProperty('planner');
  });

  it('waits for a pending save before reading the build', async () => {
    let finishSave!: () => void;
    vi.mocked(buildApi.updateTopology).mockImplementationOnce(
      () =>
        new Promise(resolve => {
          finishSave = () =>
            resolve({ build: { id: 'build-1', name: 'test', revision: 2, nodes: [] } as any });
        }),
    );
    vi.mocked(buildApi.get).mockResolvedValueOnce({
      id: 'build-1',
      name: 'test',
      revision: 2,
      nodes: [],
      edges: [],
    } as any);

    const save = useBuilderStore.getState().reassignAllIPs();
    const open = useBuilderStore.getState().openBuild('build-1');
    await Promise.resolve();
    expect(buildApi.get).not.toHaveBeenCalled();

    finishSave();
    await Promise.all([save, open]);
    expect(buildApi.get).toHaveBeenCalledTimes(1);
    expect(useBuilderStore.getState().currentRevision).toBe(2);
  });
});

describe('gaming nodes', () => {
  beforeEach(() => resetStoreWithBuildId());

  const place = (id: string, type: HardwareNode['type'], extra: Partial<HardwareNode> = {}) =>
    useBuilderStore.getState().addHardware({ id, type, name: id, x: 0, y: 0, ...extra });

  it('gives a new LAN table its seats, switch and power figure', () => {
    place('table', 'lan_table', { name: 'New lan_table' });

    const table = useBuilderStore.getState().hardwareNodes[0];
    expect(table.name).toBe('LAN Table');
    expect(table.details).toMatchObject({ seats: 8, seat_watts: 350, switch_ports: 16 });
    expect(table.power_draw).toBe(8 * 350 + 10);
    // What is saved is what the card shows.
    expect(useBuilderStore.getState().getBuildData().nodes[0]).toMatchObject({
      type: 'lan_table',
      power_draw: 2810,
      details: { seats: 8 },
    });
  });

  it('keeps a table that already has its details as it is', () => {
    place('table', 'lan_table', {
      details: { seats: 12, seat_watts: 400, switch_ports: 16 },
      power_draw: 4810,
    });
    const table = useBuilderStore.getState().hardwareNodes[0];
    expect(table.details?.seats).toBe(12);
    expect(table.power_draw).toBe(4810);
  });

  it('draws a client on an access point as a Wi-Fi link and a table as a cable', async () => {
    place('ap', 'access_point');
    place('deck', 'console');
    place('switch', 'switch');
    place('table', 'lan_table');
    const save = vi.spyOn(useBuilderStore.getState(), 'reassignAllIPs').mockResolvedValue();

    useBuilderStore
      .getState()
      .onConnect({ source: 'ap', target: 'deck', sourceHandle: 'eth0', targetHandle: 'target-0' });
    useBuilderStore.getState().onConnect({
      source: 'switch',
      target: 'table',
      sourceHandle: 'eth0',
      targetHandle: 'target-0',
    });

    const [wifi, cable] = useBuilderStore.getState().edges;
    expect(wifi.data).toMatchObject({ connection_type: 'wireless', wireless_standard: 'Wi-Fi 6' });
    expect(cable.data).toMatchObject({ connection_type: 'ethernet', wireless_standard: '' });

    // The medium of those two links is not a choice.
    useBuilderStore
      .getState()
      .updateEdge(wifi.id, { data: { ...wifi.data, connection_type: 'ethernet' } });
    useBuilderStore
      .getState()
      .updateEdge(cable.id, { data: { ...cable.data, connection_type: 'wireless' } });
    const [wifiAfter, cableAfter] = useBuilderStore.getState().edges;
    expect(wifiAfter.data?.connection_type).toBe('wireless');
    expect(cableAfter.data?.connection_type).toBe('ethernet');
    // Other fields of the same update still go through.
    useBuilderStore
      .getState()
      .updateEdge(cable.id, { data: { ...cableAfter.data, speed: '2.5 GbE' } });
    expect(useBuilderStore.getState().edges[1].data?.speed).toBe('2.5 GbE');

    // Let the saves that onConnect schedules run against the mock before it is removed.
    await new Promise(resolve => setTimeout(resolve, 10));
    save.mockRestore();
  });

  it('drops a DHCP pool the server no longer reports', async () => {
    place('router-1', 'router', {
      details: { dhcp_enabled: false, dhcp_pool: { start: 'a', end: 'b', size: 86, clients: 0 } },
    });
    vi.mocked(buildApi.updateTopology).mockResolvedValueOnce({
      build: {
        id: 'build-1',
        name: 'test',
        revision: 2,
        nodes: [{ id: 'router-1', ip: '192.168.1.1', details: { dhcp_enabled: false } }],
      },
    } as any);

    await useBuilderStore.getState().reassignAllIPs();

    const router = useBuilderStore.getState().hardwareNodes[0];
    expect(router.details).not.toHaveProperty('dhcp_pool');
    expect(router.details?.dhcp_enabled).toBe(false);
    expect(useBuilderStore.getState().getBuildData().nodes[0].details).not.toHaveProperty(
      'dhcp_pool',
    );
  });

  it('shows the DHCP pool the server calculated', async () => {
    place('router-1', 'router', { details: { dhcp_enabled: true } });
    const pool = { start: '192.168.1.50', end: '192.168.1.149', size: 100, clients: 80 };
    vi.mocked(buildApi.updateTopology).mockResolvedValueOnce({
      build: {
        id: 'build-1',
        name: 'test',
        revision: 2,
        nodes: [
          { id: 'router-1', ip: '192.168.1.1', details: { dhcp_enabled: true, dhcp_pool: pool } },
        ],
      },
    } as any);

    await useBuilderStore.getState().reassignAllIPs();

    expect(useBuilderStore.getState().hardwareNodes[0].details?.dhcp_pool).toEqual(pool);
    // A calculated value coming back is not an edit to save again.
    expect(useBuilderStore.getState().hasUnsavedChanges()).toBe(false);
  });
});

describe('duplicateHardware', () => {
  beforeEach(() => resetStoreWithBuildId());

  it('gives copied internal components their own IDs', () => {
    useBuilderStore.getState().addHardware({
      ...makeRouter('server-1'),
      type: 'server',
      internal_components: [{ id: 'disk-1', type: 'disk', name: 'SSD' }],
    });

    useBuilderStore.getState().duplicateHardware('server-1');

    const [original, copy] = useBuilderStore.getState().hardwareNodes;
    expect(copy.internal_components).toHaveLength(1);
    expect(copy.internal_components![0].id).not.toBe(original.internal_components![0].id);
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
