import type { GuestRow, ImportHost, ImportPlan, Integration } from '../api/integrations';

export const INTEGRATION: Integration = {
  id: 'int-1',
  kind: 'proxmox',
  name: 'Homelab',
  source: 'api',
  base_url: 'https://192.168.10.11:8006',
  token_id: 'hlbuilder@pve!hlbuilder',
  has_secret: true,
  secret_usable: true,
  tls_fingerprint: 'AA:BB:CC',
  synced_at: '2026-10-07T10:00:00Z',
  last_error: '',
  summary: {
    version: '8.4.1',
    cluster: 'homelab',
    nodes: 2,
    nodes_online: 2,
    vms: 2,
    containers: 3,
    templates: 0,
  },
  notes: [],
  created_at: '2026-10-01T10:00:00Z',
};

const figure = (planned: number, actual: number): GuestRow['cpus'] => ({
  planned,
  actual,
  state: planned > 0 && actual > 0 ? (planned === actual ? 'same' : 'differs') : 'unknown',
});

/** A guest row of a comparison. */
export function guest(overrides: Partial<GuestRow> & Pick<GuestRow, 'state' | 'name'>): GuestRow {
  return {
    kind: 'lxc',
    status: 'running',
    cpus: figure(0, 2),
    memory_mb: figure(0, 2048),
    differs: false,
    ...overrides,
  };
}

/** A host of a comparison: online, 12 threads and 32 GB unless said otherwise. */
export function host(overrides: Partial<ImportHost> & Pick<ImportHost, 'node'>): ImportHost {
  return {
    online: true,
    skipped: false,
    cpus: { planned: 0, actual: 12, state: 'unknown' },
    ram_gb: { planned: 0, actual: 31.2, state: 'unknown' },
    storage_gb: { planned: 0, actual: 220, state: 'unknown' },
    guests: [],
    memory_mb: { capacity: 31985, planned: 0, actual: 0 },
    vcpus: { capacity: 12, planned: 0, actual: 0 },
    disk_gb: { capacity: 220, planned: 0, actual: 0 },
    headroom_percent: 100,
    warnings: [],
    facts: {
      name: overrides.node,
      online: true,
      cpu_model: 'AMD Ryzen 5 PRO 4650GE',
      cores: 6,
      threads: 12,
      memory_mb: 31985,
      version: '8.4.1',
    },
    storage: [{ name: 'local-lvm', node: overrides.node, total_gb: 220, used_gb: 90 }],
    linked_item: null,
    suggestions: [],
    ...overrides,
  };
}

/**
 * A comparison with a project: pve01 is the planned device "M75q", with one
 * guest on both sides that runs with other memory than planned, two that only
 * Proxmox has (one of them stopped) and one that only the plan has; pve02 is
 * not in the plan.
 */
export function comparison(): ImportPlan {
  return {
    integration: INTEGRATION,
    fetched_at: '2026-10-07T10:00:00Z',
    build: { id: 'build-1', name: 'Main Homelab', revision: 7 },
    candidates: [
      { id: 'node-1', name: 'M75q', type: 'minipc' },
      { id: 'node-2', name: 'Spare box', type: 'server_v2' },
    ],
    hosts: [
      host({
        node: 'pve01',
        planned_id: 'node-1',
        planned_name: 'M75q',
        paired_by: 'name',
        cpus: { planned: 12, actual: 12, state: 'same' },
        ram_gb: { planned: 16, actual: 31.2, state: 'differs' },
        storage_gb: { planned: 240, actual: 220, state: 'same' },
        guests: [
          guest({
            state: 'matched',
            vmid: 100,
            name: 'homeassistant',
            planned_id: 'g-ha',
            planned_name: 'Home Assistant',
            matched_by: 'name',
            cpus: figure(2, 2),
            memory_mb: figure(2048, 4096),
            differs: true,
            ip: '192.168.10.15',
          }),
          guest({
            state: 'matched',
            vmid: 101,
            name: 'pihole',
            planned_id: 'g-pi',
            planned_name: 'Pi-hole',
            matched_by: 'id',
            cpus: figure(1, 1),
            memory_mb: figure(512, 512),
          }),
          guest({ state: 'discovered', vmid: 102, name: 'grafana' }),
          guest({
            state: 'discovered',
            vmid: 103,
            name: 'docker',
            kind: 'vm',
            status: 'stopped',
            cpus: figure(0, 4),
            memory_mb: figure(0, 8192),
          }),
          guest({
            state: 'missing',
            name: 'Jellyfin',
            kind: 'container',
            planned_id: 'g-jf',
            planned_name: 'Jellyfin',
            cpus: figure(4, 0),
            memory_mb: figure(4096, 0),
          }),
        ],
        memory_mb: { capacity: 31985, planned: 6656, actual: 6656 },
        vcpus: { capacity: 12, planned: 7, actual: 5 },
        headroom_percent: 79,
      }),
      host({
        node: 'pve02',
        guests: [
          guest({
            state: 'discovered',
            vmid: 110,
            name: 'truenas',
            kind: 'vm',
            cpus: figure(0, 4),
            memory_mb: figure(0, 16384),
          }),
        ],
        memory_mb: { capacity: 31985, planned: 0, actual: 16384 },
        headroom_percent: 49,
      }),
    ],
    totals: {
      vcpus: { capacity: 24, planned: 7, actual: 9 },
      memory_mb: { capacity: 63970, planned: 6656, actual: 23040 },
      disk_gb: { capacity: 440, planned: 30, actual: 190 },
    },
    counts: { matched: 2, differing: 1, discovered: 3, missing: 1 },
    notes: [],
    operation_limit: 100,
  };
}
