import { useStore, type ReactFlowState } from '@xyflow/react';

const viewportTransform = (state: ReactFlowState) => state.transform;

/** Always the positive remainder, so the grid never slides off its edge. */
const wrap = (value: number, step: number) => ((value % step) + step) % step;

/** A dot is never drawn smaller than this; below it, it fades instead. */
const SMALLEST_DOT = 0.5;

type CanvasGridProps = {
  /** Distance between two dots, in canvas units. The canvas snaps to the same grid. */
  gap?: number;
  color?: string;
  /** How strong the dots are at full size. */
  opacity?: number;
};

/**
 * The dot grid behind a canvas.
 *
 * React Flow's own `<Background>` is an SVG pattern that is painted again,
 * over the whole canvas, on every frame of a pan. This one is a tiled CSS
 * background on a layer of its own (`.canvas-grid` in index.css): a pan only
 * moves the layer, and it is painted again when the zoom changes.
 */
export function CanvasGrid({ gap = 20, color = '#a1a1aa', opacity = 0.25 }: CanvasGridProps) {
  const [x, y, zoom] = useStore(viewportTransform);
  const step = gap * zoom;
  // A dot is half a canvas unit in radius. Zoomed out it would be a fraction of
  // a pixel: it keeps its smallest size and gets as faint as the area it lost,
  // so a far view is not covered in dots.
  const radius = zoom / 2;
  const drawn = Math.max(SMALLEST_DOT, radius);
  const faded = opacity * Math.min(1, (radius / SMALLEST_DOT) ** 2);

  return (
    <div
      aria-hidden="true"
      className="canvas-grid"
      style={{
        // One step larger on every side, so it still covers the canvas when moved.
        inset: -step,
        opacity: faded,
        // Half a pixel of soft edge, centred on the radius.
        backgroundImage: `radial-gradient(circle, ${color} ${drawn - 0.25}px, transparent ${drawn + 0.25}px)`,
        backgroundSize: `${step}px ${step}px`,
        // A dot sits in the middle of its tile; half a tile puts it on the grid.
        backgroundPosition: `${step / 2}px ${step / 2}px`,
        transform: `translate(${wrap(x, step)}px, ${wrap(y, step)}px)`,
      }}
    />
  );
}
