import type { Point, Side } from './types';

/**
 * How a step-style cable runs between two cards.
 *
 * The canvas draws cables with React Flow's `getSmoothStepPath`. This file
 * reproduces the corner points of that path for the only handle sides the
 * builder has (top and bottom), with one deliberate difference from React
 * Flow's default: the sideways run sits just under the port instead of halfway
 * between the two cards. `custom-edge.tsx` passes the same value to React Flow,
 * and `route.test.ts` compares this file with the installed path function, so
 * the layout engine and the canvas cannot drift apart unnoticed.
 */

/** React Flow keeps a cable straight for this long after a handle before it may turn. */
const HANDLE_GAP = 20;

/** How far under its port a cable runs sideways. */
export const CABLE_BUS_OFFSET = 30;

/** A cable leaves a port and enters a top handle cleanly only if they are further apart than this. */
const MIN_CLEAN_DROP = 2 * HANDLE_GAP;

/**
 * The y of the sideways run for a cable between a bottom port and a top handle,
 * or undefined when React Flow should decide (same-side handles, ends too close).
 * Pass the result as `centerY` to `getSmoothStepPath`.
 */
export function stepBusY(
  sourceY: number,
  sourceSide: Side,
  targetY: number,
  targetSide: Side,
): number | undefined {
  if (sourceSide === 'bottom' && targetSide === 'top' && targetY - sourceY > MIN_CLEAN_DROP) {
    return Math.min(sourceY + CABLE_BUS_OFFSET, targetY - HANDLE_GAP);
  }
  if (sourceSide === 'top' && targetSide === 'bottom' && sourceY - targetY > MIN_CLEAN_DROP) {
    // The port is at the target end here: the cable was drawn from the device up to the hub.
    return Math.min(targetY + CABLE_BUS_OFFSET, sourceY - HANDLE_GAP);
  }
  return undefined;
}

const direction = (side: Side) => (side === 'bottom' ? 1 : -1);

/**
 * The corner points of a cable from `source` to `target`, both ends included.
 * Consecutive points are joined by straight horizontal or vertical runs.
 */
export function cableRoute(source: Point, sourceSide: Side, target: Point, targetSide: Side): Point[] {
  const sourceDir = direction(sourceSide);
  const targetDir = direction(targetSide);
  const sourceGapped = { x: source.x, y: source.y + sourceDir * HANDLE_GAP };
  const targetGapped = { x: target.x, y: target.y + targetDir * HANDLE_GAP };
  const heading = sourceGapped.y < targetGapped.y ? 1 : -1;

  let middle: Point[];
  let sourceShift = 0;
  let targetShift = 0;

  if (sourceDir !== targetDir) {
    if (sourceDir === heading) {
      // Port above, handle below (or the mirror image): down, across, down.
      const busY =
        stepBusY(source.y, sourceSide, target.y, targetSide) ??
        sourceGapped.y + (targetGapped.y - sourceGapped.y) / 2;
      middle = [
        { x: sourceGapped.x, y: busY },
        { x: targetGapped.x, y: busY },
      ];
    } else {
      // The ends face away from each other: React Flow wraps around through the middle.
      const centerX = (sourceGapped.x + targetGapped.x) / 2;
      middle = [
        { x: centerX, y: sourceGapped.y },
        { x: centerX, y: targetGapped.y },
      ];
    }
  } else {
    // Both ends on the same side: one corner, taken at the end that is further along.
    middle =
      sourceDir === heading
        ? [{ x: sourceGapped.x, y: targetGapped.y }]
        : [{ x: targetGapped.x, y: sourceGapped.y }];
    const apart = Math.abs(source.y - target.y);
    if (apart <= HANDLE_GAP) {
      const shift = Math.min(HANDLE_GAP - 1, HANDLE_GAP - apart);
      if (sourceDir === heading) sourceShift = (sourceGapped.y > source.y ? -1 : 1) * shift;
      else targetShift = (targetGapped.y > target.y ? -1 : 1) * shift;
    }
  }

  return [
    source,
    { x: sourceGapped.x, y: sourceGapped.y + sourceShift },
    ...middle,
    { x: targetGapped.x, y: targetGapped.y + targetShift },
    target,
  ];
}

/** True when React Flow routes this cable around instead of straight down: the ends are too close or reversed. */
export function isWrapped(source: Point, sourceSide: Side, target: Point, targetSide: Side): boolean {
  if (sourceSide === targetSide) return true;
  return stepBusY(source.y, sourceSide, target.y, targetSide) === undefined;
}

/** Coordinates closer than this are the same place; the difference is rounding. */
const SAME_PLACE = 1e-6;

/** A route without repeated points and without points in the middle of a straight run. */
export function simplifyRoute(points: Point[]): Point[] {
  const result: Point[] = [];
  for (const raw of points) {
    const last = result[result.length - 1];
    // A port placed exactly over a handle can be off by rounding, which would
    // turn one straight drop into two runs with an invisible step between them.
    const point = last
      ? {
          x: Math.abs(raw.x - last.x) < SAME_PLACE ? last.x : raw.x,
          y: Math.abs(raw.y - last.y) < SAME_PLACE ? last.y : raw.y,
        }
      : raw;
    if (last && last.x === point.x && last.y === point.y) continue;
    const before = result[result.length - 2];
    if (
      before &&
      last &&
      ((before.x === last.x && last.x === point.x) || (before.y === last.y && last.y === point.y))
    ) {
      result[result.length - 1] = point;
      continue;
    }
    result.push(point);
  }
  return result;
}
