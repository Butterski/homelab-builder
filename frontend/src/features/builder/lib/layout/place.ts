import { boundsOf, segmentBox, segmentsOf, snap, snapDown, snapUp } from './geometry';
import { rawRouteOf } from './metrics';
import { typeOrder, type DownLink, type Feeder, type Forest } from './structure';
import type { LayoutStyle, Point, Rect } from './types';
import type { Link, LinkEnd, Unit, UnitGraph } from './units';

/** Distances a style keeps, in pixels. */
interface Spacing {
  /** Between cards side by side. */
  gapX: number;
  /** From the bottom of a parent to the top of its children. */
  gapY: number;
  /** Between cards above each other that are not parent and child. */
  cardGapY: number;
  /** In a family of at least this many, leaves side by side fold into two staggered rows. */
  staggerFrom: number;
  /** Parents at one level whose heights differ by no more than this share a line for their children. */
  baseline: number;
  /** Between separate networks. */
  groupGap: number;
}

const SPACING: Record<LayoutStyle, Spacing> = {
  hierarchy: { gapX: 60, gapY: 60, cardGapY: 40, staggerFrom: 12, baseline: 120, groupGap: 140 },
  compact: { gapX: 40, gapY: 60, cardGapY: 40, staggerFrom: 7, baseline: 0, groupGap: 100 },
};

/** Free space kept on each side of a cable run. */
const CABLE_MARGIN = 6;
/** How far around a NAT or firewall branch nothing else may be placed (its outline is drawn there). */
const ZONE_PADDING = 40;
/** A port inside a rack and the top of a card beside it: just enough for a clean bend. */
const SIDE_ROW_DROP = 44;
/** How wide the grid of loose devices is when the networks above it are narrower. */
const MIN_SHELF_WIDTH = 1200;
/** In a big family, this many leaves side by side are enough to fold them into two rows. */
const MIN_FOLD = 3;

/** Something other things have to keep away from: a card, a cable run, a zone. */
type Item = Rect & { mx: number; my: number };

/** A part of the drawing that is moved as one piece. x is local to the piece, y is final. */
interface Shape {
  at: Map<string, Point>;
  items: Item[];
}

/** Which side of the unit it feeds each feeder sits on. Left unless a trial found right better. */
export type FeederSides = Map<string, 'left' | 'right'>;

function moveShape(shape: Shape, dx: number, dy = 0): Shape {
  for (const point of shape.at.values()) {
    point.x += dx;
    point.y += dy;
  }
  for (const item of shape.items) {
    item.x += dx;
    item.y += dy;
  }
  return shape;
}

function merge(into: Shape, part: Shape): void {
  for (const [id, point] of part.at) into.at.set(id, point);
  for (const item of part.items) into.items.push(item);
}

/**
 * How far `incoming` has to move right so that it stays clear of `placed`
 * wherever the two share a height. -Infinity when they never do.
 */
function clearance(placed: Item[], incoming: Item[]): number {
  // What `incoming` spans as a whole, and the most any of its items can add to
  // the right edge of a placed one. Both rule a placed item out at a glance.
  let spanTop = Infinity;
  let spanBottom = -Infinity;
  let reach = -Infinity;
  for (const b of incoming) {
    spanTop = Math.min(spanTop, b.y - b.my);
    spanBottom = Math.max(spanBottom, b.y + b.height + b.my);
    reach = Math.max(reach, b.mx - b.x);
  }
  let need = -Infinity;
  // Newest first: what was placed last is furthest right and settles `need`
  // early, so most of the older items are skipped by the second test.
  for (let index = placed.length - 1; index >= 0; index--) {
    const a = placed[index];
    const top = a.y - a.my;
    const bottom = a.y + a.height + a.my;
    if (top >= spanBottom || bottom <= spanTop) continue;
    const right = a.x + a.width + a.mx;
    // The margin keeps a rounding error from skipping an item that counts.
    if (right + reach + 1e-6 <= need) continue;
    for (const b of incoming) {
      if (b.y - b.my >= bottom || b.y + b.height + b.my <= top) continue;
      need = Math.max(need, right + b.mx - b.x);
    }
  }
  return need;
}

/** The mirror image: how far `incoming` may move (at most) to stay left of `placed`. Infinity when they never share a height. */
function clearanceLeft(placed: Item[], incoming: Item[]): number {
  let most = Infinity;
  for (const a of placed) {
    const top = a.y - a.my;
    const bottom = a.y + a.height + a.my;
    const left = a.x - a.mx;
    for (const b of incoming) {
      if (b.y - b.my >= bottom || b.y + b.height + b.my <= top) continue;
      most = Math.min(most, left - b.mx - (b.x + b.width));
    }
  }
  return most;
}

const middle = (values: number[]) => (Math.min(...values) + Math.max(...values)) / 2;

/** One row of networks standing side by side. */
interface Shelf {
  entries: Array<{ index: number; x: number }>;
  top: number;
  /** How far down the roots start, to make room for what stands above one of them. */
  rise: number;
}

interface Shelving {
  shelves: Shelf[];
  width: number;
  height: number;
}

/** Puts boxes on shelves left to right, starting a new shelf when one would get wider than `limit`. */
function shelve(boxes: Rect[], limit: number, gap: number): Shelving {
  const shelves: Shelf[] = [];
  let cursor = 0;
  let width = 0;
  let bottom = 0;
  let open: Shelf | null = null;
  const close = () => {
    if (!open) return;
    // Roots sit at y = 0 in their own box; whatever stands above one decides
    // how far down the whole shelf has to start.
    open.rise = Math.max(0, ...open.entries.map(entry => -boxes[entry.index].y));
    for (const entry of open.entries) {
      const box = boxes[entry.index];
      bottom = Math.max(bottom, open.top + open.rise + box.y + box.height);
    }
    shelves.push(open);
    open = null;
  };
  boxes.forEach((box, index) => {
    if (open && cursor + box.width > limit) {
      close();
      cursor = 0;
    }
    open ??= { entries: [], top: shelves.length > 0 ? snapUp(bottom + gap) : 0, rise: 0 };
    open.entries.push({ index, x: cursor });
    width = Math.max(width, cursor + box.width);
    cursor = snapUp(cursor + box.width + gap);
  });
  close();
  return { shelves, width, height: bottom };
}

/** Every width a single row has after one more box: the limits worth trying. Widest first. */
function runningWidths(boxes: Rect[], gap: number): number[] {
  const widths: number[] = [];
  let cursor = 0;
  for (const box of boxes) {
    widths.push(cursor + box.width);
    cursor = snapUp(cursor + box.width + gap);
  }
  return widths.length > 0 ? widths.reverse() : [0];
}

const SCREEN_SHAPE = 16 / 9;

/** The arrangement whose outline is closest to a screen; the one with fewer shelves on a tie. */
function bestOf(options: Shelving[]): Shelving {
  const distance = (option: Shelving) =>
    option.height > 0 ? Math.abs(Math.log(option.width / option.height / SCREEN_SHAPE)) : 0;
  let best = options[0];
  for (const option of options.slice(1)) {
    if (distance(option) < distance(best) - 1e-9) best = option;
  }
  return best;
}

/**
 * Places every unit. Returns the top-left corner of each unit's box.
 *
 * The drawing is built bottom-up: a subtree is laid out, then slid against its
 * left neighbour until neither its cards nor its cables touch anything of the
 * neighbour's. Subtrees may reach into each other's free corners, but never
 * across a cable.
 *
 * A row wider than `foldWidth` is folded, see `rowOf`. With Infinity nothing
 * is folded for its width.
 */
export function place(
  graph: UnitGraph,
  forest: Forest,
  style: LayoutStyle,
  sides: FeederSides,
  foldWidth = Infinity,
): Map<string, Point> {
  const spacing = SPACING[style];
  const unit = (id: string) => graph.units.get(id) as Unit;
  const kids = (id: string) => forest.children.get(id) ?? [];

  const beside = new Map<string, Feeder[]>();
  const crowns = new Map<string, Feeder[]>();
  /** Every unit of a tree that stands beside another tree instead of on its own. */
  const docked = new Set<string>();
  for (const feeder of forest.feeders) {
    const group = feeder.crown ? crowns : beside;
    group.set(feeder.beside, [...(group.get(feeder.beside) ?? []), feeder]);
    const pending = [feeder.root];
    while (pending.length > 0) {
      const id = pending.pop() as string;
      docked.add(id);
      pending.push(...kids(id));
    }
  }

  // Hubs of similar height at one level share the line their devices start on,
  // so the tiers of a network line up across its branches. Racks and leaves
  // never move that line.
  const sharedHeight = new Map<string, number>();
  const levels = new Map<number, string[]>();
  for (const id of graph.order) {
    if (kids(id).length === 0 || unit(id).isRack || docked.has(id)) continue;
    const depth = forest.depth.get(id) ?? 0;
    levels.set(depth, [...(levels.get(depth) ?? []), id]);
  }
  for (const ids of levels.values()) {
    const heights = [...new Set(ids.map(id => unit(id).height))].sort((a, b) => a - b);
    const lineFor = new Map<number, number>();
    let first = 0;
    for (let i = 0; i < heights.length; i++) {
      const last = i + 1 === heights.length || heights[i + 1] - heights[first] > spacing.baseline;
      if (!last) continue;
      for (let j = first; j <= i; j++) lineFor.set(heights[j], heights[i]);
      first = i + 1;
    }
    for (const id of ids) sharedHeight.set(id, lineFor.get(unit(id).height) as number);
  }

  const cardItem = (id: string, x: number, y: number): Item => ({
    x,
    y,
    width: unit(id).width,
    height: unit(id).height,
    mx: spacing.gapX / 2,
    my: spacing.cardGapY / 2,
  });

  /** The runs of a cable as obstacles, with both of its units at their place in `shape`. */
  const cableItems = (link: Link, shape: Shape): Item[] => {
    const route = rawRouteOf(link, shape.at);
    return segmentsOf(route).map(segment => {
      const box = segmentBox(segment);
      return {
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
        mx: CABLE_MARGIN,
        my: CABLE_MARGIN,
      };
    });
  };

  /** A vertical strip a cable will run in, kept free before the cable itself is known. */
  const lane = (x: number, top: number, bottom: number): Item => ({
    x,
    y: top,
    width: 0,
    height: bottom - top,
    mx: CABLE_MARGIN,
    my: 0,
  });

  /** The area around the given items that a zone outline takes up. */
  const hullOf = (items: Item[]): Item => {
    const box = boundsOf(items);
    return {
      x: box.x - ZONE_PADDING,
      y: box.y - ZONE_PADDING,
      width: box.width + 2 * ZONE_PADDING,
      height: box.height + 2 * ZONE_PADDING,
      mx: 0,
      my: 0,
    };
  };

  /** How high the port at `end` is, with its unit at its place in `shape`. */
  const portLine = (shape: Shape, end: LinkEnd): number | undefined => {
    const at = shape.at.get(end.unit);
    return at ? at.y + end.at.y : undefined;
  };

  /** Adds `part` to the right of what is in `row` already. */
  const append = (row: Shape, part: Shape): void => {
    if (row.items.length > 0) {
      const need = clearance(row.items, part.items);
      const fallback = () => {
        const taken = boundsOf(row.items);
        return taken.x + taken.width + spacing.gapX - boundsOf(part.items).x;
      };
      moveShape(part, snapUp(Number.isFinite(need) ? need : fallback()));
    }
    merge(row, part);
  };

  /** A device with nothing below it and nothing standing beside it. */
  const isLeaf = (id: string) => kids(id).length === 0 && !unit(id).isRack && !beside.has(id);

  /**
   * Two rows of leaves, the lower one shifted by half a step. A cable to the
   * lower row drops through the gap between two cards of the upper row, which
   * works because every cable of the hub runs sideways right under its port.
   */
  const staggerRows = (ids: string[], top: number): Shape => {
    const cell = Math.max(...ids.map(id => unit(id).width));
    const step = cell + spacing.gapX;
    const upper = ids.filter((_, index) => index % 2 === 0);
    const lowerTop = snapUp(
      top + Math.max(...upper.map(id => unit(id).height)) + spacing.cardGapY,
    );
    const row: Shape = { at: new Map(), items: [] };
    ids.forEach((id, index) => {
      const column = Math.floor(index / 2);
      const lower = index % 2 === 1;
      const x = column * step + (lower ? step / 2 : 0) + (cell - unit(id).width) / 2;
      const y = lower ? lowerTop : top;
      row.at.set(id, { x, y });
      row.items.push(cardItem(id, x, y));
      // The way down to a lower card has to stay free, also of whatever is
      // placed next to these rows before the cable itself is known.
      if (lower) row.items.push(lane(x + unit(id).width / 2, top, lowerTop));
    });
    return row;
  };

  /**
   * A branch with what feeds it from the side. A feeder (a UPS, a spare modem)
   * stands with its ports on the line of the ports its first cable shares the
   * next row with, so both run on one line instead of crossing. If that would
   * lift the feeder above the row, the branch moves down instead.
   */
  const branch = (id: string, top: number): Shape => {
    const own = subtree(id, top);
    const feeders = (beside.get(id) ?? []).map(feeder => {
      const shape = subtree(feeder.root, 0);
      const host = forest.parentLink.get(feeder.feed.lower.unit);
      const hostLine = host ? portLine(own, host.upper) : undefined;
      const feedLine = portLine(shape, feeder.feed.upper);
      const y = hostLine === undefined || feedLine === undefined ? top : hostLine - feedLine;
      return { feeder, shape, y };
    });
    if (feeders.length === 0) return own;

    const drop = snapUp(Math.max(0, ...feeders.map(entry => top - entry.y)));
    if (drop > 0) {
      moveShape(own, 0, drop);
      // Its cable comes down through the space this opens above it.
      const at = own.at.get(id) as Point;
      own.items.push({ ...cardItem(id, at.x, top), height: drop, my: 0 });
    }
    for (const entry of feeders) moveShape(entry.shape, 0, entry.y + drop);

    const group: Shape = { at: new Map(), items: [] };
    for (const entry of feeders) {
      if (sides.get(entry.feeder.root) !== 'right') append(group, entry.shape);
    }
    append(group, own);
    for (const entry of feeders) {
      if (sides.get(entry.feeder.root) === 'right') append(group, entry.shape);
    }
    // What feeds a zone from beside its first device is drawn inside its outline.
    if (unit(id).zoneRoot) group.items.push(hullOf(group.items));
    return group;
  };

  /** One thing in a row: a branch with what stands beside it, or leaves. */
  interface Block {
    shape: Shape;
    /** The unit a branch hangs from, when it has devices of its own below it. */
    hub?: string;
  }

  /**
   * Lays the given units out side by side, each with its subtree and feeders.
   *
   * In a big family, leaves that stand next to each other fold into two
   * staggered rows. A row that is still wider than `foldWidth` is folded
   * altogether: all of its leaves stagger, and every second branch moves to a
   * lower tier, under the gap between its neighbours. Its cable comes down
   * through that gap, so the fold costs no crossing; the row gets about half
   * as wide and twice as high.
   */
  const rowOf = (ids: string[], top: number): Shape => {
    // A branch is laid out once, whichever way the row ends up being arranged.
    const branches = new Map<string, Shape>();
    const blocksOf = (foldLeaves: boolean): Block[] => {
      const blocks: Block[] = [];
      let run: string[] = [];
      const closeRun = () => {
        if (run.length >= MIN_FOLD) blocks.push({ shape: staggerRows(run, top) });
        else for (const id of run) blocks.push({ shape: subtree(id, top) });
        run = [];
      };
      for (const id of ids) {
        if (foldLeaves && isLeaf(id)) {
          run.push(id);
          continue;
        }
        closeRun();
        let shape = branches.get(id);
        if (!shape) {
          shape = branch(id, top);
          branches.set(id, shape);
        }
        blocks.push({ shape, hub: kids(id).length > 0 ? id : undefined });
      }
      closeRun();
      return blocks;
    };
    const pack = (blocks: Block[]): Shape => {
      const row: Shape = { at: new Map(), items: [] };
      for (const block of blocks) append(row, block.shape);
      return row;
    };

    const plain = pack(blocksOf(ids.length >= spacing.staggerFrom));
    if (ids.length < 2 || boundsOf(plain.items).width <= foldWidth) return plain;

    const blocks = blocksOf(true);
    const hubs = blocks.filter(block => block.hub);
    if (hubs.length >= 2) {
      const lowered = new Set(hubs.filter((_, index) => index % 2 === 1));
      const upper = blocks
        .filter(block => !lowered.has(block))
        .map(block => boundsOf(block.shape.items));
      const tierTop = snapUp(Math.max(...upper.map(box => box.y + box.height)) + spacing.gapY);
      for (const block of lowered) {
        moveShape(block.shape, 0, tierTop - top);
        const hub = block.hub as string;
        const at = block.shape.at.get(hub) as Point;
        const handle = (forest.parentLink.get(hub) as DownLink).lower.at.x;
        block.shape.items.push(lane(at.x + handle, top, at.y));
      }
    }
    return pack(blocks);
  };

  /** A rack with the devices that hang off the devices inside it. */
  const rackFamily = (id: string, y: number, shape: Shape): Shape => {
    const rack = unit(id);
    // Children are grouped by the racked device they hang from, top to bottom.
    // Each group is a row that starts at the height of that device's ports.
    interface Group {
      ids: string[];
      port: number;
      row: Shape;
      box: Rect;
      side: 'right' | 'left';
    }
    const groups: Group[] = [];
    const groupOf = new Map<string, Group>();
    for (const child of kids(id)) {
      const end = (forest.parentLink.get(child) as DownLink).upper;
      let group = groupOf.get(end.node);
      if (!group) {
        group = {
          ids: [],
          port: end.at.y,
          row: { at: new Map(), items: [] },
          box: { x: 0, y: 0, width: 0, height: 0 },
          side: 'right',
        };
        groupOf.set(end.node, group);
        groups.push(group);
      }
      group.ids.push(child);
    }

    // A group stands on the right while that side is free at its height, else
    // on the left, else on the side that has less on it.
    const busyUntil = { right: -Infinity, left: -Infinity };
    const load = { right: 0, left: 0 };
    for (const group of groups) {
      group.row = rowOf(group.ids, snapUp(y + group.port + SIDE_ROW_DROP));
      group.box = boundsOf(group.row.items);
      group.side =
        group.box.y >= busyUntil.right
          ? 'right'
          : group.box.y >= busyUntil.left
            ? 'left'
            : load.right <= load.left
              ? 'right'
              : 'left';
      busyUntil[group.side] = Math.max(
        busyUntil[group.side],
        group.box.y + group.box.height + spacing.gapY,
      );
      load[group.side] += group.box.width + spacing.gapX;
    }

    // On each side the lowest group goes next to the rack, and every group
    // above it as close as the ones below allow. A group that shares its height
    // with a lower one therefore stands further out: its cables leave the rack
    // above the lower group's cards, and the lower group's cables never reach it.
    for (const side of ['right', 'left'] as const) {
      const obstacles: Item[] = [shape.items[0]];
      for (const group of groups.filter(entry => entry.side === side).toReversed()) {
        if (side === 'right') {
          const need = clearance(obstacles, group.row.items);
          moveShape(group.row, snapUp(Math.max(need, rack.width + spacing.gapX - group.box.x)));
        } else {
          const need = clearanceLeft(obstacles, group.row.items);
          moveShape(
            group.row,
            snapDown(Math.min(need, -spacing.gapX - (group.box.x + group.box.width))),
          );
        }
        merge(shape, group.row);
        const cables = group.ids.flatMap(child =>
          cableItems((forest.parentLink.get(child) as DownLink).link, shape),
        );
        shape.items.push(...cables);
        obstacles.push(...group.row.items, ...cables);
      }
    }
    return shape;
  };

  /** A unit with everything below it. */
  function subtree(id: string, y: number): Shape {
    const self = unit(id);
    const shape: Shape = { at: new Map([[id, { x: 0, y }]]), items: [cardItem(id, 0, y)] };
    const children = kids(id);
    if (children.length === 0) return shape;
    if (self.isRack) return rackFamily(id, y, shape);

    const top = snapUp(y + (sharedHeight.get(id) ?? self.height) + spacing.gapY);
    const row = rowOf(children, top);

    // The ports in use end up over the children they lead to. With one child
    // that is exact, so the cable is a straight line.
    const ports: number[] = [];
    const anchors: number[] = [];
    for (const child of children) {
      const link = forest.parentLink.get(child) as DownLink;
      ports.push(link.upper.at.x);
      anchors.push((row.at.get(child) as Point).x + link.lower.at.x);
    }
    const x = middle(anchors) - middle(ports);
    moveShape(shape, children.length === 1 ? x : snap(x));
    merge(shape, row);
    for (const child of children) {
      shape.items.push(...cableItems((forest.parentLink.get(child) as DownLink).link, shape));
    }

    // The branch is drawn inside one outline: keep everything else out of it.
    if (self.zoneRoot) shape.items.push(hullOf(shape.items));
    return shape;
  }

  /** One network: a root at y = 0 with its subtree, what feeds it from the side and from above. */
  const network = (root: string): Shape => {
    const shape = rowOf([root], 0);
    moveShape(shape, 0, -(shape.at.get(root) as Point).y);
    const above = crowns.get(root) ?? [];
    if (above.length === 0) return shape;

    // Whatever only feeds the root stands in a row above the network, its port
    // over the root's handle.
    const at = shape.at.get(root) as Point;
    const ceiling = boundsOf(shape.items).y;
    const row: Shape = { at: new Map(), items: [] };
    const ports: number[] = [];
    const anchors: number[] = [];
    for (const feeder of above) {
      append(row, subtree(feeder.root, ceiling - spacing.gapY - unit(feeder.root).height));
      ports.push((row.at.get(feeder.root) as Point).x + feeder.feed.upper.at.x);
      anchors.push(at.x + feeder.feed.lower.at.x);
    }
    moveShape(row, middle(anchors) - middle(ports));
    merge(shape, row);
    return shape;
  };

  // ── Put the networks, loose devices and spare racks together ──────────────
  const result = new Map<string, Point>();
  const loose = forest.loose.toSorted(
    (a, b) =>
      typeOrder(unit(a).type) - typeOrder(unit(b).type) ||
      unit(a).name.localeCompare(unit(b).name) ||
      a.localeCompare(b),
  );

  // Networks side by side with their roots on one line. A long row wraps, and
  // of all the ways to wrap it the one closest to the shape of a screen wins.
  const networks = forest.roots.map(network);
  const boxes = networks.map(group => boundsOf(group.items));
  const packed = bestOf(
    runningWidths(boxes, spacing.groupGap).map(limit => shelve(boxes, limit, spacing.groupGap)),
  );
  for (const shelf of packed.shelves) {
    for (const entry of shelf.entries) {
      const group = networks[entry.index];
      moveShape(group, entry.x - boxes[entry.index].x, shelf.top + shelf.rise);
      for (const [id, point] of group.at) result.set(id, point);
    }
  }
  let right = packed.width;

  // Devices without any cable wait in a grid below the networks, grouped by type.
  const cards = loose.filter(id => !unit(id).isRack);
  if (cards.length > 0) {
    const step = snapUp(Math.max(...cards.map(id => unit(id).width)) + spacing.gapX);
    const columns = Math.max(
      1,
      Math.floor((Math.max(right, MIN_SHELF_WIDTH) + spacing.gapX) / step),
    );
    let y = networks.length > 0 ? snapUp(packed.height + spacing.groupGap) : 0;
    for (let start = 0; start < cards.length; start += columns) {
      const line = cards.slice(start, start + columns);
      line.forEach((id, column) => {
        result.set(id, { x: column * step, y });
        right = Math.max(right, column * step + unit(id).width);
      });
      y = snapUp(y + Math.max(...line.map(id => unit(id).height)) + spacing.cardGapY);
    }
  }

  // A rack without cables is too tall for that grid: spare racks stand to the
  // right of everything else.
  let x = right > 0 ? snapUp(right + spacing.groupGap) : 0;
  for (const id of loose.filter(id => unit(id).isRack)) {
    result.set(id, { x, y: 0 });
    x = snapUp(x + unit(id).width + spacing.gapX);
  }

  // The first network's root stays where it is (to the grid), so running the
  // layout again moves nothing, and a small change does not shift the canvas.
  const anchor = forest.roots[0] ?? loose[0];
  const placed = anchor ? result.get(anchor) : undefined;
  if (anchor && placed) {
    const dx = snap(unit(anchor).x - placed.x);
    const dy = snap(unit(anchor).y - placed.y);
    for (const point of result.values()) {
      point.x += dx;
      point.y += dy;
    }
  }
  return result;
}
