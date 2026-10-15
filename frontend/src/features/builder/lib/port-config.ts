import type { HardwareSpec, PortRole, PortSettings, VlanDef } from '../../../types';
import { isPowerHandle } from './power-ports';

// Port settings of routers, firewalls and switches: roles, addresses and
// VLANs. The backend applies the same rules on save
// (backend/internal/wiring/ports.go).

export type { PortRole, PortSettings, VlanDef };

/**
 * A device as the canvas holds it. Both a HardwareNode and the data of a
 * React Flow node fit, so the store and the edge component share these helpers.
 */
export interface PortNode {
  type?: unknown;
  details?: unknown;
}

/** The two ends of a link, as edges carry them in the store and on the canvas. */
export interface CableEnds {
  source: string | null;
  target: string | null;
  sourceHandle?: string | null;
  targetHandle?: string | null;
}

const PORT_ROLES: Record<string, true> = { wan: true, lan: true, dmz: true, vpn: true, unused: true };
const VLAN_TYPES: Record<string, true> = { router: true, firewall: true, switch: true };

const MAX_PORTS = 96;

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;

const isVlanId = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 4094;

/** The settings of every port of a device, keyed by handle. Malformed values are dropped. */
export function readPortConfig(details: unknown): Record<string, PortSettings> {
  const raw = asRecord(asRecord(details)?.port_config);
  const config: Record<string, PortSettings> = {};
  if (!raw) return config;
  for (const [handle, value] of Object.entries(raw)) {
    const entry = asRecord(value);
    if (!entry) continue;
    const settings: PortSettings = {};
    if (typeof entry.role === 'string' && PORT_ROLES[entry.role]) settings.role = entry.role as PortRole;
    if (typeof entry.address === 'string' && entry.address) settings.address = entry.address;
    if (entry.dhcp === true) settings.dhcp = true;
    if (isVlanId(entry.untagged_vlan)) settings.untagged_vlan = entry.untagged_vlan;
    if (Array.isArray(entry.tagged_vlans)) {
      const tagged = entry.tagged_vlans.filter(isVlanId);
      if (tagged.length > 0) settings.tagged_vlans = tagged;
    }
    if (typeof entry.comment === 'string' && entry.comment) settings.comment = entry.comment;
    config[handle] = settings;
  }
  return config;
}

/** The VLANs defined on a switch. Malformed entries are dropped. */
export function readVlans(details: unknown): VlanDef[] {
  const raw = asRecord(details)?.vlans;
  if (!Array.isArray(raw)) return [];
  const vlans: VlanDef[] = [];
  for (const value of raw) {
    const entry = asRecord(value);
    if (!entry || !isVlanId(entry.id)) continue;
    const vlan: VlanDef = { id: entry.id, name: typeof entry.name === 'string' ? entry.name : '' };
    if (typeof entry.color === 'string' && entry.color) vlan.color = entry.color;
    if (typeof entry.subnet === 'string' && entry.subnet) vlan.subnet = entry.subnet;
    vlans.push(vlan);
  }
  return vlans;
}

/** The role a port has when none is set: the uplink faces the WAN, the rest the LAN. */
export function defaultRole(handle: string): PortRole {
  return handle === 'target-0' ? 'wan' : 'lan';
}

/** The VLAN ids a port carries, untagged and tagged, sorted; null when it carries none. */
export function vlanSet(node: PortNode | null | undefined, handle: string): number[] | null {
  if (!node || typeof node.type !== 'string' || !VLAN_TYPES[node.type]) return null;
  const settings = readPortConfig(node.details)[handle];
  if (!settings) return null;
  const ids = [...(settings.tagged_vlans ?? [])];
  if (settings.untagged_vlan !== undefined) ids.push(settings.untagged_vlan);
  const unique = [...new Set(ids)].sort((a, b) => a - b);
  return unique.length > 0 ? unique : null;
}

/** Parses "a.b.c.d/p" into the address as a 32-bit number and the prefix; null when malformed. */
function parseIpv4Prefix(text: string): { ip: number; prefix: number } | null {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/.exec(text);
  if (!match) return null;
  const parts = match.slice(1);
  // Leading zeros are refused, like Go's netip.
  if (parts.some(part => part.length > 1 && part.startsWith('0'))) return null;
  const octets = parts.slice(0, 4).map(Number);
  if (octets.some(octet => octet > 255)) return null;
  const prefix = Number(parts[4]);
  if (prefix < 8 || prefix > 30) return null;
  const ip = ((octets[0] << 24) | (octets[1] << 16) | (octets[2] << 8) | octets[3]) >>> 0;
  return { ip, prefix };
}

/**
 * Whether text is the address of a port, such as "192.168.10.1/24": an IPv4
 * address with a prefix of 8 to 30 that is neither the network nor the
 * broadcast address of its subnet.
 */
export function isIpv4Cidr(text: string): boolean {
  const parsed = parseIpv4Prefix(text.trim());
  if (!parsed) return false;
  const hostMask = (2 ** (32 - parsed.prefix) - 1) >>> 0;
  const host = (parsed.ip & hostMask) >>> 0;
  return host !== 0 && host !== hostMask;
}

/** Whether text is a VLAN subnet such as "192.168.10.0/24": an IPv4 address with a prefix of 8 to 30. */
export function isIpv4Subnet(text: string): boolean {
  return parseIpv4Prefix(text.trim()) !== null;
}

/** The highest N of an ethN port on the node that carries a network cable, or -1. */
export function highestCabledPort(nodeId: string, edges: readonly CableEnds[]): number {
  let highest = -1;
  for (const edge of edges) {
    if (isPowerHandle(edge.sourceHandle) || isPowerHandle(edge.targetHandle)) continue;
    for (const [end, handle] of [
      [edge.source, edge.sourceHandle],
      [edge.target, edge.targetHandle],
    ] as const) {
      if (end !== nodeId || !handle) continue;
      const match = /^eth(\d+)$/.exec(handle);
      if (match) highest = Math.max(highest, Number(match[1]));
    }
  }
  return highest;
}

/**
 * The details of a node with its port count set to requested. The count never
 * drops below the highest cabled port + 1 (clamped is then true), and settings
 * of removed ports are dropped.
 */
export function withPortCount(
  node: PortNode & { id: string },
  edges: readonly CableEnds[],
  requested: number,
): { details: HardwareSpec; count: number; clamped: boolean } {
  const min = Math.max(1, highestCabledPort(node.id, edges) + 1);
  const wanted = Number.isFinite(requested) ? Math.trunc(requested) : min;
  const count = Math.min(MAX_PORTS, Math.max(min, wanted));
  const details: HardwareSpec = { ...(asRecord(node.details) as HardwareSpec | undefined), ports: count };

  const config = asRecord(details.port_config);
  if (config) {
    const kept: Record<string, PortSettings> = {};
    for (const [handle, settings] of Object.entries(config)) {
      const match = /^eth(\d+)$/.exec(handle);
      if (match && Number(match[1]) >= count) continue;
      kept[handle] = settings as PortSettings;
    }
    if (Object.keys(kept).length > 0) details.port_config = kept;
    else delete details.port_config;
  }

  return { details, count, clamped: count !== requested };
}

/**
 * The VLANs a cable carries. Each end that sits on a router, firewall or
 * switch port with VLANs gives a set. Two sets that share nothing are a
 * mismatch; otherwise the cable shows the shared set, or the one set there is.
 * The colour is the untagged VLAN of a switch end when shown and coloured,
 * else the lowest shown id that either end colours. Power cables carry none;
 * callers skip wireless links.
 */
export function cableVlan(
  sourceNode: PortNode | null | undefined,
  sourceHandle: string | null | undefined,
  targetNode: PortNode | null | undefined,
  targetHandle: string | null | undefined,
): { vlans: number[]; color?: string; mismatch: boolean } {
  if (isPowerHandle(sourceHandle) || isPowerHandle(targetHandle)) return { vlans: [], mismatch: false };
  const sourcePort = sourceHandle || 'eth0';
  const targetPort = targetHandle || 'target-0';
  const sourceSet = vlanSet(sourceNode, sourcePort);
  const targetSet = vlanSet(targetNode, targetPort);

  let vlans: number[];
  if (sourceSet && targetSet) {
    vlans = sourceSet.filter(id => targetSet.includes(id));
    if (vlans.length === 0) return { vlans, mismatch: true };
  } else {
    vlans = sourceSet ?? targetSet ?? [];
  }
  if (vlans.length === 0) return { vlans, mismatch: false };

  const ends = [
    { node: sourceNode, port: sourcePort },
    { node: targetNode, port: targetPort },
  ];
  for (const { node, port } of ends) {
    if (node?.type !== 'switch') continue;
    const untagged = readPortConfig(node.details)[port]?.untagged_vlan;
    if (untagged === undefined || !vlans.includes(untagged)) continue;
    const color = readVlans(node.details).find(vlan => vlan.id === untagged)?.color;
    if (color) return { vlans, color, mismatch: false };
  }

  for (const id of vlans) {
    for (const { node } of ends) {
      const color = readVlans(node?.details).find(vlan => vlan.id === id)?.color;
      if (color) return { vlans, color, mismatch: false };
    }
  }
  return { vlans, mismatch: false };
}
