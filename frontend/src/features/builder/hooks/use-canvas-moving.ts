import { useCallback, useEffect, useRef, type RefObject } from 'react';

/**
 * How long the canvas stays marked after a move has ended. Every notch of a
 * mouse wheel is a move of its own; without the wait each notch would make the
 * layer and throw it away again, which costs two paintings instead of one.
 */
const MOVE_SETTLE_MS = 250;

/**
 * Handlers for `<ReactFlow>` that mark an element around the canvas while the
 * view is being moved. The mark gives the canvas a compositor layer for that
 * time (`[data-canvas-moving]` in index.css), so a pan moves a picture instead
 * of painting every card again. It is taken off when the move has ended, or
 * the cards would stay at the sharpness they had before a zoom.
 *
 * A data attribute, set directly: a class would be lost when React writes the
 * class list, and state would render the canvas twice for every pan.
 */
export function useCanvasMoving(around: RefObject<HTMLElement | null>) {
  const settling = useRef<number | undefined>(undefined);
  const onMoveStart = useCallback(() => {
    window.clearTimeout(settling.current);
    around.current?.setAttribute('data-canvas-moving', '');
  }, [around]);
  const onMoveEnd = useCallback(() => {
    window.clearTimeout(settling.current);
    settling.current = window.setTimeout(
      () => around.current?.removeAttribute('data-canvas-moving'),
      MOVE_SETTLE_MS,
    );
  }, [around]);
  useEffect(() => () => window.clearTimeout(settling.current), []);
  return { onMoveStart, onMoveEnd };
}
