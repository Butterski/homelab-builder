import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useCanvasMoving } from './use-canvas-moving';

describe('useCanvasMoving', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const marked = () => {
    const canvas = document.createElement('div');
    const { result, unmount } = renderHook(() => useCanvasMoving({ current: canvas }));
    return { canvas, handlers: result.current, unmount };
  };

  it('marks the canvas while it moves and for a moment after', () => {
    const { canvas, handlers } = marked();
    expect(canvas).not.toHaveAttribute('data-canvas-moving');

    act(() => handlers.onMoveStart());
    expect(canvas).toHaveAttribute('data-canvas-moving');

    act(() => handlers.onMoveEnd());
    expect(canvas).toHaveAttribute('data-canvas-moving');

    act(() => void vi.advanceTimersByTime(300));
    expect(canvas).not.toHaveAttribute('data-canvas-moving');
  });

  it('stays marked through wheel notches that follow one another', () => {
    const { canvas, handlers } = marked();

    for (let notch = 0; notch < 4; notch++) {
      act(() => handlers.onMoveStart());
      act(() => handlers.onMoveEnd());
      act(() => void vi.advanceTimersByTime(150));
      expect(canvas).toHaveAttribute('data-canvas-moving');
    }

    act(() => void vi.advanceTimersByTime(300));
    expect(canvas).not.toHaveAttribute('data-canvas-moving');
  });

  it('leaves no timer behind when the canvas goes away', () => {
    const { handlers, unmount } = marked();
    act(() => handlers.onMoveStart());
    act(() => handlers.onMoveEnd());

    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
