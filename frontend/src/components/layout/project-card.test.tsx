import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router-dom';

const mocks = vi.hoisted(() => ({
  user: { id: 'user-1', email: 'me@example.com' } as { id: string; email: string } | null,
  sync: { data: undefined as unknown },
  syncCalls: [] as Array<[string | null, boolean, number]>,
  list: vi.fn(),
  updateTopology: vi.fn(),
}));

vi.mock('../../features/auth/hooks/use-auth', () => ({ useAuth: () => ({ user: mocks.user }) }));
vi.mock('../../features/builder/api/builds', () => ({
  buildApi: { list: mocks.list, updateTopology: mocks.updateTopology, get: vi.fn(), validateNetwork: vi.fn() },
}));
vi.mock('../../features/builder/api/proposals', () => ({
  proposalApi: {},
  useSyncState: (id: string | null, enabled: boolean, interval: number) => {
    mocks.syncCalls.push([id, enabled, interval]);
    return mocks.sync;
  },
}));

import type { Build } from '../../features/builder/api/builds';
import { useBuilderStore } from '../../features/builder/store/builder-store';
import { ProjectCard } from './project-card';

const BUILD = '11111111-1111-4111-8111-111111111111';

function build(): Build {
  return {
    id: BUILD,
    user_id: 'user-1',
    name: 'Basement Lab',
    kind: 'game_server',
    revision: 3,
    settings: {},
    created_at: '2026-10-01T10:00:00Z',
    updated_at: '2026-10-01T10:00:00Z',
    nodes: [
      { id: 'a1111111-1111-4111-8111-111111111111', type: 'router', name: 'Router', x: 80, y: 80, details: { ports: 4 } },
      { id: 'b1111111-1111-4111-8111-111111111111', type: 'server_v2', name: 'Game Host', x: 80, y: 340, details: {} },
    ],
    edges: [
      {
        id: 'e1',
        source_node_id: 'a1111111-1111-4111-8111-111111111111',
        source_handle: 'eth0',
        target_node_id: 'b1111111-1111-4111-8111-111111111111',
        target_handle: 'target-0',
        type: 'ethernet',
      },
    ],
  } as unknown as Build;
}

/** Shows where the app is, so navigation can be asserted. */
function Where() {
  const location = useLocation();
  return (
    <p data-testid="where">
      {location.pathname}
      {location.search}
      {(location.state as { createProject?: boolean } | null)?.createProject ? ' +create' : ''}
    </p>
  );
}

function renderCard(path = '/hardware', props: { collapsed?: boolean; onNavigate?: () => void } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <ProjectCard {...props} />
        <Where />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** The state right after a page reload: which project is open is known, its canvas is not. */
function reloaded() {
  useBuilderStore.getState().clearCurrentBuild();
  useBuilderStore.setState({
    currentBuildId: BUILD,
    projectName: 'Basement Lab',
    buildKind: 'game_server',
    buildStatus: 'idle',
  });
}

function opened() {
  useBuilderStore.getState().clearCurrentBuild();
  useBuilderStore.getState().setCurrentBuildId(BUILD);
  const data = build();
  useBuilderStore.getState().loadBuild(data.id, data.name, data);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.user = { id: 'user-1', email: 'me@example.com' };
  mocks.sync.data = undefined;
  mocks.syncCalls.length = 0;
  mocks.list.mockResolvedValue([]);
  useBuilderStore.getState().clearCurrentBuild();
});

describe('ProjectCard', () => {
  it('leads to the projects when none is open', () => {
    renderCard();
    expect(screen.getByRole('link', { name: 'No project open. Choose one.' })).toHaveAttribute('href', '/');
    expect(screen.queryByRole('region', { name: 'Current project' })).not.toBeInTheDocument();
  });

  it('is there after a reload, before the canvas has been fetched', () => {
    reloaded();
    renderCard();

    const card = screen.getByRole('region', { name: 'Current project' });
    expect(within(card).getByText('Basement Lab')).toBeInTheDocument();
    // What is not known yet is not made up.
    expect(within(card).getByText('Game server')).toBeInTheDocument();
    expect(card).not.toHaveTextContent('devices');
    expect(within(card).queryByRole('status')).not.toBeInTheDocument();
    expect(card.querySelector('svg[role="img"]')).toBeNull();

    const pages = within(card).getByRole('navigation', { name: 'Pages of this project' });
    expect(within(pages).getByRole('link', { name: 'Canvas' })).toHaveAttribute('href', `/builder/${BUILD}`);
    expect(within(pages).getByRole('link', { name: 'Config Generator' })).toHaveAttribute('href', '/generate');
    expect(within(pages).getByRole('link', { name: 'Setup Guide' })).toHaveAttribute('href', '/checklist');
  });

  it('shows the canvas in miniature, the device count and the save state once it is loaded', () => {
    opened();
    renderCard();
    const card = screen.getByRole('region', { name: 'Current project' });

    expect(card).toHaveTextContent('Game server, 2 devices');
    // The miniature is a second way to the canvas for a mouse; it is not announced twice.
    expect(card.querySelector('svg[aria-label="Basement Lab: the canvas in miniature"]')).not.toBeNull();
    expect(within(card).getByRole('status')).toHaveTextContent('Saved');

    act(() => useBuilderStore.setState({ saveState: 'unsaved' }));
    expect(within(card).getByRole('status')).toHaveTextContent('Unsaved changes');
  });

  it('follows a rename and disappears with the project', () => {
    opened();
    renderCard();
    act(() => useBuilderStore.getState().setProjectName('Attic Lab'));
    expect(screen.getByText('Attic Lab')).toBeInTheDocument();

    act(() => useBuilderStore.getState().clearCurrentBuild());
    expect(screen.queryByRole('region', { name: 'Current project' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'No project open. Choose one.' })).toBeInTheDocument();
  });

  it('retries a failed save from the card', async () => {
    const user = userEvent.setup();
    opened();
    mocks.updateTopology.mockResolvedValue({ build: { ...build(), revision: 4 } });
    renderCard();
    act(() => useBuilderStore.setState({ saveState: 'error', saveError: 'The server could not be reached.' }));

    const state = screen.getByRole('status');
    expect(state).toHaveTextContent('Save failed');
    await user.click(within(state).getByRole('button', { name: 'Retry' }));

    await waitFor(() => expect(mocks.updateTopology).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Saved'));
  });

  it('says when an AI proposal is waiting, and takes the user to its review', async () => {
    const user = userEvent.setup();
    reloaded();
    mocks.sync.data = { revision: 3, pending: { id: 'proposal-9', summary: 'Add a NAS' }, recent: [] };
    renderCard('/hardware');

    // Away from the canvas the card asks itself, at a slower pace than the builder.
    expect(mocks.syncCalls.at(-1)).toEqual([BUILD, true, 20_000]);
    await user.click(screen.getByRole('link', { name: '1 proposal' }));
    expect(screen.getByTestId('where')).toHaveTextContent(`/builder/${BUILD}?proposal=proposal-9`);
  });

  it('leaves the asking to the builder while the canvas is open, and asks nothing without a login', () => {
    reloaded();
    renderCard(`/builder/${BUILD}`);
    expect(mocks.syncCalls.at(-1)).toEqual([BUILD, false, 20_000]);

    mocks.user = null;
    mocks.syncCalls.length = 0;
    renderCard('/hardware');
    expect(mocks.syncCalls.at(-1)).toEqual([BUILD, false, 20_000]);
  });

  it('switches to another recent project, to all of them, or to a new one', async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    reloaded();
    mocks.list.mockResolvedValue([
      { id: BUILD, name: 'Basement Lab', kind: 'game_server', updated_at: '2026-10-05T10:00:00Z' },
      { id: 'older', name: 'Old Lab', kind: 'homelab', updated_at: '2026-09-01T10:00:00Z' },
      { id: 'newer', name: 'LAN Night', kind: 'lan_party', updated_at: '2026-10-04T10:00:00Z' },
    ]);
    renderCard('/hardware', { onNavigate });

    // Nothing is fetched until the menu is asked for.
    expect(mocks.list).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Switch project' }));
    const others = await screen.findAllByRole('button', { name: /Lab|Night/ });
    // Most recently changed first; the open project is not offered to itself.
    expect(others.map(button => button.textContent)).toEqual(['LAN Night', 'Old Lab']);

    await user.click(others[0]);
    expect(screen.getByTestId('where')).toHaveTextContent('/builder/newer');
    expect(onNavigate).toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Switch project' }));
    await user.click(await screen.findByRole('button', { name: 'New project' }));
    expect(screen.getByTestId('where')).toHaveTextContent('/ +create');

    await user.click(screen.getByRole('button', { name: 'Switch project' }));
    await user.click(await screen.findByRole('button', { name: 'All projects' }));
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/$/);
  });

  it('shrinks to icons in a collapsed sidebar', () => {
    opened();
    mocks.sync.data = { revision: 3, pending: { id: 'proposal-9', summary: '' }, recent: [] };
    renderCard(`/builder/${BUILD}`, { collapsed: true });

    const canvas = screen.getByRole('link', { name: 'Basement Lab: open the canvas' });
    expect(canvas).toHaveAttribute('href', `/builder/${BUILD}`);
    expect(canvas).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Config Generator' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Setup Guide' })).toBeInTheDocument();
    expect(screen.queryByText('Basement Lab')).not.toBeInTheDocument();
  });

  it('shows nothing in a collapsed sidebar when no project is open', () => {
    const { container } = renderCard('/hardware', { collapsed: true });
    expect(container.querySelector('a')).toBeNull();
  });
});
