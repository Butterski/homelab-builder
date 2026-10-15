import type { HardwareType } from '@/types';

/** Where "Show me" takes the user: a page, or the open project's canvas on devices of some types. */
export type ShowTarget = { kind: 'route'; to: string } | { kind: 'canvas'; types: HardwareType[] };

export type ReleaseEntry = {
  id: string;
  title: string;
  /** One paragraph. A command between backticks is set in the monospace face. */
  body: string;
  show?: ShowTarget;
};

export type Release = {
  /** MAJOR.MINOR.PATCH */
  version: string;
  title: string;
  /** One sentence under the title. */
  lead: string;
  entries: ReleaseEntry[];
};

/** The release notes, newest first. */
export const RELEASES: Release[] = [
  {
    version: '1.4.0',
    title: "What's new in 1.4",
    lead: 'Power, ports and the hardware you own are now part of a plan.',
    entries: [
      {
        id: 'power',
        title: 'Power cables',
        body: 'A UPS, a PDU and a wall outlet have sockets, and every device has a power input for each power supply. A power cable runs from a socket to an input, takes no network port, and each source shows its load against what it can deliver. The checks warn about an overloaded source, a source with every socket used, a power supply left unplugged, and two power supplies that hang off the same source.',
        show: { kind: 'canvas', types: ['ups', 'pdu', 'power_outlet'] },
      },
      {
        id: 'ports',
        title: 'Port settings and VLANs',
        body: 'A port of a router or firewall takes a role (WAN, LAN, DMZ, VPN or unused), an address, and DHCP. A LAN port with an address becomes a gateway of its own, and the devices behind it get addresses from its subnet. A switch defines VLANs and each port carries some of them; a cable takes the colour of the VLAN it carries and turns amber when its two ends share none.',
        show: { kind: 'canvas', types: ['router', 'firewall', 'switch'] },
      },
      {
        id: 'inventory',
        title: 'Inventory',
        body: 'Write down the hardware you own, once, for all your projects. An owned device dragged onto the canvas is that machine: it keeps its link to the item, and the inventory shows where each one is planned and what is spare. A host that is short of memory is offered the spare memory you have.',
        show: { kind: 'route', to: '/inventory' },
      },
      {
        id: 'proxmox',
        title: 'Proxmox import',
        body: 'Connect to Proxmox VE with a read-only token, or paste the output of `pvesh get /cluster/resources`. Hosts are matched to your inventory, a project is compared with what really runs, and the differences come in as a proposal you review on the canvas. Nothing is written to the cluster, and nothing is imported until you apply it.',
        // The Integrations section is on the inventory page.
        show: { kind: 'route', to: '/inventory' },
      },
      {
        id: 'devices',
        title: 'Notes, tags and smaller cards',
        body: 'A device takes notes, shown on its card, and tags you define per project, each with a colour. A card can be collapsed to its header. CPUs and PCIe cards are components of their own, and a guest has a disk size that is checked against its host.',
        show: { kind: 'canvas', types: [] },
      },
      {
        id: 'setup-guide',
        title: 'Setup Guide',
        body: 'The Setup Guide is written from the open project: the cable schedule, the address plan, and the steps for each host in the order the work is done. What you tick off is saved with the project, and the guide prints as a runbook to take to the rack.',
        show: { kind: 'route', to: '/checklist' },
      },
      {
        id: 'service-library',
        title: 'Service Library',
        body: 'The Service Library is a table: one line per service with what it needs at least, sortable by column, with the categories as filters. A row opens to the rest: recommended figures, ports, players of a game server, links.',
        show: { kind: 'route', to: '/services' },
      },
      {
        id: 'canvas',
        title: 'A quieter canvas',
        body: 'An open canvas no longer keeps the processor busy while nobody touches it, and dragging, panning and zooming a large build keep up with the pointer.',
      },
    ],
  },
];

/** Orders two MAJOR.MINOR.PATCH versions by their numbers; a missing or unreadable part counts as 0. */
export function compareVersions(a: string, b: string): number {
  const parts = (version: string) => version.split('.').map(part => Number.parseInt(part, 10) || 0);
  const left = parts(a);
  const right = parts(b);
  for (let i = 0; i < 3; i++) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * The releases whose notes are new to an account that last saw `seen`, newest
 * first: those after it, up to the running version. An account that never saw
 * any gets the notes of the running version only, not the whole history.
 */
export function releasesToShow(seen: string, appVersion: string, releases = RELEASES): Release[] {
  if (!seen) return releases.filter(release => compareVersions(release.version, appVersion) === 0);
  return releases.filter(
    release =>
      compareVersions(release.version, seen) > 0 &&
      compareVersions(release.version, appVersion) <= 0,
  );
}

/**
 * The notes opened by hand: those of the running version, or of the newest
 * release before it when a patch release brought no notes of its own.
 */
export function currentRelease(appVersion: string, releases = RELEASES): Release[] {
  const release = releases.find(entry => compareVersions(entry.version, appVersion) <= 0);
  return release ? [release] : [];
}
