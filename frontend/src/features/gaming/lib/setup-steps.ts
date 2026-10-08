import type { GamingPlan, HardwareNode, Service } from '../../../types';
import { completePlan } from './kind';
import { findGameProfile, readGameInstance, resolvePorts } from './sizing';
import { tableSeats } from './table';

interface GamingSetupStep {
  id: 'game-servers' | 'lan-party';
  title: string;
  description: string;
  items: Array<{ text: string; code?: string }>;
}

const portList = (ports: Array<{ port: number; proto: string }>) =>
  ports.map(port => `${port.port}/${port.proto.toUpperCase()}`).join(', ');

/**
 * The setup guide steps a gaming build adds: bringing game servers online and
 * preparing the room for a LAN party. A build without either adds nothing.
 */
export function gamingSetupSteps(
  nodes: HardwareNode[],
  storedPlan: Partial<GamingPlan> | undefined,
  services: Service[],
): GamingSetupStep[] {
  const plan = completePlan(storedPlan);
  const steps: GamingSetupStep[] = [];

  // ── Game servers ───────────────────────────────────────────────────────────
  const serverItems: GamingSetupStep['items'] = [];
  let remote = false;
  let hasCache = false;
  for (const node of nodes) {
    for (const vm of node.vms ?? []) {
      const instance = readGameInstance(vm.details);
      if (!instance) continue;
      const profile = findGameProfile(services, instance.profile);
      if (instance.profile === 'lancache') hasCache = true;
      if (!profile || profile.role !== 'game') continue;

      const ports = resolvePorts(profile, instance.port_offset);
      const forwarded = ports.filter(port => port.forward);
      const joinPort = (forwarded[0] ?? ports[0])?.port;
      // A container listens on its host; a VM has an address of its own.
      const address = (vm.type === 'container' ? node.ip : vm.ip || node.ip) || 'its address';
      const target = joinPort ? `${address}:${joinPort}` : address;

      switch (instance.exposure) {
        case 'port_forward':
          remote = true;
          serverItems.push({
            text: `${vm.name}: on your router, forward ${portList(forwarded)} to ${address}. Friends connect to ${plan.uplink.public_host || 'your public address'}${joinPort ? `:${joinPort}` : ''}.`,
          });
          break;
        case 'vpn':
          remote = true;
          serverItems.push({
            text: `${vm.name}: invite your friends to your VPN (Tailscale or WireGuard). Once connected, they join ${target}.`,
          });
          break;
        case 'relay':
          remote = true;
          serverItems.push({
            text: `${vm.name}: create a tunnel with a relay service that points at ${target}, and share the address it gives you.`,
          });
          break;
        default:
          serverItems.push({ text: `${vm.name}: players on your network join ${target}.` });
      }
    }
  }
  if (serverItems.length > 0) {
    steps.push({
      id: 'game-servers',
      title: 'Game Servers',
      description: 'Bringing your game servers online and letting players in.',
      items: [
        {
          text: 'Download the complete bundle from the Config Generator. Each host has its own folder under gaming/ with a docker-compose.yml and an .env.example.',
        },
        {
          text: 'Copy the folder to the host, fill in the names and passwords in .env, and start the servers:',
          code: 'cp .env.example .env\nnano .env\ndocker compose up -d',
        },
        ...serverItems,
        ...(remote
          ? [
              {
                text: 'Test from outside your network before you invite anyone, for example from a phone on mobile data.',
              },
            ]
          : []),
      ],
    });
  }

  // ── LAN party ──────────────────────────────────────────────────────────────
  const tables = nodes.filter(node => node.type === 'lan_table');
  if (tables.length > 0) {
    const seats = tables.reduce((sum, table) => sum + tableSeats(table.details), 0);
    const items: GamingSetupStep['items'] = [];

    const byCircuit = new Map<string, string[]>();
    for (const table of tables) {
      const circuit = table.details?.circuit;
      if (!circuit) continue;
      byCircuit.set(circuit, [...(byCircuit.get(circuit) ?? []), table.name]);
    }
    if (byCircuit.size > 0) {
      const lines = [...byCircuit.entries()].map(([id, names]) => {
        const circuit = plan.power.circuits.find(item => item.id === id);
        return `${circuit?.label || id}: ${names.join(', ')}`;
      });
      items.push({
        text: 'Run one extension lead per circuit and label both ends. Plug the tables in as planned:',
        code: lines.join('\n'),
      });
    } else {
      items.push({
        text: 'Find out which sockets are on which breaker, enter the circuits in the Game plan and assign every table to one.',
      });
    }
    items.push({
      text: 'Switch the tables on one at a time when players arrive. A breaker that trips with one table on it will not hold two.',
    });

    const pool = nodes.find(node => node.details?.dhcp_pool?.start)?.details?.dhcp_pool;
    items.push({
      text: pool
        ? `Set the DHCP range on your router to ${pool.start} - ${pool.end} (${pool.size} addresses for ${pool.clients} expected devices).`
        : `Turn DHCP on at your router and give it room for at least ${Math.ceil(seats * 1.25)} addresses.`,
    });
    items.push({
      text: `Bring ${tables.length} long cables for the table uplinks and ${seats} patch cables for the seats, plus a few spares.`,
    });
    items.push({
      text: 'Ask players to install and update their games at home. Launcher updates on the day eat the line for everyone.',
    });
    if (hasCache) {
      items.push({
        text: 'LANCache only works when clients use its DNS server: set that address as the DNS server in your router DHCP settings.',
      });
    }
    steps.push({
      id: 'lan-party',
      title: 'LAN Party Setup',
      description: `Preparing the room for ${seats} seats at ${tables.length} ${tables.length === 1 ? 'table' : 'tables'}.`,
      items,
    });
  }

  return steps;
}
