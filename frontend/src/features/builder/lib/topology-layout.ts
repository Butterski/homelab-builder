import type { Edge } from '@xyflow/react';
import type { HardwareNode, HardwareType } from '../../../types';
import { isNetworkNode } from '../../../lib/hardware-config';

type LayoutEdge = Pick<Edge, 'source' | 'target'>;

export type TopologyLayoutPosition = {
  id: string;
  x: number;
  y: number;
};

type LayoutOptions = {
  startX?: number;
  startY?: number;
  columnGap?: number;
  rowGap?: number;
};

const TYPE_ORDER: Partial<Record<HardwareType, number>> = {
  modem: 0,
  router: 1,
  firewall: 2,
  switch: 3,
  access_point: 4,
  server_v2: 5,
  server: 6,
  nas: 7,
  minipc: 8,
  pc: 9,
  sbc: 10,
  vps: 11,
  iot: 12,
  ups: 13,
  pdu: 14,
  rack: 15,
};

function isGatewayNode(node: HardwareNode) {
  return (
    node.type === 'modem' ||
    node.type === 'router' ||
    node.type === 'firewall' ||
    !!node.details?.routing_enabled ||
    !!node.details?.nat_enabled ||
    !!node.details?.dhcp_enabled ||
    !!node.details?.lan_gateway_ip
  );
}

function compareHardwareNodes(a: HardwareNode, b: HardwareNode) {
  const typeDelta = (TYPE_ORDER[a.type] ?? 99) - (TYPE_ORDER[b.type] ?? 99);
  if (typeDelta !== 0) return typeDelta;
  return a.name.localeCompare(b.name);
}

function buildAdjacency(nodes: HardwareNode[], edges: LayoutEdge[]) {
  const topLevelIds = new Set(nodes.map(node => node.id));
  const adjacency = new Map<string, Set<string>>();
  topLevelIds.forEach(id => adjacency.set(id, new Set()));

  edges.forEach(edge => {
    if (!topLevelIds.has(edge.source) || !topLevelIds.has(edge.target)) return;
    adjacency.get(edge.source)?.add(edge.target);
    adjacency.get(edge.target)?.add(edge.source);
  });

  return adjacency;
}

function getSeeds(nodes: HardwareNode[]) {
  const gateways = nodes.filter(isGatewayNode).sort(compareHardwareNodes);
  if (gateways.length > 0) return gateways;

  const networkNodes = nodes.filter(node => isNetworkNode(node.type)).sort(compareHardwareNodes);
  if (networkNodes.length > 0) return [networkNodes[0]];

  return [nodes.toSorted(compareHardwareNodes)[0]].filter(Boolean);
}

export function computeTopologyLayout(
  hardwareNodes: HardwareNode[],
  edges: LayoutEdge[],
  options: LayoutOptions = {},
): TopologyLayoutPosition[] {
  const startX = options.startX ?? 80;
  const startY = options.startY ?? 80;
  const columnGap = options.columnGap ?? 320;
  const rowGap = options.rowGap ?? 210;
  const topLevelNodes = hardwareNodes.filter(node => !node.parent_id).sort(compareHardwareNodes);

  if (topLevelNodes.length === 0) return [];

  const nodeById = new Map(topLevelNodes.map(node => [node.id, node]));
  const adjacency = buildAdjacency(topLevelNodes, edges);
  const layerById = new Map<string, number>();
  const seeds = getSeeds(topLevelNodes);
  const queue = seeds.map(seed => ({ id: seed.id, layer: 0 }));

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || layerById.has(current.id)) continue;

    layerById.set(current.id, current.layer);

    const neighbors = [...(adjacency.get(current.id) ?? [])]
      .map(id => nodeById.get(id))
      .filter((node): node is HardwareNode => !!node)
      .sort(compareHardwareNodes);

    neighbors.forEach(neighbor => {
      if (!layerById.has(neighbor.id)) {
        queue.push({ id: neighbor.id, layer: current.layer + 1 });
      }
    });
  }

  const disconnectedLayer =
    layerById.size > 0 ? Math.max(...layerById.values()) + 1 : 0;

  topLevelNodes.forEach(node => {
    if (!layerById.has(node.id)) layerById.set(node.id, disconnectedLayer);
  });

  const nodesByLayer = new Map<number, HardwareNode[]>();
  topLevelNodes.forEach(node => {
    const layer = layerById.get(node.id) ?? disconnectedLayer;
    nodesByLayer.set(layer, [...(nodesByLayer.get(layer) ?? []), node]);
  });

  return [...nodesByLayer.entries()]
    .sort(([a], [b]) => a - b)
    .flatMap(([layer, layerNodes]) =>
      layerNodes.sort(compareHardwareNodes).map((node, index) => ({
        id: node.id,
        x: startX + layer * columnGap,
        y: startY + index * rowGap,
      })),
    );
}

