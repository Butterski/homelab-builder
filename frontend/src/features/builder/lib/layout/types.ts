import type { HardwareType } from '../../../../types';

export type Point = { x: number; y: number };
export type Rect = { x: number; y: number; width: number; height: number };

/** How a link is carried. A power feed is any link with a UPS or PDU at one end. */
export type Medium = 'ethernet' | 'wireless' | 'vpn' | 'power';

/** Which edge of a card a cable is attached to: the uplink handle is on top, ports are below. */
export type Side = 'top' | 'bottom';

export type LayoutStyle = 'hierarchy' | 'compact';

/** A card or a rack as the layout sees it. Positions are canvas coordinates. */
export interface LayoutNode {
  id: string;
  type: HardwareType;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** True when the size is a guess because the card has not been measured yet. */
  estimated: boolean;
  /** The rack this device sits in. Its x and y are then relative to the rack. */
  parentId?: string;
  /** Number of ports along the bottom edge; 1 for devices with a single port. */
  ports: number;
  /** Hubs spread their ports along the edge; other devices have one in the middle. */
  spreadPorts: boolean;
  /** Everything behind this device is drawn inside one zone outline (NAT, firewall). */
  zoneRoot: boolean;
}

export interface LayoutEdge {
  id: string;
  source: string;
  target: string;
  /** Handle ids as React Flow stores them: `target-0` is the top, `ethN` a port. */
  sourceHandle: string;
  targetHandle: string;
  medium: Medium;
}

export interface LayoutGraph {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
}

export interface LayoutOptions {
  style: LayoutStyle;
}

/** What a layout looks like in numbers. All of it is computed from the routes the canvas draws. */
export interface LayoutMetrics {
  /** Pairs of cards or racks that overlap. */
  overlaps: number;
  /** Places where two cables of the tree cross each other. The layout keeps this at zero. */
  treeCrossings: number;
  /**
   * Crossings no arrangement of the cards settles: those of a secondary link (a
   * UPS feed, a second uplink, a tunnel, a cable that closes a loop), and those
   * inside a rack between cables of that rack.
   */
  otherCrossings: number;
  /** Cards a tree cable runs over. The layout keeps this at zero. */
  treeCableHits: number;
  /** Cards a secondary link runs over. */
  otherCableHits: number;
  /** Cables React Flow has to route around a card because their ends are too close or reversed. */
  wrappedCables: number;
  bounds: Rect;
  /** Total length of all cables, in pixels. */
  cableLength: number;
}

export interface LayoutResult {
  /** New positions of top-level nodes. Devices in a rack keep their place in it. */
  positions: Array<{ id: string; x: number; y: number }>;
  metrics: LayoutMetrics;
  /** True when a size was guessed; running the layout again after the first paint is exact. */
  usedEstimates: boolean;
}
