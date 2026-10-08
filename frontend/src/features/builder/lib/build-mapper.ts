import type { Edge, Node } from '@xyflow/react';
import type { HardwareNode, HardwareSpec, HardwareType } from '../../../types';
import type { Build } from '../api/builds';
import {
  RACK_FOOTER_PX,
  RACK_HEADER_PX,
  RACK_U_HEIGHT_PX,
  RACK_WIDTH_PX,
} from '../components/rack-node-constants';

export type FlowBuild = {
  hardwareNodes: HardwareNode[];
  nodes: Node[];
  edges: Edge[];
};

/** Details as the API stores them: an object, or the same as a JSON string. */
export function parseDetails(details: unknown): HardwareSpec {
  if (!details) return {};
  if (typeof details === 'string') {
    try {
      const parsed: unknown = JSON.parse(details);
      return parsed && typeof parsed === 'object' ? (parsed as HardwareSpec) : {};
    } catch {
      return {};
    }
  }
  return typeof details === 'object' ? (details as HardwareSpec) : {};
}

/**
 * Converts a build as the API returns it (relational nodes and edges) into the
 * canvas representation: the hardware list plus React Flow nodes and edges.
 */
export function mapBuildToFlow(build: Build): FlowBuild {
  const serverNodes = build.nodes || [];
  const serverEdges = build.edges || [];

  const hardwareNodes: HardwareNode[] = serverNodes.map(n => ({
    id: n.id,
    type: n.type as HardwareType,
    name: n.name,
    ip: n.ip,
    mac_address: n.mac_address,
    power_draw: n.power_draw || undefined,
    x: n.x || 0,
    y: n.y || 0,
    vms: n.virtual_machines || [],
    internal_components: n.internal_components || [],
    details: parseDetails(n.details),
    parent_id: n.parent_id || undefined,
  }));

  const hwMap = new Map<string, HardwareNode>(hardwareNodes.map(n => [n.id, n]));

  // Racks first so React Flow can resolve parentId references.
  const sortedNodes = serverNodes.toSorted(
    (a, b) => (a.type === 'rack' ? 0 : 1) - (b.type === 'rack' ? 0 : 1),
  );

  const nodes: Node[] = sortedNodes.map(n => {
    const hw = hwMap.get(n.id);
    const isRack = n.type === 'rack';
    const rackSize = hw?.details?.rack_size || 24;
    const totalHeight = RACK_HEADER_PX + rackSize * RACK_U_HEIGHT_PX + RACK_FOOTER_PX;

    return {
      id: n.id,
      type: isRack ? 'rack' : 'hardware',
      position: { x: n.x ?? 0, y: n.y ?? 0 },
      data: { ...(hw || {}), label: n.name },
      ...(isRack ? { style: { width: RACK_WIDTH_PX, height: totalHeight } } : {}),
      ...(n.parent_id ? { parentId: n.parent_id, extent: 'parent' as const } : {}),
    };
  });

  const edges: Edge[] = serverEdges.map(e => ({
    id: String(e.id || `${e.source_node_id}-${e.target_node_id}`),
    source: String(e.source_node_id),
    sourceHandle: e.source_handle || undefined,
    target: String(e.target_node_id),
    targetHandle: e.target_handle || undefined,
    type: 'custom',
    data: {
      connection_type: e.type || 'ethernet',
      speed: e.speed || '1 GbE',
      subnet: e.subnet || '',
      wireless_standard: e.wireless_standard || 'Wi-Fi 6',
      direction: e.direction || 'auto',
    },
  }));

  return { hardwareNodes, nodes, edges };
}
