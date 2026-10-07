import { useEffect } from 'react';
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { ReactFlowProvider, useStoreApi } from '@xyflow/react';
import { CanvasGrid } from './canvas-grid';

/** Puts the view of the surrounding React Flow store where a test wants it. */
function View({ x, y, zoom }: { x: number; y: number; zoom: number }) {
  const store = useStoreApi();
  useEffect(() => {
    store.setState({ transform: [x, y, zoom] });
  }, [store, x, y, zoom]);
  return null;
}

function gridAt(x: number, y: number, zoom: number, props: Parameters<typeof CanvasGrid>[0] = {}) {
  const { container } = render(
    <ReactFlowProvider>
      <View x={x} y={y} zoom={zoom} />
      <CanvasGrid {...props} />
    </ReactFlowProvider>,
  );
  return container.querySelector<HTMLElement>('.canvas-grid')!;
}

describe('CanvasGrid', () => {
  it('draws one dot per grid step and is hidden from assistive technology', () => {
    const grid = gridAt(0, 0, 1);

    expect(grid).toHaveAttribute('aria-hidden', 'true');
    expect(grid.style.backgroundSize).toBe('20px 20px');
    // The dot of a tile sits in its middle; half a tile puts it on the grid.
    expect(grid.style.backgroundPosition).toBe('10px 10px');
    expect(grid.style.opacity).toBe('0.25');
  });

  it('moves with a pan by the remainder of a step, never further', () => {
    const grid = gridAt(45, -5, 1);

    // 45 is two steps and 5; -5 is one step back and 15.
    expect(grid.style.transform).toBe('translate(5px, 15px)');
    // One step larger on every side, so the canvas stays covered.
    expect(grid.style.inset).toBe('-20px');
  });

  it('follows the zoom with the size of its steps', () => {
    const grid = gridAt(0, 0, 1.5, { gap: 20 });

    expect(grid.style.backgroundSize).toBe('30px 30px');
    expect(grid.style.opacity).toBe('0.25');
  });

  it('fades when zoomed out instead of covering the canvas in dots', () => {
    const near = gridAt(0, 0, 1, { opacity: 0.4 });
    const far = gridAt(0, 0, 0.3, { opacity: 0.4 });

    expect(Number(near.style.opacity)).toBe(0.4);
    expect(Number(far.style.opacity)).toBeLessThan(0.05);
    expect(far.style.backgroundSize).toBe('6px 6px');
  });
});
