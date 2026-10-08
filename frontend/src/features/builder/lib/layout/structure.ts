import type { HardwareType } from '../../../../types';
import type { Medium } from './types';
import type { Link, LinkEnd, Unit, UnitGraph } from './units';

/** A cable with its direction decided: `upper` is drawn above `lower`. */
export interface DownLink {
  link: Link;
  upper: LinkEnd;
  lower: LinkEnd;
}

/** A group of power sources (a UPS, its PDU) or a spare uplink that hangs beside the tree it feeds. */
export interface Feeder {
  /** Root unit of the feeder's own little tree. */
  root: string;
  /** The unit in the fed tree it is placed beside, or above when `crown` is set. */
  beside: string;
  /** True when it feeds a root: it then sits in a row of its own above that root. */
  crown: boolean;
  /** Its cable to the topmost device it feeds. The ports at both upper ends go on one line. */
  feed: DownLink;
}

export interface Forest {
  /** The tree: one parent per unit, null for a root. */
  parent: Map<string, string | null>;
  /** The cable that makes a unit a child of its parent. */
  parentLink: Map<string, DownLink>;
  /** Children in the order they are drawn, left to right. */
  children: Map<string, string[]>;
  /** Distance from the root of the unit's tree. */
  depth: Map<string, number>;
  /** Roots of the trees that are laid out on their own, most internet-facing first. */
  roots: string[];
  feeders: Feeder[];
  /** Every cable with a direction, tree or not. */
  down: DownLink[];
  /** Ids of the cables that form the tree. */
  tree: Set<string>;
  /** Units without any cable to another unit. */
  loose: string[];
}

/** How close a device type usually is to the internet. Lower is further up. */
const UPSTREAM_RANK: Partial<Record<HardwareType, number>> = {
  modem: 0,
  router: 1,
  firewall: 2,
  switch: 3,
  access_point: 4,
  ups: 8,
  pdu: 9,
};

/** The order device types are listed in when nothing else decides. */
const TYPE_ORDER: Partial<Record<HardwareType, number>> = {
  modem: 0,
  router: 1,
  firewall: 2,
  switch: 3,
  access_point: 4,
  server_v2: 5,
  server: 6,
  nas: 7,
  vps: 8,
  minipc: 9,
  pc: 10,
  sbc: 11,
  iot: 12,
  console: 13,
  lan_table: 14,
  ups: 15,
  pdu: 16,
  rack: 17,
};

/** A cable beats Wi-Fi, Wi-Fi beats a tunnel, and a power feed comes last. */
const MEDIUM_RANK: Record<Medium, number> = { ethernet: 0, wireless: 1, vpn: 2, power: 3 };

const upstreamRank = (type: HardwareType) => UPSTREAM_RANK[type] ?? 5;
export const typeOrder = (type: HardwareType) => TYPE_ORDER[type] ?? 99;

const isNetworkMedium = (medium: Medium) => medium === 'ethernet' || medium === 'wireless';

/**
 * Turns the cabled units into a forest that can be drawn top-down.
 *
 * Every card has its uplink handle on top and its ports at the bottom, so a
 * cable has a natural direction: the end on a port is above, the end on a top
 * handle below. Following that keeps cables short and straight, whatever the
 * devices are.
 */
export function buildForest(graph: UnitGraph): Forest {
  const { units, order, links } = graph;
  const unit = (id: string) => units.get(id) as Unit;

  // ── Who is connected to whom, ignoring direction ──────────────────────────
  const neighbours = new Map<string, string[]>(order.map(id => [id, []]));
  for (const link of links) {
    neighbours.get(link.from.unit)?.push(link.to.unit);
    neighbours.get(link.to.unit)?.push(link.from.unit);
  }
  const loose = order.filter(id => neighbours.get(id)?.length === 0);

  // Distance from the most internet-facing unit of each connected group. It
  // only settles cables whose handles say nothing (port to port, top to top).
  const distance = new Map<string, number>();
  const byRank = order.toSorted(
    (a, b) => upstreamRank(unit(a).type) - upstreamRank(unit(b).type) || a.localeCompare(b),
  );
  for (const start of byRank) {
    if (distance.has(start) || loose.includes(start)) continue;
    distance.set(start, 0);
    const queue = [start];
    for (let i = 0; i < queue.length; i++) {
      const current = queue[i];
      for (const next of (neighbours.get(current) ?? []).toSorted()) {
        if (distance.has(next)) continue;
        distance.set(next, (distance.get(current) ?? 0) + 1);
        queue.push(next);
      }
    }
  }

  // ── Direction of every cable ──────────────────────────────────────────────
  const orient = (link: Link): DownLink => {
    const { from, to } = link;
    if (from.side !== to.side) {
      return from.side === 'bottom' ? { link, upper: from, lower: to } : { link, upper: to, lower: from };
    }
    const closer =
      (distance.get(from.unit) ?? 0) - (distance.get(to.unit) ?? 0) ||
      upstreamRank(unit(from.unit).type) - upstreamRank(unit(to.unit).type) ||
      from.unit.localeCompare(to.unit);
    return closer <= 0 ? { link, upper: from, lower: to } : { link, upper: to, lower: from };
  };

  // Cables are taken strongest first, and one that would close a circle is
  // left out of the ordering (it is still drawn, as a secondary link).
  const candidates = links.map(orient).toSorted(
    (a, b) =>
      MEDIUM_RANK[a.link.medium] - MEDIUM_RANK[b.link.medium] ||
      a.upper.unit.localeCompare(b.upper.unit) ||
      a.lower.unit.localeCompare(b.lower.unit) ||
      a.upper.port - b.upper.port,
  );
  const below = new Map<string, Set<string>>(order.map(id => [id, new Set<string>()]));
  const reaches = (from: string, to: string): boolean => {
    const seen = new Set([from]);
    const stack = [from];
    while (stack.length > 0) {
      const current = stack.pop() as string;
      if (current === to) return true;
      for (const next of below.get(current) ?? []) {
        if (!seen.has(next)) {
          seen.add(next);
          stack.push(next);
        }
      }
    }
    return false;
  };
  const down: DownLink[] = [];
  const ordered: DownLink[] = [];
  for (const candidate of candidates) {
    down.push(candidate);
    if (reaches(candidate.lower.unit, candidate.upper.unit)) continue;
    below.get(candidate.upper.unit)?.add(candidate.lower.unit);
    ordered.push(candidate);
  }

  // ── Levels: the longest way down, so no ordered cable ever points up ──────
  const incoming = new Map<string, DownLink[]>(order.map(id => [id, []]));
  for (const link of ordered) incoming.get(link.lower.unit)?.push(link);
  const level = new Map<string, number>();
  const levelOf = (id: string): number => {
    const known = level.get(id);
    if (known !== undefined) return known;
    level.set(id, 0); // guards against a circle, which `ordered` cannot contain
    const value = Math.max(0, ...(incoming.get(id) ?? []).map(link => levelOf(link.upper.unit) + 1));
    level.set(id, value);
    return value;
  };
  order.forEach(levelOf);

  // ── One parent per unit ───────────────────────────────────────────────────
  // A tunnel or a power feed only makes a parent of a device that has no
  // network link at all: a second site stays a network of its own, and a
  // server is drawn under its switch, not under its UPS.
  const networked = new Set<string>();
  for (const link of links) {
    if (!isNetworkMedium(link.medium)) continue;
    networked.add(link.from.unit);
    networked.add(link.to.unit);
  }
  const parent = new Map<string, string | null>();
  const parentLink = new Map<string, DownLink>();
  const tree = new Set<string>();
  for (const id of order) {
    const eligible = (incoming.get(id) ?? []).filter(
      link => isNetworkMedium(link.link.medium) || !networked.has(id),
    );
    const chosen = eligible.toSorted(
      (a, b) =>
        MEDIUM_RANK[a.link.medium] - MEDIUM_RANK[b.link.medium] ||
        levelOf(b.upper.unit) - levelOf(a.upper.unit) ||
        a.upper.unit.localeCompare(b.upper.unit) ||
        a.upper.port - b.upper.port,
    )[0];
    parent.set(id, chosen ? chosen.upper.unit : null);
    if (chosen) {
      parentLink.set(id, chosen);
      tree.add(chosen.link.id);
    }
  }

  // ── Children, left to right ───────────────────────────────────────────────
  const children = new Map<string, string[]>(order.map(id => [id, []]));
  for (const id of order) {
    const above = parent.get(id);
    if (above) children.get(above)?.push(id);
  }
  // By the port they hang from, so cables leaving a hub fan out without
  // crossing. A rack's devices are taken top to bottom first.
  const portKey = (id: string) => {
    const end = (parentLink.get(id) as DownLink).upper;
    return { y: Math.round(end.at.y), x: end.at.x };
  };
  for (const [id, list] of children) {
    const rack = unit(id).isRack;
    list.sort((a, b) => {
      const first = portKey(a);
      const second = portKey(b);
      return (
        (rack ? first.y - second.y : 0) ||
        first.x - second.x ||
        typeOrder(unit(a).type) - typeOrder(unit(b).type) ||
        unit(a).x - unit(b).x ||
        unit(a).y - unit(b).y ||
        unit(a).name.localeCompare(unit(b).name) ||
        a.localeCompare(b)
      );
    });
  }

  const depth = new Map<string, number>();
  const depthOf = (id: string): number => {
    const known = depth.get(id);
    if (known !== undefined) return known;
    const above = parent.get(id);
    const value = above ? depthOf(above) + 1 : 0;
    depth.set(id, value);
    return value;
  };
  order.forEach(depthOf);

  const rootOf = (id: string): string => {
    let current = id;
    for (let above = parent.get(current); above; above = parent.get(current)) current = above;
    return current;
  };

  // ── Feeders ───────────────────────────────────────────────────────────────
  // A tree without a network cable of its own (a UPS, a UPS with its PDU, a
  // second modem) that has cables into another tree is drawn beside what it
  // feeds instead of as a network of its own.
  const treeRoots = order.filter(id => !parent.get(id) && !loose.includes(id));
  const membersOf = new Map<string, string[]>(treeRoots.map(id => [id, []]));
  for (const id of order) {
    if (!loose.includes(id)) membersOf.get(rootOf(id))?.push(id);
  }
  const isFeederTree = (root: string) =>
    (membersOf.get(root) ?? []).every(id => {
      const link = parentLink.get(id);
      return !link || !isNetworkMedium(link.link.medium);
    });

  const feeders: Feeder[] = [];
  const docked = new Set<string>();
  for (const root of treeRoots) {
    if (!isFeederTree(root)) continue;
    const members = new Set(membersOf.get(root));
    // The cables this tree sends into other trees, topmost target first.
    const feeds = ordered
      .filter(link => members.has(link.upper.unit) && !members.has(link.lower.unit))
      .toSorted(
        (a, b) =>
          depthOf(a.lower.unit) - depthOf(b.lower.unit) || a.lower.unit.localeCompare(b.lower.unit),
      );
    const first = feeds[0];
    if (!first) continue;
    const host = rootOf(first.lower.unit);
    // Not beside another feeder: that one is being moved itself.
    if (host === root || (isFeederTree(host) && treeRoots.includes(host))) continue;

    // The row above the topmost device it feeds is where its feeding member belongs.
    const rowsAbove = depthOf(first.lower.unit) - 1 - depthOf(first.upper.unit);
    if (rowsAbove < 0) {
      if (members.size === 1 && depthOf(first.lower.unit) === 0) {
        feeders.push({ root, beside: first.lower.unit, crown: true, feed: first });
        docked.add(root);
      }
      continue;
    }
    let beside = first.lower.unit;
    while (depthOf(beside) > rowsAbove) beside = parent.get(beside) as string;
    feeders.push({ root, beside, crown: false, feed: first });
    docked.add(root);
  }

  // Internet-facing networks first. Among equals the canvas decides: the order
  // they stand in now is kept, so Polish tidies an arrangement instead of
  // replacing it, and a network that grows does not change places.
  const byType = new Map<number, string[]>();
  for (const id of treeRoots) {
    if (docked.has(id)) continue;
    const rank = upstreamRank(unit(id).type);
    byType.set(rank, [...(byType.get(rank) ?? []), id]);
  }
  const roots = [...byType.keys()]
    .sort((a, b) => a - b)
    .flatMap(rank => readingOrder(byType.get(rank) as string[], unit));

  return { parent, parentLink, children, depth, roots, feeders, down, tree, loose };
}

/**
 * Roots closer together than this in height count as standing in one row. It
 * has to stay below the distance between two rows of networks the layout
 * itself produces (a root's height plus the gap between networks), or running
 * the layout twice could reorder them.
 */
const ROW_BAND = 120;

/** Row by row from the top, left to right within a row. */
function readingOrder(ids: string[], unit: (id: string) => Unit): string[] {
  const byHeight = ids.toSorted((a, b) => unit(a).y - unit(b).y || a.localeCompare(b));
  const ordered: string[] = [];
  for (let start = 0; start < byHeight.length; ) {
    let end = start + 1;
    while (end < byHeight.length && unit(byHeight[end]).y - unit(byHeight[start]).y < ROW_BAND) end += 1;
    ordered.push(
      ...byHeight.slice(start, end).sort((a, b) => unit(a).x - unit(b).x || a.localeCompare(b)),
    );
    start = end;
  }
  return ordered;
}
