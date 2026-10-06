import type { Edge, Node } from '@xyflow/react';
import { describe, expect, it } from 'vitest';
import type { HardwareNode, HardwareType } from '../../../../types';
import { buildLayoutGraph, estimateNodeSize, layoutGraphFromFlow } from './from-flow';

function device(id: string, type: HardwareType, extra: Partial<HardwareNode> = {}): HardwareNode {
  return {
    id,
    type,
    name: id,
    x: 0,
    y: 0,
    details: {},
    vms: [],
    internal_components: [],
    ...extra,
  } as HardwareNode;
}

describe('estimateNodeSize', () => {
  it('sizes a rack by its height in units', () => {
    expect(estimateNodeSize(device('rack', 'rack', { details: { rack_size: 12 } }))).toEqual({
      width: 280,
      height: 40 + 12 * 90 + 8,
    });
  });

  it('widens a hub with many ports and a card that shows its guests', () => {
    const small = estimateNodeSize(device('sw', 'switch', { details: { ports: 8 } }));
    const large = estimateNodeSize(device('sw', 'switch', { details: { ports: 24 } }));
    expect(small.width).toBe(220);
    expect(large.width).toBe(24 * 16);

    const empty = estimateNodeSize(device('srv', 'server_v2'));
    const busy = estimateNodeSize(
      device('srv', 'server_v2', {
        vms: [
          { id: 'a', name: 'Jellyfin' },
          { id: 'b', name: 'Pi-hole' },
        ] as HardwareNode['vms'],
      }),
    );
    expect(busy.width).toBe(244);
    expect(busy.height).toBeGreaterThan(empty.height);
  });

  it('errs on the tall side: a bare switch is still a card', () => {
    expect(estimateNodeSize(device('sw', 'switch')).height).toBeGreaterThanOrEqual(60);
  });
});

describe('buildLayoutGraph', () => {
  it('uses what was measured and says when it had to guess', () => {
    const graph = buildLayoutGraph(
      [
        { hardware: device('seen', 'pc'), x: 10, y: 20, measured: { width: 231, height: 187 } },
        { hardware: device('new', 'pc'), x: 0, y: 0 },
        // What was measured for a rack can be older than its size setting.
        {
          hardware: device('rack', 'rack', { details: { rack_size: 6 } }),
          x: 0,
          y: 0,
          measured: { width: 280, height: 2208 },
        },
      ],
      [],
    );
    const byId = Object.fromEntries(graph.nodes.map(node => [node.id, node]));
    expect(byId.seen).toMatchObject({ x: 10, y: 20, width: 231, height: 187, estimated: false });
    expect(byId.new.estimated).toBe(true);
    expect(byId.rack).toMatchObject({ height: 40 + 6 * 90 + 8, estimated: false });
  });

  it('reads the medium of every cable, and power off anything a UPS is on', () => {
    const cards = ['router', 'ups', 'server', 'laptop', 'site'].map((id, index) => ({
      hardware: device(id, (['router', 'ups', 'server_v2', 'pc', 'vps'] as HardwareType[])[index]),
      x: 0,
      y: 0,
    }));
    const graph = buildLayoutGraph(cards, [
      { id: 'a', source: 'router', target: 'server', sourceHandle: 'eth0', targetHandle: 'target-0', type: 'ethernet' },
      { id: 'b', source: 'ups', target: 'server', sourceHandle: 'eth0', targetHandle: 'target-0', type: 'ethernet' },
      { id: 'c', source: 'router', target: 'laptop', sourceHandle: 'eth1', targetHandle: 'target-0', type: 'wireless' },
      { id: 'd', source: 'router', target: 'site', type: 'vpn' },
      { id: 'e', source: 'router', target: 'gone', type: 'ethernet' },
    ]);
    expect(graph.edges.map(edge => [edge.id, edge.medium])).toEqual([
      ['a', 'ethernet'],
      ['b', 'power'],
      ['c', 'wireless'],
      ['d', 'vpn'],
    ]);
    // A cable saved without handles runs from a port to the handle on top.
    expect(graph.edges[3]).toMatchObject({ sourceHandle: 'eth0', targetHandle: 'target-0' });
  });

  it('marks the devices whose branch the canvas outlines', () => {
    const graph = buildLayoutGraph(
      [
        { hardware: device('plain', 'router'), x: 0, y: 0 },
        { hardware: device('nat', 'router', { details: { nat_enabled: true } }), x: 0, y: 0 },
        { hardware: device('fw', 'firewall'), x: 0, y: 0 },
        {
          hardware: device('gw', 'server_v2', { details: { dhcp_enabled: true, routing_enabled: true } }),
          x: 0,
          y: 0,
        },
      ],
      [],
    );
    expect(Object.fromEntries(graph.nodes.map(node => [node.id, node.zoneRoot]))).toEqual({
      plain: false,
      nat: true,
      fw: true,
      gw: true,
    });
  });

  it('gives a hub one port anchor per port and any other device a single one', () => {
    const graph = buildLayoutGraph(
      [
        { hardware: device('sw', 'switch', { details: { ports: 16 } }), x: 0, y: 0 },
        { hardware: device('nas', 'nas'), x: 0, y: 0 },
      ],
      [],
    );
    expect(graph.nodes[0]).toMatchObject({ ports: 16, spreadPorts: true });
    expect(graph.nodes[1]).toMatchObject({ ports: 1, spreadPorts: false });
  });
});

describe('layoutGraphFromFlow', () => {
  it('takes positions and sizes from the canvas, and devices from the device list', () => {
    const nodes: Node[] = [
      { id: 'rack', type: 'rack', position: { x: 400, y: 80 }, data: {} },
      {
        id: 'srv',
        type: 'hardware',
        position: { x: 28, y: 40 },
        parentId: 'rack',
        measured: { width: 220, height: 80 },
        data: {},
      },
      { id: 'pc', type: 'hardware', position: { x: 900, y: 300 }, data: {} },
      // Zone outlines and anything else on the canvas are not devices.
      { id: 'network-zone-nat-1', type: 'networkZone', position: { x: 0, y: 0 }, data: {} },
      { id: 'orphan', type: 'hardware', position: { x: 0, y: 0 }, data: {} },
    ];
    const edges: Edge[] = [
      {
        id: 'e1',
        source: 'srv',
        target: 'pc',
        sourceHandle: 'eth0',
        targetHandle: 'target-0',
        data: { connection_type: 'wireless' },
      },
    ];
    // The device list still has the position from before the last drag.
    const hardware = [
      device('rack', 'rack', { details: { rack_size: 6 } }),
      device('srv', 'server_v2', { parent_id: 'rack' }),
      device('pc', 'pc', { x: 1, y: 2 }),
    ];

    const graph = layoutGraphFromFlow(nodes, edges, hardware);

    expect(graph.nodes.map(node => node.id)).toEqual(['rack', 'srv', 'pc']);
    expect(graph.nodes[1]).toMatchObject({ parentId: 'rack', x: 28, y: 40, estimated: false });
    expect(graph.nodes[2]).toMatchObject({ x: 900, y: 300, estimated: true });
    expect(graph.edges).toEqual([
      { id: 'e1', source: 'srv', target: 'pc', sourceHandle: 'eth0', targetHandle: 'target-0', medium: 'wireless' },
    ]);
  });
});
