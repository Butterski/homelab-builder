import { cardsOf, measureLayout, routeOf } from './metrics';
import { place, type FeederSides } from './place';
import { boundsOf } from './geometry';
import { buildForest, type Forest } from './structure';
import type {
  LayoutGraph,
  LayoutMetrics,
  LayoutOptions,
  LayoutResult,
  LayoutStyle,
  Point,
  Rect,
} from './types';
import { buildUnits, type UnitGraph } from './units';

export type { LayoutGraph, LayoutMetrics, LayoutResult, LayoutStyle } from './types';

export const LAYOUT_STYLES: Array<{ id: LayoutStyle; label: string; description: string }> = [
  {
    id: 'hierarchy',
    label: 'Hierarchy',
    description: 'Internet at the top, each hub with its devices in a row below. Rows fold only when the network would not fit a screen.',
  },
  {
    id: 'compact',
    label: 'Compact',
    description: 'The same tree, tighter. Rows fold into two as soon as a hub has many devices.',
  },
];

const EMPTY_METRICS: LayoutMetrics = {
  overlaps: 0,
  treeCrossings: 0,
  otherCrossings: 0,
  treeCableHits: 0,
  otherCableHits: 0,
  wrappedCables: 0,
  bounds: { x: 0, y: 0, width: 0, height: 0 },
  cableLength: 0,
};

/** What a secondary link costs the drawing; lower is better. */
const secondaryCost = (metrics: LayoutMetrics) =>
  metrics.otherCableHits * 4 + metrics.otherCrossings;

/**
 * Arranges a canvas. Pure: it reads sizes, positions and cables, and returns
 * where every top-level node should go. Devices in a rack move with their rack.
 */
export function computeLayout(graph: LayoutGraph, options: LayoutOptions): LayoutResult {
  const units = buildUnits(graph);
  if (units.order.length === 0) {
    return { positions: [], metrics: EMPTY_METRICS, usedEstimates: false };
  }
  const forest = buildForest(units);
  const foldWidth = chooseFoldWidth(units, forest, options.style);

  // A feeder (a UPS, a second modem) stands beside what it feeds. Which side is
  // tried out: the one where its cables run over fewer cards and cables wins.
  const sides: FeederSides = new Map();
  let at = place(units, forest, options.style, sides, foldWidth);
  let metrics = measureLayout(units, forest, at);
  for (const feeder of forest.feeders) {
    if (feeder.crown) continue;
    sides.set(feeder.root, 'right');
    const otherAt = place(units, forest, options.style, sides, foldWidth);
    const otherMetrics = measureLayout(units, forest, otherAt);
    if (secondaryCost(otherMetrics) < secondaryCost(metrics)) {
      at = otherAt;
      metrics = otherMetrics;
    } else {
      sides.delete(feeder.root);
    }
  }

  const positions = units.order.map(id => {
    const unit = units.units.get(id)!;
    const box = at.get(id)!;
    return { id, x: box.x + unit.nodeDX, y: box.y + unit.nodeDY };
  });
  return {
    positions,
    metrics,
    usedEstimates: units.order.some(id => units.units.get(id)!.estimated),
  };
}

/**
 * How wide a drawing may get before its rows start to fold. A network of a
 * dozen devices is drawn as a plain tree; one of sixty would be a ribbon ten
 * screens wide, which no zoom level makes readable.
 */
const ROOM: Record<LayoutStyle, { width: number; shape: number }> = {
  // Fine as long as it is at most this wide, or no flatter than this (width / height).
  hierarchy: { width: 3200, shape: 4 },
  compact: { width: 2000, shape: 2 },
};

/** Rows wider than one of these are folded; tried from no folding to a lot of it. */
const FOLD_WIDTHS = [Infinity, 4800, 3200, 2400, 1600, 1000];

/** The least folding that gives the drawing a readable shape, or failing that the best shape on offer. */
function chooseFoldWidth(units: UnitGraph, forest: Forest, style: LayoutStyle): number {
  const room = ROOM[style];
  let best = { foldWidth: Infinity, shape: Infinity };
  for (const foldWidth of FOLD_WIDTHS) {
    const at = place(units, forest, style, new Map(), foldWidth);
    const outline = boundsOf(cardsOf(units, at));
    const shape = outline.width / Math.max(outline.height, 1);
    if (outline.width <= room.width || shape <= room.shape) return foldWidth;
    if (shape < best.shape - 1e-9) best = { foldWidth, shape };
  }
  return best.foldWidth;
}

/** The same graph with a layout's positions written into it. */
export function withPositions(graph: LayoutGraph, positions: LayoutResult['positions']): LayoutGraph {
  const moved = new Map(positions.map(position => [position.id, position]));
  return {
    edges: graph.edges,
    nodes: graph.nodes.map(node => {
      const position = moved.get(node.id);
      return position && !node.parentId ? { ...node, x: position.x, y: position.y } : node;
    }),
  };
}

/** A drawing of a graph as it stands: every card and every cable run, for thumbnails. */
export interface LayoutPicture {
  cards: Array<Rect & { nodeId: string; rack: boolean; type: string }>;
  cables: Array<{ points: Point[]; tree: boolean }>;
  bounds: Rect;
  metrics: LayoutMetrics;
}

export function pictureOf(graph: LayoutGraph): LayoutPicture {
  const units = buildUnits(graph);
  const forest = buildForest(units);
  const at = new Map<string, Point>();
  for (const id of units.order) {
    const unit = units.units.get(id)!;
    at.set(id, { x: unit.x, y: unit.y });
  }
  const types = new Map(graph.nodes.map(node => [node.id, node.type]));
  const metrics = units.order.length > 0 ? measureLayout(units, forest, at) : EMPTY_METRICS;
  return {
    cards: cardsOf(units, at).map(card => ({
      ...card,
      rack: types.get(card.nodeId) === 'rack',
      type: types.get(card.nodeId) ?? 'pc',
    })),
    cables: units.links.map(link => ({
      points: routeOf(link, at),
      tree: forest.tree.has(link.id),
    })),
    bounds: metrics.bounds,
    metrics,
  };
}
