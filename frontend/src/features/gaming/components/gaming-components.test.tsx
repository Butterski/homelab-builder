import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameProfile, HardwareNode, VirtualMachine } from '../../../types';
import type { GamingReport } from '../api/gaming';

// ─── Store and API doubles ───────────────────────────────────────────────────

const valheim: GameProfile = {
  slug: 'valheim',
  service_id: 'svc-valheim',
  name: 'Valheim Server',
  role: 'game',
  default_players: 5,
  max_players: 10,
  base_ram_mb: 3072,
  ram_mb_per_player: 150,
  base_cpu_cores: 1.5,
  cpu_cores_per_player: 0.1,
  storage_gb: 5,
  upload_kbps_per_player: 150,
  single_thread: true,
  ports: [
    { name: 'game', port: 2456, proto: 'udp', forward: true, env: 'SERVER_PORT' },
    { name: 'query', port: 2457, proto: 'udp', forward: true },
  ],
  image: '',
  notes: '',
};

const store = vi.hoisted(() => ({
  state: {} as Record<string, unknown>,
  report: { data: undefined as unknown, isLoading: false, isError: false },
}));

vi.mock('../../builder/store/builder-store', () => {
  const useBuilderStore = (selector: (state: Record<string, unknown>) => unknown) => selector(store.state);
  useBuilderStore.getState = () => store.state;
  return { useBuilderStore };
});

vi.mock('../api/gaming', () => ({
  useGamingReport: () => store.report,
}));

import { GameServerSettings } from './game-server-settings';
import { GamingNodeFields } from './gaming-node-fields';
import { GamingPlanDialog } from './gaming-plan-dialog';
import { GamingReportView } from './gaming-report';

const plan = {
  uplink: { down_mbps: 300, up_mbps: 20, cgnat: '' as const, public_host: '' },
  power: { mains_voltage: 230, circuits: [{ id: 'c1', label: 'Hall', breaker_amps: 16 }] },
  event: { date: '', hours: 24 },
};

beforeEach(() => {
  store.state = {
    currentBuildId: 'build-1',
    currentRevision: 3,
    buildKind: 'lan_party',
    gamingPlan: plan,
    availableServices: [{ id: 'svc-valheim', name: 'Valheim Server', game: valheim }],
    hardwareNodes: [],
    setBuildKind: vi.fn(),
    setGamingPlan: vi.fn(),
    updateVM: vi.fn(),
    updateHardware: vi.fn(),
    hasUnsavedChanges: () => false,
  };
  store.report = { data: undefined, isLoading: false, isError: false };
});

// ─── Report ──────────────────────────────────────────────────────────────────

const report: GamingReport = {
  kind: 'lan_party',
  revision: 3,
  status: 'error',
  servers: [
    {
      vm_id: 'vm1',
      name: 'Valheim',
      profile: 'valheim',
      game: 'Valheim Server',
      role: 'game',
      host_id: 'host',
      host_name: 'Game host',
      players: 10,
      exposure: 'port_forward',
      needed: { cpu_cores: 2.5, ram_mb: 4608, storage_gb: 5, upload_kbps: 1500 },
      allocated_cpu: 2.5,
      allocated_ram_mb: 4608,
      ports: [],
      target_ip: '192.168.1.150',
      address: 'play.example.org:2456',
    },
  ],
  port_forwards: [
    {
      router_id: 'router',
      router_name: 'Router',
      vm_id: 'vm1',
      server: 'Valheim',
      port_name: 'game',
      proto: 'udp',
      external_port: 2456,
      target_ip: '192.168.1.150',
      target_port: 2456,
      hop: 1,
    },
  ],
  uplink: { up_mbps: 20, down_mbps: 300, needed_up_mbps: 1.5, used_pct: 7.5, cgnat: '' },
  party: {
    seats: 16,
    wifi_players: 1,
    wifi_clients: 20,
    dhcp: [
      {
        router_id: 'router',
        router_name: 'Router',
        enabled: true,
        start: '192.168.1.50',
        end: '192.168.1.149',
        size: 100,
        needed: 36,
      },
    ],
    switches: [{ id: 'core', name: 'Core switch', total: 24, used: 5, free: 19 }],
    tables: [],
    circuits: [
      {
        id: 'c1',
        label: 'Hall',
        breaker_amps: 16,
        watts: 4230,
        capacity_watts: 3680,
        continuous_watts: 2944,
        used_pct: 114.9,
      },
    ],
    total_watts: 5640,
    unassigned_watts: 0,
    energy_kwh: 135.4,
    has_lancache: false,
  },
  issues: [
    {
      code: 'circuit_overloaded',
      severity: 'error',
      message: 'Circuit Hall carries 4230 W on a 16 A breaker that trips at 3680 W.',
      fix: 'Move tables to another circuit.',
    },
    {
      code: 'table_no_uplink',
      severity: 'error',
      node_id: 'table-3',
      message: 'Table 3 is not plugged in: its 8 seats have no network.',
      fix: 'Connect the table to a switch or to the router.',
    },
    { code: 'lancache_suggested', severity: 'info', message: 'With 16 seats, updates repeat.' },
  ],
};

describe('GamingReportView', () => {
  it('leads with what to fix and how', async () => {
    const onSelectNode = vi.fn();
    render(<GamingReportView report={report} onSelectNode={onSelectNode} />);

    expect(screen.getByText(/Circuit Hall carries 4230 W/)).toBeInTheDocument();
    expect(screen.getByText('Move tables to another circuit.')).toBeInTheDocument();
    // Severity is said in words, not only by colour.
    expect(screen.getAllByLabelText('Must fix')).toHaveLength(2);
    expect(screen.getByLabelText('Tip')).toBeInTheDocument();

    // Only a finding about a device offers to show it.
    const jump = screen.getAllByRole('button', { name: 'Show on canvas' });
    expect(jump).toHaveLength(1);
    await userEvent.click(jump[0]);
    expect(onSelectNode).toHaveBeenCalledWith('table-3');
  });

  it('lists servers, the forwards to add and the party figures', () => {
    render(<GamingReportView report={report} />);

    expect(screen.getByText('play.example.org:2456')).toBeInTheDocument();
    expect(screen.getByText('4.5 GB, 2.5 cores')).toBeInTheDocument();
    expect(screen.getByText('2456/UDP')).toBeInTheDocument();
    expect(screen.getByText('192.168.1.150:2456')).toBeInTheDocument();
    expect(screen.getByText('1.5 Mbps of 20 Mbps')).toBeInTheDocument();

    expect(screen.getByText('16')).toBeInTheDocument();
    expect(screen.getByText('5640 W')).toBeInTheDocument();
    expect(
      screen.getByText(/Router hands out 192\.168\.1\.50 to 192\.168\.1\.149: 100 addresses for 36/),
    ).toBeInTheDocument();
    expect(screen.getByText('4230 W of 3680 W (16 A)')).toBeInTheDocument();
    expect(screen.getByText('Safe for hours up to 2944 W.')).toBeInTheDocument();
    expect(screen.getByText('19 of 24 free')).toBeInTheDocument();
    expect(screen.getByText('The event uses about 135.4 kWh.')).toBeInTheDocument();
  });

  it('says so when there is nothing to fix', () => {
    render(
      <GamingReportView
        report={{ ...report, status: 'ok', issues: [], servers: [], port_forwards: [] }}
      />,
    );
    expect(screen.getByText('Nothing to fix. The plan holds together.')).toBeInTheDocument();
    expect(screen.queryByText('Port forwards to add')).not.toBeInTheDocument();
  });
});

// ─── Dialog ──────────────────────────────────────────────────────────────────

describe('GamingPlanDialog', () => {
  it('opens on the report of the saved build', () => {
    store.report = { data: report, isLoading: false, isError: false };
    render(<GamingPlanDialog open onOpenChange={vi.fn()} />);

    expect(screen.getByRole('tab', { name: 'Report' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText(/Circuit Hall carries 4230 W/)).toBeInTheDocument();
    expect(screen.queryByText(/Saving your changes/)).not.toBeInTheDocument();
  });

  it('says the report is behind while edits are being saved', () => {
    store.state.hasUnsavedChanges = () => true;
    store.report = { data: report, isLoading: false, isError: false };
    render(<GamingPlanDialog open onOpenChange={vi.fn()} />);
    expect(screen.getByText(/Saving your changes/)).toBeInTheDocument();
  });

  it('does not compare the build with the server while it is closed', () => {
    // The comparison serialises the whole build, and a store selector runs on
    // every change of the store: every frame of a drag on the canvas behind.
    const compare = vi.fn(() => false);
    store.state.hasUnsavedChanges = compare;
    render(<GamingPlanDialog open={false} onOpenChange={vi.fn()} />);

    expect(compare).not.toHaveBeenCalled();
  });

  it('edits the plan as one complete object', async () => {
    const user = userEvent.setup();
    render(<GamingPlanDialog open onOpenChange={vi.fn()} />);
    await user.click(screen.getByRole('tab', { name: 'Plan details' }));

    await user.selectOptions(screen.getByLabelText('Public IPv4 address'), 'yes');
    expect(store.state.setGamingPlan).toHaveBeenLastCalledWith({
      ...plan,
      uplink: { ...plan.uplink, cgnat: 'yes' },
    });

    await user.click(screen.getByRole('button', { name: /Add circuit/ }));
    expect(store.state.setGamingPlan).toHaveBeenLastCalledWith({
      ...plan,
      power: {
        mains_voltage: 230,
        // The next free id, with the rating of the last circuit as a starting point.
        circuits: [...plan.power.circuits, { id: 'c2', label: '', breaker_amps: 16 }],
      },
    });

    await user.click(screen.getByRole('button', { name: 'Remove circuit Hall' }));
    expect(store.state.setGamingPlan).toHaveBeenLastCalledWith({
      ...plan,
      power: { mains_voltage: 230, circuits: [] },
    });

    await user.selectOptions(screen.getByLabelText('This build is a'), 'game_server');
    expect(store.state.setBuildKind).toHaveBeenCalledWith('game_server');
  });

  it('completes a plan that was never filled in before editing it', async () => {
    store.state.gamingPlan = {};
    store.state.buildKind = 'game_server';
    const user = userEvent.setup();
    render(<GamingPlanDialog open onOpenChange={vi.fn()} />);
    await user.click(screen.getByRole('tab', { name: 'Plan details' }));

    // A game server plan has no venue to describe.
    expect(screen.queryByText('Power at the venue')).not.toBeInTheDocument();
    await user.type(screen.getByLabelText('Upload (Mbps)'), '5');
    expect(store.state.setGamingPlan).toHaveBeenLastCalledWith({
      uplink: { down_mbps: 0, up_mbps: 5, cgnat: '', public_host: '' },
      power: { mains_voltage: 0, circuits: [] },
      event: { date: '', hours: 0 },
    });
  });
});

// ─── Game server settings ────────────────────────────────────────────────────

describe('GameServerSettings', () => {
  const vm: VirtualMachine = {
    id: 'vm1',
    name: 'Valheim',
    type: 'container',
    status: 'running',
    cpu_cores: 2,
    ram_mb: 4096,
    details: {
      catalog_service_id: 'svc-valheim',
      game: { profile: 'valheim', players: 5, exposure: 'lan', port_offset: 0 },
    },
  };

  it('shows what the server needs and which ports it uses', () => {
    render(<GameServerSettings nodeId="host" vm={vm} />);
    expect(
      screen.getByText(/Needs about 4 GB and 2 cores for 5 players\. Ports: 2456\/udp, 2457\/udp\./),
    ).toBeInTheDocument();
    expect(screen.getByText(/Runs mostly on one core/)).toBeInTheDocument();
    // Sized right: nothing to correct.
    expect(screen.queryByRole('button', { name: /Set memory and cores/ })).not.toBeInTheDocument();
  });

  it('resizes the service when the player count changes', async () => {
    const user = userEvent.setup();
    render(<GameServerSettings nodeId="host" vm={{ ...vm, details: { ...vm.details, game: { profile: 'valheim', players: 1, exposure: 'lan', port_offset: 0 } } }} />);

    // The field can be cleared and retyped; nothing is saved until the value is valid.
    await user.clear(screen.getByLabelText('Players'));
    expect(store.state.updateVM).not.toHaveBeenCalled();
    await user.type(screen.getByLabelText('Players'), '10');
    // 10 players need 4608 MB and 2.5 cores.
    expect(store.state.updateVM).toHaveBeenLastCalledWith('host', 'vm1', {
      details: {
        catalog_service_id: 'svc-valheim',
        game: { profile: 'valheim', players: 10, exposure: 'lan', port_offset: 0 },
      },
      cpu_cores: 2.5,
      ram_mb: 4608,
    });
  });

  it('changes how the server is reached without resizing it', async () => {
    const user = userEvent.setup();
    render(<GameServerSettings nodeId="host" vm={vm} />);

    await user.selectOptions(screen.getByLabelText('Reachable'), 'port_forward');
    expect(store.state.updateVM).toHaveBeenLastCalledWith('host', 'vm1', {
      details: {
        catalog_service_id: 'svc-valheim',
        game: { profile: 'valheim', players: 5, exposure: 'port_forward', port_offset: 0 },
      },
    });
  });

  it('offers to fix a server that was given too little', async () => {
    const user = userEvent.setup();
    render(<GameServerSettings nodeId="host" vm={{ ...vm, ram_mb: 1024 }} />);

    await user.click(screen.getByRole('button', { name: /Set memory and cores/ }));
    expect(store.state.updateVM).toHaveBeenLastCalledWith(
      'host',
      'vm1',
      expect.objectContaining({ cpu_cores: 2, ram_mb: 4096 }),
    );
  });

  it('renders nothing for an ordinary service', () => {
    const { container } = render(
      <GameServerSettings nodeId="host" vm={{ ...vm, details: { catalog_service_id: 'x' } }} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

// ─── Node fields ─────────────────────────────────────────────────────────────

describe('GamingNodeFields', () => {
  const table: HardwareNode = {
    id: 'table',
    type: 'lan_table',
    name: 'Table 1',
    x: 0,
    y: 0,
    power_draw: 2110,
    details: { seats: 6, seat_watts: 350, switch_ports: 8, switch_speed: '1 GbE' },
  };

  it('changes seats, switch and power draw of a table in one write', async () => {
    store.state.hardwareNodes = [table];
    const user = userEvent.setup();
    render(<GamingNodeFields node={table} />);

    expect(screen.getByText(/A full table draws 2110 W/)).toBeInTheDocument();
    // Only switches that leave a port for the uplink are offered.
    const options = within(screen.getByLabelText('Table switch')).getAllByRole('option');
    expect(options.map(option => option.textContent)).toEqual([
      '8 ports',
      '16 ports',
      '24 ports',
      '48 ports',
    ]);

    await user.clear(screen.getByLabelText('Seats'));
    expect(store.state.updateHardware).not.toHaveBeenCalled();
    await user.type(screen.getByLabelText('Seats'), '9');
    expect(store.state.updateHardware).toHaveBeenLastCalledWith('table', {
      details: { seats: 9, seat_watts: 350, switch_ports: 16, switch_speed: '1 GbE' },
      power_draw: 9 * 350 + 10,
    });
  });

  it('assigns a device to a circuit of the plan', async () => {
    store.state.hardwareNodes = [table];
    const user = userEvent.setup();
    render(<GamingNodeFields node={table} />);

    await user.selectOptions(screen.getByLabelText('Power circuit'), 'c1');
    expect(store.state.updateHardware).toHaveBeenLastCalledWith('table', {
      details: { ...table.details, circuit: 'c1' },
    });
  });

  it('builds on the latest details, not on the ones it was rendered with', async () => {
    // Another field of the panel saved a model name in the meantime.
    store.state.hardwareNodes = [{ ...table, details: { ...table.details, model: 'Folding table' } }];
    const user = userEvent.setup();
    render(<GamingNodeFields node={table} />);

    await user.selectOptions(screen.getByLabelText('Switch speed'), '2.5 GbE');
    expect(store.state.updateHardware).toHaveBeenLastCalledWith('table', {
      details: { ...table.details, model: 'Folding table', switch_speed: '2.5 GbE' },
    });
  });

  it('asks a console for its platform and an access point for its clients', async () => {
    const user = userEvent.setup();
    const consoleNode: HardwareNode = { id: 'ps5', type: 'console', name: 'PS5', x: 0, y: 0 };
    store.state.hardwareNodes = [consoleNode];
    const { unmount } = render(<GamingNodeFields node={consoleNode} />);
    await user.selectOptions(screen.getByLabelText('Platform'), 'playstation');
    expect(store.state.updateHardware).toHaveBeenLastCalledWith('ps5', {
      details: { platform: 'playstation' },
    });
    unmount();

    const ap: HardwareNode = { id: 'ap', type: 'access_point', name: 'AP', x: 0, y: 0 };
    store.state.hardwareNodes = [ap];
    render(<GamingNodeFields node={ap} />);
    await user.type(screen.getByLabelText('Wi-Fi devices expected'), '3');
    expect(store.state.updateHardware).toHaveBeenLastCalledWith('ap', {
      details: { wifi_clients: 3 },
    });
  });

  it('adds nothing to an ordinary device in a build without circuits', () => {
    store.state.gamingPlan = {};
    const server: HardwareNode = { id: 's', type: 'server_v2', name: 'Server', x: 0, y: 0 };
    const { container } = render(<GamingNodeFields node={server} />);
    expect(container).toBeEmptyDOMElement();
  });
});
