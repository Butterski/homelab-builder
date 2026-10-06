import { Position } from '@xyflow/react';
import { stepBusY } from './layout/route';
import type { Side } from './layout/types';

function sideOf(position: Position): Side | null {
  if (position === Position.Top) return 'top';
  if (position === Position.Bottom) return 'bottom';
  return null;
}

/**
 * `centerY` for React Flow's step path between two handles: the sideways run
 * sits just under the port. Undefined lets React Flow decide, which is the case
 * for cables attached to the side of a card (the "floating" connection style)
 * and for ends that are too close to route cleanly.
 */
export function stepCableBusY(
  sourceY: number,
  sourcePosition: Position,
  targetY: number,
  targetPosition: Position,
): number | undefined {
  const from = sideOf(sourcePosition);
  const to = sideOf(targetPosition);
  if (!from || !to) return undefined;
  return stepBusY(sourceY, from, targetY, to);
}
