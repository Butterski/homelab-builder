import { isNetworkNode, isWifiAssociation } from '../../../lib/hardware-config';
import { hardwareTypeName as typeName } from '../../../lib/hardware-taxonomy';
import { formatMemory, plural } from '../../../lib/format';
import type {
  GamingPlan,
  HardwareNode,
  HardwareType,
  Service,
  VirtualMachine,
} from '../../../types';
import { DEFAULT_DEVICE_U } from '../../builder/components/rack-node-constants';
import { gamingSetupSteps } from '../../gaming/lib/setup-steps';

/**
 * The setup guide of a build, worked out from the build itself: which cable
 * goes where, which address each device gets, what to install on which host.
 * Everything here is a pure function of the plan, so the guide always says
 * what the canvas says.
 *
 * Every step and every table row has an id that survives a save: it is made
 * from node and guest ids, never from an edge id (those change on every save)
 * or from a position in a list.
 */

/** A connection of the plan, as the canvas holds it. */
export interface SetupLink {
  source: string;
  target: string;
  /** The port on the source the cable leaves from, e.g. "eth1". */
  sourcePort?: string;
  /** 'ethernet', 'wireless' or 'vpn'. */
  type?: string;
  speed?: string;
  wirelessStandard?: string;
}

export interface SetupCell {
  text: string;
  /** An address, a port, a figure: set in the monospace face. */
  figure?: boolean;
  href?: string;
}

/** One thing to do. `code` is typed as shown. */
export interface SetupStep {
  id: string;
  text: string;
  code?: string;
  /** Where in the app the step is done. */
  action?: { label: string; to: string };
}

export interface SetupTable {
  caption: string;
  columns: Array<{ label: string; figure?: boolean }>;
  rows: Array<{
    id: string;
    /** What ticking the row means, in words. */
    label: string;
    cells: SetupCell[];
  }>;
}

export interface SetupSection {
  id: string;
  title: string;
  intro?: string;
  /** Something the plan is missing. It is shown; it cannot be ticked off. */
  warning?: string;
  steps: SetupStep[];
  table?: SetupTable;
  /** Said under the table. */
  note?: string;
}

interface SetupInput {
  nodes: HardwareNode[];
  links: SetupLink[];
  services: Service[];
  gamingPlan?: Partial<GamingPlan>;
}

type FlowEdge = {
  source: string;
  target: string;
  sourceHandle?: string | null;
  data?: Record<string, unknown>;
};

/** The canvas's edges as the links the guide is written from. */
export function linksFromEdges(edges: FlowEdge[]): SetupLink[] {
  return edges.map(edge => ({
    source: edge.source,
    target: edge.target,
    sourcePort: edge.sourceHandle ?? undefined,
    type: typeof edge.data?.connection_type === 'string' ? edge.data.connection_type : undefined,
    speed: typeof edge.data?.speed === 'string' ? edge.data.speed : undefined,
    wirelessStandard:
      typeof edge.data?.wireless_standard === 'string' ? edge.data.wireless_standard : undefined,
  }));
}

/** Machines that get a section of their own even before anything runs on them. */
const HOST_TYPES = new Set<HardwareType>(['server', 'server_v2', 'minipc', 'sbc', 'nas', 'vps']);

const guestsOf = (node: HardwareNode): VirtualMachine[] => node.vms ?? [];
const isHost = (node: HardwareNode) => guestsOf(node).length > 0 || HOST_TYPES.has(node.type);

// ─── Addresses ───────────────────────────────────────────────────────────────

function octets(ip: string | undefined): number[] | null {
  const parts = (ip ?? '').trim().split('.');
  if (parts.length !== 4) return null;
  const numbers = parts.map(part => (/^\d{1,3}$/.test(part) ? Number(part) : NaN));
  return numbers.every(number => number >= 0 && number <= 255) ? numbers : null;
}

/** Orders addresses the way a person reads them; anything that is not an address goes last. */
export function compareAddresses(a: string | undefined, b: string | undefined): number {
  const left = octets(a);
  const right = octets(b);
  if (!left || !right) return left ? -1 : right ? 1 : 0;
  for (let index = 0; index < 4; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

/** "255.255.255.0" as 24; null for anything that is not a mask. */
function maskBits(mask: string | undefined): number | null {
  const parts = octets(mask);
  if (!parts) return null;
  const bits = parts.map(part => part.toString(2).padStart(8, '0')).join('');
  if (!/^1*0*$/.test(bits)) return null;
  const firstZero = bits.indexOf('0');
  return firstZero === -1 ? 32 : firstZero;
}

const network = (ip: string | undefined) => octets(ip)?.slice(0, 3).join('.') ?? null;

function maskOf(node: HardwareNode | undefined): string | undefined {
  const fromDetails = (node?.details as { subnet_mask?: unknown } | undefined)?.subnet_mask;
  return node?.subnet_mask || (typeof fromDetails === 'string' ? fromDetails : undefined);
}

/** An address with the length of its network, when the plan knows it: "192.168.1.10/24". */
function withMask(ip: string, ...masks: Array<string | undefined>): string {
  for (const mask of masks) {
    const bits = maskBits(mask);
    if (bits !== null) return `${ip}/${bits}`;
  }
  return ip;
}

// ─── Small helpers ───────────────────────────────────────────────────────────

/** "A", "A and B", "A, B and C". */
function list(names: string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** A short, stable mark of a text, for steps that have nothing else to be known by. */
function mark(text: string): string {
  let hash = 5381;
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) + hash + text.charCodeAt(index)) >>> 0;
  }
  return hash.toString(36);
}

/** The two ends of a connection in a fixed order, whichever way it was drawn. */
const pair = (a: string, b: string) => [a, b].sort().join('~');

const byName = (a: { name: string }, b: { name: string }) =>
  a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });

const portNumber = (port: string | undefined) => {
  const match = /(\d+)$/.exec(port ?? '');
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
};

/** How far each device is from a router, along the cables. */
function depths(nodes: HardwareNode[], cables: SetupLink[]): Map<string, number> {
  const neighbours = new Map<string, string[]>();
  for (const cable of cables) {
    neighbours.set(cable.source, [...(neighbours.get(cable.source) ?? []), cable.target]);
    neighbours.set(cable.target, [...(neighbours.get(cable.target) ?? []), cable.source]);
  }
  const depth = new Map<string, number>();
  const queue = nodes
    .filter(node => node.type === 'router' || node.type === 'modem')
    .map(node => node.id);
  for (const id of queue) depth.set(id, 0);
  for (let index = 0; index < queue.length; index += 1) {
    const id = queue[index];
    for (const next of neighbours.get(id) ?? []) {
      if (depth.has(next)) continue;
      depth.set(next, (depth.get(id) ?? 0) + 1);
      queue.push(next);
    }
  }
  return depth;
}

// ─── Sections ────────────────────────────────────────────────────────────────

function rackSection(nodes: HardwareNode[]): SetupSection | null {
  const racks = nodes.filter(node => node.type === 'rack').sort(byName);
  const rows: SetupTable['rows'] = [];
  const several = racks.length > 1;
  for (const rack of racks) {
    const mounted = nodes
      .filter(node => node.parent_id === rack.id)
      .sort((a, b) => (a.details?.rack_position ?? 0) - (b.details?.rack_position ?? 0));
    for (const device of mounted) {
      const units = device.details?.rack_units || DEFAULT_DEVICE_U[device.type] || 1;
      const top = (device.details?.rack_position ?? 0) + 1;
      const unit = units > 1 ? `U${top} to U${top + units - 1}` : `U${top}`;
      rows.push({
        id: `mount:${device.id}`,
        label: `${device.name} is mounted in ${rack.name} at ${unit}`,
        cells: [
          ...(several ? [{ text: rack.name }] : []),
          { text: unit, figure: true },
          { text: device.name },
          { text: `${units}U`, figure: true },
        ],
      });
    }
  }
  if (rows.length === 0) return null;
  const only = racks.find(rack => nodes.some(node => node.parent_id === rack.id));
  return {
    id: 'rack',
    title: several ? 'Mount the racks' : 'Mount the rack',
    intro:
      (!several && only ? `${only.name}, ${only.details?.rack_size || 24}U. ` : '') +
      'Units are counted from the top, as on the canvas.',
    steps: [],
    table: {
      caption: 'Where each device sits in the rack',
      columns: [
        ...(several ? [{ label: 'Rack' }] : []),
        { label: 'Unit', figure: true },
        { label: 'Device' },
        { label: 'Height', figure: true },
      ],
      rows,
    },
  };
}

function cablingSection(nodes: HardwareNode[], links: SetupLink[]): SetupSection | null {
  const byId = new Map(nodes.map(node => [node.id, node]));
  const known = links.filter(link => byId.has(link.source) && byId.has(link.target));
  const tunnels = known.filter(link => link.type === 'vpn');
  const wifi = known.filter(
    link =>
      link.type !== 'vpn' &&
      isWifiAssociation(byId.get(link.source)!.type, byId.get(link.target)!.type),
  );
  const cables = known.filter(link => !tunnels.includes(link) && !wifi.includes(link));

  const depth = depths(nodes, cables);
  const far = Number.MAX_SAFE_INTEGER;
  const ordered = [...cables].sort((a, b) => {
    const from = byId.get(a.source)!;
    const other = byId.get(b.source)!;
    return (
      (depth.get(a.source) ?? far) - (depth.get(b.source) ?? far) ||
      byName(from, other) ||
      portNumber(a.sourcePort) - portNumber(b.sourcePort) ||
      byName(byId.get(a.target)!, byId.get(b.target)!)
    );
  });

  const seen = new Map<string, number>();
  const rows: SetupTable['rows'] = ordered.map(cable => {
    const from = byId.get(cable.source)!;
    const to = byId.get(cable.target)!;
    const key = pair(from.id, to.id);
    const count = (seen.get(key) ?? 0) + 1;
    seen.set(key, count);
    const port = /^eth\d+$/.test(cable.sourcePort ?? '') ? cable.sourcePort! : '';
    // An access point's uplink is drawn as a wireless link and still takes a
    // port of the switch: it is a cable.
    const uplink =
      cable.type === 'wireless' && (from.type === 'access_point' || to.type === 'access_point');
    const medium =
      cable.type === 'wireless' && !uplink
        ? `${cable.wirelessStandard || 'Wi-Fi'} link`
        : uplink
          ? 'Access point uplink'
          : cable.speed || '1 GbE';
    return {
      id: count > 1 ? `cable:${key}#${count}` : `cable:${key}`,
      label: `${from.name}${port ? ` ${port}` : ''} is connected to ${to.name}`,
      cells: [
        { text: from.name },
        { text: port, figure: true },
        { text: to.name },
        { text: medium, figure: !uplink && cable.type !== 'wireless' },
      ],
    };
  });

  const steps: SetupStep[] = [
    ...wifi.map(link => {
      const a = byId.get(link.source)!;
      const b = byId.get(link.target)!;
      const [accessPoint, client] = a.type === 'access_point' ? [a, b] : [b, a];
      return {
        id: `wifi:${client.id}:${accessPoint.id}`,
        text: `Join ${client.name} to the Wi-Fi of ${accessPoint.name}.`,
      };
    }),
    ...tunnels.map(link => {
      const a = byId.get(link.source)!;
      const b = byId.get(link.target)!;
      return {
        id: `vpn:${pair(a.id, b.id)}`,
        text: `Set up the site-to-site VPN between ${a.name} and ${b.name}. Both ends have to be online first.`,
      };
    }),
  ];

  if (rows.length === 0 && steps.length === 0) return null;
  return {
    id: 'cabling',
    title: 'Run the cables',
    intro:
      rows.length > 0
        ? `${plural(rows.length, 'cable')}. Ports are named as on the canvas. Label both ends before you plug one in.`
        : undefined,
    steps,
    table:
      rows.length > 0
        ? {
            caption: 'Which cable goes where',
            columns: [
              { label: 'From' },
              { label: 'Port', figure: true },
              { label: 'To' },
              { label: 'Link', figure: true },
            ],
            rows,
          }
        : undefined,
  };
}

function networkSection(nodes: HardwareNode[]): SetupSection | null {
  const routers = nodes.filter(node => node.type === 'router').sort(byName);
  const addressed = nodes
    .filter(node => node.type !== 'router' && isNetworkNode(node.type) && node.ip)
    .sort((a, b) => compareAddresses(a.ip, b.ip) || byName(a, b));
  const missing = nodes
    .filter(
      node =>
        isNetworkNode(node.type) &&
        !node.ip &&
        node.type !== 'router' &&
        node.type !== 'modem' &&
        node.type !== 'vps',
    )
    .sort(byName);

  const steps: SetupStep[] = [];
  for (const router of routers) {
    if (router.ip) {
      steps.push({
        id: `router:${router.id}:lan`,
        text: `Set the LAN address of ${router.name} to ${withMask(router.ip, maskOf(router))}.`,
      });
    }
    const pool = router.details?.dhcp_pool;
    if (pool?.start && router.details?.dhcp_enabled !== false) {
      steps.push({
        id: `router:${router.id}:dhcp`,
        text:
          `Set the DHCP range of ${router.name}: ${pool.start} to ${pool.end}, ${plural(pool.size, 'address', 'addresses')}` +
          (pool.clients ? ` for ${plural(pool.clients, 'expected device')}.` : '.'),
      });
    }
  }

  const withMac = addressed.some(node => node.mac_address);
  const rows: SetupTable['rows'] = addressed.map(node => ({
    id: `addr:${node.id}`,
    label: `${node.name} has the address ${node.ip}`,
    cells: [
      { text: node.name },
      { text: typeName(node.type) },
      { text: node.ip!, figure: true },
      ...(withMac ? [{ text: node.mac_address ?? '', figure: true }] : []),
    ],
  }));

  let warning: string | undefined;
  if (routers.length === 0) {
    // Only worth saying when something is waiting for an address.
    if (!nodes.some(node => isNetworkNode(node.type))) return null;
    warning =
      'This build has no router, so nothing has an address yet. Add one on the canvas and connect the devices to it.';
  } else if (missing.length > 0) {
    const names = list(missing.map(node => node.name));
    warning =
      missing.length === 1
        ? `${names} has no address: it is not connected to a router on the canvas.`
        : `${names} have no address: they are not connected to a router on the canvas.`;
  }

  if (steps.length === 0 && rows.length === 0 && !warning) return null;
  return {
    id: 'network',
    title: 'Set up the network',
    intro:
      rows.length > 0
        ? 'Give every device the address the plan reserved for it: set it on the device, or reserve it for the device in the DHCP settings of the router.'
        : undefined,
    warning,
    steps,
    table:
      rows.length > 0
        ? {
            caption: 'The address of every device',
            columns: [
              { label: 'Device' },
              { label: 'Type' },
              { label: 'Address', figure: true },
              ...(withMac ? [{ label: 'MAC', figure: true }] : []),
            ],
            rows,
          }
        : undefined,
  };
}

const RUNS_AS: Record<string, string> = {
  vm: 'Virtual machine',
  lxc: 'LXC',
  container: 'Container',
};

function catalogService(guest: VirtualMachine, services: Service[]): Service | undefined {
  const id = guest.details?.catalog_service_id;
  return (
    (typeof id === 'string' ? services.find(service => service.id === id) : undefined) ??
    services.find(service => service.name.toLowerCase() === guest.name.toLowerCase())
  );
}

/** Where a guest answers: a container on its host, a machine on its own address. */
function reachableAt(guest: VirtualMachine, host: HardwareNode): string | undefined {
  return (guest.type === 'container' ? host.ip : guest.ip || host.ip) || undefined;
}

function hostSection(
  host: HardwareNode,
  routers: HardwareNode[],
  services: Service[],
): SetupSection | null {
  const guests = guestsOf(host);
  const machines = guests.filter(guest => guest.type === 'vm' || guest.type === 'lxc');
  const containers = guests.filter(guest => guest.type === 'container');
  const hypervisor = machines.length > 0 || host.details?.hypervisor_enabled === true;
  const gateway = routers.find(
    router => network(router.ip) && network(router.ip) === network(host.ip),
  );
  const login = host.ip ? `username@${host.ip}` : 'username@ADDRESS';
  const step = (key: string, text: string, code?: string): SetupStep => ({
    id: `host:${host.id}:${key}`,
    text,
    ...(code ? { code } : {}),
  });
  const steps: SetupStep[] = [];

  const parts = host.internal_components ?? [];
  if (parts.length > 0) {
    steps.push(step('parts', `Fit its parts: ${list(parts.map(part => part.name))}.`));
  }

  if (host.type === 'nas') {
    const raid = (host.details as { raid?: unknown } | undefined)?.raid;
    steps.push(
      step(
        'os',
        `Set up the storage pool${typeof raid === 'string' && raid ? ` (${raid})` : ''} and the shares you need.`,
      ),
    );
  } else if (host.type === 'vps') {
    const provider = [host.details?.provider, host.details?.region].filter(Boolean).join(', ');
    steps.push(
      step(
        'os',
        `Create the server${provider ? ` at ${provider}` : ' at your provider'} with a Debian or Ubuntu image.`,
      ),
    );
  } else {
    if (host.type !== 'sbc') {
      steps.push(
        step(
          'bios',
          hypervisor
            ? 'In the BIOS or UEFI, turn on virtualization (Intel VT-x or AMD-V) and set the machine to power on after a power loss. Update the firmware first if a newer version exists.'
            : 'In the BIOS or UEFI, set the machine to power on after a power loss. Update the firmware first if a newer version exists.',
        ),
      );
    }
    steps.push(
      step(
        'os',
        hypervisor
          ? 'Install Proxmox VE: flash the installer to a USB stick, boot from it and follow it. Choose ZFS when the machine has several identical drives and ECC memory, otherwise ext4 or xfs.'
          : containers.length > 0
            ? 'Install a Linux server system such as Debian or Ubuntu Server. Proxmox VE works too if you want virtual machines later.'
            : 'Install the operating system you want to run on it.',
      ),
    );
  }

  if (host.ip && host.type !== 'vps') {
    steps.push(
      step(
        'address',
        `Give it the static address ${withMask(host.ip, maskOf(host), maskOf(gateway))}` +
          (gateway?.ip ? `, with ${gateway.ip} as its gateway.` : '.'),
      ),
    );
  }

  if (host.type !== 'nas') {
    steps.push(
      step(
        'user',
        'Create a user for yourself and add it to the sudo group. Replace “username” with your own.',
        'adduser username\nusermod -aG sudo username',
      ),
      step('key', 'From your own computer, copy your SSH key to it.', `ssh-copy-id ${login}`),
      step(
        'ssh',
        'Turn off password sign-in over SSH, and sign-in as root with a password.',
        'sudo nano /etc/ssh/sshd_config\n# PasswordAuthentication no\n# PermitRootLogin prohibit-password\nsudo systemctl restart ssh',
      ),
    );
  }

  if (containers.length > 0 && host.type === 'nas') {
    steps.push(
      step('docker', 'Turn on container support in its system: the containers below run in it.'),
    );
  } else if (containers.length > 0) {
    if (hypervisor) {
      steps.push(
        step(
          'docker-host',
          'Create a Debian or Ubuntu LXC or virtual machine on it to run Docker in.',
        ),
      );
    }
    steps.push(
      step(
        'docker',
        'Install Docker and Docker Compose, then check that Compose answers.',
        'curl -fsSL https://get.docker.com -o get-docker.sh\nsudo sh get-docker.sh\nsudo usermod -aG docker $USER\ndocker compose version',
      ),
    );
  }

  const rows: SetupTable['rows'] = [...guests]
    .sort((a, b) => compareAddresses(a.ip, b.ip) || byName(a, b))
    .map(guest => {
      const service = catalogService(guest, services);
      const docs = service?.docs_url || service?.official_website;
      return {
        id: `guest:${guest.id}`,
        label: `${guest.name} is running on ${host.name}`,
        cells: [
          { text: guest.name, ...(docs ? { href: docs } : {}) },
          { text: RUNS_AS[guest.type] ?? guest.type },
          { text: guest.ip ?? '', figure: true },
          { text: guest.cpu_cores ? String(guest.cpu_cores) : '', figure: true },
          { text: guest.ram_mb ? formatMemory(guest.ram_mb) : '', figure: true },
        ],
      };
    });

  if (steps.length === 0 && rows.length === 0) return null;
  return {
    id: `host:${host.id}`,
    title: host.name,
    intro: [typeName(host.type), host.ip, describe(host)].filter(Boolean).join(', '),
    steps,
    table:
      rows.length > 0
        ? {
            caption: `What runs on ${host.name}`,
            columns: [
              { label: 'Runs on it' },
              { label: 'As' },
              { label: 'Address', figure: true },
              { label: 'Cores', figure: true },
              { label: 'RAM', figure: true },
            ],
            rows,
          }
        : undefined,
    note:
      containers.length > 0 && host.ip
        ? `The generated Compose file publishes the ports of its containers on the host: from the network, reach them at ${host.ip}. The addresses above are the ones they carry inside Docker's own network on that host.`
        : undefined,
  };
}

/** What the plan says the machine is made of: "8 cores, 32 GB RAM". */
function describe(host: HardwareNode): string {
  const details = host.details;
  if (!details) return '';
  const facts: string[] = [];
  if (details.model) facts.push(String(details.model));
  const cores = details.cpu_cores ?? (typeof details.cpu === 'number' ? details.cpu : undefined);
  if (cores) facts.push(plural(Number(cores), 'core'));
  if (typeof details.ram === 'number' && details.ram > 0) facts.push(`${details.ram} GB RAM`);
  return facts.join(', ');
}

const DNS_FILTERS = ['pi-hole', 'pihole', 'adguard home'];
const REVERSE_PROXIES = ['nginx proxy manager', 'traefik', 'caddy'];

function servicesSection(nodes: HardwareNode[], routers: HardwareNode[]): SetupSection | null {
  const hosts = nodes.filter(node => guestsOf(node).some(guest => guest.type === 'container'));
  if (hosts.length === 0) return null;
  const router = routers[0];
  const steps: SetupStep[] = [
    {
      id: 'services:files',
      text:
        'Download docker-compose.yml and .env from the Config Generator.' +
        (hosts.length > 1
          ? ' The file lists every container of the project: on each host, keep the ones that run there.'
          : ''),
      action: { label: 'Open the Config Generator', to: '/generate' },
    },
  ];
  for (const host of [...hosts].sort((a, b) => compareAddresses(a.ip, b.ip) || byName(a, b))) {
    steps.push({
      id: `services:up:${host.id}`,
      text: `Copy both files to ${host.name}${host.ip ? ` (${host.ip})` : ''}, start the containers and check that they stay up.`,
      code: 'docker compose up -d\ndocker compose ps',
    });
  }
  for (const host of nodes) {
    for (const guest of guestsOf(host)) {
      const name = guest.name.toLowerCase();
      const address = reachableAt(guest, host);
      if (DNS_FILTERS.includes(name)) {
        steps.push({
          id: `services:dns:${guest.id}`,
          text:
            `${guest.name} only filters for devices that use it: in the DHCP settings of ${router?.name ?? 'your router'}, ` +
            `set the DNS server to ${address ?? `the address of ${host.name}`}.`,
        });
      }
      if (REVERSE_PROXIES.includes(name)) {
        steps.push(
          {
            id: `services:proxy:${guest.id}`,
            text: `On ${router?.name ?? 'your router'}, forward ports 80 and 443 to ${address ?? host.name}, where ${guest.name} runs.`,
          },
          {
            id: `services:domain:${guest.id}`,
            text: 'Point the DNS A record of your domain (at Cloudflare, for example) at the public address of your home.',
          },
        );
      }
    }
  }
  return { id: 'services', title: 'Start the services', steps };
}

function gamingSections(input: SetupInput): SetupSection[] {
  return gamingSetupSteps(input.nodes, input.gamingPlan, input.services).map(step => ({
    id: step.id,
    title: step.id === 'lan-party' ? 'Prepare the room' : 'Bring the game servers online',
    intro: step.description,
    steps: step.items.map(item => ({
      id: `${step.id}:${mark(item.text)}`,
      text: item.text,
      ...(item.code ? { code: item.code } : {}),
    })),
  }));
}

/** The whole guide of a build, in the order the work is done. */
export function buildSetupPlan(input: SetupInput): SetupSection[] {
  const { nodes, links, services } = input;
  const routers = nodes.filter(node => node.type === 'router').sort(byName);
  const hosts = nodes.filter(isHost).sort((a, b) => compareAddresses(a.ip, b.ip) || byName(a, b));

  const sections: Array<SetupSection | null> = [
    rackSection(nodes),
    cablingSection(nodes, links),
    networkSection(nodes),
    ...hosts.map(host => hostSection(host, routers, services)),
    servicesSection(nodes, routers),
    ...gamingSections(input),
  ];
  return sections.filter((section): section is SetupSection => section !== null);
}

/** Everything in a section that can be ticked off. */
export function sectionStepIds(section: SetupSection): string[] {
  return [...section.steps.map(step => step.id), ...(section.table?.rows.map(row => row.id) ?? [])];
}

interface SetupProgress {
  done: number;
  total: number;
  /** Per section id. */
  sections: Map<string, { done: number; total: number }>;
}

/** How far along the guide is. Ticks for steps the plan no longer has do not count. */
export function setupProgress(sections: SetupSection[], doneIds: Iterable<string>): SetupProgress {
  const ticked = new Set(doneIds);
  const progress: SetupProgress = { done: 0, total: 0, sections: new Map() };
  for (const section of sections) {
    const ids = sectionStepIds(section);
    const done = ids.filter(id => ticked.has(id)).length;
    progress.sections.set(section.id, { done, total: ids.length });
    progress.done += done;
    progress.total += ids.length;
  }
  return progress;
}

/** The ticked steps as the build's settings hold them; anything else counts as none. */
export function readSetupDone(settings: Record<string, unknown> | undefined): string[] {
  const stored = settings?.setupDone;
  return Array.isArray(stored) ? stored.filter((id): id is string => typeof id === 'string') : [];
}
