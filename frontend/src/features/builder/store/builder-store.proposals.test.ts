/**
 * Proposal review and server sync in the builder store.
 *
 * The API modules are mocked; every test starts from a build loaded through
 * loadBuild, the same way the builder page opens one.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api/builds', () => ({
  buildApi: {
    updateTopology: vi.fn(),
    get: vi.fn(),
    validateNetwork: vi.fn(),
  },
}));

vi.mock('../api/proposals', () => ({
  proposalApi: {
    apply: vi.fn(),
    get: vi.fn(),
    reject: vi.fn(),
    syncState: vi.fn(),
  },
}));

import { useBuilderStore } from './builder-store';
import { buildApi, type Build, type BuildEdge, type BuildNode } from '../api/builds';
import { proposalApi, type Proposal } from '../api/proposals';
import { mapBuildToFlow } from '../lib/build-mapper';

const ROUTER = '11111111-1111-4111-8111-111111111111';
const SWITCH = '22222222-2222-4222-8222-222222222222';
const NAS = '33333333-3333-4333-8333-333333333333';
const OLD_AP = '44444444-4444-4444-8444-444444444444';

function serverBuild(revision: number, extra: { nas?: boolean; ap?: boolean } = {}): Build {
  const nodes: BuildNode[] = [
    { id: ROUTER, type: 'router', name: 'Router', x: 80, y: 80, ip: '192.168.1.1', power_draw: 12, details: { ports: 4 } },
    { id: SWITCH, type: 'switch', name: 'Switch', x: 80, y: 340, ip: '192.168.1.10', details: { ports: 8 } },
  ];
  const edges: BuildEdge[] = [
    { id: `e-${revision}-1`, source_node_id: ROUTER, source_handle: 'eth0', target_node_id: SWITCH, target_handle: 'target-0', type: 'ethernet', speed: '1 GbE', direction: 'auto' },
  ];
  if (extra.ap) {
    nodes.push({ id: OLD_AP, type: 'access_point', name: 'Old AP', x: 360, y: 600, ip: '192.168.1.20', details: {} });
    edges.push({ id: `e-${revision}-ap`, source_node_id: SWITCH, source_handle: 'eth1', target_node_id: OLD_AP, target_handle: 'target-0', type: 'wireless', speed: '1 GbE', direction: 'auto' });
  }
  if (extra.nas) {
    nodes.push({
      id: NAS, type: 'nas', name: 'Backup NAS', x: 80, y: 600, ip: '192.168.1.100', power_draw: 45, details: { storage: 8000 },
      virtual_machines: [{ id: 'vm-1', name: 'Jellyfin', type: 'container', status: 'running', ip: '192.168.1.101' }],
    });
    edges.push({ id: `e-${revision}-nas`, source_node_id: SWITCH, source_handle: 'eth0', target_node_id: NAS, target_handle: 'target-0', type: 'ethernet', speed: '1 GbE', direction: 'auto' });
  }
  return {
    id: 'build-1', user_id: 'user-1', name: 'Home Lab', revision, settings: {},
    created_at: '2026-10-01T10:00:00Z', updated_at: '2026-10-01T10:00:00Z', nodes, edges,
  };
}

function emptyCounts() {
  return {
    nodes_added: 0, nodes_removed: 0, nodes_changed: 0, connections_added: 0, connections_removed: 0,
    connections_changed: 0, vms_added: 0, vms_removed: 0, vms_changed: 0, components_added: 0,
    components_removed: 0, ip_changes: 0, total: 0,
  };
}

/** A proposal that adds a NAS with a service and removes the old access point. */
function proposal(): Proposal {
  return {
    id: 'proposal-1', build_id: 'build-1', summary: 'Add a NAS, drop the old AP', source: 'mcp',
    source_label: 'Claude Code', status: 'pending', status_reason: '', base_revision: 3,
    created_at: '2026-10-05T10:00:00Z',
    diff: {
      counts: { ...emptyCounts(), nodes_added: 1, nodes_removed: 1, nodes_changed: 1, connections_added: 1, connections_removed: 1, vms_added: 1, total: 6 },
      nodes: {
        added: [{ id: NAS, name: 'Backup NAS', type: 'nas', ip: '192.168.1.100' }],
        removed: [{ id: OLD_AP, name: 'Old AP', type: 'access_point' }],
        changed: [{ id: SWITCH, name: 'Switch', type: 'switch', changes: [{ field: 'details.ports', before: 8, after: 16 }] }],
      },
      connections: {
        added: [{ source: SWITCH, target: NAS, source_name: 'Switch', target_name: 'Backup NAS', source_handle: 'eth0', target_handle: 'target-0', type: 'ethernet' }],
        removed: [{ source: SWITCH, target: OLD_AP, source_name: 'Switch', target_name: 'Old AP', type: 'wireless' }],
        changed: [],
      },
      vms: { added: [{ id: 'vm-1', name: 'Jellyfin', type: 'container', host_id: NAS, host_name: 'Backup NAS' }], removed: [], changed: [] },
      components: { added: [], removed: [] },
      ip_changes: [],
    },
    preview: {
      build: serverBuild(4, { nas: true }),
      validation: { valid: true, errors: [], warnings: [{ node_id: NAS, message: 'address inside the DHCP pool' }] },
    },
  };
}

function loadLiveBuild() {
  const build = serverBuild(3, { ap: true });
  useBuilderStore.getState().loadBuild(build.id, build.name, build);
}

beforeEach(() => {
  vi.clearAllMocks();
  useBuilderStore.getState().clearCurrentBuild();
  loadLiveBuild();
});

describe('saved-state tracking', () => {
  it('treats a freshly loaded build as saved and an edit as unsaved', () => {
    const store = useBuilderStore.getState();
    expect(store.hasUnsavedChanges()).toBe(false);
    expect(store.lastSyncedFingerprint).toBe(JSON.stringify(store.getBuildData()));

    store.updateHardware(SWITCH, { name: 'Core Switch' });
    expect(useBuilderStore.getState().hasUnsavedChanges()).toBe(true);
  });

  it('is saved again after a successful save, unless the canvas was edited meanwhile', async () => {
    useBuilderStore.getState().updateHardware(SWITCH, { name: 'Core Switch' });
    vi.mocked(buildApi.updateTopology).mockResolvedValueOnce({ build: serverBuild(4, { ap: true }) });
    await useBuilderStore.getState().reassignAllIPs();
    expect(useBuilderStore.getState().hasUnsavedChanges()).toBe(false);

    useBuilderStore.getState().updateHardware(SWITCH, { name: 'Renamed again' });
    vi.mocked(buildApi.updateTopology).mockImplementationOnce(async () => {
      useBuilderStore.getState().updateHardware(ROUTER, { name: 'Edited during the save' });
      return { build: serverBuild(5, { ap: true }) };
    });
    await useBuilderStore.getState().reassignAllIPs();
    expect(useBuilderStore.getState().hasUnsavedChanges()).toBe(true);
  });

  it('keeps node power draw across a load and a save', () => {
    const { hardwareNodes, getBuildData } = useBuilderStore.getState();
    expect(hardwareNodes.find(node => node.id === ROUTER)?.power_draw).toBe(12);
    const payload = getBuildData();
    expect(payload.nodes.find(node => node.id === ROUTER)?.power_draw).toBe(12);
    expect(payload.nodes.find(node => node.id === SWITCH)?.power_draw).toBe(0);
  });
});

describe('syncWithServer', () => {
  it('loads a newer revision when nothing local is unsaved', async () => {
    vi.mocked(buildApi.get).mockResolvedValueOnce(serverBuild(7, { ap: true, nas: true }));
    const reloaded = await useBuilderStore.getState().syncWithServer(7);
    expect(reloaded).toBe(true);
    const state = useBuilderStore.getState();
    expect(state.currentRevision).toBe(7);
    expect(state.hardwareNodes).toHaveLength(4);
    expect(state.hasUnsavedChanges()).toBe(false);
  });

  it('does nothing when the server is not ahead', async () => {
    expect(await useBuilderStore.getState().syncWithServer(3)).toBe(false);
    expect(buildApi.get).not.toHaveBeenCalled();
  });

  it('never replaces unsaved local edits', async () => {
    useBuilderStore.getState().updateHardware(SWITCH, { name: 'My edit' });
    expect(await useBuilderStore.getState().syncWithServer(9)).toBe(false);
    expect(buildApi.get).not.toHaveBeenCalled();
    expect(useBuilderStore.getState().hardwareNodes.find(node => node.id === SWITCH)?.name).toBe('My edit');
  });
});

describe('proposal preview', () => {
  it('shows the proposed build without touching the live canvas', () => {
    const before = useBuilderStore.getState();
    const fingerprint = JSON.stringify(before.getBuildData());

    before.startProposalPreview(proposal());
    const state = useBuilderStore.getState();
    const preview = state.proposalPreview!;

    // The live build is unchanged, so auto-save has nothing to do.
    expect(JSON.stringify(state.getBuildData())).toBe(fingerprint);
    expect(state.nodes).toBe(before.nodes);
    expect(state.hasUnsavedChanges()).toBe(false);

    const byId = new Map(preview.nodes.map(node => [node.id, node]));
    expect(byId.get(NAS)?.className).toContain('proposal-diff-added');
    expect(byId.get(SWITCH)?.className).toContain('proposal-diff-changed');
    expect(byId.get(ROUTER)?.className).toBeUndefined();
    // The removed access point is kept as a ghost taken from the live canvas.
    expect(byId.get(OLD_AP)?.className).toContain('proposal-diff-removed');
    expect(preview.nodes.every(node => node.draggable === false && node.selectable === false)).toBe(true);

    const statuses = preview.edges.map(edge => [edge.source, edge.target, edge.data?.proposalDiff]);
    expect(statuses).toContainEqual([SWITCH, NAS, 'added']);
    expect(statuses).toContainEqual([SWITCH, OLD_AP, 'removed']);
    expect(statuses).toContainEqual([ROUTER, SWITCH, undefined]);
    expect(preview.edges.every(edge => edge.type === 'proposal')).toBe(true);

    expect(preview.hardwareNodes.map(node => node.id).sort()).toEqual([ROUTER, SWITCH, NAS, OLD_AP].sort());
    expect(preview.validationIssues).toEqual([
      { node_id: NAS, message: 'address inside the DHCP pool', type: 'warning' },
    ]);
    expect(preview.focus?.ids).toEqual(expect.arrayContaining([NAS, SWITCH, OLD_AP]));

    state.focusProposalNodes([NAS]);
    expect(useBuilderStore.getState().proposalPreview?.focus).toEqual({ ids: [NAS], nonce: 1 });

    state.endProposalPreview();
    expect(useBuilderStore.getState().proposalPreview).toBeNull();
    expect(JSON.stringify(useBuilderStore.getState().getBuildData())).toBe(fingerprint);
  });

  it('blocks undo and redo while a proposal is open', () => {
    useBuilderStore.getState().removeHardware(OLD_AP);
    expect(useBuilderStore.getState().hardwareNodes).toHaveLength(2);
    useBuilderStore.getState().startProposalPreview(proposal());
    useBuilderStore.getState().undo();
    expect(useBuilderStore.getState().hardwareNodes).toHaveLength(2);
    useBuilderStore.getState().endProposalPreview();
    useBuilderStore.getState().undo();
    expect(useBuilderStore.getState().hardwareNodes).toHaveLength(3);
  });

  it('is drawn on the canvas that is already there: cards keep their size, changes come in order', () => {
    // React Flow has measured the cards of the live canvas.
    useBuilderStore.setState(state => ({
      nodes: state.nodes.map(node => ({ ...node, measured: { width: 220, height: 140 } })),
    }));

    useBuilderStore.getState().startProposalPreview(proposal());
    const preview = useBuilderStore.getState().proposalPreview!;
    const byId = new Map(preview.nodes.map(node => [node.id, node]));

    // A card without its measured size would be hidden until it is measured
    // again: everything that stays would blink when the review opens.
    for (const id of [ROUTER, SWITCH, OLD_AP]) {
      expect(byId.get(id)?.measured, id).toEqual({ width: 220, height: 140 });
    }
    // The new device has not been drawn yet.
    expect(byId.get(NAS)?.measured).toBeUndefined();

    // What goes, then what changes, then what is new; a cable with its later end.
    const reveal = (id: string) => (byId.get(id)?.style as Record<string, unknown> | undefined)?.['--reveal-index'];
    expect([reveal(OLD_AP), reveal(SWITCH), reveal(NAS)]).toEqual([0, 1, 2]);
    expect(reveal(ROUTER)).toBeUndefined();
    expect(preview.changedNodeIds).toEqual([OLD_AP, SWITCH, NAS]);
    const cable = (source: string, target: string) =>
      preview.edges.find(edge => edge.source === source && edge.target === target)!;
    expect((cable(SWITCH, NAS).data as { revealIndex?: number }).revealIndex).toBe(3);
    expect((cable(ROUTER, SWITCH).data as { revealIndex?: number }).revealIndex).toBeUndefined();
    // The canvas animates its cables by default; a reviewed one says what happens to it instead.
    expect(preview.edges.every(edge => edge.animated === false)).toBe(true);
  });

  it('keeps what React Flow measures during a review, and nothing else', () => {
    useBuilderStore.getState().startProposalPreview(proposal());
    const live = useBuilderStore.getState().nodes;

    useBuilderStore.getState().applyPreviewNodeChanges([
      { id: NAS, type: 'dimensions', dimensions: { width: 220, height: 200 } },
      { id: SWITCH, type: 'position', position: { x: 999, y: 999 }, dragging: false },
      { id: ROUTER, type: 'remove' },
      { id: ROUTER, type: 'select', selected: true },
    ]);

    const state = useBuilderStore.getState();
    const byId = new Map(state.proposalPreview!.nodes.map(node => [node.id, node]));
    expect(byId.get(NAS)?.measured).toEqual({ width: 220, height: 200 });
    expect(byId.get(SWITCH)?.position).not.toEqual({ x: 999, y: 999 });
    expect(byId.has(ROUTER)).toBe(true);
    expect(byId.get(ROUTER)?.selected).toBe(false);
    // The live graph, which is what gets saved, never sees any of it.
    expect(state.nodes).toBe(live);
    expect(state.hasUnsavedChanges()).toBe(false);
    expect(state.historyPast).toHaveLength(0);

    // Without a review there is nothing to apply them to.
    state.endProposalPreview();
    useBuilderStore.getState().applyPreviewNodeChanges([
      { id: SWITCH, type: 'dimensions', dimensions: { width: 1, height: 1 } },
    ]);
    expect(useBuilderStore.getState().nodes).toBe(live);
  });
});

describe('applyProposal', () => {
  it('loads the applied build and makes it one undo step', async () => {
    vi.mocked(proposalApi.apply).mockResolvedValueOnce({
      build: serverBuild(4, { nas: true }),
      validation: { valid: false, errors: [{ node_id: NAS, message: 'conflict' }], warnings: [] },
    });
    useBuilderStore.getState().startProposalPreview(proposal());

    await useBuilderStore.getState().applyProposal('proposal-1');

    expect(proposalApi.apply).toHaveBeenCalledWith('build-1', 'proposal-1');
    expect(buildApi.updateTopology).not.toHaveBeenCalled();
    let state = useBuilderStore.getState();
    expect(state.proposalPreview).toBeNull();
    expect(state.currentRevision).toBe(4);
    expect(state.hardwareNodes.map(node => node.name)).toEqual(['Router', 'Switch', 'Backup NAS']);
    expect(state.validationIssues).toEqual([{ node_id: NAS, message: 'conflict', type: 'error' }]);
    expect(state.hasUnsavedChanges()).toBe(false);
    expect(state.historyPast).toHaveLength(1);

    // Ctrl+Z brings back the canvas from before the proposal; saving it is then a normal edit.
    state.undo();
    state = useBuilderStore.getState();
    expect(state.hardwareNodes.map(node => node.name)).toEqual(['Router', 'Switch', 'Old AP']);
    expect(state.hasUnsavedChanges()).toBe(true);
  });

  it('undo also takes back a rename, a kind and a plan the proposal changed', async () => {
    const plan = { uplink: { down_mbps: 300, up_mbps: 20, cgnat: 'no', public_host: '' } };
    vi.mocked(proposalApi.apply).mockResolvedValueOnce({
      build: {
        ...serverBuild(4, { nas: true }),
        name: 'Game Night',
        kind: 'game_server',
        gaming_plan: plan,
      } as Build,
    });
    useBuilderStore.getState().startProposalPreview(proposal());

    await useBuilderStore.getState().applyProposal('proposal-1');
    let state = useBuilderStore.getState();
    expect(state.projectName).toBe('Game Night');
    expect(state.buildKind).toBe('game_server');
    expect(state.gamingPlan).toEqual(plan);

    state.undo();
    state = useBuilderStore.getState();
    expect(state.projectName).toBe('Home Lab');
    expect(state.buildKind).toBe('homelab');
    expect(state.gamingPlan).toEqual({});
    // The next save writes the old canvas under the old name and plan.
    expect(state.hasUnsavedChanges()).toBe(true);

    state.redo();
    state = useBuilderStore.getState();
    expect(state.projectName).toBe('Game Night');
    expect(state.buildKind).toBe('game_server');
    expect(state.gamingPlan).toEqual(plan);
  });

  it('asks the canvas to show what was applied', async () => {
    vi.mocked(proposalApi.apply).mockResolvedValueOnce({ build: serverBuild(4, { nas: true }) });
    useBuilderStore.getState().startProposalPreview(proposal());

    await useBuilderStore.getState().applyProposal('proposal-1');

    // New devices can be anywhere on the canvas; the removed one is gone.
    const focus = useBuilderStore.getState().canvasFocus;
    expect(focus?.ids).toEqual(expect.arrayContaining([NAS, SWITCH]));
    expect(focus?.ids).not.toContain(OLD_AP);
    // The same devices light up once on the live canvas.
    expect(useBuilderStore.getState().appliedGlow).toEqual({ ids: focus?.ids, nonce: 1 });
  });

  it('saves unsaved edits before applying so they are not lost', async () => {
    const order: string[] = [];
    vi.mocked(buildApi.updateTopology).mockImplementationOnce(async () => {
      order.push('save');
      return { build: serverBuild(4, { ap: true }) };
    });
    vi.mocked(proposalApi.apply).mockImplementationOnce(async () => {
      order.push('apply');
      return { build: serverBuild(5, { nas: true }) };
    });
    useBuilderStore.getState().updateHardware(ROUTER, { name: 'Edge Router' });

    await useBuilderStore.getState().applyProposal('proposal-1');

    expect(order).toEqual(['save', 'apply']);
    expect(vi.mocked(buildApi.updateTopology).mock.calls[0][1].nodes.find(node => node.id === ROUTER)?.name).toBe('Edge Router');
  });

  it('leaves the canvas and the preview alone when applying fails', async () => {
    vi.mocked(proposalApi.apply).mockRejectedValueOnce(new Error('proposal conflicts with the current build'));
    useBuilderStore.getState().startProposalPreview(proposal());
    const before = useBuilderStore.getState();

    await expect(before.applyProposal('proposal-1')).rejects.toThrow('conflicts');

    const state = useBuilderStore.getState();
    expect(state.nodes).toBe(before.nodes);
    expect(state.currentRevision).toBe(3);
    expect(state.historyPast).toHaveLength(0);
    expect(state.proposalPreview?.proposal.id).toBe('proposal-1');
  });
});

describe('mapBuildToFlow', () => {
  it('puts racks first and keeps handles, addresses and services', () => {
    const build = serverBuild(1, { nas: true });
    build.nodes!.push({ id: 'rack-1', type: 'rack', name: 'Rack', x: 600, y: 80, details: '{"rack_size":12}' });
    build.nodes!.find(node => node.id === NAS)!.parent_id = 'rack-1';

    const flow = mapBuildToFlow(build);

    expect(flow.nodes[0]).toMatchObject({ id: 'rack-1', type: 'rack', style: { height: 40 + 12 * 90 + 8 } });
    expect(flow.nodes.find(node => node.id === NAS)).toMatchObject({ parentId: 'rack-1', extent: 'parent', type: 'hardware' });
    const nas = flow.hardwareNodes.find(node => node.id === NAS)!;
    expect(nas).toMatchObject({ ip: '192.168.1.100', power_draw: 45, parent_id: 'rack-1' });
    expect(nas.vms).toHaveLength(1);
    // Details saved as a JSON string are parsed.
    expect(flow.hardwareNodes.find(node => node.id === 'rack-1')?.details).toEqual({ rack_size: 12 });
    expect(flow.edges.find(edge => edge.target === NAS)).toMatchObject({
      source: SWITCH, sourceHandle: 'eth0', targetHandle: 'target-0', type: 'custom',
      data: { connection_type: 'ethernet', speed: '1 GbE', direction: 'auto' },
    });
  });
});
