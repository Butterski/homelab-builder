import type { HardwareType } from '../../../../types';
import type { LayoutEdge, LayoutGraph, LayoutNode, Medium, Point, Rect, Side } from './types';

/**
 * A unit is what the layout moves as one piece: a card, or a rack together
 * with everything in it. Devices never move inside their rack, and a cable
 * between two devices of the same rack plays no part in the layout.
 */
export interface Unit {
  /** The id of the card or rack. */
  id: string;
  type: HardwareType;
  name: string;
  isRack: boolean;
  /** Size of the box around the node and, for a rack, around what sticks out of it. */
  width: number;
  height: number;
  /** Where the node itself sits inside that box. */
  nodeDX: number;
  nodeDY: number;
  /** Where the box is now. */
  x: number;
  y: number;
  /** Every card in the unit, relative to the box. A rack's own frame comes first. */
  cards: Array<Rect & { nodeId: string }>;
  zoneRoot: boolean;
  estimated: boolean;
}

/** One end of a cable: which card and port it is attached to, and where that is in the unit's box. */
export interface LinkEnd {
  unit: string;
  node: string;
  handle: string;
  side: Side;
  /** Port number for a bottom handle; -1 for the handle on top. */
  port: number;
  at: Point;
}

/** A cable between two different units, as drawn: `from` is the edge's source. */
export interface Link {
  id: string;
  medium: Medium;
  from: LinkEnd;
  to: LinkEnd;
}

export interface UnitGraph {
  units: Map<string, Unit>;
  /** Unit ids in a stable order: by id, so input order never matters. */
  order: string[];
  links: Link[];
  /** Which unit a node belongs to. */
  unitOf: Map<string, string>;
}

/** The handle on top of a card; every other handle is a port on the bottom edge. */
export const TOP_HANDLE = 'target-0';

/** Distance of a cable's end from the card edge, from the size of the handle elements. */
const TOP_ANCHOR = 3;
const HUB_PORT_ANCHOR = 4;
const SINGLE_PORT_ANCHOR = 6;

function sideOfHandle(handle: string): Side {
  return handle === TOP_HANDLE ? 'top' : 'bottom';
}

function portOfHandle(handle: string): number {
  const match = /^eth(\d+)$/.exec(handle);
  return match ? Number(match[1]) : 0;
}

/** Where a cable attached to `handle` ends, relative to the card's top-left corner. */
function handleAnchor(node: LayoutNode, handle: string): Point {
  if (sideOfHandle(handle) === 'top') return { x: node.width / 2, y: -TOP_ANCHOR };
  if (!node.spreadPorts) return { x: node.width / 2, y: node.height + SINGLE_PORT_ANCHOR };
  const port = Math.min(portOfHandle(handle), Math.max(0, node.ports - 1));
  return { x: (node.width * (port + 1)) / (node.ports + 1), y: node.height + HUB_PORT_ANCHOR };
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

/** Groups nodes into units and keeps the cables that run between different units. */
export function buildUnits(graph: LayoutGraph): UnitGraph {
  const byId = new Map(graph.nodes.map(node => [node.id, node]));
  const childrenOf = new Map<string, LayoutNode[]>();
  for (const node of graph.nodes) {
    const rack = node.parentId ? byId.get(node.parentId) : undefined;
    if (!rack) continue;
    childrenOf.set(rack.id, [...(childrenOf.get(rack.id) ?? []), node]);
  }

  const units = new Map<string, Unit>();
  const unitOf = new Map<string, string>();
  /** Where each node sits inside its unit's box. */
  const offsetOf = new Map<string, Point>();

  for (const node of graph.nodes) {
    // A device whose rack is missing from the graph is laid out on its own.
    if (node.parentId && byId.has(node.parentId)) continue;

    const members = (childrenOf.get(node.id) ?? []).toSorted((a, b) => a.id.localeCompare(b.id));
    // React Flow keeps a racked card inside the rack; a card wider than the
    // rack ends up sticking out on the left.
    const placed = members.map(member => ({
      node: member,
      x: clamp(member.x, 0, node.width - member.width),
      y: clamp(member.y, 0, node.height - member.height),
    }));
    const left = Math.min(0, ...placed.map(member => member.x));
    const top = Math.min(0, ...placed.map(member => member.y));
    const right = Math.max(node.width, ...placed.map(member => member.x + member.node.width));
    const bottom = Math.max(node.height, ...placed.map(member => member.y + member.node.height));

    const unit: Unit = {
      id: node.id,
      type: node.type,
      name: node.name,
      isRack: node.type === 'rack',
      width: right - left,
      height: bottom - top,
      nodeDX: -left,
      nodeDY: -top,
      x: node.x + left,
      y: node.y + top,
      cards: [{ nodeId: node.id, x: -left, y: -top, width: node.width, height: node.height }],
      zoneRoot: node.zoneRoot,
      estimated: node.estimated || members.some(member => member.estimated),
    };
    unitOf.set(node.id, node.id);
    offsetOf.set(node.id, { x: -left, y: -top });
    for (const member of placed) {
      unit.cards.push({
        nodeId: member.node.id,
        x: member.x - left,
        y: member.y - top,
        width: member.node.width,
        height: member.node.height,
      });
      unitOf.set(member.node.id, node.id);
      offsetOf.set(member.node.id, { x: member.x - left, y: member.y - top });
    }
    units.set(unit.id, unit);
  }

  const end = (nodeId: string, handle: string): LinkEnd | null => {
    const node = byId.get(nodeId);
    const unit = unitOf.get(nodeId);
    const offset = offsetOf.get(nodeId);
    if (!node || !unit || !offset) return null;
    const anchor = handleAnchor(node, handle);
    const side = sideOfHandle(handle);
    return {
      unit,
      node: nodeId,
      handle,
      side,
      port: side === 'top' ? -1 : portOfHandle(handle),
      at: { x: offset.x + anchor.x, y: offset.y + anchor.y },
    };
  };

  const links: Link[] = [];
  for (const edge of graph.edges.toSorted(compareEdges)) {
    const from = end(edge.source, edge.sourceHandle);
    const to = end(edge.target, edge.targetHandle);
    if (!from || !to || from.unit === to.unit) continue;
    links.push({ id: edge.id, medium: edge.medium, from, to });
  }

  return { units, order: [...units.keys()].sort(), links, unitOf };
}

/** Edge ids change on every save, so cables are ordered by what they connect. */
function compareEdges(a: LayoutEdge, b: LayoutEdge): number {
  return (
    a.source.localeCompare(b.source) ||
    a.target.localeCompare(b.target) ||
    a.sourceHandle.localeCompare(b.sourceHandle) ||
    a.targetHandle.localeCompare(b.targetHandle)
  );
}
