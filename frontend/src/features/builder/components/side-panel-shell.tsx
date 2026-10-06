import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { cn } from '../../../lib/utils';

const WIDTH_KEY = 'hlb-side-panel-width';
const DEFAULT_WIDTH = 380;
const MIN_WIDTH = 320;
const MAX_WIDTH = 640;
const KEY_STEP = 20;

const clampWidth = (width: number) => Math.min(Math.max(Math.round(width), MIN_WIDTH), MAX_WIDTH);

function storedWidth(): number {
  try {
    const stored = Number(localStorage.getItem(WIDTH_KEY));
    if (Number.isFinite(stored) && stored > 0) return clampWidth(stored);
  } catch {
    // No storage: the default width is fine.
  }
  return DEFAULT_WIDTH;
}

/**
 * The panel beside the canvas (assistant, list of proposed changes). Its left
 * edge can be dragged, or moved with the arrow keys, to make it wider; the
 * width is remembered on this browser. On a narrow screen it covers the canvas
 * and has no width of its own.
 */
export function SidePanelShell({ children, className }: { children: ReactNode; className?: string }) {
  const [width, setWidth] = useState(storedWidth);
  const drag = useRef<{ startX: number; startWidth: number } | null>(null);

  const remember = useCallback((next: number) => {
    try {
      localStorage.setItem(WIDTH_KEY, String(next));
    } catch {
      // See storedWidth.
    }
  }, []);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    drag.current = { startX: event.clientX, startWidth: width };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    // The panel is on the right: dragging left makes it wider.
    setWidth(clampWidth(drag.current.startWidth + drag.current.startX - event.clientX));
  };
  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    drag.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
    remember(width);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const delta = event.key === 'ArrowLeft' ? KEY_STEP : event.key === 'ArrowRight' ? -KEY_STEP : 0;
    if (delta === 0) return;
    event.preventDefault();
    const next = clampWidth(width + delta);
    setWidth(next);
    remember(next);
  };

  // A canvas that changes size has to be told, or it keeps its old viewport.
  useEffect(() => {
    window.dispatchEvent(new Event('resize'));
  }, [width]);

  return (
    <aside
      className={cn(
        'builder-side-panel relative flex h-full shrink-0 flex-col border-l bg-card max-md:absolute max-md:inset-y-0 max-md:right-0 max-md:z-40 max-md:!w-full',
        className,
      )}
      style={{ width }}
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize the side panel"
        aria-valuemin={MIN_WIDTH}
        aria-valuemax={MAX_WIDTH}
        aria-valuenow={width}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={onKeyDown}
        className="builder-side-resizer absolute inset-y-0 -left-1 z-10 w-2 cursor-col-resize touch-none outline-none max-md:hidden"
      />
      {children}
    </aside>
  );
}
