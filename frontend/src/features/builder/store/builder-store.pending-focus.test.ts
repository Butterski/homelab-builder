/**
 * A focus asked for before the build is open ("Show" in What's new): it waits
 * for that build to be loaded, and then shows only devices that exist.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api/builds', () => ({
  buildApi: {
    updateTopology: vi.fn(),
    get: vi.fn(),
    validateNetwork: vi.fn().mockResolvedValue({ issues: [] }),
  },
}));

vi.mock('../api/proposals', () => ({
  proposalApi: { apply: vi.fn(), get: vi.fn(), reject: vi.fn(), syncState: vi.fn() },
}));

import { buildApi, type Build } from '../api/builds';
import { useBuilderStore } from './builder-store';

const UPS = '11111111-1111-4111-8111-111111111111';
const PDU = '22222222-2222-4222-8222-222222222222';
const ROUTER = '33333333-3333-4333-8333-333333333333';
const GONE = '44444444-4444-4444-8444-444444444444';

function build(id: string, nodes: { id: string; type: string; name: string }[]): Build {
  return {
    id,
    user_id: 'user-1',
    name: id,
    revision: 1,
    settings: {},
    created_at: '2026-10-01T10:00:00Z',
    updated_at: '2026-10-01T10:00:00Z',
    nodes: nodes.map((node, at) => ({ ...node, x: at * 300, y: 0, details: {} })),
    edges: [],
  } as unknown as Build;
}

const RACK = build('build-2', [
  { id: ROUTER, type: 'router', name: 'Router' },
  { id: PDU, type: 'pdu', name: 'PDU' },
  { id: UPS, type: 'ups', name: 'UPS' },
]);

beforeEach(() => {
  vi.clearAllMocks();
  const store = useBuilderStore.getState();
  store.clearCurrentBuild();
  store.loadBuild('build-1', 'build-1', build('build-1', [{ id: 'other', type: 'pc', name: 'PC' }]));
});

describe('a focus asked for before its build is open', () => {
  it('outlives the empty graph of opening another build, then shows the devices that exist', async () => {
    let answer!: (value: Build) => void;
    vi.mocked(buildApi.get).mockReturnValue(new Promise<Build>(resolve => (answer = resolve)));
    useBuilderStore.getState().setPendingFocus({ buildId: 'build-2', ids: [UPS, ROUTER, GONE] });

    const opening = useBuilderStore.getState().openBuild('build-2');
    await vi.waitFor(() => expect(useBuilderStore.getState().buildStatus).toBe('loading'));
    // Nothing to show yet: the focus waits.
    useBuilderStore.getState().takePendingFocus('build-2');
    expect(useBuilderStore.getState().pendingFocus?.buildId).toBe('build-2');

    answer(RACK);
    await opening;
    const before = useBuilderStore.getState().canvasFocus?.nonce ?? 0;
    useBuilderStore.getState().takePendingFocus('build-2');

    const state = useBuilderStore.getState();
    expect(state.pendingFocus).toBeNull();
    // In the order of the canvas; a device deleted since is left out.
    expect(state.canvasFocus).toEqual({ ids: [ROUTER, UPS], nonce: before + 1 });
    expect(state.selectedNodeId).toBeNull();
  });

  it('finds devices by type, in the order of the types, and selects the first', () => {
    useBuilderStore.getState().loadBuild('build-2', 'build-2', RACK);
    useBuilderStore
      .getState()
      .setPendingFocus({ buildId: 'build-2', types: ['ups', 'pdu', 'power_outlet'], select: true });

    useBuilderStore.getState().takePendingFocus('build-2');

    const state = useBuilderStore.getState();
    expect(state.canvasFocus?.ids).toEqual([UPS, PDU]);
    expect(state.selectedNodeId).toBe(UPS);
  });

  it('shows the whole canvas and selects nothing when the build has none of those devices', () => {
    useBuilderStore.getState().loadBuild('build-2', 'build-2', RACK);
    useBuilderStore
      .getState()
      .setPendingFocus({ buildId: 'build-2', types: ['firewall'], select: true });

    useBuilderStore.getState().takePendingFocus('build-2');

    const state = useBuilderStore.getState();
    expect(state.pendingFocus).toBeNull();
    expect(state.canvasFocus?.ids).toBeNull();
    expect(state.selectedNodeId).toBeNull();
  });

  it('is left for its own build when another one is taken', () => {
    useBuilderStore.getState().setPendingFocus({ buildId: 'build-2', ids: [UPS] });
    useBuilderStore.getState().takePendingFocus('build-1');
    expect(useBuilderStore.getState().pendingFocus?.buildId).toBe('build-2');
  });
});
