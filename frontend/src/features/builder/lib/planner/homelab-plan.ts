import type { Service } from '../../../../types';
import type { CreateBuildParams } from '../../api/builds';
import { arrangePlan } from './arrange';
import { GOAL_LABELS, type Goal, type PlannedNode, type PlannerAnswers } from './types';

const SERVICE_BY_GOAL: Record<Goal, string[]> = {
  backup: ['restic', 'duplicati', 'syncthing'],
  media: ['jellyfin'],
  home: ['home assistant'],
  network: ['pi-hole', 'adguard home', 'uptime kuma'],
  development: ['gitea', 'forgejo'],
  security: ['wireguard easy', 'wg-easy'],
};

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function chooseService(goal: Goal, services: Service[]): Service | undefined {
  const candidates = SERVICE_BY_GOAL[goal].map(normalize);
  return services.find(service =>
    candidates.some(candidate => normalize(service.name).includes(candidate)),
  );
}

/** Builds a homelab from the goals, footprint and budget picked in the planner. */
export function buildHomelabPlan(
  answers: PlannerAnswers,
  services: Service[],
): CreateBuildParams {
  const nodes: PlannedNode[] = [];
  const edges: CreateBuildParams['edges'] = [];
  const routerID = crypto.randomUUID();
  const switchID = crypto.randomUUID();

  nodes.push({
    id: routerID,
    type: 'router',
    name: 'Lab Router',
    x: 80,
    y: 250,
    ip: '192.168.10.1',
    power_draw: 12,
    details: {
      model: 'Existing router or firewall',
      ports: 4,
      dhcp_enabled: true,
      subnet_mask: '255.255.255.0',
      network_zone: 'lan',
      planner_role: 'gateway',
    },
    vms: [],
    internal_components: [],
  });
  nodes.push({
    id: switchID,
    type: 'switch',
    name: answers.budget === 'enthusiast' ? 'Managed 16-port Switch' : 'Managed 8-port Switch',
    x: 360,
    y: 250,
    power_draw: answers.budget === 'enthusiast' ? 24 : 10,
    details: {
      ports: answers.budget === 'enthusiast' ? 16 : 8,
      managed: true,
      planner_role: 'distribution',
    },
    vms: [],
    internal_components: [],
  });
  edges.push({
    source: routerID,
    source_handle: 'eth1',
    target: switchID,
    target_handle: 'target-0',
    type: 'ethernet',
    speed: answers.budget === 'enthusiast' ? '10 GbE' : '1 GbE',
    direction: 'lan',
  });

  const computeIDs: string[] = [];
  const addCompute = (
    type: string,
    name: string,
    x: number,
    y: number,
    details: Record<string, unknown>,
  ) => {
    const id = crypto.randomUUID();
    computeIDs.push(id);
    nodes.push({
      id,
      type,
      name,
      x,
      y,
      power_draw: type === 'vps' ? 0 : type === 'server_v2' ? 115 : 24,
      details: { ...details, app_host_enabled: true, planner_role: 'compute' },
      vms: [],
      internal_components: [],
    });
    return id;
  };

  let rackID: string | undefined;
  if (answers.footprint === 'rack') {
    rackID = crypto.randomUUID();
    nodes.push({
      id: rackID,
      type: 'rack',
      name: '12U Lab Rack',
      x: 630,
      y: 70,
      power_draw: 0,
      details: { rack_size: 12, planner_role: 'enclosure' },
      vms: [],
      internal_components: [],
    });
  }

  const primaryType = answers.footprint === 'rack' ? 'server_v2' : 'minipc';
  const primaryID = addCompute(
    primaryType,
    answers.footprint === 'rack' ? 'Primary Virtualization Server' : 'Primary Mini PC',
    rackID ? 22 : 680,
    rackID ? 70 : 150,
    {
      cpu: answers.budget === 'starter' ? 4 : answers.budget === 'balanced' ? 8 : 16,
      ram: answers.budget === 'starter' ? 16 : answers.budget === 'balanced' ? 32 : 64,
      storage: answers.budget === 'starter' ? 512 : 1000,
      ports: answers.budget === 'enthusiast' ? 4 : 2,
      ...(rackID ? { rack_units: 2, rack_position: 1 } : {}),
    },
  );
  if (rackID) {
    nodes[nodes.findIndex(node => node.id === primaryID)].parent_id = rackID;
  }

  if (answers.reliability === 'resilient') {
    addCompute(
      answers.footprint === 'cloud' ? 'vps' : 'minipc',
      answers.footprint === 'cloud' ? 'Cloud Recovery VPS' : 'Secondary Compute Node',
      680,
      390,
      { cpu: 4, ram: 16, storage: 256, ports: 2, planner_role: 'failover' },
    );
  }
  if (answers.footprint === 'cloud' && !nodes.some(node => node.type === 'vps')) {
    addCompute('vps', 'Public Edge VPS', 680, 390, {
      cpu: 2,
      ram: 4,
      storage: 40,
      ports: 2,
      provider: 'Choose a provider',
      network_zone: 'cloud',
    });
  }

  if (answers.goals.includes('backup') || answers.goals.includes('media')) {
    nodes.push({
      id: crypto.randomUUID(),
      type: 'nas',
      name: 'Storage NAS',
      x: 990,
      y: 320,
      power_draw: 45,
      details: {
        storage:
          answers.budget === 'starter' ? 4000 : answers.budget === 'balanced' ? 12000 : 24000,
        raid: answers.reliability === 'resilient' ? 'RAIDZ2 / SHR-2' : 'Mirror / SHR',
        planner_role: 'storage',
      },
      vms: [],
      internal_components: [],
    });
  }

  if (answers.goals.includes('home') || answers.goals.includes('network')) {
    nodes.push({
      id: crypto.randomUUID(),
      type: 'access_point',
      name: 'Wi-Fi Access Point',
      x: 990,
      y: 90,
      power_draw: 12,
      details: { wireless_standard: 'Wi-Fi 6', planner_role: 'wireless' },
      vms: [],
      internal_components: [],
    });
  }

  if (answers.footprint === 'rack' || answers.reliability === 'resilient') {
    nodes.push({
      id: crypto.randomUUID(),
      type: 'ups',
      name: 'UPS',
      x: 990,
      y: 520,
      power_draw: 5,
      details: { capacity_va: answers.budget === 'enthusiast' ? 1500 : 900, planner_role: 'power' },
      vms: [],
      internal_components: [],
    });
  }

  let switchPort = 1;
  for (const node of nodes) {
    if (node.id === routerID || node.id === switchID || node.type === 'rack' || node.type === 'ups')
      continue;
    edges.push({
      source: switchID,
      source_handle: `eth${switchPort++}`,
      target: node.id,
      target_handle: 'target-0',
      type: node.type === 'access_point' ? 'wireless' : 'ethernet',
      speed: answers.budget === 'enthusiast' && node.type !== 'access_point' ? '10 GbE' : '1 GbE',
      wireless_standard: node.type === 'access_point' ? 'Wi-Fi 6' : '',
      direction: 'lan',
    });
  }

  const computeNodes = nodes.filter(node => computeIDs.includes(node.id));
  answers.goals.forEach((goal, index) => {
    const host = computeNodes[index % Math.max(computeNodes.length, 1)];
    if (!host) return;
    const catalogService = chooseService(goal, services);
    const fallbackName = GOAL_LABELS[goal] || goal;
    host.vms.push({
      id: crypto.randomUUID(),
      name: catalogService?.name || fallbackName,
      type: 'container',
      status: 'running',
      cpu_cores: catalogService?.requirements?.min_cpu_cores || 1,
      ram_mb: catalogService?.requirements?.min_ram_mb || 512,
      details: {
        catalog_service_id: catalogService?.id || '',
        catalog_service_name: catalogService?.name || fallbackName,
        planner_goal: goal,
      },
    });
  });

  return arrangePlan({
    name: answers.name.trim() || 'Guided Homelab',
    thumbnail: '',
    settings: {
      planner: answers,
      boughtItems: [],
      showBought: false,
    },
    nodes,
    edges,
    services: [],
  });
}
