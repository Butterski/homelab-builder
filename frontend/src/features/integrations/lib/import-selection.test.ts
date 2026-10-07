import { describe, expect, it } from 'vitest';
import { comparison, guest, host } from '../testing/plan';
import {
  changeSentence,
  countChanges,
  decisionOf,
  formatMemory,
  freeShare,
  guestChosen,
  guestDefault,
  guestKey,
  integrationHealthy,
  share,
  shortSummary,
  specsChosen,
  specsDiffer,
  specsKey,
  summaryLine,
  timeAgo,
  totalChanges,
} from './import-selection';

describe('what an import does unless the owner says otherwise', () => {
  it('brings the plan in line with what runs, and removes nothing by itself', () => {
    expect(guestDefault(guest({ state: 'discovered', name: 'grafana', vmid: 102 }))).toBe(true);
    // A stopped guest may be a leftover: it is left out until it is ticked.
    expect(
      guestDefault(guest({ state: 'discovered', name: 'test', vmid: 9, status: 'stopped' })),
    ).toBe(false);
    expect(guestDefault(guest({ state: 'matched', name: 'ha', vmid: 1, differs: true }))).toBe(
      true,
    );
    expect(guestDefault(guest({ state: 'matched', name: 'pi', vmid: 2, differs: false }))).toBe(
      false,
    );
    expect(guestDefault(guest({ state: 'missing', name: 'Jellyfin', planned_id: 'g' }))).toBe(
      false,
    );
  });

  it('keeps what the owner ticked or unticked', () => {
    const stopped = guest({ state: 'discovered', name: 'docker', vmid: 103, status: 'stopped' });
    expect(guestKey(stopped)).toBe('add:103');
    expect(guestChosen(stopped, {})).toBe(false);
    expect(guestChosen(stopped, { 'add:103': true })).toBe(true);

    const missing = guest({ state: 'missing', name: 'Jellyfin', planned_id: 'g-jf' });
    expect(guestKey(missing)).toBe('remove:g-jf');
    expect(guestChosen(missing, { 'remove:g-jf': true })).toBe(true);

    // A guest that is the same on both sides has nothing to choose, whatever was ticked.
    const same = guest({ state: 'matched', name: 'pihole', vmid: 101 });
    expect(guestChosen(same, { 'update:101': true })).toBe(false);
  });

  it('offers the real figures of a host only where the planned ones differ', () => {
    const [planned, fresh] = comparison().hosts;
    expect(specsDiffer(planned)).toBe(true);
    expect(specsChosen(planned, {})).toBe(true);
    expect(specsChosen(planned, { [specsKey(planned)]: false })).toBe(false);
    // A host that is not in the plan has no planned figures to differ from.
    expect(specsDiffer(fresh)).toBe(false);
    expect(specsChosen(fresh, { [specsKey(fresh)]: true })).toBe(false);
  });
});

describe('counting an import', () => {
  it('counts hosts and guests, and the operations the server will count', () => {
    const count = countChanges(comparison(), {});
    // pve01: the host (new figures, and it learns which host it is), one guest
    // updated, one added. pve02: a new host with its cable, one guest added.
    expect(count).toEqual({
      hostsAdded: 1,
      hostsUpdated: 1,
      guestsAdded: 2,
      guestsUpdated: 1,
      guestsRemoved: 0,
      operations: 6,
    });
    expect(totalChanges(count)).toBe(5);
    expect(changeSentence(count)).toBe(
      '1 host added, 1 host updated, 2 guests added, 1 guest updated',
    );
  });

  it('follows the ticks', () => {
    const count = countChanges(comparison(), {
      'add:103': true,
      'remove:g-jf': true,
      'update:100': false,
      'specs:pve01': false,
    });
    // The host still learns which Proxmox host it is: it was paired by name.
    expect(count).toMatchObject({
      hostsUpdated: 1,
      guestsAdded: 3,
      guestsUpdated: 0,
      guestsRemoved: 1,
    });
  });

  it('leaves a skipped host and its guests out', () => {
    const plan = comparison();
    plan.hosts[1] = host({ node: 'pve02', skipped: true });
    expect(countChanges(plan, {})).toMatchObject({ hostsAdded: 0, guestsAdded: 1 });
  });

  it('counts the router and the switch of a new project, and nothing when nothing comes', () => {
    const plan = comparison();
    plan.build = null;
    plan.candidates = [];
    plan.hosts = [
      host({ node: 'pve01', guests: [guest({ state: 'discovered', name: 'grafana', vmid: 102 })] }),
    ];
    expect(countChanges(plan, {})).toMatchObject({ hostsAdded: 1, guestsAdded: 1, operations: 6 });

    plan.hosts = [host({ node: 'pve01', skipped: true })];
    const none = countChanges(plan, {});
    expect(none.operations).toBe(0);
    expect(changeSentence(none)).toBe('Nothing to change');
  });

  it('does not count a host that already says which Proxmox host it is and whose figures agree', () => {
    const plan = comparison();
    plan.hosts = [
      host({
        node: 'pve01',
        planned_id: 'node-1',
        paired_by: 'link',
        ram_gb: { planned: 32, actual: 31.2, state: 'same' },
      }),
    ];
    expect(countChanges(plan, {})).toMatchObject({ hostsAdded: 0, hostsUpdated: 0, operations: 0 });
  });
});

describe('what is sent to the server', () => {
  it('names the project, the hosts and every chosen change', () => {
    const decision = decisionOf(
      comparison(),
      { pve02: 'new' },
      { 'add:103': true, 'remove:g-jf': true },
      'ignored',
    );
    expect(decision).toEqual({
      build_id: 'build-1',
      build_name: undefined,
      hosts: { pve02: 'new' },
      use_actual_specs: ['pve01'],
      add_guests: [102, 103, 110],
      update_guests: [100],
      remove_guests: ['g-jf'],
    });
  });

  it('sends a name instead of a project for a new one, and nothing of a skipped host', () => {
    const plan = comparison();
    plan.build = null;
    plan.hosts[0] = host({
      node: 'pve01',
      skipped: true,
      guests: [guest({ state: 'discovered', name: 'x', vmid: 1 })],
    });
    const decision = decisionOf(plan, { pve01: 'skip' }, {}, '  What I run  ');
    expect(decision).toMatchObject({
      build_id: null,
      build_name: 'What I run',
      add_guests: [110],
      use_actual_specs: [],
    });
  });
});

describe('figures in words', () => {
  it('sums up a reading', () => {
    const summary = {
      version: '8.4.1',
      cluster: 'homelab',
      nodes: 3,
      nodes_online: 3,
      vms: 11,
      containers: 7,
      templates: 1,
    };
    expect(summaryLine(summary)).toBe(
      'Proxmox VE 8.4.1, cluster homelab, 3 nodes, 11 VMs, 7 containers',
    );
    expect(shortSummary(summary)).toBe('3 nodes / 18 guests');
    // A pasted export of one host knows neither version nor cluster.
    expect(summaryLine({ nodes: 1, nodes_online: 1, vms: 1, containers: 0, templates: 0 })).toBe(
      '1 node, 1 VM, 0 containers',
    );
  });

  it('writes memory the way people say it', () => {
    expect(formatMemory(4096)).toBe('4 GB');
    expect(formatMemory(31985)).toBe('31.2 GB');
    expect(formatMemory(512)).toBe('512 MB');
    expect(formatMemory(0)).toBe('0 GB');
    expect(share(27, 32)).toBe(84);
    expect(share(40, 32)).toBe(100);
    expect(share(1, 0)).toBe(0);
    // Headroom: what the guests leave of a host.
    expect(freeShare(24, 32)).toBe(25);
    expect(freeShare(30, 31.1)).toBe(4);
    expect(freeShare(40, 32)).toBe(0);
  });

  it('calls an integration in order when it was read and the last reading worked', () => {
    expect(
      integrationHealthy({
        summary: { nodes: 1, nodes_online: 1, vms: 0, containers: 0, templates: 0 },
        last_error: '',
      }),
    ).toBe(true);
    expect(integrationHealthy({ summary: null, last_error: '' })).toBe(false);
    expect(
      integrationHealthy({
        summary: { nodes: 1, nodes_online: 1, vms: 0, containers: 0, templates: 0 },
        last_error: 'refused',
      }),
    ).toBe(false);
  });

  it('says when something was read, and never that it will be', () => {
    const now = Date.parse('2026-10-07T12:00:00Z');
    expect(timeAgo('2026-10-07T11:55:00Z', now)).toBe('5 minutes ago');
    // The server's clock is two seconds ahead of the browser's.
    expect(timeAgo('2026-10-07T12:00:02Z', now)).toBe('less than a minute ago');
  });
});
