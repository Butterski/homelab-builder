import type { Edge, Node } from '@xyflow/react';
import {
  canNodeHostVMs,
  isNetworkNode,
  nodeHasDynamicPorts,
} from '../../../../lib/hardware-config';
import type { HardwareNode, HardwareType } from '../../../../types';
import {
  RACK_FOOTER_PX,
  RACK_HEADER_PX,
  RACK_U_HEIGHT_PX,
  RACK_WIDTH_PX,
} from '../../components/rack-node-constants';
import { getNodePortCount } from '../port-count';
import type { LayoutEdge, LayoutGraph, LayoutNode, Medium } from './types';
import { TOP_HANDLE } from './units';

/** A card on the canvas, with what the layout needs to know about it. */
export interface CanvasCard {
  hardware: HardwareNode;
  x: number;
  y: number;
  /** What React Flow measured, when it has. */
  measured?: { width?: number; height?: number };
  parentId?: string;
}

/** A cable on the canvas. */
export interface CanvasCable {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
  /** ethernet, wireless or vpn. */
  type?: string;
}

const CARD_WIDTH = 220;
const CARD_WIDTH_WITH_GUESTS = 244;
/** A hub's card grows with its ports from this width on. */
const PORTS_WIDEN_FROM = 192;
const PORT_PITCH = 16;

export function rackHeight(node: HardwareNode): number {
  const size = Number(node.details?.rack_size) || 24;
  return RACK_HEADER_PX + size * RACK_U_HEIGHT_PX + RACK_FOOTER_PX;
}

function portCount(node: HardwareNode): number {
  if (!nodeHasDynamicPorts(node.type)) return 1;
  return Math.max(1, getNodePortCount(node.type, node.details?.ports));
}

/**
 * The size a card will have, for when React Flow has not measured it: a plan
 * that is not on screen yet, or the moment before the first paint. It follows
 * the blocks `hardware-node.tsx` renders and errs on the tall side, because a
 * guess that is too small makes cards overlap.
 */
export function estimateNodeSize(node: HardwareNode): { width: number; height: number } {
  if (node.type === 'rack') return { width: RACK_WIDTH_PX, height: rackHeight(node) };

  const details = node.details ?? {};
  const guests = node.vms?.length ?? 0;
  const components = node.internal_components?.length ?? 0;
  const base = guests > 0 || components > 0 ? CARD_WIDTH_WITH_GUESTS : CARD_WIDTH;
  const byPorts = nodeHasDynamicPorts(node.type) ? portCount(node) * PORT_PITCH : 0;
  const width = byPorts > PORTS_WIDEN_FROM ? Math.max(base, byPorts) : base;

  const networked = isNetworkNode(node.type);
  const compute = canNodeHostVMs(node.type);
  const hasBody =
    compute ||
    !networked ||
    !!details.model ||
    components > 0 ||
    guests > 0 ||
    !!details.cpu ||
    !!details.ram ||
    !!details.storage ||
    !!node.ip;

  let height = 58; // header: name, type pill, status light
  if (hasBody) {
    const blocks: number[] = [];
    if (details.model) blocks.push(14);
    if (node.type === 'lan_table') blocks.push(78);
    if (networked) {
      let cells = 1; // address
      if (details.lan_gateway_ip) cells += details.lan_subnet ? 2 : 1;
      if (compute && node.ip) cells += 1; // container pool
      if (details.dhcp_pool) cells += 1;
      if (
        details.nat_enabled ||
        details.firewall_enabled ||
        details.routing_enabled ||
        details.network_zone
      ) {
        cells += 1;
      }
      if (node.type === 'vps') cells += 1;
      blocks.push(cells * 26);
    }
    if (node.type === 'server_v2') blocks.push(24);
    const specs = [details.cpu, details.ram, details.storage, details.ports].filter(Boolean).length;
    if (specs > 0) blocks.push(Math.ceil(specs / 2) * 28);
    if (compute && guests > 0 && (details.cpu || details.ram)) blocks.push(68);
    if (components > 0) blocks.push(32 + components * 42);
    if (compute) blocks.push(40); // virtual network button
    if (guests > 0) blocks.push(34 + Math.min(guests * 42, 144));
    if (compute && guests === 0 && components === 0) blocks.push(20);
    height += 24 + blocks.reduce((sum, block) => sum + block, 0) + Math.max(0, blocks.length - 1) * 10;
  }
  return { width, height: Math.ceil(height / 10) * 10 };
}

/** A device that puts everything behind it into its own address space: the canvas outlines that branch. */
function isZoneRoot(node: HardwareNode): boolean {
  const details = node.details ?? {};
  const routes =
    (node.type === 'server_v2' || node.type === 'vps' || node.type === 'firewall') &&
    !!details.dhcp_enabled &&
    !!details.routing_enabled;
  return !!details.nat_enabled || !!details.firewall_enabled || node.type === 'firewall' || routes;
}

/** A link with a UPS at one end carries power, whatever it was drawn as. */
function mediumOf(cable: CanvasCable, types: Map<string, HardwareType>): Medium {
  if (types.get(cable.source) === 'ups' || types.get(cable.target) === 'ups') return 'power';
  if (cable.type === 'wireless' || cable.type === 'vpn') return cable.type;
  return 'ethernet';
}

/** Describes a canvas to the layout engine. */
export function buildLayoutGraph(cards: CanvasCard[], cables: CanvasCable[]): LayoutGraph {
  const types = new Map(cards.map(card => [card.hardware.id, card.hardware.type]));
  const nodes: LayoutNode[] = cards.map(card => {
    const hardware = card.hardware;
    const guess = estimateNodeSize(hardware);
    const rack = hardware.type === 'rack';
    // A rack's size follows from its height in units; what was measured can be
    // older than the last edit of that field.
    const width = rack ? guess.width : card.measured?.width;
    const height = rack ? guess.height : card.measured?.height;
    return {
      id: hardware.id,
      type: hardware.type,
      name: hardware.name,
      x: card.x,
      y: card.y,
      width: width ?? guess.width,
      height: height ?? guess.height,
      estimated: !rack && !(card.measured?.width && card.measured?.height),
      parentId: card.parentId,
      ports: portCount(hardware),
      spreadPorts: nodeHasDynamicPorts(hardware.type),
      zoneRoot: isZoneRoot(hardware),
    };
  });
  const edges: LayoutEdge[] = cables
    .filter(cable => types.has(cable.source) && types.has(cable.target))
    .map(cable => ({
      id: cable.id,
      source: cable.source,
      target: cable.target,
      sourceHandle: cable.sourceHandle || 'eth0',
      targetHandle: cable.targetHandle || TOP_HANDLE,
      medium: mediumOf(cable, types),
    }));
  return { nodes, edges };
}

/** The live canvas, as React Flow and the builder store hold it. */
export function layoutGraphFromFlow(
  nodes: Node[],
  edges: Edge[],
  hardwareNodes: HardwareNode[],
): LayoutGraph {
  const hardware = new Map(hardwareNodes.map(node => [node.id, node]));
  const cards: CanvasCard[] = [];
  for (const node of nodes) {
    if (node.type !== 'hardware' && node.type !== 'rack') continue;
    const device = hardware.get(node.id) ?? (node.data as unknown as HardwareNode | undefined);
    if (!device?.type) continue;
    cards.push({
      hardware: { ...device, id: node.id },
      x: node.position.x,
      y: node.position.y,
      measured: node.measured,
      parentId: node.parentId,
    });
  }
  return buildLayoutGraph(
    cards,
    edges.map(edge => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle,
      targetHandle: edge.targetHandle,
      type: edge.data?.connection_type as string | undefined,
    })),
  );
}
