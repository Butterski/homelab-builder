import { describe, expect, it } from 'vitest';
import { getSmoothStepPath, Position } from '@xyflow/react';
import { stepCableBusY } from '../cable-path';
import { CABLE_BUS_OFFSET, cableRoute, isWrapped, simplifyRoute, stepBusY } from './route';
import type { Point, Side } from './types';

const POSITION: Record<Side, Position> = { top: Position.Top, bottom: Position.Bottom };

/**
 * The corner points React Flow draws for a cable, read back from its path with
 * square corners. This is what the canvas shows; the engine has to agree with it.
 */
function drawnRoute(source: Point, sourceSide: Side, target: Point, targetSide: Side): Point[] {
  const [path] = getSmoothStepPath({
    sourceX: source.x,
    sourceY: source.y,
    sourcePosition: POSITION[sourceSide],
    targetX: target.x,
    targetY: target.y,
    targetPosition: POSITION[targetSide],
    borderRadius: 0,
    centerY: stepCableBusY(source.y, POSITION[sourceSide], target.y, POSITION[targetSide]),
  });
  const numbers = path.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
  const points: Point[] = [];
  for (let i = 0; i < numbers.length; i += 2) points.push({ x: numbers[i], y: numbers[i + 1] });
  return simplifyRoute(points);
}

const SIDES: Side[] = ['top', 'bottom'];

describe('cableRoute', () => {
  it('draws what React Flow draws, for every pair of handle sides and distance', () => {
    const source = { x: 200, y: 300 };
    // Around the points where the route changes shape: 20 px (the handle gap)
    // and 40 px (two gaps), plus plain near and far cases, above and below.
    const offsetsY = [-400, -61, -41, -40, -39, -21, -20, -19, -1, 0, 1, 19, 20, 21, 39, 40, 41, 61, 400];
    const offsetsX = [-300, -20, 0, 20, 300];
    let compared = 0;
    for (const sourceSide of SIDES) {
      for (const targetSide of SIDES) {
        for (const dy of offsetsY) {
          for (const dx of offsetsX) {
            const target = { x: source.x + dx, y: source.y + dy };
            const mine = simplifyRoute(cableRoute(source, sourceSide, target, targetSide));
            const theirs = drawnRoute(source, sourceSide, target, targetSide);
            expect(mine, `${sourceSide} -> ${targetSide} dx=${dx} dy=${dy}`).toEqual(theirs);
            compared += 1;
          }
        }
      }
    }
    expect(compared).toBe(SIDES.length * SIDES.length * offsetsY.length * offsetsX.length);
  });

  it('turns just under the port instead of halfway down', () => {
    // A hub port at y=100 and a device 400 px further down.
    const route = cableRoute({ x: 0, y: 100 }, 'bottom', { x: 300, y: 500 }, 'top');
    expect(simplifyRoute(route)).toEqual([
      { x: 0, y: 100 },
      { x: 0, y: 100 + CABLE_BUS_OFFSET },
      { x: 300, y: 100 + CABLE_BUS_OFFSET },
      { x: 300, y: 500 },
    ]);
  });

  it('treats a cable drawn from the device up to the hub the same way', () => {
    // The port is the target end here; the run still sits under the port.
    const route = cableRoute({ x: 300, y: 500 }, 'top', { x: 0, y: 100 }, 'bottom');
    expect(simplifyRoute(route)).toEqual([
      { x: 300, y: 500 },
      { x: 300, y: 100 + CABLE_BUS_OFFSET },
      { x: 0, y: 100 + CABLE_BUS_OFFSET },
      { x: 0, y: 100 },
    ]);
  });

  it('never turns closer to the device than React Flow allows', () => {
    // 45 px apart: the run would be 30 px under the port, but only 15 px above
    // the device, so it moves up to stay 20 px clear of the handle.
    expect(stepBusY(100, 'bottom', 145, 'top')).toBe(125);
    expect(stepBusY(145, 'top', 100, 'bottom')).toBe(125);
  });

  it('leaves cables that cannot run straight down to React Flow', () => {
    expect(stepBusY(100, 'bottom', 140, 'top')).toBeUndefined();
    expect(stepBusY(100, 'bottom', 60, 'top')).toBeUndefined();
    expect(stepBusY(100, 'bottom', 400, 'bottom')).toBeUndefined();
    expect(isWrapped({ x: 0, y: 100 }, 'bottom', { x: 50, y: 130 }, 'top')).toBe(true);
    expect(isWrapped({ x: 0, y: 100 }, 'bottom', { x: 50, y: 400 }, 'bottom')).toBe(true);
    expect(isWrapped({ x: 0, y: 100 }, 'bottom', { x: 50, y: 400 }, 'top')).toBe(false);
  });
});
