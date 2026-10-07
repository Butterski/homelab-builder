import type { PlannedEdge, PlannedNode, PlannedVM } from '../../builder/lib/planner/types';

/**
 * Where each kind of device sits inside a /24, and how many addresses it keeps
 * for its guests. The same zones hlbIPAM uses (see "Node Types and IP Zones" in
 * AGENTS.md). This copy only fills in the demo on the landing page, where no
 * build is saved and so the server never calculates anything.
 */
const ZONES: Record<string, { base: number; step: number }> = {
  switch: { base: 10, step: 1 },
  access_point: { base: 20, step: 1 },
  console: { base: 30, step: 1 },
  nas: { base: 100, step: 10 },
  server: { base: 150, step: 10 },
  server_v2: { base: 150, step: 10 },
  pc: { base: 160, step: 10 },
  minipc: { base: 170, step: 10 },
  sbc: { base: 180, step: 10 },
};

/**
 * Gives every device that can be reached from a router an address in that
 * router's network, and every guest the next address after its host.
 * Returns new nodes; the plan passed in is left as it was.
 */
export function previewAddresses(nodes: PlannedNode[], edges: PlannedEdge[]): PlannedNode[] {
  const neighbours = new Map<string, string[]>();
  for (const edge of edges) {
    neighbours.set(edge.source, [...(neighbours.get(edge.source) ?? []), edge.target]);
    neighbours.set(edge.target, [...(neighbours.get(edge.target) ?? []), edge.source]);
  }

  const byId = new Map(nodes.map(node => [node.id, node]));
  const assigned = new Map<string, string>();
  const guests = new Map<string, string[]>();
  const visited = new Set<string>();

  for (const router of nodes.filter(node => node.type === 'router' && node.ip)) {
    const prefix = router.ip!.split('.').slice(0, 3).join('.');
    const used = new Set<number>([Number(router.ip!.split('.')[3])]);
    const queue = [router.id];
    visited.add(router.id);

    while (queue.length > 0) {
      const id = queue.shift()!;
      for (const next of neighbours.get(id) ?? []) {
        if (visited.has(next)) continue;
        visited.add(next);
        queue.push(next);

        const node = byId.get(next);
        const zone = node ? ZONES[node.type] : undefined;
        if (!node || !zone) continue;

        let host = zone.base;
        while (used.has(host) && host < 255) host += zone.step;
        if (host >= 255) continue;
        used.add(host);
        assigned.set(node.id, `${prefix}.${host}`);

        const guestAddresses: string[] = [];
        node.vms.slice(0, zone.step - 1).forEach((_, index) => {
          used.add(host + 1 + index);
          guestAddresses.push(`${prefix}.${host + 1 + index}`);
        });
        guests.set(node.id, guestAddresses);
      }
    }
  }

  return nodes.map(node => {
    const ip = assigned.get(node.id);
    if (!ip) return node;
    const guestAddresses = guests.get(node.id) ?? [];
    return {
      ...node,
      ip,
      vms: node.vms.map((vm, index) =>
        guestAddresses[index] ? ({ ...vm, ip: guestAddresses[index] } as PlannedVM) : vm,
      ),
    };
  });
}
