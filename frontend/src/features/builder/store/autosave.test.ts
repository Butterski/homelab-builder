/**
 * The autosave: when it saves, when it must not, and what it does when a save
 * fails. Time is faked; the API modules are mocked.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

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

import { ApiError } from '../../../lib/api';
import type { HardwareNode } from '../../../types';
import { buildApi, type Build, type BuildNode, type TopologyUpdateResponse } from '../api/builds';
import { AUTOSAVE_DELAY_MS, AUTOSAVE_RETRY_MS, startAutosave } from './autosave';
import { BuildConflictError, useBuilderStore } from './builder-store';

const device = (id: string, type: HardwareNode['type'] = 'router'): HardwareNode => ({
  id,
  type,
  name: id,
  x: 0,
  y: 0,
});

const serverBuild = (revision: number, nodes: BuildNode[] = []): Build => ({
  id: 'build-1',
  user_id: 'user-1',
  name: 'Lab',
  revision,
  nodes,
  edges: [],
  settings: {},
  created_at: '',
  updated_at: '',
});

const saved = (revision: number): TopologyUpdateResponse => ({ build: serverBuild(revision) });

let stop: () => void;
let onConflict: Mock<(error: BuildConflictError) => void>;
let onFailure: Mock<(message: string) => void>;

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  vi.mocked(buildApi.updateTopology).mockReset().mockResolvedValue(saved(2));
  useBuilderStore.getState().clearCurrentBuild();
  useBuilderStore.getState().loadBuild('build-1', 'Lab', serverBuild(1));
  onConflict = vi.fn<(error: BuildConflictError) => void>();
  onFailure = vi.fn<(message: string) => void>();
  // A failed save is logged for whoever debugs it; the tests fail saves on purpose.
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  stop = startAutosave({ onConflict, onFailure });
});

afterEach(async () => {
  stop();
  // Stopping saves what is pending; let that finish while errors are still silenced.
  await vi.advanceTimersByTimeAsync(0);
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('when it saves', () => {
  it('saves once, two seconds after the last edit', async () => {
    useBuilderStore.getState().addHardware(device('router-1'));

    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS - 1);
    expect(buildApi.updateTopology).not.toHaveBeenCalled();
    // The header can say "Unsaved changes" during the wait instead of "Saved".
    expect(useBuilderStore.getState().saveState).toBe('unsaved');

    await vi.advanceTimersByTimeAsync(1);
    expect(buildApi.updateTopology).toHaveBeenCalledTimes(1);
    expect(useBuilderStore.getState().saveState).toBe('saved');

    // What comes back from the save (addresses, the new revision) is not an edit.
    await vi.advanceTimersByTimeAsync(30_000);
    expect(buildApi.updateTopology).toHaveBeenCalledTimes(1);
  });

  it('starts the wait again with every edit', async () => {
    useBuilderStore.getState().addHardware(device('router-1'));
    await vi.advanceTimersByTimeAsync(1500);
    useBuilderStore.getState().addHardware(device('switch-1', 'switch'));

    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS - 1);
    expect(buildApi.updateTopology).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(buildApi.updateTopology).toHaveBeenCalledTimes(1);
    expect(vi.mocked(buildApi.updateTopology).mock.calls[0][1].nodes).toHaveLength(2);
  });

  it('saves what is pending when the builder is left', async () => {
    useBuilderStore.getState().addHardware(device('router-1'));

    stop();

    // The save waits its turn behind whatever is already on its way.
    await vi.advanceTimersByTimeAsync(0);
    expect(buildApi.updateTopology).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(buildApi.updateTopology).toHaveBeenCalledTimes(1);
  });
});

describe('when it must not save', () => {
  it('leaves a canvas alone that matches the server', async () => {
    useBuilderStore.getState().loadBuild('build-1', 'Lab', serverBuild(1, [device('router-1')]));
    // Measuring and selecting replace the node array without changing the build.
    useBuilderStore
      .getState()
      .onNodesChange([
        { id: 'router-1', type: 'dimensions', dimensions: { width: 220, height: 96 } },
        { id: 'router-1', type: 'select', selected: true },
      ]);

    await vi.advanceTimersByTimeAsync(30_000);
    expect(buildApi.updateTopology).not.toHaveBeenCalled();
    expect(useBuilderStore.getState().saveState).toBe('saved');
    stop();
    expect(buildApi.updateTopology).not.toHaveBeenCalled();
  });

  it('does not save a build back that just arrived from the server', async () => {
    // Otherwise two open tabs would keep bumping the revision for each other.
    useBuilderStore.getState().loadBuild('build-1', 'Lab', serverBuild(5, [device('router-1')]));

    await vi.advanceTimersByTimeAsync(30_000);
    expect(buildApi.updateTopology).not.toHaveBeenCalled();
  });

  it('does not save while a proposal is reviewed on the canvas', async () => {
    useBuilderStore.getState().loadBuild('build-1', 'Lab', serverBuild(1, [device('router-1')]));
    useBuilderStore.getState().startProposalPreview({
      id: 'proposal-1',
      build_id: 'build-1',
      summary: 'Add a switch',
      source: 'chat',
      source_label: 'In-app assistant',
      status: 'pending',
      status_reason: '',
      base_revision: 1,
      created_at: '2026-10-06T10:00:00Z',
      diff: {
        counts: {
          nodes_added: 1,
          nodes_removed: 0,
          nodes_changed: 0,
          connections_added: 0,
          connections_removed: 0,
          connections_changed: 0,
          vms_added: 0,
          vms_removed: 0,
          vms_changed: 0,
          components_added: 0,
          components_removed: 0,
          ip_changes: 0,
          total: 1,
        },
        nodes: { added: [{ id: 'switch-1', name: 'Switch', type: 'switch' }], removed: [], changed: [] },
        connections: { added: [], removed: [], changed: [] },
        vms: { added: [], removed: [], changed: [] },
        components: { added: [], removed: [] },
        ip_changes: [],
      },
      preview: { build: serverBuild(2, [device('router-1'), device('switch-1', 'switch')]) },
    });

    await vi.advanceTimersByTimeAsync(30_000);
    expect(buildApi.updateTopology).not.toHaveBeenCalled();
  });

  it('does not save a project whose canvas is not loaded', async () => {
    useBuilderStore.setState({ buildStatus: 'loading', nodes: [], hardwareNodes: [] });

    await vi.advanceTimersByTimeAsync(30_000);
    expect(buildApi.updateTopology).not.toHaveBeenCalled();
    stop();
    expect(buildApi.updateTopology).not.toHaveBeenCalled();
  });
});

describe('when a save fails', () => {
  it('tries again by itself, then gives up and says so', async () => {
    vi.mocked(buildApi.updateTopology).mockRejectedValue(new TypeError('Failed to fetch'));
    useBuilderStore.getState().addHardware(device('router-1'));

    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    expect(buildApi.updateTopology).toHaveBeenCalledTimes(1);
    expect(useBuilderStore.getState().saveState).toBe('error');

    for (const [attempt, wait] of AUTOSAVE_RETRY_MS.entries()) {
      expect(onFailure).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(wait);
      expect(buildApi.updateTopology).toHaveBeenCalledTimes(attempt + 2);
    }
    expect(onFailure).toHaveBeenCalledTimes(1);
    expect(onFailure).toHaveBeenCalledWith('The server could not be reached.');

    await vi.advanceTimersByTimeAsync(120_000);
    expect(buildApi.updateTopology).toHaveBeenCalledTimes(AUTOSAVE_RETRY_MS.length + 1);
  });

  it('recovers when the server answers again', async () => {
    vi.mocked(buildApi.updateTopology)
      .mockRejectedValueOnce(new ApiError(503, 'UNKNOWN', 'Service Unavailable'))
      .mockResolvedValueOnce(saved(2));
    useBuilderStore.getState().addHardware(device('router-1'));

    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS + AUTOSAVE_RETRY_MS[0]);

    expect(buildApi.updateTopology).toHaveBeenCalledTimes(2);
    expect(useBuilderStore.getState().saveState).toBe('saved');
    expect(onFailure).not.toHaveBeenCalled();
  });

  it('does not repeat a save the server refused, until the canvas changes', async () => {
    const reason = 'invalid topology: a rack cannot be cabled';
    vi.mocked(buildApi.updateTopology).mockRejectedValueOnce(new ApiError(422, 'UNKNOWN', reason));
    useBuilderStore.getState().addHardware(device('router-1'));

    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    expect(onFailure).toHaveBeenCalledWith(reason);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(buildApi.updateTopology).toHaveBeenCalledTimes(1);

    // Fixing the canvas is an edit, and edits are saved.
    useBuilderStore.getState().addHardware(device('switch-1', 'switch'));
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    expect(buildApi.updateTopology).toHaveBeenCalledTimes(2);
    expect(useBuilderStore.getState().saveState).toBe('saved');
  });

  it('reports a change made elsewhere once', async () => {
    vi.mocked(buildApi.updateTopology).mockRejectedValueOnce(
      new ApiError(409, 'UNKNOWN', 'build revision conflict', {
        build: serverBuild(9, [device('theirs', 'switch')]),
      }),
    );
    useBuilderStore.getState().addHardware(device('mine'));

    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);

    expect(onConflict).toHaveBeenCalledTimes(1);
    expect(onConflict.mock.calls[0][0]).toBeInstanceOf(BuildConflictError);
    expect(useBuilderStore.getState().currentRevision).toBe(9);
    // The server's version is on the canvas now; it is not saved back.
    await vi.advanceTimersByTimeAsync(120_000);
    expect(buildApi.updateTopology).toHaveBeenCalledTimes(1);
  });
});
