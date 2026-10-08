import type { Point, Rect } from './types';

/** The canvas grid; cards dragged by hand snap to it. */
const GRID = 20;

export const snap = (value: number) => Math.round(value / GRID) * GRID;
export const snapUp = (value: number) => Math.ceil(value / GRID) * GRID;
export const snapDown = (value: number) => Math.floor(value / GRID) * GRID;

/** A straight run of cable. Routes consist of horizontal and vertical runs only. */
export type Segment = { a: Point; b: Point };

export function segmentsOf(route: Point[]): Segment[] {
  const segments: Segment[] = [];
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1];
    const b = route[i];
    if (a.x !== b.x || a.y !== b.y) segments.push({ a, b });
  }
  return segments;
}

export function segmentLength(segment: Segment): number {
  return Math.abs(segment.b.x - segment.a.x) + Math.abs(segment.b.y - segment.a.y);
}

/** The rectangle a run of cable occupies when it is `pad` wide on each side. */
export function segmentBox(segment: Segment, pad = 0): Rect {
  const x = Math.min(segment.a.x, segment.b.x) - pad;
  const y = Math.min(segment.a.y, segment.b.y) - pad;
  return {
    x,
    y,
    width: Math.abs(segment.b.x - segment.a.x) + 2 * pad,
    height: Math.abs(segment.b.y - segment.a.y) + 2 * pad,
  };
}

export function rectsOverlap(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
  );
}

export function boundsOf(rects: Rect[]): Rect {
  if (rects.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const rect of rects) {
    left = Math.min(left, rect.x);
    top = Math.min(top, rect.y);
    right = Math.max(right, rect.x + rect.width);
    bottom = Math.max(bottom, rect.y + rect.height);
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** Runs that reach this close to each other's end touch; they do not cross. */
const TOUCHING = 0.01;

/**
 * Where two runs of cable cross, if they do: one passes through the other, each
 * at a point strictly inside it. Runs that lie on top of each other (a shared bus)
 * and runs that merely touch (a drop leaving the bus) do not count, because
 * that is how a tidy drawing looks.
 */
export function crossingOf(first: Segment, second: Segment): Point | null {
  const firstVertical = first.a.x === first.b.x;
  const secondVertical = second.a.x === second.b.x;
  if (firstVertical === secondVertical) return null;
  const vertical = firstVertical ? first : second;
  const horizontal = firstVertical ? second : first;
  const x = vertical.a.x;
  const y = horizontal.a.y;
  const left = Math.min(horizontal.a.x, horizontal.b.x) + TOUCHING;
  const right = Math.max(horizontal.a.x, horizontal.b.x) - TOUCHING;
  const top = Math.min(vertical.a.y, vertical.b.y) + TOUCHING;
  const bottom = Math.max(vertical.a.y, vertical.b.y) - TOUCHING;
  return left < x && x < right && top < y && y < bottom ? { x, y } : null;
}

/** Whether a run of cable passes through the inside of a rectangle (touching its edge does not count). */
export function segmentCutsRect(segment: Segment, rect: Rect): boolean {
  const left = Math.min(segment.a.x, segment.b.x);
  const right = Math.max(segment.a.x, segment.b.x);
  const top = Math.min(segment.a.y, segment.b.y);
  const bottom = Math.max(segment.a.y, segment.b.y);
  if (segment.a.x === segment.b.x) {
    return left > rect.x && left < rect.x + rect.width && top < rect.y + rect.height && bottom > rect.y;
  }
  return top > rect.y && top < rect.y + rect.height && left < rect.x + rect.width && right > rect.x;
}
