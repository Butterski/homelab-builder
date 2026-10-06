import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

vi.mock('../store/builder-store', () => ({
  useBuilderStore: { getState: vi.fn() },
}));

import { toast } from 'sonner';
import { useBuilderStore } from '../store/builder-store';
import type { LayoutMetrics } from './layout';
import { describeLayout, lastPolishStyle, polishCanvas } from './polish';

const metrics = (extra: Partial<LayoutMetrics> = {}): LayoutMetrics => ({
  overlaps: 0,
  treeCrossings: 0,
  otherCrossings: 0,
  treeCableHits: 0,
  otherCableHits: 0,
  wrappedCables: 0,
  bounds: { x: 0, y: 0, width: 1650.4, height: 500 },
  cableLength: 0,
  ...extra,
});

function storeWith(state: Record<string, unknown>) {
  vi.mocked(useBuilderStore.getState).mockReturnValue(state as never);
}

describe('describeLayout', () => {
  it('says what a person would check first', () => {
    expect(describeLayout(metrics())).toBe('No crossings · 1650 × 500');
    expect(describeLayout(metrics({ otherCrossings: 1 }))).toBe('1 crossing · 1650 × 500');
    expect(describeLayout(metrics({ treeCrossings: 1, otherCrossings: 2, otherCableHits: 1 }))).toBe(
      '3 crossings · 1 cable over a card · 1650 × 500',
    );
  });
});

describe('polishCanvas', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('arranges in the style asked for, remembers it and offers Undo', () => {
    const undo = vi.fn();
    const polishLayout = vi.fn().mockReturnValue({
      positions: [{ id: 'a', x: 0, y: 0 }],
      metrics: metrics(),
      usedEstimates: false,
      moved: 3,
    });
    storeWith({ proposalPreview: null, polishLayout, undo });
    expect(lastPolishStyle()).toBe('hierarchy');

    polishCanvas('compact');

    expect(polishLayout).toHaveBeenCalledWith('compact');
    expect(lastPolishStyle()).toBe('compact');
    expect(toast.success).toHaveBeenCalledWith(
      'Layout polished: Compact',
      expect.objectContaining({ description: 'No crossings · 1650 × 500' }),
    );
    const options = vi.mocked(toast.success).mock.calls[0][1] as unknown as {
      action: { onClick: () => void };
    };
    options.action.onClick();
    expect(undo).toHaveBeenCalledTimes(1);

    // Without a style the button uses the one from last time.
    polishCanvas();
    expect(polishLayout).toHaveBeenLastCalledWith('compact');
  });

  it('says so when nothing had to move, without an Undo that would undo something else', () => {
    storeWith({
      proposalPreview: null,
      polishLayout: () => ({ positions: [{ id: 'a', x: 0, y: 0 }], metrics: metrics(), usedEstimates: false, moved: 0 }),
    });
    polishCanvas('hierarchy');
    expect(toast.success).toHaveBeenCalledWith('Already tidy (Hierarchy)', { description: 'No crossings · 1650 × 500' });
  });

  it('explains why nothing happens on an empty canvas, during a review, or without a project', () => {
    storeWith({
      proposalPreview: null,
      polishLayout: () => ({ positions: [], metrics: metrics(), usedEstimates: false, moved: 0 }),
    });
    polishCanvas('hierarchy');
    expect(toast.info).toHaveBeenLastCalledWith('Add hardware before polishing the layout.');

    const polishLayout = vi.fn();
    storeWith({ proposalPreview: { proposal: {} }, polishLayout });
    polishCanvas('hierarchy');
    expect(polishLayout).not.toHaveBeenCalled();
    expect(toast.info).toHaveBeenLastCalledWith('Finish reviewing the proposal before polishing the layout.');

    storeWith({ proposalPreview: null, polishLayout: () => null });
    polishCanvas('hierarchy');
    expect(toast.error).toHaveBeenCalledWith('Open a project before polishing its layout.');
  });

  it('falls back to the default style when the stored one is unknown', () => {
    localStorage.setItem('hlb-polish-style', 'tiers');
    expect(lastPolishStyle()).toBe('hierarchy');
  });
});
