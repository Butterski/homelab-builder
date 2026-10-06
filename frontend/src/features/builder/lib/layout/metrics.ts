import {
  boundsOf,
  crossingOf,
  rectsOverlap,
  segmentCutsRect,
  segmentLength,
  segmentsOf,
  type Segment,
} from './geometry';
import { cableRoute, isWrapped, simplifyRoute } from './route';
import type { Forest } from './structure';
import type { LayoutMetrics, Point, Rect } from './types';
import type { Link, UnitGraph } from './units';

/**
 * Where a cable runs, with its units at the given places: corner points only.
 * A straight drop has to be one run, or a cable crossing it at the height of a
 * corner that is not there would go unnoticed.
 */
export function routeOf(link: Link, at: Map<string, Point>): Point[] {
  const from = at.get(link.from.unit) as Point;
  const to = at.get(link.to.unit) as Point;
  return simplifyRoute(
    cableRoute(
      { x: from.x + link.from.at.x, y: from.y + link.from.at.y },
      link.from.side,
      { x: to.x + link.to.at.x, y: to.y + link.to.at.y },
      link.to.side,
    ),
  );
}

/** Every card on the canvas with the unit it belongs to. */
export function cardsOf(graph: UnitGraph, at: Map<string, Point>): Array<Rect & { unit: string; nodeId: string }> {
  const cards: Array<Rect & { unit: string; nodeId: string }> = [];
  for (const id of graph.order) {
    const unit = graph.units.get(id);
    const origin = at.get(id);
    if (!unit || !origin) continue;
    for (const card of unit.cards) {
      cards.push({
        unit: id,
        nodeId: card.nodeId,
        x: origin.x + card.x,
        y: origin.y + card.y,
        width: card.width,
        height: card.height,
      });
    }
  }
  return cards;
}

/**
 * Measures a layout the way a person judges it: do cards overlap, do cables
 * cross, does a cable run over a card. Everything is computed from the routes
 * the canvas draws, so "no crossings" here means none on screen.
 *
 * Two things are counted apart, because no arrangement of the cards can change
 * them. "Tree" numbers are about the cables the layout is built on, and the
 * layout keeps them at zero. "Other" numbers are about the rest: links that
 * close a loop, power feeds and tunnels across branches, and what happens
 * inside a rack, where devices keep their slots: a cable into the third device
 * passes the two above it and crosses what leaves them. Likewise a cable is
 * never held against the cards of its own two units.
 */
export function measureLayout(
  graph: UnitGraph,
  forest: Forest,
  at: Map<string, Point>,
): LayoutMetrics {
  const cards = cardsOf(graph, at);

  let overlaps = 0;
  for (let i = 0; i < cards.length; i++) {
    for (let j = i + 1; j < cards.length; j++) {
      if (cards[i].unit !== cards[j].unit && rectsOverlap(cards[i], cards[j])) overlaps += 1;
    }
  }

  const rackBox = (id: string): Rect | null => {
    const unit = graph.units.get(id);
    const origin = at.get(id);
    if (!unit?.isRack || !origin) return null;
    return { x: origin.x, y: origin.y, width: unit.width, height: unit.height };
  };

  const cables = graph.links.map(link => ({
    link,
    tree: forest.tree.has(link.id),
    segments: segmentsOf(routeOf(link, at)),
    wrapped: isWrapped(
      pointOf(link.from.unit, link.from.at, at),
      link.from.side,
      pointOf(link.to.unit, link.to.at, at),
      link.to.side,
    ),
  }));

  let treeCrossings = 0;
  let otherCrossings = 0;
  for (let i = 0; i < cables.length; i++) {
    for (let j = i + 1; j < cables.length; j++) {
      const points = crossingsOf(cables[i].segments, cables[j].segments);
      if (points.length === 0) continue;
      // Racks both cables are plugged into.
      const first = cables[i].link;
      const second = cables[j].link;
      const racks = [first.from.unit, first.to.unit]
        .filter(id => id === second.from.unit || id === second.to.unit)
        .map(rackBox)
        .filter((box): box is Rect => box !== null);
      for (const point of points) {
        const inRack = racks.some(
          box =>
            point.x > box.x &&
            point.x < box.x + box.width &&
            point.y > box.y &&
            point.y < box.y + box.height,
        );
        if (cables[i].tree && cables[j].tree && !inRack) treeCrossings += 1;
        else otherCrossings += 1;
      }
    }
  }

  let treeCableHits = 0;
  let otherCableHits = 0;
  let cableLength = 0;
  for (const cable of cables) {
    for (const segment of cable.segments) cableLength += segmentLength(segment);
    for (const card of cards) {
      if (card.unit === cable.link.from.unit || card.unit === cable.link.to.unit) continue;
      if (!cable.segments.some(segment => segmentCutsRect(segment, card))) continue;
      if (cable.tree) treeCableHits += 1;
      else otherCableHits += 1;
    }
  }

  return {
    overlaps,
    treeCrossings,
    otherCrossings,
    treeCableHits,
    otherCableHits,
    wrappedCables: cables.filter(cable => cable.wrapped).length,
    bounds: boundsOf(cards),
    cableLength: Math.round(cableLength),
  };
}

function pointOf(unit: string, offset: Point, at: Map<string, Point>): Point {
  const origin = at.get(unit) as Point;
  return { x: origin.x + offset.x, y: origin.y + offset.y };
}

function crossingsOf(first: Segment[], second: Segment[]): Point[] {
  const points: Point[] = [];
  for (const a of first) {
    for (const b of second) {
      const point = crossingOf(a, b);
      if (point) points.push(point);
    }
  }
  return points;
}
