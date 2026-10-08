/**
 * builder-store.test.ts
 *
 * The builder store against a mocked build API:
 *
 * - reassignAllIPs saves through the one atomic topology endpoint and takes the
 *   addresses and details the server calculated back onto the canvas.
 * - Adding devices or guests does not save by itself; connecting them does.
 * - Loading a build keeps its settings, kind and plan, and is not an unsaved change.
 * - Save state, save conflicts, and what getBuildData sends.
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
    get: vi.fn().mockResolvedValue({ id: 'build-1', name: 'test', revision: 2, nodes: [] }),
    validateNetwork: vi.fn().mockResolvedValue({ valid: true, errors: [], warnings: [] }),
    create: vi.fn().mockResolvedValue({ id: 'build-1', revision: 1 }),
    list: vi.fn().mockResolvedValue([]),
    delete: vi.fn().mockResolvedValue(undefined),
  },
}));

// ─── Import AFTER mock is registered ──────────────────────────────────────
import { BuildConflictError, useBuilderStore } from './builder-store';
import { buildApi, type Build } from '../api/builds';
import { ApiError } from '../../../lib/api';
import type { GamingPlan, HardwareNode } from '../../../types';

/** A build as the server returns it, with the fields a test cares about. */
function serverBuild(fields: Partial<Build>): Build {
  return {
    id: 'build-1',
    user_id: 'user-1',
    name: 'test',
    revision: 1,
    created_at: '',
    updated_at: '',
    ...fields,
  };
}

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
      useBuilderStore.getState().getBuildData().nodes[0].details.virtual_network!.edges,
    ).toHaveLength(2);
    useBuilderStore.getState().removeVM(host.id, 'vm');
    expect(
      useBuilderStore.getState().getBuildData().nodes[0].details.virtual_network!.edges,
    ).toHaveLength(1);
    useBuilderStore.getState().undo();
    expect(
      useBuilderStore.getState().getBuildData().nodes[0].details.virtual_network!.edges,
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
        build: serverBuild({
          revision: 3,
          nodes: [
            {
              id: 'host',
              type: 'server',
              name: 'Host',
              ip: '192.168.1.150',
              virtual_machines: [
                { id: 'vm', name: 'Guest', type: 'vm', status: 'running', ip: '' },
              ],
              details: { virtual_network: oldNetwork },
            },
          ],
        }),
      };
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
  useBuilderStore.getState().clearCurrentBuild();
  useBuilderStore.setState({
    currentBuildId: id,
    // The graph in the store is this build's: only then may it be saved.
    buildStatus: 'ready',
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
    vi.mocked(buildApi.get).mockResolvedValueOnce(
      serverBuild({ name: 'Renamed', revision: 4, nodes: [], edges: [] }),
    );

    await useBuilderStore.getState().openBuild('build-1');

    expect(useBuilderStore.getState().currentRevision).toBe(4);
    expect(useBuilderStore.getState().projectName).toBe('Renamed');
  });

  it('sends back loaded settings unchanged, keys it does not manage included', () => {
    // A save replaces the whole settings object on the server, so the Guided
    // Planner's answers and keys older versions wrote must survive a load and a save.
    const settings = { planner: { goals: ['media'] }, boughtItems: ['Router'] };
    useBuilderStore
      .getState()
      .loadBuild(
        'build-1',
        'Planned',
        serverBuild({ name: 'Planned', nodes: [], edges: [], settings }),
      );

    const state = useBuilderStore.getState();
    expect(state.getBuildData().settings).toEqual({
      planner: { goals: ['media'] },
      boughtItems: ['Router'],
    });
    // Loading must not look like an unsaved change, or the autosave would loop.
    expect(state.hasUnsavedChanges()).toBe(false);
  });

  it('keeps the kind and the gaming plan of a build across load and save', () => {
    const plan: GamingPlan = {
      uplink: { down_mbps: 300, up_mbps: 30, cgnat: 'no', public_host: 'play.example.org' },
      power: { mains_voltage: 230, circuits: [{ id: 'c1', label: 'Hall', breaker_amps: 16 }] },
      event: { date: '2026-11-14', hours: 24 },
    };
    useBuilderStore.getState().loadBuild(
      'build-1',
      'Party',
      serverBuild({
        name: 'Party',
        kind: 'lan_party',
        gaming_plan: plan,
        nodes: [],
        edges: [],
        settings: {},
      }),
    );

    const data = useBuilderStore.getState().getBuildData();
    expect(data.kind).toBe('lan_party');
    expect(data.gaming_plan).toEqual(plan);
    expect(useBuilderStore.getState().hasUnsavedChanges()).toBe(false);

    // Editing the plan is a change the autosave has to pick up.
    useBuilderStore.getState().setGamingPlan({
      ...plan,
      uplink: { ...plan.uplink, up_mbps: 50 },
    });
    expect(useBuilderStore.getState().hasUnsavedChanges()).toBe(true);
    expect(useBuilderStore.getState().getBuildData().gaming_plan!.uplink!.up_mbps).toBe(50);
  });

  it('does not send a plan for a build that never had one', () => {
    // Builds saved before 1.3 come back without a kind and with an empty plan.
    useBuilderStore
      .getState()
      .loadBuild(
        'build-1',
        'Lab',
        serverBuild({ name: 'Lab', gaming_plan: {}, nodes: [], edges: [], settings: {} }),
      );

    const data = useBuilderStore.getState().getBuildData();
    expect(data.kind).toBe('homelab');
    expect(data).not.toHaveProperty('gaming_plan');
    expect(useBuilderStore.getState().hasUnsavedChanges()).toBe(false);

    useBuilderStore.getState().setBuildKind('game_server');
    expect(useBuilderStore.getState().getBuildData().kind).toBe('game_server');
    expect(useBuilderStore.getState().hasUnsavedChanges()).toBe(true);
  });

  it('forgets the settings of the previous build when the builder is closed', () => {
    useBuilderStore.getState().loadBuild(
      'build-1',
      'Planned',
      serverBuild({
        name: 'Planned',
        nodes: [],
        edges: [],
        settings: { planner: { goals: ['media'] } },
      }),
    );

    useBuilderStore.getState().clearCurrentBuild();

    expect(useBuilderStore.getState().getBuildData().settings).not.toHaveProperty('planner');
  });

  it('waits for a pending save before reading the build', async () => {
    let finishSave!: () => void;
    vi.mocked(buildApi.updateTopology).mockImplementationOnce(
      () =>
        new Promise(resolve => {
          finishSave = () => resolve({ build: serverBuild({ revision: 2, nodes: [] }) });
        }),
    );
    vi.mocked(buildApi.get).mockResolvedValueOnce(
      serverBuild({ revision: 2, nodes: [], edges: [] }),
    );

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
      build: serverBuild({
        revision: 2,
        nodes: [
          {
            id: 'router-1',
            type: 'router',
            name: 'router-1',
            ip: '192.168.1.1',
            details: { dhcp_enabled: false },
          },
        ],
      }),
    });

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
      build: serverBuild({
        revision: 2,
        nodes: [
          {
            id: 'router-1',
            type: 'router',
            name: 'router-1',
            ip: '192.168.1.1',
            details: { dhcp_enabled: true, dhcp_pool: pool },
          },
        ],
      }),
    });

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
      ],
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
      ],
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

  it('addVM does not save', () => {
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

    expect(buildApi.updateTopology).not.toHaveBeenCalled();
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

describe('the open project across reloads', () => {
  beforeEach(() => resetStoreWithBuildId());

  const lab = (extra: Partial<Build> = {}) =>
    serverBuild({
      name: 'Garage Lab',
      revision: 4,
      nodes: [
        { id: 'r1', type: 'router', name: 'Router', x: 0, y: 0 },
        { id: 's1', type: 'switch', name: 'Switch', x: 0, y: 200 },
      ],
      edges: [],
      settings: {},
      ...extra,
    });

  it('remembers which project is open, not its canvas', () => {
    useBuilderStore.getState().loadBuild('build-1', 'Garage Lab', lab({ kind: 'lan_party' }));

    const stored = JSON.parse(localStorage.getItem('hlb-workspace') ?? '{}');
    expect(stored.state).toEqual({
      currentBuildId: 'build-1',
      projectName: 'Garage Lab',
      buildKind: 'lan_party',
    });
  });

  it('never saves a project whose canvas has not been loaded', async () => {
    // After a page reload the id is back but the canvas is not. Saving now
    // would store an empty build over the real one.
    useBuilderStore.setState({ buildStatus: 'idle', nodes: [], hardwareNodes: [], edges: [] });

    expect(useBuilderStore.getState().hasUnsavedChanges()).toBe(false);
    await expect(useBuilderStore.getState().reassignAllIPs()).rejects.toThrow('No build is open');
    expect(buildApi.updateTopology).not.toHaveBeenCalled();
  });

  it('clears the previous canvas before another project arrives', async () => {
    useBuilderStore.getState().addHardware(makeRouter('old-router'));
    let arrive!: (build: Build) => void;
    vi.mocked(buildApi.get).mockImplementationOnce(
      () => new Promise<Build>(resolve => (arrive = resolve)),
    );

    const opening = useBuilderStore.getState().openBuild('build-2');
    await vi.waitFor(() => expect(buildApi.get).toHaveBeenCalledWith('build-2'));

    // Nothing of the old project is left to be shown, or saved, under the new id.
    let state = useBuilderStore.getState();
    expect(state.currentBuildId).toBe('build-2');
    expect(state.buildStatus).toBe('loading');
    expect(state.nodes).toEqual([]);
    expect(state.hardwareNodes).toEqual([]);
    expect(state.hasUnsavedChanges()).toBe(false);

    arrive(
      serverBuild({ id: 'build-2', name: 'Other', revision: 9, nodes: [], edges: [], settings: {} }),
    );
    await opening;
    state = useBuilderStore.getState();
    expect(state.buildStatus).toBe('ready');
    expect(state.currentRevision).toBe(9);
    expect(state.projectName).toBe('Other');
  });

  it('marks the project as failed when it cannot be fetched', async () => {
    vi.mocked(buildApi.get).mockRejectedValueOnce(new ApiError(500, 'UNKNOWN', 'boom'));

    await expect(useBuilderStore.getState().openBuild('build-2')).rejects.toBeInstanceOf(ApiError);
    expect(useBuilderStore.getState().buildStatus).toBe('error');
  });

  it('keeps measured sizes and the selection when the same build is loaded again', () => {
    useBuilderStore.getState().loadBuild('build-1', 'Garage Lab', lab());
    // React Flow reports what it measured through node changes.
    useBuilderStore
      .getState()
      .onNodesChange([{ id: 'r1', type: 'dimensions', dimensions: { width: 220, height: 96 } }]);
    useBuilderStore.getState().selectNode('r1');

    // The same build one revision later, as a sync or an applied proposal delivers it.
    useBuilderStore.getState().loadBuild('build-1', 'Garage Lab', lab({ revision: 5 }));

    const state = useBuilderStore.getState();
    expect(state.nodes.find(node => node.id === 'r1')?.measured).toEqual({ width: 220, height: 96 });
    expect(state.selectedNodeId).toBe('r1');
    expect(state.hasUnsavedChanges()).toBe(false);
  });

  it('drops the selection of a device that is gone, and old sizes for another build', () => {
    useBuilderStore.getState().loadBuild('build-1', 'Garage Lab', lab());
    useBuilderStore
      .getState()
      .onNodesChange([{ id: 'r1', type: 'dimensions', dimensions: { width: 220, height: 96 } }]);
    useBuilderStore.getState().selectNode('s1');

    const withoutSwitch = lab({ revision: 5 });
    withoutSwitch.nodes = [withoutSwitch.nodes![0]];
    useBuilderStore.getState().loadBuild('build-1', 'Garage Lab', withoutSwitch);
    expect(useBuilderStore.getState().selectedNodeId).toBeNull();

    // Another project that happens to reuse an id starts unmeasured.
    useBuilderStore.getState().loadBuild('build-2', 'Other', lab({ id: 'build-2' }));
    expect(useBuilderStore.getState().nodes[0].measured).toBeUndefined();
  });

  it('forgets issues that were found for an earlier state of the build', () => {
    useBuilderStore.setState({
      validationIssues: [{ node_id: 'r1', message: 'stale', type: 'error' }],
    });
    useBuilderStore.getState().loadBuild('build-1', 'Garage Lab', lab());
    expect(useBuilderStore.getState().validationIssues).toEqual([]);
  });
});

describe('save state', () => {
  // A failed save is logged for whoever debugs it; these tests fail saves on purpose.
  afterEach(() => vi.restoreAllMocks());
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    resetStoreWithBuildId();
    useBuilderStore
      .getState()
      .loadBuild(
        'build-1',
        'Lab',
        serverBuild({ name: 'Lab', nodes: [], edges: [], settings: {} }),
      );
  });

  it('is unsaved as soon as the canvas differs and saved again after the save', async () => {
    expect(useBuilderStore.getState().saveState).toBe('saved');

    useBuilderStore.getState().addHardware(makeRouter());
    expect(useBuilderStore.getState().refreshSaveState()).toBe(true);
    expect(useBuilderStore.getState().saveState).toBe('unsaved');

    await useBuilderStore.getState().reassignAllIPs();
    const state = useBuilderStore.getState();
    expect(state.saveState).toBe('saved');
    expect(state.lastSavedAt).toEqual(expect.any(Number));
    expect(state.refreshSaveState()).toBe(false);
  });

  it('shows the reason when the server refuses the canvas', async () => {
    const reason = 'invalid topology: a LAN table needs one cabled uplink';
    vi.mocked(buildApi.updateTopology).mockRejectedValueOnce(new ApiError(422, 'UNKNOWN', reason));
    useBuilderStore.getState().addHardware(makeRouter());

    await expect(useBuilderStore.getState().reassignAllIPs()).rejects.toBeInstanceOf(ApiError);
    expect(useBuilderStore.getState().saveState).toBe('error');
    expect(useBuilderStore.getState().saveError).toBe(reason);
  });

  it('stays failed until the canvas is in sync again', async () => {
    vi.mocked(buildApi.updateTopology).mockRejectedValueOnce(new TypeError('Failed to fetch'));
    useBuilderStore.getState().addHardware(makeRouter());

    await expect(useBuilderStore.getState().reassignAllIPs()).rejects.toBeInstanceOf(TypeError);
    expect(useBuilderStore.getState().saveState).toBe('error');
    expect(useBuilderStore.getState().saveError).toBe('The server could not be reached.');
    // Another look at the canvas does not turn a failed save into a merely pending one.
    useBuilderStore.getState().refreshSaveState();
    expect(useBuilderStore.getState().saveState).toBe('error');

    await useBuilderStore.getState().reassignAllIPs();
    expect(useBuilderStore.getState().saveState).toBe('saved');
    expect(useBuilderStore.getState().saveError).toBeNull();
  });
});

describe('save conflicts', () => {
  afterEach(() => vi.restoreAllMocks());
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    resetStoreWithBuildId();
  });

  const refusal = (build?: unknown) =>
    new ApiError(409, 'UNKNOWN', 'build revision conflict', {
      error: 'build revision conflict',
      ...(build ? { build } : {}),
    });

  it('keeps the canvas as it was here one undo step away', async () => {
    useBuilderStore.getState().addHardware(makeRouter('mine'));
    vi.mocked(buildApi.updateTopology).mockRejectedValueOnce(
      refusal({
        id: 'build-1',
        name: 'Renamed elsewhere',
        revision: 7,
        nodes: [{ id: 'theirs', type: 'switch', name: 'Their switch', x: 0, y: 0 }],
        edges: [],
      }),
    );

    await expect(useBuilderStore.getState().reassignAllIPs()).rejects.toBeInstanceOf(
      BuildConflictError,
    );
    expect(useBuilderStore.getState().hardwareNodes.map(node => node.id)).toEqual(['theirs']);
    expect(useBuilderStore.getState().saveState).toBe('saved');

    useBuilderStore.getState().undo();
    const state = useBuilderStore.getState();
    expect(state.hardwareNodes.map(node => node.id)).toEqual(['mine']);
    // The canvas comes back; a rename made elsewhere is not undone with it.
    expect(state.projectName).toBe('Renamed elsewhere');
    // The server's revision stays, so saving the restored canvas goes through.
    expect(state.currentRevision).toBe(7);
    expect(state.hasUnsavedChanges()).toBe(true);
  });

  it('carries on from its own save when only the answer was lost', async () => {
    useBuilderStore.getState().addHardware(makeRouter('router-1'));
    // The save reaches the server, but its answer never comes back.
    vi.mocked(buildApi.updateTopology).mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(useBuilderStore.getState().reassignAllIPs()).rejects.toBeInstanceOf(TypeError);

    // An edit made after that must not be thrown away as "changed elsewhere".
    useBuilderStore
      .getState()
      .addHardware({ ...makeRouter('switch-1'), type: 'switch', name: 'Switch' });
    vi.mocked(buildApi.updateTopology)
      .mockRejectedValueOnce(
        refusal({
          id: 'build-1',
          name: 'Test Project',
          kind: 'homelab',
          revision: 2,
          // What we sent, with the address the server calculated.
          nodes: [{ id: 'router-1', type: 'router', name: 'Router', x: 0, y: 0, ip: '192.168.1.1' }],
          edges: [],
        }),
      )
      .mockResolvedValueOnce({
        build: serverBuild({ name: 'Test Project', revision: 3, nodes: [] }),
      });

    await useBuilderStore.getState().reassignAllIPs();

    const state = useBuilderStore.getState();
    expect(state.hardwareNodes.map(node => node.id)).toEqual(['router-1', 'switch-1']);
    expect(state.currentRevision).toBe(3);
    expect(buildApi.updateTopology).toHaveBeenLastCalledWith(
      'build-1',
      expect.objectContaining({ revision: 2 }),
    );
  });

  it('does not mistake a real change for its own lost save', async () => {
    useBuilderStore.getState().addHardware(makeRouter('router-1'));
    vi.mocked(buildApi.updateTopology).mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(useBuilderStore.getState().reassignAllIPs()).rejects.toBeInstanceOf(TypeError);

    // One revision on, but the server holds something we never sent.
    vi.mocked(buildApi.updateTopology).mockRejectedValueOnce(
      refusal({
        id: 'build-1',
        name: 'Test Project',
        revision: 2,
        nodes: [{ id: 'someone-elses', type: 'nas', name: 'NAS', x: 0, y: 0 }],
        edges: [],
      }),
    );

    await expect(useBuilderStore.getState().reassignAllIPs()).rejects.toBeInstanceOf(
      BuildConflictError,
    );
    expect(useBuilderStore.getState().hardwareNodes.map(node => node.id)).toEqual([
      'someone-elses',
    ]);
  });

  it('fetches the latest build itself when the refusal does not carry it', async () => {
    vi.mocked(buildApi.updateTopology).mockRejectedValueOnce(refusal());
    vi.mocked(buildApi.get).mockResolvedValueOnce(
      serverBuild({ name: 'Latest', revision: 5, nodes: [], edges: [] }),
    );

    await expect(useBuilderStore.getState().reassignAllIPs()).rejects.toBeInstanceOf(
      BuildConflictError,
    );
    expect(useBuilderStore.getState().currentRevision).toBe(5);
    expect(useBuilderStore.getState().projectName).toBe('Latest');
  });
});

describe('one list of devices', () => {
  beforeEach(() => resetStoreWithBuildId());

  const place = (id: string, type: HardwareNode['type'], extra: Partial<HardwareNode> = {}) =>
    useBuilderStore.getState().addHardware({ id, type, name: id, x: 0, y: 0, ...extra });

  it('follows a delete on the canvas, with what sat in a deleted rack and their cables', () => {
    place('rack', 'rack');
    place('server', 'server_v2', { parent_id: 'rack' });
    place('switch', 'switch');
    place('pc', 'pc');
    place('nas', 'nas');
    useBuilderStore.setState({
      edges: [
        { id: 'e1', source: 'switch', target: 'server' },
        { id: 'e2', source: 'switch', target: 'pc' },
        { id: 'e3', source: 'switch', target: 'nas' },
      ],
      selectedNodeId: 'pc',
    });

    // Deleting a selection arrives from React Flow as several removals at once.
    useBuilderStore.getState().onNodesChange([
      { id: 'rack', type: 'remove' },
      { id: 'pc', type: 'remove' },
    ]);

    const state = useBuilderStore.getState();
    expect(state.hardwareNodes.map(node => node.id)).toEqual(['switch', 'nas']);
    expect(state.nodes.map(node => node.id)).toEqual(['switch', 'nas']);
    expect(state.edges.map(edge => edge.id)).toEqual(['e3']);
    expect(state.selectedNodeId).toBeNull();
    expect(state.getBuildData().nodes.map((node: { id: string }) => node.id)).toEqual([
      'switch',
      'nas',
    ]);

    state.undo();
    expect(useBuilderStore.getState().hardwareNodes).toHaveLength(5);
    expect(useBuilderStore.getState().edges).toHaveLength(3);
  });

  it('records where a card was dropped in the device list too', () => {
    place('pc', 'pc');

    useBuilderStore
      .getState()
      .onNodesChange([{ id: 'pc', type: 'position', position: { x: 240, y: 120 }, dragging: false }]);

    expect(useBuilderStore.getState().hardwareNodes[0]).toMatchObject({ x: 240, y: 120 });
    expect(useBuilderStore.getState().nodes[0].position).toEqual({ x: 240, y: 120 });
  });
});
