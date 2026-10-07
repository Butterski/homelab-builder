import type { Service } from '../../../types';
import type { Build, CreateBuildParams } from '../../builder/api/builds';
import { mapBuildToFlow, type FlowBuild } from '../../builder/lib/build-mapper';
import { buildHomelabPlan } from '../../builder/lib/planner/homelab-plan';
import {
  buildLanPartyPlan,
  circuitsNeeded,
  seatsPerTable,
  tablesNeeded,
} from '../../builder/lib/planner/lan-party-plan';
import type {
  Budget,
  Goal,
  LanPartyAnswers,
  PlannedEdge,
  PlannedNode,
  PlannerAnswers,
} from '../../builder/lib/planner/types';
import { previewAddresses } from './demo-addresses';

export type DemoScenario = 'homelab' | 'lan_party';

export type HomelabDemoAnswers = {
  goals: Goal[];
  budget: Budget;
  resilient: boolean;
};

export type PartyDemoAnswers = {
  seats: number;
  consoles: number;
  wifi: boolean;
  /** 230 V / 16 A or 120 V / 15 A: the two kinds of wall socket a venue has. */
  mains: 'eu' | 'us';
};

export const DEFAULT_HOMELAB: HomelabDemoAnswers = {
  goals: ['media', 'backup', 'home'],
  budget: 'balanced',
  resilient: false,
};

export const DEFAULT_PARTY: PartyDemoAnswers = {
  seats: 16,
  consoles: 1,
  wifi: true,
  mains: 'eu',
};

/** What a stat tile of the demo shows. */
export type DemoStat = { label: string; value: string; hint?: string };

export type DemoPlan = FlowBuild & { stats: DemoStat[] };

/**
 * The few catalog services the homelab planner looks for. On the landing page
 * nobody is signed in and the catalog is not loaded, so the demo brings its own.
 */
const DEMO_SERVICES: Service[] = [
  demoService('Jellyfin', 'media', 2, 2048),
  demoService('Restic', 'storage', 1, 512),
  demoService('Home Assistant', 'automation', 2, 2048),
  demoService('Pi-hole', 'networking', 1, 512),
  demoService('Gitea', 'development', 1, 1024),
  demoService('WireGuard Easy', 'networking', 1, 256),
];

function demoService(name: string, category: string, cores: number, ramMb: number): Service {
  const id = `demo-${name.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;
  return {
    id,
    name,
    description: '',
    category,
    icon: '',
    official_website: '',
    docker_support: true,
    is_active: true,
    requirements: {
      id: `${id}-requirements`,
      service_id: id,
      min_ram_mb: ramMb,
      recommended_ram_mb: ramMb * 2,
      min_cpu_cores: cores,
      recommended_cpu_cores: cores,
      min_storage_gb: 10,
      recommended_storage_gb: 20,
    },
    created_at: '',
  };
}

const MAINS = {
  eu: { mainsVoltage: 230, breakerAmps: 16 },
  us: { mainsVoltage: 120, breakerAmps: 15 },
} as const;

function partyAnswers(answers: PartyDemoAnswers): LanPartyAnswers {
  const base: LanPartyAnswers = {
    name: 'LAN Party',
    seats: answers.seats,
    consoles: answers.consoles,
    wifi: answers.wifi,
    ...MAINS[answers.mains],
    circuits: 1,
    downMbps: 500,
    upMbps: 50,
    hours: 12,
    games: [],
    lancache: false,
  };
  // Give the venue as many circuits as the plan asks for, as the planner page
  // suggests, so the load in the demo is spread the way a real plan spreads it.
  return { ...base, circuits: circuitsNeeded(base) };
}

/** The plan as the server would return it once saved, drawn by the builder's own mapper. */
function toFlow(plan: CreateBuildParams): { flow: FlowBuild; nodes: PlannedNode[] } {
  const edges = plan.edges as PlannedEdge[];
  const nodes = previewAddresses(plan.nodes as PlannedNode[], edges);
  const build = {
    id: 'demo',
    name: plan.name,
    nodes: nodes.map(node => ({ ...node, virtual_machines: node.vms })),
    edges: edges.map((edge, index) => ({
      id: `demo-edge-${index}`,
      source_node_id: edge.source,
      source_handle: edge.source_handle,
      target_node_id: edge.target,
      target_handle: edge.target_handle,
      type: edge.type,
      speed: edge.speed,
      wireless_standard: edge.wireless_standard,
      direction: edge.direction,
    })),
  } as unknown as Build;
  return { flow: mapBuildToFlow(build), nodes };
}

const watts = (nodes: PlannedNode[]) =>
  nodes.reduce((sum, node) => sum + (node.power_draw ?? 0), 0);

/** A homelab from the guided planner, with addresses filled in for the preview. */
export function homelabDemo(answers: HomelabDemoAnswers): DemoPlan {
  const planner: PlannerAnswers = {
    name: 'Demo homelab',
    goals: answers.goals,
    // A rack draws its contents from the builder's store, which the demo does not fill.
    footprint: 'desk',
    budget: answers.budget,
    reliability: answers.resilient ? 'resilient' : 'simple',
  };
  const { flow, nodes } = toFlow(buildHomelabPlan(planner, DEMO_SERVICES));
  const guests = nodes.flatMap(node => node.vms);
  const addresses = nodes.filter(node => node.ip).length + guests.length;
  return {
    ...flow,
    stats: [
      { label: 'Devices', value: String(nodes.filter(node => node.type !== 'rack').length) },
      { label: 'Services', value: String(guests.length), hint: 'containers on the hosts' },
      { label: 'Addresses', value: String(addresses), hint: 'assigned by role' },
      { label: 'Power', value: `${watts(nodes)} W`, hint: 'estimated draw' },
    ],
  };
}

/** A LAN party from the guided planner, with the figures its report leads with. */
export function partyDemo(answers: PartyDemoAnswers): DemoPlan {
  const planner = partyAnswers(answers);
  const { flow, nodes } = toFlow(buildLanPartyPlan(planner, []));
  const wifiClients = answers.wifi ? answers.seats : 0;
  const leases = Math.ceil((answers.seats + wifiClients) * 1.25);
  const perCircuit = planner.mainsVoltage * planner.breakerAmps * 0.8;
  return {
    ...flow,
    stats: [
      {
        label: 'Tables',
        value: String(tablesNeeded(planner)),
        hint: `up to ${seatsPerTable(planner.mainsVoltage, planner.breakerAmps)} seats each`,
      },
      {
        label: 'Power circuits',
        value: String(circuitsNeeded(planner)),
        hint: `${Math.round(perCircuit)} W each, kept at 80%`,
      },
      { label: 'DHCP pool', value: String(leases), hint: 'leases, with headroom' },
      { label: 'Total draw', value: `${(watts(nodes) / 1000).toFixed(1)} kW` },
    ],
  };
}
