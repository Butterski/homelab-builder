import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApi } from '../api/builds';
import GuidedPlannerPage from './guided-planner-page';

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  updateTopology: vi.fn(),
  deleteBuild: vi.fn(),
  fetchServices: vi.fn(),
  loadBuild: vi.fn(),
  navigate: vi.fn(),
}));

vi.mock('../api/builds', () => ({
  buildApi: {
    create: mocks.create,
    updateTopology: mocks.updateTopology,
    delete: mocks.deleteBuild,
  },
}));

const valheim = {
  id: 'svc-valheim',
  name: 'Valheim Server',
  category: 'gaming',
  game: {
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
    ports: [{ name: 'game', port: 2456, proto: 'udp', forward: true }],
    image: '',
    notes: '',
  },
};

vi.mock('../store/builder-store', () => {
  type State = {
    availableServices: Array<typeof valheim>;
    fetchServices: typeof mocks.fetchServices;
    loadBuild: typeof mocks.loadBuild;
  };
  // Read on use: the factory runs before `valheim` is defined.
  const state = (): State => ({
    availableServices: [valheim],
    fetchServices: mocks.fetchServices,
    loadBuild: mocks.loadBuild,
  });
  const useBuilderStore = <T,>(selector: (current: State) => T) => selector(state());
  useBuilderStore.getState = state;
  return { useBuilderStore };
});

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => mocks.navigate };
});

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

describe('GuidedPlannerPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchServices.mockResolvedValue(undefined);
    mocks.create.mockResolvedValue({ id: 'build-1', name: 'Guided Lab', revision: 1 });
    mocks.updateTopology.mockResolvedValue({
      build: { id: 'build-1', name: 'Guided Lab', revision: 2 },
      validation: { valid: true, errors: [], warnings: [] },
    });
  });

  it('creates an empty project before submitting its generated topology atomically', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <GuidedPlannerPage />
      </MemoryRouter>,
    );

    // The first question is what to plan; a homelab is the default answer.
    expect(screen.getByText('What are you planning?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Homelab/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    for (let step = 0; step < 4; step += 1) {
      await user.click(screen.getByRole('button', { name: /continue/i }));
    }
    await user.click(screen.getByRole('button', { name: /create this lab/i }));

    await waitFor(() => expect(mocks.updateTopology).toHaveBeenCalledTimes(1));
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({ nodes: [], edges: [], services: [] }),
    );
    expect(mocks.updateTopology).toHaveBeenCalledWith(
      'build-1',
      expect.objectContaining({ revision: 1, nodes: expect.any(Array), edges: expect.any(Array) }),
    );
    const saved = vi.mocked(buildApi.updateTopology).mock.calls[0][1];
    expect(saved.nodes.length).toBeGreaterThan(2);
    expect(saved.edges.length).toBeGreaterThan(1);
    // A homelab is created exactly as before: no kind, no gaming plan.
    expect(vi.mocked(buildApi.create).mock.calls[0][0]).not.toHaveProperty('kind');
  });

  it('plans a LAN party from seats and what the venue offers', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <GuidedPlannerPage />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('button', { name: /^LAN party/ }));
    await user.click(screen.getByRole('button', { name: /continue/i }));

    const seats = screen.getByLabelText('Players with a PC');
    await user.clear(seats);
    await user.type(seats, '32');
    await user.click(screen.getByRole('button', { name: /continue/i }));

    // 32 players are four tables of 8, and the download cache runs on a server:
    // two circuits are not enough, and the wizard says so.
    expect(
      screen.getByText(
        /need 4 tables, and the server a circuit of its own: 5 circuits, 3 more than you entered/,
      ),
    ).toBeInTheDocument();
    const circuits = screen.getByLabelText('Separate circuits');
    await user.clear(circuits);
    await user.type(circuits, '5');
    expect(screen.getByText(/a circuit of its own: 5 circuits\./)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /continue/i }));
    await user.click(screen.getByRole('button', { name: /continue/i }));
    await user.click(screen.getByRole('button', { name: /create this plan/i }));

    await waitFor(() => expect(mocks.updateTopology).toHaveBeenCalledTimes(1));
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'lan_party', nodes: [], edges: [] }),
    );
    const saved = vi.mocked(buildApi.updateTopology).mock.calls[0][1];
    expect(saved.kind).toBe('lan_party');
    expect(saved.nodes.filter(node => node.type === 'lan_table')).toHaveLength(4);
    expect(saved.gaming_plan?.power?.circuits).toHaveLength(5);
    // With enough circuits nothing shares one with a full table except small gear.
    const loads = new Map<string | undefined, number>();
    for (const node of saved.nodes) {
      const circuit = node.details?.circuit;
      loads.set(circuit, (loads.get(circuit) ?? 0) + (node.power_draw ?? 0));
    }
    // 230 V x 16 A x 80% = 2944 W is what a circuit carries for hours.
    expect(Math.max(...loads.values())).toBeLessThanOrEqual(2944);
    expect(mocks.navigate).toHaveBeenCalledWith('/builder/build-1');
  });

  it('plans a game server and starts on that plan when the link names it', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/planner?kind=game_server']}>
        <GuidedPlannerPage />
      </MemoryRouter>,
    );

    // The link skips the first question.
    expect(screen.queryByText('What are you planning?')).not.toBeInTheDocument();
    // Without a game there is nothing to size.
    expect(screen.getByRole('button', { name: /continue/i })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Valheim' }));
    const players = screen.getByLabelText('Valheim Server: players');
    await user.clear(players);
    await user.type(players, '10');
    expect(screen.getByText('Needs about 4.5 GB and 2.5 cores.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /continue/i }));
    await user.click(screen.getByRole('button', { name: /^VPN/ }));
    await user.click(screen.getByRole('button', { name: /continue/i }));
    await user.click(screen.getByRole('button', { name: /create this plan/i }));

    await waitFor(() => expect(mocks.updateTopology).toHaveBeenCalledTimes(1));
    const saved = vi.mocked(buildApi.updateTopology).mock.calls[0][1];
    expect(saved.kind).toBe('game_server');
    const host = saved.nodes.find(node => (node.vms?.length ?? 0) > 0);
    expect(host?.vms?.[0].details?.game).toEqual({
      profile: 'valheim',
      players: 10,
      exposure: 'vpn',
      port_offset: 0,
    });
  });
});
