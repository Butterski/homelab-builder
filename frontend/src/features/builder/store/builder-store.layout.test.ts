/**
 * Polish in the builder store: the positions are written once, as one undo
 * step, and nothing else about the canvas changes.
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
import type { Build } from '../api/builds';
import type { Proposal } from '../api/proposals';

const ROUTER = '11111111-1111-4111-8111-111111111111';
const SWITCH = '22222222-2222-4222-8222-222222222222';
const NAS = '33333333-3333-4333-8333-333333333333';
const PC = '44444444-4444-4444-8444-444444444444';
const RACK = '55555555-5555-4555-8555-555555555555';
const SERVER = '66666666-6666-4666-8666-666666666666';

const cable = (id: string, source: string, port: number, target: string) => ({
  id,
  source_node_id: source,
  source_handle: `eth${port}`,
  target_node_id: target,
  target_handle: 'target-0',
  type: 'ethernet',
  speed: '1 GbE',
  direction: 'auto',
});

/** A small network scattered over the canvas, with a server in a rack. */
function messyBuild(): Build {
  return {
    id: 'build-1',
    user_id: 'user-1',
    name: 'Home Lab',
    revision: 3,
    settings: {},
    created_at: '2026-10-01T10:00:00Z',
    updated_at: '2026-10-01T10:00:00Z',
    nodes: [
      { id: ROUTER, type: 'router', name: 'Router', x: 900, y: 700, ip: '192.168.1.1', details: { ports: 4 } },
      { id: SWITCH, type: 'switch', name: 'Switch', x: 120, y: 60, ip: '192.168.1.10', details: { ports: 8 } },
      { id: NAS, type: 'nas', name: 'NAS', x: 1400, y: 90, ip: '192.168.1.100', details: {} },
      { id: PC, type: 'pc', name: 'PC', x: 40, y: 900, ip: '192.168.1.160', details: {} },
      { id: RACK, type: 'rack', name: 'Rack', x: 600, y: 40, details: { rack_size: 6 } },
      { id: SERVER, type: 'server_v2', name: 'Server', x: 28, y: 40, parent_id: RACK, ip: '192.168.1.150', details: {} },
    ],
    edges: [
      cable('e1', ROUTER, 0, SWITCH),
      cable('e2', SWITCH, 0, NAS),
      cable('e3', SWITCH, 1, PC),
      cable('e4', SWITCH, 2, SERVER),
    ],
  } as unknown as Build;
}

/** Opens the build the way the builder page does, then gives every card the size React Flow measured. */
function openMeasured() {
  const store = useBuilderStore.getState();
  store.clearCurrentBuild();
  store.setCurrentBuildId('build-1');
  store.loadBuild('build-1', 'Home Lab', messyBuild());
  useBuilderStore.setState(state => ({
    nodes: state.nodes.map(node => ({
      ...node,
      measured: node.type === 'rack' ? { width: 280, height: 588 } : { width: 220, height: 140 },
    })),
  }));
}

const positionOf = (id: string) => useBuilderStore.getState().nodes.find(node => node.id === id)!.position;

describe('polishing the layout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    openMeasured();
  });

  it('arranges the canvas top-down in one step', () => {
    const before = useBuilderStore.getState();
    const result = useBuilderStore.getState().polishLayout('hierarchy');

    expect(result).not.toBeNull();
    expect(result!.moved).toBeGreaterThan(0);
    expect(result!.metrics).toMatchObject({ overlaps: 0, treeCrossings: 0, treeCableHits: 0 });
    expect(result!.usedEstimates).toBe(false);

    // The router feeds the switch, the switch everything else.
    expect(positionOf(ROUTER).y).toBeLessThan(positionOf(SWITCH).y);
    expect(positionOf(SWITCH).y).toBeLessThan(positionOf(NAS).y);
    expect(positionOf(NAS).y).toBe(positionOf(PC).y);
    expect(positionOf(NAS).x).toBeLessThan(positionOf(PC).x);

    const after = useBuilderStore.getState();
    expect(after.historyPast).toHaveLength(before.historyPast.length + 1);
    expect(after.layoutMotion).toBe(before.layoutMotion + 1);
    // The camera is asked to show the whole canvas.
    expect(after.canvasFocus?.ids).toBeNull();
    expect(after.canvasFocus?.nonce).toBe((before.canvasFocus?.nonce ?? 0) + 1);
  });

  it('keeps what React Flow knows about each card, and the devices in a rack where they are', () => {
    const selected = useBuilderStore.getState().nodes.map(node => ({ ...node, selected: node.id === NAS }));
    useBuilderStore.setState({ nodes: selected });

    useBuilderStore.getState().polishLayout('hierarchy');

    const { nodes, hardwareNodes } = useBuilderStore.getState();
    for (const node of nodes) expect(node.measured, node.id).toBeDefined();
    expect(nodes.find(node => node.id === NAS)!.selected).toBe(true);
    // Racks still come before what is in them, and the server kept its slot.
    expect(nodes.findIndex(node => node.id === RACK)).toBeLessThan(nodes.findIndex(node => node.id === SERVER));
    expect(positionOf(SERVER)).toEqual({ x: 28, y: 40 });
    expect(nodes.find(node => node.id === SERVER)!.parentId).toBe(RACK);
    // The device list follows the canvas.
    for (const node of nodes) {
      const device = hardwareNodes.find(entry => entry.id === node.id)!;
      expect({ x: device.x, y: device.y }, node.id).toEqual(node.position);
    }
  });

  it('is undone and redone as a whole', () => {
    const scattered = Object.fromEntries(useBuilderStore.getState().nodes.map(node => [node.id, node.position]));
    useBuilderStore.getState().polishLayout('hierarchy');
    const tidy = Object.fromEntries(useBuilderStore.getState().nodes.map(node => [node.id, node.position]));

    useBuilderStore.getState().undo();
    expect(Object.fromEntries(useBuilderStore.getState().nodes.map(node => [node.id, node.position]))).toEqual(scattered);
    expect(useBuilderStore.getState().hardwareNodes.find(node => node.id === ROUTER)).toMatchObject({ x: 900, y: 700 });

    useBuilderStore.getState().redo();
    expect(Object.fromEntries(useBuilderStore.getState().nodes.map(node => [node.id, node.position]))).toEqual(tidy);
  });

  it('adds no undo step when the canvas is tidy already', () => {
    useBuilderStore.getState().polishLayout('hierarchy');
    const settled = useBuilderStore.getState();

    const again = useBuilderStore.getState().polishLayout('hierarchy');

    expect(again!.moved).toBe(0);
    const after = useBuilderStore.getState();
    expect(after.historyPast).toHaveLength(settled.historyPast.length);
    expect(after.layoutMotion).toBe(settled.layoutMotion);
    expect(after.nodes).toBe(settled.nodes);
  });

  it('makes the canvas differ from the server, so the new layout is saved', () => {
    expect(useBuilderStore.getState().hasUnsavedChanges()).toBe(false);
    useBuilderStore.getState().polishLayout('compact');
    expect(useBuilderStore.getState().hasUnsavedChanges()).toBe(true);
  });

  it('moves nothing while a proposal is being reviewed or no build is open', () => {
    const before = useBuilderStore.getState().nodes;
    useBuilderStore.setState({
      proposalPreview: { proposal: {} as Proposal, nodes: [], edges: [], focus: null } as never,
    });
    expect(useBuilderStore.getState().polishLayout('hierarchy')).toBeNull();
    expect(useBuilderStore.getState().applyLayout([{ id: ROUTER, x: 0, y: 0 }])).toBe(0);
    expect(useBuilderStore.getState().nodes).toBe(before);

    useBuilderStore.setState({ proposalPreview: null, buildStatus: 'loading' });
    expect(useBuilderStore.getState().polishLayout('hierarchy')).toBeNull();
    expect(useBuilderStore.getState().nodes).toBe(before);
  });
});
