import type { ProposalDiff } from '@/features/builder/api/proposals';

const TYPE_NAMES: Record<string, string> = {
  access_point: 'access point',
  server_v2: 'server',
  minipc: 'mini PC',
  pc: 'PC',
  nas: 'NAS',
  sbc: 'single-board computer',
  vps: 'VPS',
  ups: 'UPS',
  pdu: 'PDU',
  iot: 'IoT device',
  lan_table: 'LAN table',
};

const typeName = (type: string) => TYPE_NAMES[type] ?? type.replace(/_/g, ' ');

/**
 * A proposal's changes as short sentences, in the order they are revealed on
 * the canvas: what goes, what changes, what is new. The names in them were
 * written by a model; show the result as plain text.
 */
export function describeChanges(diff: ProposalDiff): string[] {
  const lines: string[] = [];
  if (diff.build_name) lines.push(`Rename the build to "${String(diff.build_name.after)}"`);
  for (const node of diff.nodes.removed) lines.push(`Remove ${node.name}`);
  for (const link of diff.connections.removed) {
    lines.push(`Disconnect ${link.source_name} from ${link.target_name}`);
  }
  for (const guest of diff.vms.removed) lines.push(`Remove ${guest.name} from ${guest.host_name}`);
  for (const component of diff.components.removed) {
    lines.push(`Remove ${component.name} from ${component.host_name}`);
  }
  for (const node of diff.nodes.changed) lines.push(`Change ${node.name}`);
  for (const link of diff.connections.changed) {
    lines.push(`Change the link ${link.source_name} → ${link.target_name}`);
  }
  for (const guest of diff.vms.changed) lines.push(`Change ${guest.name} on ${guest.host_name}`);
  for (const node of diff.nodes.added) lines.push(`Add ${node.name} (${typeName(node.type)})`);
  for (const link of diff.connections.added) {
    lines.push(`Connect ${link.source_name} → ${link.target_name}`);
  }
  for (const guest of diff.vms.added) lines.push(`Run ${guest.name} on ${guest.host_name}`);
  for (const component of diff.components.added) {
    lines.push(`Put ${component.name} in ${component.host_name}`);
  }
  if ((diff.plan ?? []).length > 0) lines.push('Change the plan');
  return lines;
}
