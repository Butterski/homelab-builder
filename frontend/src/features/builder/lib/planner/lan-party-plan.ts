import type { GamingPlan, Service } from '../../../../types';
import {
  DEFAULT_SEAT_WATTS,
  MAX_TABLE_SEATS,
  TABLE_SWITCH_WATTS,
  newTableDetails,
} from '../../../gaming/lib/table';
import { arrangePlan } from './arrange';
import { gameHost, gameServerVM, gameService, nextPortOffsets } from './game-hosts';
import type { LanPartyAnswers, Plan, PlannedEdge, PlannedNode, PlannedVM } from './types';

export const MAX_PARTY_SEATS = 64;

/** The largest table we seat by default, whatever the power allows. */
const PREFERRED_TABLE_SEATS = 8;
/** A breaker should carry at most this share of its rating for hours. */
const CONTINUOUS_LOAD_SHARE = 0.8;
/** Above this many addresses a /24 gets too tight for the pool and the fixed hosts. */
const LEASES_IN_A_24 = 150;
const DHCP_HEADROOM = 1.25;
const CORE_SWITCH_SIZES = [8, 16, 24, 48];

const TABLE_COLUMNS = 4;
const COLUMN_WIDTH = 280;
const ROW_HEIGHT = 260;

/**
 * How many players one table seats so that a full table stays inside what one
 * circuit carries for hours.
 */
export function seatsPerTable(mainsVoltage: number, breakerAmps: number): number {
  const continuousWatts = mainsVoltage * breakerAmps * CONTINUOUS_LOAD_SHARE;
  const fit = Math.floor((continuousWatts - TABLE_SWITCH_WATTS) / DEFAULT_SEAT_WATTS);
  return Math.max(1, Math.min(PREFERRED_TABLE_SEATS, MAX_TABLE_SEATS, fit));
}

/** Splits the players over tables, filling each before starting the next. */
export function tableSizes(seats: number, perTable: number): number[] {
  const sizes: number[] = [];
  for (let left = seats; left > 0; left -= perTable) sizes.push(Math.min(perTable, left));
  return sizes;
}

/** Whether the plan includes a server for local game servers or the download cache. */
export function hasPartyServer(answers: LanPartyAnswers): boolean {
  return answers.lancache || answers.games.length > 0;
}

/** How many tables the players need. */
export function tablesNeeded(answers: LanPartyAnswers): number {
  const perTable = seatsPerTable(answers.mainsVoltage, answers.breakerAmps);
  return tableSizes(clampSeats(answers.seats), perTable).length;
}

/**
 * Circuits the plan needs: one per table, because a full table uses nearly all
 * a circuit carries for hours, and one more for the server when there is one.
 */
export function circuitsNeeded(answers: LanPartyAnswers): number {
  return tablesNeeded(answers) + (hasPartyServer(answers) ? 1 : 0);
}

const clampSeats = (seats: number) =>
  Math.min(MAX_PARTY_SEATS, Math.max(1, Math.round(seats) || 1));

/** Builds a LAN party: tables on a core switch behind a router, with what was asked for. */
export function buildLanPartyPlan(
  answers: LanPartyAnswers,
  services: Service[],
): Plan {
  const seats = clampSeats(answers.seats);
  const consoles = Math.min(16, Math.max(0, Math.round(answers.consoles) || 0));
  const circuitCount = Math.min(32, Math.max(1, Math.round(answers.circuits) || 1));
  const perTable = seatsPerTable(answers.mainsVoltage, answers.breakerAmps);
  const sizes = tableSizes(seats, perTable);

  const nodes: PlannedNode[] = [];
  const edges: PlannedEdge[] = [];

  // Phones and laptops on the Wi-Fi: about one per player.
  const wifiClients = answers.wifi ? seats : 0;
  const leases = Math.ceil((seats + wifiClients) * DHCP_HEADROOM);
  const wide = leases > LEASES_IN_A_24;

  // ── Local servers ──────────────────────────────────────────────────────────
  const offsetFor = nextPortOffsets();
  const vms: PlannedVM[] = [];
  for (const slug of answers.games) {
    const service = gameService(services, slug);
    // Everyone is in the room: plan each server for the whole party.
    if (service?.game) {
      const players = Math.min(seats + consoles, service.game.max_players || seats);
      vms.push(gameServerVM(service, players, 'lan', offsetFor(slug)));
    }
  }
  const cache = answers.lancache ? gameService(services, 'lancache') : undefined;
  if (cache?.game) vms.push(gameServerVM(cache, undefined, 'lan'));

  // ── Network ────────────────────────────────────────────────────────────────
  const extras = (answers.wifi ? 1 : 0) + (vms.length > 0 ? 1 : 0) + consoles;
  const corePorts =
    CORE_SWITCH_SIZES.find(size => size >= sizes.length + extras + 1) ??
    sizes.length + extras + 1;

  const routerID = crypto.randomUUID();
  const coreID = crypto.randomUUID();
  nodes.push({
    id: routerID,
    type: 'router',
    name: 'Party Router',
    x: 80,
    y: 80,
    ip: wide ? '192.168.0.1' : '192.168.1.1',
    power_draw: 12,
    details: {
      ports: 4,
      dhcp_enabled: true,
      subnet_mask: wide ? '255.255.254.0' : '255.255.255.0',
      network_zone: 'lan',
      planner_role: 'gateway',
    },
    vms: [],
    internal_components: [],
  });
  nodes.push({
    id: coreID,
    type: 'switch',
    name: `Core Switch (${corePorts}-port)`,
    x: 80,
    y: 340,
    power_draw: corePorts > 16 ? 25 : 12,
    details: { ports: corePorts, planner_role: 'distribution' },
    vms: [],
    internal_components: [],
  });
  edges.push({
    source: routerID,
    source_handle: 'eth0',
    target: coreID,
    target_handle: 'target-0',
    type: 'ethernet',
    speed: '1 GbE',
    direction: 'lan',
  });

  let corePort = 0;
  const plugIntoCore = (node: PlannedNode, wireless = false) => {
    nodes.push(node);
    edges.push({
      source: coreID,
      source_handle: `eth${corePort++}`,
      target: node.id,
      target_handle: 'target-0',
      type: wireless ? 'wireless' : 'ethernet',
      speed: '1 GbE',
      wireless_standard: wireless ? 'Wi-Fi 6' : '',
      direction: 'lan',
    });
  };

  sizes.forEach((size, index) => {
    const table = newTableDetails(size);
    plugIntoCore({
      id: crypto.randomUUID(),
      type: 'lan_table',
      name: `Table ${index + 1}`,
      x: 400 + (index % TABLE_COLUMNS) * COLUMN_WIDTH,
      y: 80 + Math.floor(index / TABLE_COLUMNS) * ROW_HEIGHT,
      power_draw: table.power_draw,
      details: { ...table.details },
      vms: [],
      internal_components: [],
    });
  });

  const sideX = 400 + Math.min(sizes.length, TABLE_COLUMNS) * COLUMN_WIDTH;
  let sideY = 80;
  const nextSide = () => {
    const position = { x: sideX, y: sideY };
    sideY += ROW_HEIGHT;
    return position;
  };

  if (answers.wifi) {
    plugIntoCore(
      {
        id: crypto.randomUUID(),
        type: 'access_point',
        name: 'Party Wi-Fi',
        ...nextSide(),
        power_draw: 12,
        details: { wifi_clients: wifiClients, planner_role: 'wireless' },
        vms: [],
        internal_components: [],
      },
      true,
    );
  }
  for (let index = 0; index < consoles; index += 1) {
    plugIntoCore({
      id: crypto.randomUUID(),
      type: 'console',
      name: `Console ${index + 1}`,
      ...nextSide(),
      power_draw: 150,
      details: { platform: 'other' },
      vms: [],
      internal_components: [],
    });
  }
  // Last in the column: its card grows with the services it runs.
  if (vms.length > 0) plugIntoCore(gameHost('Party Server', vms, nextSide()));

  // ── Power ──────────────────────────────────────────────────────────────────
  // Heaviest first onto the least loaded circuit, so the load is spread evenly.
  const circuits = Array.from({ length: circuitCount }, (_, index) => ({
    id: `c${index + 1}`,
    label: `Circuit ${index + 1}`,
    breaker_amps: answers.breakerAmps,
  }));
  const load = new Map(circuits.map(circuit => [circuit.id, 0]));
  [...nodes]
    .filter(node => (node.power_draw ?? 0) > 0)
    .sort((a, b) => (b.power_draw ?? 0) - (a.power_draw ?? 0))
    .forEach(node => {
      const [target] = [...load.entries()].sort((a, b) => a[1] - b[1])[0];
      load.set(target, (load.get(target) ?? 0) + (node.power_draw ?? 0));
      node.details.circuit = target;
    });

  const gaming_plan: GamingPlan = {
    uplink: {
      down_mbps: Math.max(0, answers.downMbps || 0),
      up_mbps: Math.max(0, answers.upMbps || 0),
      cgnat: '',
      public_host: '',
    },
    power: { mains_voltage: answers.mainsVoltage, circuits },
    event: { date: '', hours: Math.max(0, answers.hours || 0) },
  };

  return arrangePlan({
    name: answers.name.trim() || 'LAN Party',
    thumbnail: '',
    kind: 'lan_party',
    gaming_plan,
    settings: { planner: { kind: 'lan_party', ...answers } },
    nodes,
    edges,
    services: [],
  });
}
