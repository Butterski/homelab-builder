import { writeFileSync } from 'node:fs';
import { env } from 'node:process';
import { afterAll, describe, expect, it } from 'vitest';
import type { HardwareNode, HardwareType } from '../../../../types';
import { buildGameServerPlan } from '../planner/game-server-plan';
import { buildHomelabPlan } from '../planner/homelab-plan';
import { buildLanPartyPlan } from '../planner/lan-party-plan';
import type { PlannedEdge, PlannedNode } from '../planner/types';
import { buildLayoutGraph } from './from-flow';
import { computeLayout, pictureOf, withPositions, type LayoutPicture } from './index';
import type { LayoutEdge, LayoutGraph, LayoutNode, LayoutResult, LayoutStyle, Medium } from './types';

// ─── Looking at the result ───────────────────────────────────────────────────
//
// Numbers say a layout is free of crossings, not that it looks right. Run
//   LAYOUT_PREVIEW=/some/file.html npx vitest run src/features/builder/lib/layout
// to get every canvas of this file drawn in both styles.

const drawn: Array<{ label: string; style: LayoutStyle; picture: LayoutPicture; names: Map<string, string> }> = [];

afterAll(() => {
  if (!env.LAYOUT_PREVIEW) return;
  const escape = (text: string) => text.replace(/[&<>"]/g, char => `&#${char.charCodeAt(0)};`);
  const sections = drawn.map(({ label, style, picture, names }) => {
    const { bounds, metrics } = picture;
    const pad = 40;
    const box = `${bounds.x - pad} ${bounds.y - pad} ${bounds.width + 2 * pad} ${bounds.height + 2 * pad}`;
    const cards = picture.cards
      .map(
        card =>
          `<rect x="${card.x}" y="${card.y}" width="${card.width}" height="${card.height}" rx="10" class="${card.rack ? 'rack' : 'card'}"/>` +
          `<text x="${card.x + 10}" y="${card.y + 24}">${escape(names.get(card.nodeId) ?? card.nodeId)}</text>`,
      )
      .join('');
    const cables = picture.cables
      .map(
        cable =>
          `<polyline points="${cable.points.map(point => `${point.x},${point.y}`).join(' ')}" class="${cable.tree ? 'tree' : 'extra'}"/>`,
      )
      .join('');
    const facts = [
      `${Math.round(bounds.width)} × ${Math.round(bounds.height)}`,
      `${metrics.overlaps} overlaps`,
      `${metrics.treeCrossings} tree crossings`,
      `${metrics.otherCrossings} other crossings`,
      `${metrics.treeCableHits + metrics.otherCableHits} cards on cables`,
      `${metrics.wrappedCables} wrapped`,
    ].join(' · ');
    return `<section><h2>${escape(label)} <small>${style}</small></h2><p>${facts}</p><svg viewBox="${box}">${cards}${cables}</svg></section>`;
  });
  writeFileSync(
    env.LAYOUT_PREVIEW,
    `<!doctype html><meta charset="utf-8"><title>Layout preview</title><style>
body{font:14px system-ui;margin:24px;background:#f6f7f9;color:#1c2330}
section{margin:0 0 40px}h2{margin:0 0 4px;font-size:18px}small{font-weight:400;color:#667}
p{margin:0 0 8px;color:#556}svg{display:block;width:100%;max-height:92vh;background:#fff;border:1px solid #dde}
.card{fill:#eef2ff;stroke:#5b6ee1;stroke-width:2}.rack{fill:#f4f4f5;stroke:#71717a;stroke-width:3}
text{font:16px system-ui;fill:#1c2330}polyline{fill:none;stroke-width:3;stroke-linejoin:round}
.tree{stroke:#16a34a}.extra{stroke:#ea580c;stroke-dasharray:8 6}
</style>${sections.join('')}`,
  );
});

// ─── Building canvases ───────────────────────────────────────────────────────

const HUBS = new Set<HardwareType>(['router', 'switch', 'firewall', 'modem', 'server_v2', 'vps', 'ups']);
const RACK_WIDTH = 280;
const rackHeight = (units: number) => 40 + units * 90 + 8;

function card(id: string, type: HardwareType, extra: Partial<LayoutNode> = {}): LayoutNode {
  const hub = HUBS.has(type);
  const ports = extra.ports ?? (hub ? (type === 'switch' ? 8 : 4) : 1);
  return {
    id,
    type,
    name: id,
    x: 0,
    y: 0,
    width: hub ? Math.max(220, ports * 16 > 192 ? ports * 16 : 220) : 220,
    height: hub ? 100 : 200,
    estimated: false,
    ports,
    spreadPorts: hub,
    zoneRoot: false,
    ...extra,
  };
}

const rack = (id: string, units: number, extra: Partial<LayoutNode> = {}) =>
  card(id, 'rack', { width: RACK_WIDTH, height: rackHeight(units), ports: 1, spreadPorts: false, ...extra });

/** A device in a rack slot (0 is the top). */
const racked = (id: string, type: HardwareType, rackId: string, slot: number, extra: Partial<LayoutNode> = {}) =>
  card(id, type, { parentId: rackId, x: 28, y: 40 + slot * 90, height: 80, ...extra });

let nextEdge = 0;
function cable(
  source: string,
  target: string,
  port = 0,
  medium: Medium = 'ethernet',
  handles: { source?: string; target?: string } = {},
): LayoutEdge {
  nextEdge += 1;
  return {
    id: `edge-${nextEdge}`,
    source,
    target,
    sourceHandle: handles.source ?? `eth${port}`,
    targetHandle: handles.target ?? 'target-0',
    medium,
  };
}

/** A planner's output as the layout sees it before anything is on screen. */
function planned(plan: { nodes: unknown[]; edges: unknown[] }): LayoutGraph {
  const nodes = plan.nodes as PlannedNode[];
  const edges = plan.edges as PlannedEdge[];
  return buildLayoutGraph(
    nodes.map(node => ({
      hardware: node as unknown as HardwareNode,
      x: node.x,
      y: node.y,
      parentId: node.parent_id,
    })),
    edges.map((edge, index) => ({
      id: `planned-${index}`,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.source_handle,
      targetHandle: edge.target_handle,
      type: edge.type,
    })),
  );
}

// ─── What a good layout is ───────────────────────────────────────────────────

function positionsOf(result: LayoutResult): Record<string, { x: number; y: number }> {
  return Object.fromEntries(result.positions.map(position => [position.id, { x: position.x, y: position.y }]));
}

/** Checks everything the layout promises, for both styles, and returns the results. */
function expectTidy(graph: LayoutGraph, label: string): Record<LayoutStyle, LayoutResult> {
  const results = {} as Record<LayoutStyle, LayoutResult>;
  for (const style of ['hierarchy', 'compact'] as const) {
    const result = computeLayout(graph, { style });
    const where = `${label} (${style})`;
    if (env.LAYOUT_PREVIEW && graph.nodes.length <= 130) {
      drawn.push({
        label,
        style,
        picture: pictureOf(withPositions(graph, result.positions)),
        names: new Map(graph.nodes.map(node => [node.id, node.name])),
      });
    }
    expect(result.metrics.overlaps, `${where}: cards overlap`).toBe(0);
    expect(result.metrics.treeCrossings, `${where}: tree cables cross`).toBe(0);
    expect(result.metrics.treeCableHits, `${where}: a tree cable runs over a card`).toBe(0);
    expect(result.positions.length, `${where}: every top-level node is placed`).toBe(
      graph.nodes.filter(node => !node.parentId).length,
    );

    // Polishing a polished canvas moves nothing.
    const again = computeLayout(withPositions(graph, result.positions), { style });
    expect(positionsOf(again), `${where}: a second run moves something`).toEqual(positionsOf(result));

    // The order of the input is an accident and must not show.
    const shuffled: LayoutGraph = {
      nodes: graph.nodes.toReversed(),
      edges: graph.edges.toReversed(),
    };
    expect(positionsOf(computeLayout(shuffled, { style })), `${where}: input order shows`).toEqual(
      positionsOf(result),
    );
    results[style] = result;
  }
  return results;
}

const at = (result: LayoutResult, id: string) => {
  const found = result.positions.find(position => position.id === id);
  if (!found) throw new Error(`${id} was not placed`);
  return found;
};

// ─── Fixtures ────────────────────────────────────────────────────────────────

function homelab(): LayoutGraph {
  return {
    nodes: [
      card('modem', 'modem'),
      card('router', 'router'),
      card('switch', 'switch'),
      card('server', 'server_v2', { height: 420, width: 244 }),
      card('nas', 'nas', { height: 260 }),
      card('pc', 'pc'),
      card('ap', 'access_point', { height: 110 }),
      card('console', 'console', { height: 110 }),
      card('laptop', 'pc'),
      card('ups', 'ups', { ports: 2 }),
      card('spare', 'sbc'),
    ],
    edges: [
      cable('modem', 'router', 0),
      cable('router', 'switch', 0),
      cable('switch', 'server', 0),
      cable('switch', 'nas', 1),
      cable('switch', 'pc', 2),
      cable('switch', 'ap', 3, 'wireless'),
      cable('ap', 'console', 0, 'wireless'),
      cable('ap', 'laptop', 0, 'wireless'),
      cable('ups', 'server', 0, 'power'),
      cable('ups', 'nas', 1, 'power'),
    ],
  };
}

describe('hierarchy', () => {
  it('draws a typical homelab top-down, in port order, without a crossing', () => {
    const { hierarchy } = expectTidy(homelab(), 'homelab');

    // Internet at the top, each level below the one that feeds it.
    const y = (id: string) => at(hierarchy, id).y;
    expect(y('modem')).toBeLessThan(y('router'));
    expect(y('router')).toBeLessThan(y('switch'));
    expect(y('switch')).toBeLessThan(y('server'));
    expect(y('ap')).toBeLessThan(y('console'));
    // Devices on one hub stand in one row, in the order of their ports.
    expect(new Set(['server', 'nas', 'pc', 'ap'].map(y)).size).toBe(1);
    const xs = ['server', 'nas', 'pc', 'ap'].map(id => at(hierarchy, id).x);
    expect(xs).toEqual(xs.toSorted((a, b) => a - b));
    // Wi-Fi clients hang under their access point.
    expect(y('console')).toBe(y('laptop'));
  });

  it('keeps a chain of single links perfectly straight', () => {
    const graph: LayoutGraph = {
      nodes: [card('modem', 'modem'), card('router', 'router'), card('switch', 'switch', { ports: 16 })],
      // Deliberately off-centre ports: the cable must still be one vertical line.
      edges: [cable('modem', 'router', 3), cable('router', 'switch', 0)],
    };
    const { hierarchy } = expectTidy(graph, 'chain');

    const port = (id: string, index: number, ports: number, width: number) =>
      at(hierarchy, id).x + (width * (index + 1)) / (ports + 1);
    expect(port('modem', 3, 4, 220)).toBeCloseTo(at(hierarchy, 'router').x + 110, 6);
    expect(port('router', 0, 4, 220)).toBeCloseTo(at(hierarchy, 'switch').x + 128, 6);
    expect(hierarchy.metrics.wrappedCables).toBe(0);
  });

  it('puts whatever only feeds the root above it, and a spare uplink beside the first', () => {
    const graph: LayoutGraph = {
      nodes: [
        card('modem-a', 'modem'),
        card('modem-b', 'modem'),
        card('router', 'router'),
        card('switch', 'switch'),
        card('pc', 'pc'),
      ],
      edges: [
        cable('modem-a', 'router', 0),
        cable('modem-b', 'router', 0),
        cable('router', 'switch', 0),
        cable('switch', 'pc', 0),
      ],
    };
    const { hierarchy } = expectTidy(graph, 'dual WAN');
    // Both modems above the router, in one row.
    expect(at(hierarchy, 'modem-a').y + 100).toBe(at(hierarchy, 'modem-b').y + 100);
    expect(at(hierarchy, 'modem-b').y).toBeLessThan(at(hierarchy, 'router').y);
    // The second uplink is drawn, and crosses nothing.
    expect(hierarchy.metrics.otherCrossings).toBe(0);
    expect(hierarchy.metrics.otherCableHits).toBe(0);
  });

  it('stands a UPS beside the branch it feeds, with its PDU under it', () => {
    const graph: LayoutGraph = {
      nodes: [
        card('router', 'router'),
        card('switch', 'switch'),
        card('server-a', 'server_v2', { height: 300 }),
        card('server-b', 'server_v2', { height: 300 }),
        card('ups', 'ups', { ports: 4 }),
        card('pdu', 'pdu', { height: 90 }),
      ],
      edges: [
        cable('router', 'switch', 0),
        cable('switch', 'server-a', 0),
        cable('switch', 'server-b', 1),
        cable('ups', 'server-a', 0, 'power'),
        cable('ups', 'server-b', 1, 'power'),
        cable('ups', 'pdu', 2, 'power'),
      ],
    };
    const { hierarchy } = expectTidy(graph, 'UPS and PDU');
    // The UPS feeds the servers, so it stands in the row above them: the switch's.
    expect(at(hierarchy, 'ups').y + 100).toBe(at(hierarchy, 'switch').y + 100);
    // A PDU has no network link: it hangs under the UPS that feeds it.
    expect(at(hierarchy, 'pdu').y).toBeGreaterThan(at(hierarchy, 'ups').y);
    expect(hierarchy.metrics.otherCableHits).toBe(0);
  });

  it('keeps a UPS and the hub beside it on one line of ports, however tall the UPS is', () => {
    const graph: LayoutGraph = {
      nodes: [
        card('router', 'router'),
        card('switch', 'switch', { height: 60 }),
        card('server-a', 'server_v2', { height: 300 }),
        card('server-b', 'server_v2', { height: 300 }),
        card('ups', 'ups', { ports: 4, height: 180 }),
      ],
      edges: [
        cable('router', 'switch', 0),
        cable('switch', 'server-a', 0),
        cable('switch', 'server-b', 1),
        cable('ups', 'server-a', 0, 'power'),
        cable('ups', 'server-b', 1, 'power'),
      ],
    };
    const { hierarchy } = expectTidy(graph, 'tall UPS');
    // Bottoms on one line: the feed runs along the switch's cables, not across them.
    expect(at(hierarchy, 'ups').y + 180).toBe(at(hierarchy, 'switch').y + 60);
    // The UPS does not reach up into the router's row; the switch moved down instead.
    expect(at(hierarchy, 'ups').y).toBeGreaterThanOrEqual(at(hierarchy, 'router').y + 100 + 60);
    expect(hierarchy.metrics.wrappedCables).toBe(0);
    expect(hierarchy.metrics.otherCrossings).toBe(0);
    expect(hierarchy.metrics.otherCableHits).toBe(0);
  });

  it('puts a UPS that feeds the root in a row above it', () => {
    const graph: LayoutGraph = {
      nodes: [card('router', 'router'), card('pc', 'pc'), card('ups', 'ups', { ports: 2 })],
      edges: [cable('router', 'pc', 0), cable('ups', 'router', 0, 'power')],
    };
    const { hierarchy } = expectTidy(graph, 'UPS over the root');
    expect(at(hierarchy, 'ups').y).toBeLessThan(at(hierarchy, 'router').y);
    expect(hierarchy.metrics.wrappedCables).toBe(0);
  });

  it('follows the handles when a cable was drawn from the device to the hub', () => {
    const graph: LayoutGraph = {
      nodes: [card('router', 'router'), card('switch', 'switch'), card('pc', 'pc'), card('nas', 'nas')],
      edges: [
        cable('router', 'switch', 0),
        // Drawn backwards: from the device's top handle to the switch's port.
        cable('pc', 'switch', 0, 'ethernet', { source: 'target-0', target: 'eth2' }),
        // From the NAS's own port into the switch's top handle: the NAS is above.
        cable('nas', 'switch', 0, 'ethernet', { source: 'eth0', target: 'target-0' }),
      ],
    };
    const { hierarchy } = expectTidy(graph, 'backwards cables');
    expect(at(hierarchy, 'pc').y).toBeGreaterThan(at(hierarchy, 'switch').y);
    expect(at(hierarchy, 'nas').y).toBeLessThan(at(hierarchy, 'switch').y);
    expect(hierarchy.metrics.wrappedCables).toBe(0);
  });

  it('survives a loop, drawing the cable that closes it as a secondary link', () => {
    const graph: LayoutGraph = {
      nodes: [card('router', 'router'), card('a', 'switch'), card('b', 'switch'), card('pc', 'pc')],
      edges: [
        cable('router', 'a', 0),
        cable('a', 'b', 0),
        // Closes a circle: b would have to be above a as well.
        cable('b', 'a', 1),
        cable('b', 'pc', 0),
      ],
    };
    const { hierarchy } = expectTidy(graph, 'loop');
    expect(at(hierarchy, 'a').y).toBeLessThan(at(hierarchy, 'b').y);
    expect(at(hierarchy, 'b').y).toBeLessThan(at(hierarchy, 'pc').y);
  });

  it('lays separate networks side by side and loose devices on a shelf below', () => {
    const graph: LayoutGraph = {
      nodes: [
        card('router-a', 'router'),
        card('pc-a', 'pc'),
        card('router-b', 'router'),
        card('pc-b', 'pc'),
        card('loose-nas', 'nas'),
        card('loose-pc', 'pc'),
        rack('spare-rack', 12),
      ],
      edges: [cable('router-a', 'pc-a', 0), cable('router-b', 'pc-b', 0)],
    };
    const { hierarchy } = expectTidy(graph, 'islands');
    expect(at(hierarchy, 'router-a').y).toBe(at(hierarchy, 'router-b').y);
    // Loose cards wait right below the networks, not below the tall rack.
    expect(at(hierarchy, 'loose-nas').y).toBeGreaterThan(at(hierarchy, 'pc-a').y + 200);
    expect(at(hierarchy, 'loose-nas').y).toBeLessThan(at(hierarchy, 'pc-a').y + 200 + 200);
    expect(at(hierarchy, 'loose-pc').y).toBe(at(hierarchy, 'loose-nas').y);
    // The spare rack stands to the right of everything else, from the top.
    expect(at(hierarchy, 'spare-rack').y).toBe(at(hierarchy, 'router-a').y);
    const rightmost = Math.max(...['pc-b', 'loose-nas', 'loose-pc'].map(id => at(hierarchy, id).x + 220));
    expect(at(hierarchy, 'spare-rack').x).toBeGreaterThan(rightmost);
  });

  it('keeps separate networks in the order they stand in, row by row', () => {
    const island = (name: string, x: number, y: number): LayoutGraph => ({
      nodes: [card(`router-${name}`, 'router', { x, y }), card(`pc-${name}`, 'pc', { x, y: y + 300 })],
      edges: [cable(`router-${name}`, `pc-${name}`, 0)],
    });
    // "b" was drawn left of "a", and "c" in a row of its own below them.
    const parts = [island('a', 900, 40), island('b', 100, 0), island('c', 500, 700)];
    const graph: LayoutGraph = {
      nodes: parts.flatMap(part => part.nodes),
      edges: parts.flatMap(part => part.edges),
    };
    const { hierarchy } = expectTidy(graph, 'three networks');
    const x = (name: string) => at(hierarchy, `router-${name}`).x;
    expect(x('b')).toBeLessThan(x('a'));
    expect(x('a')).toBeLessThan(x('c'));
    // An internet-facing network still comes first, wherever it was.
    const withModem: LayoutGraph = {
      nodes: [...graph.nodes, card('modem', 'modem', { x: 2000, y: 900 }), card('behind', 'pc', { x: 2000, y: 1200 })],
      edges: [...graph.edges, cable('modem', 'behind', 0)],
    };
    const result = computeLayout(withModem, { style: 'hierarchy' });
    expect(at(result, 'modem').x).toBeLessThan(at(result, 'router-b').x);
  });

  it('wraps a long row of networks towards the shape of a screen', () => {
    const nodes: LayoutNode[] = [];
    const edges: LayoutEdge[] = [];
    for (let n = 0; n < 6; n++) {
      nodes.push(card(`router-${n}`, 'router', { x: n * 100 }));
      for (let i = 0; i < 6; i++) {
        nodes.push(card(`pc-${n}-${i}`, 'pc'));
        edges.push(cable(`router-${n}`, `pc-${n}-${i}`, i % 4));
      }
    }
    const { hierarchy } = expectTidy({ nodes, edges }, 'six networks');
    const { width, height } = hierarchy.metrics.bounds;
    // One row would be about 10000 x 360.
    expect(width / height).toBeGreaterThan(1);
    expect(width / height).toBeLessThan(3.2);
    expect(new Set(nodes.filter(node => node.type === 'router').map(node => at(hierarchy, node.id).y)).size).toBeGreaterThan(1);
  });

  it('keeps a stranger out of a firewall branch, whose outline is drawn around it', () => {
    const graph: LayoutGraph = {
      nodes: [
        card('router', 'router'),
        card('firewall', 'firewall', { zoneRoot: true }),
        card('dmz-a', 'server_v2', { height: 300 }),
        card('dmz-b', 'server_v2', { height: 300 }),
        card('pc', 'pc', { height: 400 }),
      ],
      edges: [
        cable('router', 'firewall', 0),
        cable('firewall', 'dmz-a', 0),
        cable('firewall', 'dmz-b', 1),
        cable('router', 'pc', 1),
      ],
    };
    const { hierarchy } = expectTidy(graph, 'zone');
    const branch = ['firewall', 'dmz-a', 'dmz-b'].map(id => at(hierarchy, id));
    const right = Math.max(...branch.map(point => point.x)) + 244;
    // The PC is a sibling of the firewall; it stays clear of the whole branch.
    expect(at(hierarchy, 'pc').x).toBeGreaterThanOrEqual(right + 40);
  });
});

describe('racks', () => {
  it('moves a rack as one block and never the devices inside it', () => {
    const graph: LayoutGraph = {
      nodes: [
        card('modem', 'modem'),
        rack('rack', 12),
        racked('router', 'router', 'rack', 0),
        racked('switch', 'switch', 'rack', 2),
        racked('server', 'server_v2', 'rack', 4),
        card('ap', 'access_point'),
        card('pc', 'pc'),
      ],
      edges: [
        cable('modem', 'router', 0),
        cable('router', 'switch', 0),
        cable('switch', 'server', 0),
        cable('switch', 'ap', 1, 'wireless'),
        cable('switch', 'pc', 2),
      ],
    };
    const { hierarchy } = expectTidy(graph, 'one rack');

    // Only top-level nodes are placed.
    expect(hierarchy.positions.map(position => position.id).toSorted()).toEqual(['ap', 'modem', 'pc', 'rack']);
    // The rack hangs under the modem, pinned so the cable drops straight into the router.
    expect(at(hierarchy, 'modem').y).toBeLessThan(at(hierarchy, 'rack').y);
    expect(at(hierarchy, 'modem').x + (220 * 1) / 5).toBeCloseTo(at(hierarchy, 'rack').x + 28 + 110, 6);
    // What hangs off the racked switch stands beside the rack, at the height of its ports.
    const portY = at(hierarchy, 'rack').y + 40 + 2 * 90 + 80 + 4;
    for (const id of ['ap', 'pc']) {
      expect(at(hierarchy, id).x).toBeGreaterThanOrEqual(at(hierarchy, 'rack').x + RACK_WIDTH + 40);
      expect(at(hierarchy, id).y).toBeGreaterThan(portY + 40);
      expect(at(hierarchy, id).y).toBeLessThan(portY + 80);
    }
  });

  it('counts a wide switch that sticks out of its rack as part of the block', () => {
    const graph: LayoutGraph = {
      nodes: [
        card('router', 'router'),
        rack('rack', 6),
        racked('core', 'switch', 'rack', 0, { ports: 48, width: 768 }),
        card('pc', 'pc'),
        card('neighbour', 'pc'),
      ],
      edges: [cable('router', 'core', 0), cable('core', 'pc', 0), cable('router', 'neighbour', 1)],
    };
    expectTidy(graph, 'wide switch in a rack');
  });

  it('handles two racks, one feeding the other', () => {
    const graph: LayoutGraph = {
      nodes: [
        rack('network', 6),
        racked('router', 'router', 'network', 0),
        racked('switch', 'switch', 'network', 2),
        rack('compute', 8),
        racked('server-a', 'server_v2', 'compute', 0),
        racked('server-b', 'server_v2', 'compute', 3),
        card('pc', 'pc'),
      ],
      edges: [
        cable('router', 'switch', 0),
        cable('switch', 'server-a', 0),
        cable('switch', 'server-b', 1),
        cable('switch', 'pc', 2),
      ],
    };
    const { hierarchy } = expectTidy(graph, 'two racks');
    expect(at(hierarchy, 'compute').x).toBeGreaterThan(at(hierarchy, 'network').x + RACK_WIDTH);
  });
});

describe('wide families', () => {
  function star(leaves: number, hub: HardwareType = 'switch', ports = 48): LayoutGraph {
    const nodes = [card('router', 'router'), card('hub', hub, { ports })];
    const edges = [cable('router', 'hub', 0)];
    for (let i = 0; i < leaves; i++) {
      nodes.push(card(`leaf-${String(i).padStart(2, '0')}`, 'pc'));
      edges.push(cable('hub', `leaf-${String(i).padStart(2, '0')}`, hub === 'access_point' ? 0 : i, hub === 'access_point' ? 'wireless' : 'ethernet'));
    }
    return { nodes, edges };
  }

  it('folds a 48-port switch with 40 devices into two staggered rows', () => {
    const { hierarchy, compact } = expectTidy(star(40), '40 leaves');
    for (const result of [hierarchy, compact]) {
      const rows = new Set(result.positions.filter(position => position.id.startsWith('leaf')).map(position => position.y));
      expect(rows.size).toBe(2);
    }
    // One row would be 40 cards wide; two rows are about half of that.
    expect(hierarchy.metrics.bounds.width).toBeLessThan(40 * 280 * 0.55);
    expect(compact.metrics.bounds.width).toBeLessThan(hierarchy.metrics.bounds.width);
  });

  it('keeps a small family in one row, and staggers earlier when asked to be compact', () => {
    const { hierarchy, compact } = expectTidy(star(8), '8 leaves');
    const rowsOf = (result: LayoutResult) =>
      new Set(result.positions.filter(position => position.id.startsWith('leaf')).map(position => position.y)).size;
    expect(rowsOf(hierarchy)).toBe(1);
    expect(rowsOf(compact)).toBe(2);
    expect(compact.metrics.bounds.width).toBeLessThan(hierarchy.metrics.bounds.width);
  });

  it('folds the leaves of a big family that also has hubs in it', () => {
    const nodes = [card('router', 'router'), card('core', 'switch', { ports: 24 })];
    const edges = [cable('router', 'core', 0)];
    for (let port = 0; port < 14; port++) {
      if (port === 6) {
        nodes.push(card('floor', 'switch'), card('printer', 'pc'), card('camera', 'pc'));
        edges.push(cable('core', 'floor', port), cable('floor', 'printer', 0), cable('floor', 'camera', 1));
        continue;
      }
      const id = `leaf-${String(port).padStart(2, '0')}`;
      nodes.push(card(id, 'pc'));
      edges.push(cable('core', id, port));
    }
    const { hierarchy } = expectTidy({ nodes, edges }, 'mixed family');
    const leaves = hierarchy.positions.filter(position => position.id.startsWith('leaf'));
    expect(new Set(leaves.map(position => position.y)).size).toBe(2);
    // The switch among them stands in the upper row, between the two groups of leaves.
    const top = Math.min(...leaves.map(position => position.y));
    expect(at(hierarchy, 'floor').y).toBe(top);
    expect(at(hierarchy, 'floor').x).toBeGreaterThan(at(hierarchy, 'leaf-05').x);
    expect(at(hierarchy, 'floor').x).toBeLessThan(at(hierarchy, 'leaf-07').x);
    // 13 leaves and a switch in one row would be about 3900 wide.
    expect(hierarchy.metrics.bounds.width).toBeLessThan(2700);
  });

  it('folds a network that would be a ribbon: every second branch moves to a lower tier', () => {
    // A LAN party drawn seat by seat: four table switches with eight seats each, and consoles.
    const nodes = [card('router', 'router'), card('core', 'switch', { ports: 24 })];
    const edges = [cable('router', 'core', 0)];
    for (let table = 0; table < 4; table++) {
      nodes.push(card(`table-${table}`, 'switch', { ports: 16 }));
      edges.push(cable('core', `table-${table}`, table));
      for (let seat = 0; seat < 8; seat++) {
        nodes.push(card(`seat-${table}-${seat}`, 'pc'));
        edges.push(cable(`table-${table}`, `seat-${table}-${seat}`, seat));
      }
    }
    for (let console = 0; console < 14; console++) {
      nodes.push(card(`console-${String(console).padStart(2, '0')}`, 'console', { height: 110 }));
      edges.push(cable('core', `console-${String(console).padStart(2, '0')}`, 6 + console));
    }
    const { hierarchy, compact } = expectTidy({ nodes, edges }, 'party by the seat');

    // One row per switch would be about 11000 wide and 860 high.
    for (const result of [hierarchy, compact]) {
      const { width, height } = result.metrics.bounds;
      expect(width / height).toBeLessThan(4);
      expect(width).toBeLessThan(6000);
      expect(result.metrics.otherCrossings).toBe(0);
    }
    // Tables alternate between two tiers, still left to right in the order of their ports.
    const tables = [0, 1, 2, 3].map(table => at(hierarchy, `table-${table}`));
    expect(tables[0].y).toBe(tables[2].y);
    expect(tables[1].y).toBe(tables[3].y);
    expect(tables[1].y).toBeGreaterThan(tables[0].y);
    expect(tables.map(table => table.x)).toEqual(tables.map(table => table.x).toSorted((a, b) => a - b));
    // The lower tier starts below everything of the upper one.
    const upperBottom = Math.max(
      ...hierarchy.positions
        .filter(position => /^seat-[02]-/.test(position.id))
        .map(position => position.y + 200),
    );
    expect(tables[1].y).toBeGreaterThan(upperBottom);
  });

  it('leaves a network of ordinary size as a plain tree', () => {
    // Eleven devices on one switch: wide, but it fits a screen.
    const nodes = [card('router', 'router'), card('switch', 'switch', { ports: 16 })];
    const edges = [cable('router', 'switch', 0)];
    for (let i = 0; i < 11; i++) {
      nodes.push(card(`pc-${String(i).padStart(2, '0')}`, 'pc'));
      edges.push(cable('switch', `pc-${String(i).padStart(2, '0')}`, i));
    }
    const { hierarchy } = expectTidy({ nodes, edges }, 'eleven on a switch');
    expect(new Set(hierarchy.positions.filter(position => position.id.startsWith('pc')).map(position => position.y)).size).toBe(1);
  });

  it('stands 30 Wi-Fi clients under their access point', () => {
    expectTidy(star(30, 'access_point', 1), '30 clients');
  });
});

describe('planner output', () => {
  it('arranges a 64-seat LAN party', () => {
    const plan = buildLanPartyPlan(
      {
        name: 'Party',
        seats: 64,
        consoles: 4,
        wifi: true,
        mainsVoltage: 230,
        breakerAmps: 16,
        circuits: 9,
        downMbps: 500,
        upMbps: 50,
        hours: 24,
        games: [],
        lancache: false,
      },
      [],
    );
    const { hierarchy, compact } = expectTidy(planned(plan), 'LAN party');
    expect(hierarchy.usedEstimates).toBe(true);
    expect(compact.metrics.bounds.width).toBeLessThanOrEqual(hierarchy.metrics.bounds.width);
  });

  it('gets plans that open tidy: the planners use the same engine', () => {
    const plans = [
      buildHomelabPlan(
        { goals: ['media', 'backup', 'network'], footprint: 'rack', budget: 'enthusiast', reliability: 'resilient', name: 'Lab' },
        [],
      ),
      buildHomelabPlan(
        { goals: ['home'], footprint: 'compact', budget: 'starter', reliability: 'simple', name: 'Small' },
        [],
      ),
      buildGameServerPlan(
        { name: 'Server', games: [], location: 'vps', exposure: 'port_forward', downMbps: 300, upMbps: 30, cgnat: 'no', voice: false },
        [],
      ),
    ];
    for (const plan of plans) {
      const graph = planned(plan);
      // As handed out, before anything ran on it here.
      const { metrics } = pictureOf(graph);
      expect(metrics, plan.name).toMatchObject({ overlaps: 0, treeCrossings: 0, treeCableHits: 0 });
      const top = graph.nodes.filter(node => !node.parentId);
      expect(Math.min(...top.map(node => node.x)), plan.name).toBe(80);
      expect(Math.min(...top.map(node => node.y)), plan.name).toBe(80);
      // Polishing it right after opening has nothing to do.
      const again = computeLayout(graph, { style: 'hierarchy' });
      for (const position of again.positions) {
        const node = graph.nodes.find(entry => entry.id === position.id)!;
        expect({ x: position.x, y: position.y }, `${plan.name}: ${node.name}`).toEqual({ x: node.x, y: node.y });
      }
    }
  });

  it('arranges a homelab plan with a rack', () => {
    const plan = buildHomelabPlan(
      { goals: ['media', 'backup', 'network'], footprint: 'rack', budget: 'enthusiast', reliability: 'resilient', name: 'Lab' },
      [],
    );
    expectTidy(planned(plan), 'homelab plan');
  });

  it('arranges a game server plan', () => {
    const plan = buildGameServerPlan(
      { name: 'Server', games: [], location: 'home', exposure: 'port_forward', downMbps: 300, upMbps: 30, cgnat: 'no', voice: false },
      [],
    );
    const { hierarchy } = expectTidy(planned(plan), 'game server plan');
    const ids = Object.fromEntries((plan.nodes as PlannedNode[]).map(node => [node.type, node.id]));
    expect(at(hierarchy, ids.modem).y).toBeLessThan(at(hierarchy, ids.router).y);
  });
});

// ─── Random networks ─────────────────────────────────────────────────────────

/** A small deterministic generator, so a failure can be reproduced from its seed. */
function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A network as people build them, only messier: one or two routers, switches
 * and firewalls below them, devices of every height, access points with Wi-Fi
 * clients, cables drawn in either direction, two UPSes, a loose device, and in
 * some seeds a rack with a few of the hubs in it.
 */
function randomNetwork(seed: number, size: number, options = { racks: true }): LayoutGraph {
  const next = random(seed);
  const pick = <T,>(items: T[]) => items[Math.floor(next() * items.length)];
  const leafTypes: HardwareType[] = ['pc', 'nas', 'minipc', 'sbc', 'console'];
  const nodes: LayoutNode[] = [];
  const edges: LayoutEdge[] = [];
  let serial = 0;
  const newId = () => `n${String(serial++).padStart(3, '0')}`;

  // In some seeds the first few hubs below the routers go into a rack.
  const rackId = options.racks && next() < 0.4 ? 'rack' : null;
  let slotsLeft = rackId ? 2 + Math.floor(next() * 3) : 0;
  if (rackId) nodes.push(rack(rackId, 12));
  const inRack = (): Partial<LayoutNode> => {
    if (!rackId || slotsLeft === 0) return {};
    slotsLeft -= 1;
    return { parentId: rackId, x: 28, y: 40 + slotsLeft * 2 * 90, height: 80 };
  };

  /** Ports with nothing plugged in yet, per device that others can hang from. */
  const freePorts = new Map<string, number[]>();
  const addHub = (type: HardwareType, extra: Partial<LayoutNode> = {}) => {
    const id = newId();
    const ports = pick([4, 8, 16, 24]);
    nodes.push(
      card(id, type, {
        ports,
        height: 80 + Math.floor(next() * 4) * 20,
        zoneRoot: type === 'firewall',
        ...extra,
      }),
    );
    freePorts.set(id, Array.from({ length: ports }, (_, index) => index));
    return id;
  };
  const leaf = (type: HardwareType) => {
    const id = newId();
    nodes.push(
      card(id, type, { height: 100 + Math.floor(next() * 8) * 40, width: next() < 0.3 ? 244 : 220 }),
    );
    return id;
  };
  /** Plugs `child` into `parent`, now and then drawn from the device up to the hub. */
  const plug = (parent: string, child: string, port: number, medium: Medium = 'ethernet') => {
    edges.push(
      next() < 0.12
        ? cable(child, parent, 0, medium, { source: 'target-0', target: `eth${port}` })
        : cable(parent, child, port, medium),
    );
  };

  const routers = 1 + Math.floor(next() * 2);
  for (let i = 0; i < routers; i++) addHub('router');
  while (nodes.length < size) {
    const open = [...freePorts.entries()].filter(([, ports]) => ports.length > 0);
    if (open.length === 0) break;
    const [parent, ports] = pick(open);
    const port = ports.splice(Math.floor(next() * ports.length), 1)[0];
    const roll = next();
    if (roll < 0.3) {
      plug(parent, addHub(next() < 0.15 ? 'firewall' : 'switch', inRack()), port);
    } else if (roll < 0.4) {
      const accessPoint = leaf('access_point');
      plug(parent, accessPoint, port);
      const clients = Math.floor(next() * 4);
      for (let i = 0; i < clients; i++) plug(accessPoint, leaf(pick(['pc', 'console'])), 0, 'wireless');
    } else {
      plug(parent, leaf(pick(leafTypes)), port);
    }
  }
  // A few power feeds across the tree, and a device without any cable.
  const fed = nodes.filter(node => !HUBS.has(node.type) && node.type !== 'rack');
  for (let i = 0; i < 2 && fed.length > 0; i++) {
    const ups = `ups${i}`;
    nodes.push(card(ups, 'ups', { ports: 4 }));
    for (let port = 0; port < 2; port++) edges.push(cable(ups, pick(fed).id, port, 'power'));
  }
  nodes.push(card('loose', 'pc'));
  // Start from a mess. Devices in the rack keep their slot.
  for (const node of nodes) {
    if (node.parentId) continue;
    node.x = Math.floor(next() * 4000);
    node.y = Math.floor(next() * 3000);
  }
  return { nodes, edges: dedupe(edges) };
}

/** At most one cable per pair of devices, as the canvas enforces. */
function dedupe(edges: LayoutEdge[]): LayoutEdge[] {
  const seen = new Set<string>();
  return edges.filter(edge => {
    const key = [edge.source, edge.target].toSorted().join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

describe('random networks', () => {
  // LAYOUT_SEEDS=2000 gives the engine a longer run after a change to it.
  const seeds = Number(env.LAYOUT_SEEDS) || 60;

  it('keeps every promise on networks of 5 to 120 devices', () => {
    for (let seed = 1; seed <= seeds; seed++) {
      expectTidy(randomNetwork(seed, 5 + ((seed * 37) % 116)), `seed ${seed}`);
    }
    // Roomy on purpose: a busy CI machine on an older Node takes several times as long.
  }, 15_000 + seeds * 250);

  it('does not reshuffle the canvas when one device is added', () => {
    let checked = 0;
    for (let seed = 1; seed <= 25; seed++) {
      // Without a rack: which side of a rack a group stands on depends on how
      // much is on each side already.
      const graph = randomNetwork(seed, 30, { racks: false });
      const before = computeLayout(graph, { style: 'hierarchy' });
      const settled = withPositions(graph, before.positions);

      // One more device on a switch that has a free port.
      const used = new Map<string, Set<string>>();
      for (const edge of settled.edges) used.set(edge.source, (used.get(edge.source) ?? new Set()).add(edge.sourceHandle));
      const hub = settled.nodes.find(node => node.type === 'switch' && (used.get(node.id)?.size ?? 0) < node.ports);
      if (!hub) continue;
      const port = Array.from({ length: hub.ports }, (_, index) => index).find(index => !used.get(hub.id)?.has(`eth${index}`))!;
      const grown: LayoutGraph = {
        nodes: [...settled.nodes, card('newcomer', 'pc')],
        edges: [...settled.edges, cable(hub.id, 'newcomer', port)],
      };
      const after = computeLayout(grown, { style: 'hierarchy' });
      checked += 1;

      // The first network's root is what the canvas is anchored on: it stays,
      // give or take the step of the grid.
      const anchor = settled.nodes
        .filter(node => node.type === 'router' && settled.edges.some(edge => edge.source === node.id))
        .toSorted((a, b) => a.y - b.y || a.x - b.x)[0];
      expect(Math.abs(at(after, anchor.id).x - at(before, anchor.id).x), `seed ${seed}: the anchor moved`).toBeLessThan(20);
      expect(Math.abs(at(after, anchor.id).y - at(before, anchor.id).y), `seed ${seed}: the anchor moved`).toBeLessThan(20);

      // Whatever stood left of something in its row still does. A UPS is left
      // out: it stands on the side where its cables cross less, and that can change.
      const kept = before.positions.filter(position => !position.id.startsWith('ups'));
      for (const first of kept) {
        for (const second of kept) {
          if (first.y !== second.y || first.x >= second.x) continue;
          const [nowFirst, nowSecond] = [at(after, first.id), at(after, second.id)];
          if (nowFirst.y !== nowSecond.y) continue;
          expect(nowFirst.x, `seed ${seed}: ${first.id} and ${second.id} swapped`).toBeLessThan(nowSecond.x);
        }
      }
    }
    expect(checked).toBeGreaterThan(10);
  });

  it('lays out 300 devices well within a blink', () => {
    const graph = randomNetwork(7, 300);
    expect(graph.nodes.length).toBeGreaterThan(250);
    const started = performance.now();
    const result = computeLayout(graph, { style: 'hierarchy' });
    const elapsed = performance.now() - started;
    expect(result.metrics.overlaps).toBe(0);
    // Generous: this also has to pass on a busy CI machine.
    expect(elapsed).toBeLessThan(1500);
  });
});
