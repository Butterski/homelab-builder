import { describe, expect, it } from 'vitest';
import type { HardwareNode, Service, VirtualMachine } from '../../../types';
import {
  buildSetupPlan,
  compareAddresses,
  linksFromEdges,
  readSetupDone,
  sectionStepIds,
  setupProgress,
  type SetupLink,
  type SetupSection,
} from './setup-plan';

const node = (
  overrides: Partial<HardwareNode> & Pick<HardwareNode, 'id' | 'type' | 'name'>,
): HardwareNode => ({
  x: 0,
  y: 0,
  ...overrides,
});

const guest = (
  overrides: Partial<VirtualMachine> & Pick<VirtualMachine, 'id' | 'name'>,
): VirtualMachine => ({ type: 'container', status: 'running', ...overrides });

const cable = (
  source: string,
  target: string,
  sourcePort = 'eth0',
  extra: Partial<SetupLink> = {},
): SetupLink => ({
  source,
  target,
  sourcePort,
  type: 'ethernet',
  speed: '1 GbE',
  ...extra,
});

const section = (sections: SetupSection[], id: string) => {
  const found = sections.find(entry => entry.id === id);
  if (!found) throw new Error(`no section ${id} in ${sections.map(entry => entry.id).join(', ')}`);
  return found;
};

const texts = (entry: SetupSection) => entry.steps.map(step => step.text);
const rows = (entry: SetupSection) =>
  (entry.table?.rows ?? []).map(row => row.cells.map(cell => cell.text));

/** A router, a switch, a mini PC with two containers, a NAS and an access point. */
function homelab() {
  const nodes: HardwareNode[] = [
    node({
      id: 'router',
      type: 'router',
      name: 'Lab Router',
      ip: '192.168.10.1',
      details: {
        dhcp_enabled: true,
        dhcp_pool: { start: '192.168.10.50', end: '192.168.10.135', size: 86, clients: 0 },
        // The planner stores the mask next to the other details.
        ...({ subnet_mask: '255.255.255.0' } as object),
      },
    }),
    node({ id: 'switch', type: 'switch', name: 'Core Switch', ip: '192.168.10.10' }),
    node({
      id: 'mini',
      type: 'minipc',
      name: 'Mini PC',
      ip: '192.168.10.186',
      details: { cpu: 8, ram: 32 },
      vms: [
        guest({
          id: 'vm-pihole',
          name: 'Pi-hole',
          ip: '192.168.10.187',
          cpu_cores: 0.5,
          ram_mb: 256,
        }),
        guest({
          id: 'vm-jellyfin',
          name: 'Jellyfin',
          ip: '192.168.10.188',
          cpu_cores: 1,
          ram_mb: 2048,
          details: { catalog_service_id: 'svc-jellyfin' },
        }),
      ],
    }),
    node({
      id: 'nas',
      type: 'nas',
      name: 'Storage NAS',
      ip: '192.168.10.136',
      details: { ...({ raid: 'Mirror' } as object) },
    }),
    node({ id: 'ap', type: 'access_point', name: 'Access Point', ip: '192.168.10.20' }),
  ];
  const links: SetupLink[] = [
    // Given out of order on purpose: the guide sorts from the router outward.
    cable('switch', 'nas', 'eth2'),
    cable('switch', 'ap', 'eth3', { type: 'wireless', wirelessStandard: 'Wi-Fi 6' }),
    cable('switch', 'mini', 'eth1', { speed: '2.5 GbE' }),
    cable('router', 'switch', 'eth1'),
  ];
  const services = [
    { id: 'svc-jellyfin', name: 'Jellyfin', docs_url: 'https://jellyfin.org/docs/' },
  ] as unknown as Service[];
  return { nodes, links, services };
}

describe('buildSetupPlan', () => {
  it('writes the cables as a schedule, from the router outward', () => {
    const cabling = section(buildSetupPlan(homelab()), 'cabling');

    expect(cabling.table?.columns.map(column => column.label)).toEqual([
      'From',
      'Port',
      'To',
      'Link',
    ]);
    expect(rows(cabling)).toEqual([
      ['Lab Router', 'eth1', 'Core Switch', '1 GbE'],
      ['Core Switch', 'eth1', 'Mini PC', '2.5 GbE'],
      ['Core Switch', 'eth2', 'Storage NAS', '1 GbE'],
      // Drawn as a wireless link, but it takes a port of the switch: it is a cable.
      ['Core Switch', 'eth3', 'Access Point', 'Access point uplink'],
    ]);
    expect(cabling.intro).toContain('4 cables');
  });

  it('names a cable by its two ends, whichever way it was drawn', () => {
    const { nodes, services } = homelab();
    const drawn = buildSetupPlan({ nodes, services, links: [cable('router', 'switch', 'eth1')] });
    const flipped = buildSetupPlan({ nodes, services, links: [cable('switch', 'router', 'eth1')] });

    expect(section(drawn, 'cabling').table?.rows[0].id).toBe(
      section(flipped, 'cabling').table?.rows[0].id,
    );
  });

  it('keeps two cables between the same devices apart', () => {
    const { nodes, services } = homelab();
    const plan = buildSetupPlan({
      nodes,
      services,
      links: [cable('router', 'switch', 'eth1'), cable('router', 'switch', 'eth2')],
    });
    const ids = section(plan, 'cabling').table!.rows.map(row => row.id);

    expect(new Set(ids).size).toBe(2);
  });

  it('tells a Wi-Fi client to join its access point instead of cabling it', () => {
    const { nodes, links, services } = homelab();
    const plan = buildSetupPlan({
      nodes: [...nodes, node({ id: 'laptop', type: 'pc', name: 'Laptop', ip: '192.168.10.160' })],
      links: [
        ...links,
        cable('ap', 'laptop', 'eth0', { type: 'wireless', wirelessStandard: 'Wi-Fi 6' }),
      ],
      services,
    });
    const cabling = section(plan, 'cabling');

    expect(texts(cabling)).toContain('Join Laptop to the Wi-Fi of Access Point.');
    expect(rows(cabling).some(row => row.includes('Laptop'))).toBe(false);
  });

  it('sets the router up from the plan and lists every address in order', () => {
    const network = section(buildSetupPlan(homelab()), 'network');

    expect(texts(network)).toEqual([
      'Set the LAN address of Lab Router to 192.168.10.1/24.',
      'Set the DHCP range of Lab Router: 192.168.10.50 to 192.168.10.135, 86 addresses.',
    ]);
    expect(rows(network)).toEqual([
      ['Core Switch', 'Switch', '192.168.10.10'],
      ['Access Point', 'Access point', '192.168.10.20'],
      ['Storage NAS', 'NAS', '192.168.10.136'],
      ['Mini PC', 'Mini PC', '192.168.10.186'],
    ]);
    expect(network.warning).toBeUndefined();
  });

  it('says so when a device has no address', () => {
    const { nodes, links, services } = homelab();
    const plan = buildSetupPlan({
      nodes: [...nodes, node({ id: 'spare', type: 'server', name: 'Spare Server' })],
      links,
      services,
    });

    expect(section(plan, 'network').warning).toBe(
      'Spare Server has no address: it is not connected to a router on the canvas.',
    );
  });

  it('says so when there is no router at all', () => {
    const plan = buildSetupPlan({
      nodes: [node({ id: 'mini', type: 'minipc', name: 'Mini PC' })],
      links: [],
      services: [],
    });

    expect(section(plan, 'network').warning).toContain('no router');
  });

  it('gives each host its own steps, with its address and its gateway', () => {
    const host = section(buildSetupPlan(homelab()), 'host:mini');

    expect(host.title).toBe('Mini PC');
    expect(host.intro).toBe('Mini PC, 192.168.10.186, 8 cores, 32 GB RAM');
    expect(texts(host)).toContain(
      'Give it the static address 192.168.10.186/24, with 192.168.10.1 as its gateway.',
    );
    expect(host.steps.find(step => step.id === 'host:mini:key')?.code).toBe(
      'ssh-copy-id username@192.168.10.186',
    );
    // Containers only: no hypervisor, but Docker.
    expect(texts(host).join(' ')).not.toContain('Proxmox VE: flash');
    expect(host.steps.some(step => step.id === 'host:mini:docker')).toBe(true);
    expect(rows(host)).toEqual([
      ['Pi-hole', 'Container', '192.168.10.187', '0.5', '256 MB'],
      ['Jellyfin', 'Container', '192.168.10.188', '1', '2 GB'],
    ]);
    // A service of the catalog links to its own documentation.
    expect(host.table?.rows[1].cells[0].href).toBe('https://jellyfin.org/docs/');
  });

  it('installs a hypervisor where virtual machines run', () => {
    const { nodes, links, services } = homelab();
    const withVm = nodes.map(entry =>
      entry.id === 'mini'
        ? {
            ...entry,
            vms: [guest({ id: 'vm-1', name: 'Windows', type: 'vm', ip: '192.168.10.187' })],
          }
        : entry,
    );
    const host = section(buildSetupPlan({ nodes: withVm, links, services }), 'host:mini');

    expect(texts(host).join(' ')).toContain('Install Proxmox VE');
    expect(texts(host).join(' ')).toContain('turn on virtualization');
    expect(host.steps.some(step => step.id === 'host:mini:docker')).toBe(false);
  });

  it('treats a NAS as an appliance: a pool and an address, no shell work', () => {
    const host = section(buildSetupPlan(homelab()), 'host:nas');

    expect(texts(host)).toEqual([
      'Set up the storage pool (Mirror) and the shares you need.',
      'Give it the static address 192.168.10.136/24, with 192.168.10.1 as its gateway.',
    ]);
  });

  it('starts the containers and wires up what the whole network depends on', () => {
    const services = section(buildSetupPlan(homelab()), 'services');

    expect(services.steps[0].action).toEqual({
      label: 'Open the Config Generator',
      to: '/generate',
    });
    expect(texts(services)).toContain(
      'Copy both files to Mini PC (192.168.10.186), start the containers and check that they stay up.',
    );
    // A container answers on its host, so that is the DNS server to hand out.
    expect(texts(services)).toContain(
      'Pi-hole only filters for devices that use it: in the DHCP settings of Lab Router, set the DNS server to 192.168.10.186.',
    );
  });

  it('lists what is mounted in a rack, counted from the top', () => {
    const plan = buildSetupPlan({
      nodes: [
        node({ id: 'rack', type: 'rack', name: 'Main Rack', details: { rack_size: 12 } }),
        node({
          id: 'srv',
          type: 'server',
          name: 'Server',
          parent_id: 'rack',
          details: { rack_position: 2, rack_units: 2 },
        }),
        node({
          id: 'sw',
          type: 'switch',
          name: 'Switch',
          parent_id: 'rack',
          details: { rack_position: 0 },
        }),
      ],
      links: [],
      services: [],
    });
    const rack = section(plan, 'rack');

    expect(rack.intro).toBe('Main Rack, 12U. Units are counted from the top, as on the canvas.');
    expect(rows(rack)).toEqual([
      ['U1', 'Switch', '1U'],
      ['U3 to U4', 'Server', '2U'],
    ]);
  });

  it('puts the work in the order it is done', () => {
    const order = buildSetupPlan(homelab()).map(entry => entry.id);

    expect(order).toEqual(['cabling', 'network', 'host:nas', 'host:mini', 'services']);
  });

  it('has nothing to say about an empty build', () => {
    expect(buildSetupPlan({ nodes: [], links: [], services: [] })).toEqual([]);
  });

  it('gives every step an id of its own', () => {
    const ids = buildSetupPlan(homelab()).flatMap(sectionStepIds);

    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeGreaterThan(15);
  });
});

describe('setupProgress', () => {
  it('counts what is ticked, per section and in all', () => {
    const plan = buildSetupPlan(homelab());
    const cabling = sectionStepIds(section(plan, 'cabling'));
    const progress = setupProgress(plan, [cabling[0], cabling[1]]);

    expect(progress.done).toBe(2);
    expect(progress.total).toBe(plan.flatMap(sectionStepIds).length);
    expect(progress.sections.get('cabling')).toEqual({ done: 2, total: 4 });
    expect(progress.sections.get('network')?.done).toBe(0);
  });

  it('ignores ticks for steps the plan no longer has', () => {
    const plan = buildSetupPlan(homelab());

    expect(setupProgress(plan, ['cable:gone~also-gone', 'host:removed:os']).done).toBe(0);
  });
});

describe('helpers', () => {
  it('reads the ticked steps from the settings of a build', () => {
    expect(readSetupDone({ setupDone: ['a', 'b'] })).toEqual(['a', 'b']);
    expect(readSetupDone({ setupDone: ['a', 3, null] })).toEqual(['a']);
    expect(readSetupDone({ setupDone: 'a' })).toEqual([]);
    expect(readSetupDone({})).toEqual([]);
    expect(readSetupDone(undefined)).toEqual([]);
  });

  it('orders addresses by their numbers, not by their characters', () => {
    const sorted = ['192.168.1.100', '192.168.1.20', '10.0.0.5', '', '192.168.1.3'].sort(
      compareAddresses,
    );

    expect(sorted).toEqual(['10.0.0.5', '192.168.1.3', '192.168.1.20', '192.168.1.100', '']);
  });

  it('reads links off the edges of the canvas', () => {
    expect(
      linksFromEdges([
        {
          source: 'a',
          target: 'b',
          sourceHandle: 'eth2',
          data: { connection_type: 'wireless', speed: '1 GbE', wireless_standard: 'Wi-Fi 6' },
        },
        { source: 'b', target: 'c', sourceHandle: null },
      ]),
    ).toEqual([
      {
        source: 'a',
        target: 'b',
        sourcePort: 'eth2',
        type: 'wireless',
        speed: '1 GbE',
        wirelessStandard: 'Wi-Fi 6',
      },
      {
        source: 'b',
        target: 'c',
        sourcePort: undefined,
        type: undefined,
        speed: undefined,
        wirelessStandard: undefined,
      },
    ]);
  });
});
