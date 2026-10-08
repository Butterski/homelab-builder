import type { HardwareNode, HardwareType } from '../../../types';
import { canNodeConnectToAny, isWifiAssociation } from '../../../lib/hardware-config';

// The rules for drawing a link on the canvas. The backend applies the same
// rules on save (build_service.go: validateEdgeEndpoints).

export interface LinkEnd {
  source: string | null;
  target: string | null;
  sourceHandle?: string | null;
  targetHandle?: string | null;
}

type ConnectionCheck = { ok: true } | { ok: false; message?: string };

const isPowerLink = (a: HardwareType, b: HardwareType) => a === 'ups' || b === 'ups';

/**
 * The connection type a link between two device types must have, or null when
 * the user may choose. A Wi-Fi client is always wireless; a LAN table is cabled.
 */
export function requiredConnectionType(
  a: HardwareType | undefined,
  b: HardwareType | undefined,
): 'wireless' | 'ethernet' | null {
  if (!a || !b) return null;
  if (isPowerLink(a, b)) return null;
  if (isWifiAssociation(a, b)) return 'wireless';
  if (a === 'lan_table' || b === 'lan_table') return 'ethernet';
  return null;
}

/** Decides whether a new link may be drawn. A missing message means "refuse silently". */
export function checkConnection(
  connection: LinkEnd,
  nodes: HardwareNode[],
  edges: LinkEnd[],
  options: { ignoreLoops?: boolean } = {},
): ConnectionCheck {
  if (!connection.source || !connection.target || connection.source === connection.target) {
    return { ok: false };
  }
  const types = new Map(nodes.map(node => [node.id, node.type]));
  const sourceType = types.get(connection.source);
  const targetType = types.get(connection.target);
  if (!sourceType || !targetType) return { ok: false };

  const power = isPowerLink(sourceType, targetType);
  const wifiClient = isWifiAssociation(sourceType, targetType);

  // An existing link that is a power feed never takes a network port, and a
  // Wi-Fi client never takes the access point's port: it carries the uplink.
  const takesPort = (edge: LinkEnd, nodeId: string) => {
    const a = edge.source ? types.get(edge.source) : undefined;
    const b = edge.target ? types.get(edge.target) : undefined;
    if (!a || !b) return true;
    return !(types.get(nodeId) === 'access_point' && isWifiAssociation(a, b));
  };
  const handleInUse = (nodeId: string, handle: string | null | undefined) =>
    edges.some(
      edge =>
        takesPort(edge, nodeId) &&
        ((edge.source === nodeId && edge.sourceHandle === handle) ||
          (edge.target === nodeId && edge.targetHandle === handle)),
    );

  // Each physical port carries one cable. Power feeds share ports with network
  // links, and Wi-Fi clients all hang off the access point's one port.
  if (!power) {
    const skipSource = wifiClient && sourceType === 'access_point';
    const skipTarget = wifiClient && targetType === 'access_point';
    if (!skipSource && handleInUse(connection.source, connection.sourceHandle)) {
      return { ok: false, message: 'Source port is already in use.' };
    }
    if (!skipTarget && handleInUse(connection.target, connection.targetHandle)) {
      return { ok: false, message: 'Target port is already in use.' };
    }
  }

  if (!power) {
    for (const [nodeId, type] of [
      [connection.source, sourceType],
      [connection.target, targetType],
    ] as const) {
      if (type !== 'lan_table') continue;
      const hasUplink = edges.some(edge => {
        if (edge.source !== nodeId && edge.target !== nodeId) return false;
        const a = edge.source ? types.get(edge.source) : undefined;
        const b = edge.target ? types.get(edge.target) : undefined;
        return !(a && b && isPowerLink(a, b));
      });
      if (hasUplink) {
        return { ok: false, message: 'A LAN table has one uplink. Remove the existing one first.' };
      }
    }
  }

  if (!power && !options.ignoreLoops) {
    const adjacency = new Map<string, Set<string>>();
    for (const edge of edges) {
      if (!edge.source || !edge.target) continue;
      if (!adjacency.has(edge.source)) adjacency.set(edge.source, new Set());
      if (!adjacency.has(edge.target)) adjacency.set(edge.target, new Set());
      adjacency.get(edge.source)!.add(edge.target);
      adjacency.get(edge.target)!.add(edge.source);
    }
    const visited = new Set<string>([connection.source]);
    const queue = [connection.source];
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current === connection.target) {
        return { ok: false, message: 'Connection would create a loop.' };
      }
      for (const neighbor of adjacency.get(current) ?? []) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push(neighbor);
        }
      }
    }
  }

  // Devices connect through a hub (switch, router, modem, ...). A client on an
  // access point's Wi-Fi is the one exception.
  if (!wifiClient && !canNodeConnectToAny(sourceType) && !canNodeConnectToAny(targetType)) {
    const table = sourceType === 'lan_table' || targetType === 'lan_table';
    return {
      ok: false,
      message: table
        ? 'A LAN table plugs into a switch or router.'
        : 'Devices generally must connect through a network hub (Switch, Router, Modem, etc).',
    };
  }

  return { ok: true };
}
