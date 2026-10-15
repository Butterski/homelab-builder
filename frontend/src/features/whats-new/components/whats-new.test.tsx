import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, configure, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { WhatsNewNotice, WhatsNewState } from '../api/whats-new';

const mocks = vi.hoisted(() => ({
  user: { id: 'user-1', name: 'Ada Lovelace', email: 'ada@example.com', is_admin: false } as Record<
    string,
    unknown
  > | null,
  get: vi.fn(),
  post: vi.fn(),
}));

// The notes of 1.4 stay the ones shown, whatever version the app is at later.
vi.mock('@/lib/version', () => ({ APP_VERSION: '1.4.0', APP_VERSION_LABEL: 'v1.4' }));
vi.mock('@/lib/api', () => ({
  api: { get: mocks.get, post: mocks.post },
  ApiError: class ApiError extends Error {},
}));
vi.mock('@/features/auth/hooks/use-auth', () => ({ useAuth: () => ({ user: mocks.user }) }));
// What the sidebar brings along.
vi.mock('@/features/survey/api/use-survey', () => ({ useSurvey: () => ({ data: null }) }));
vi.mock('@/components/auth/google-login-button', () => ({
  GoogleLoginButton: () => <span>Sign in</span>,
}));
vi.mock('@/features/builder/api/builds', () => ({
  buildApi: { list: vi.fn().mockResolvedValue([]), get: vi.fn(), validateNetwork: vi.fn() },
}));
vi.mock('@/features/builder/api/proposals', () => ({
  proposalApi: {},
  useSyncState: () => ({ data: undefined }),
}));

import { Sidebar } from '@/components/layout/sidebar';
import { useBuilderStore } from '@/features/builder/store/builder-store';
import { useWhatsNewStore } from '../store/whats-new-store';
import { WhatsNew } from './whats-new';

configure({ asyncUtilTimeout: 5000 });

const OLD_RACK = '11111111-1111-4111-8111-111111111111';
const UPS = 'aaaaaaaa-0000-4000-8000-000000000001';
const ROUTER = 'aaaaaaaa-0000-4000-8000-000000000002';
const VPS = 'aaaaaaaa-0000-4000-8000-000000000003';
const NAS = 'aaaaaaaa-0000-4000-8000-000000000004';
const OPEN_BUILD = '22222222-2222-4222-8222-222222222222';

function notice(overrides: Partial<WhatsNewNotice> = {}): WhatsNewNotice {
  return {
    id: 'notice-1',
    kind: 'power_cables',
    version: '1.4.0',
    build_id: OLD_RACK,
    build_name: 'Old rack',
    created_at: '2026-10-15T08:00:00Z',
    seen_at: null,
    details: {
      converted: [{ source_id: UPS, source: 'UPS', target_id: ROUTER, target: 'Router' }],
      dropped: [
        { source_id: UPS, source: 'UPS', target_id: VPS, target: 'VPS', reason: 'no_power_input' },
        { source_id: UPS, source: 'UPS', target_id: NAS, target: 'NAS', reason: 'no_socket' },
      ],
    },
    ...overrides,
  };
}

let server: WhatsNewState;

function Where() {
  const location = useLocation();
  return <output aria-label="location">{location.pathname}</output>;
}

function renderShell({ sidebar = false } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/hardware']}>
        <Routes>
          <Route
            path="*"
            element={
              <>
                {sidebar && <Sidebar />}
                <WhatsNew />
                <Where />
              </>
            }
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const where = () => screen.getByLabelText('location');
const posts = () => mocks.post.mock.calls.filter(([path]) => path === '/api/whats-new/seen');

/** One turn of the event loop, so that answers already given land. */
const tick = () => act(() => new Promise<void>(resolve => setTimeout(resolve, 0)));

/** Lets the account's state arrive and the dialog decide whether to open. */
async function settled() {
  await waitFor(() => expect(mocks.get).toHaveBeenCalledWith('/api/whats-new'));
  await tick();
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mocks.user = { id: 'user-1', name: 'Ada Lovelace', email: 'ada@example.com', is_admin: false };
  server = { seen: '1.3.0', notices: [] };
  mocks.get.mockImplementation((path: string) =>
    Promise.resolve(path === '/api/whats-new' ? server : []),
  );
  // What the server does: the version is recorded and every notice marked seen.
  mocks.post.mockImplementation((path: string, body: { version: string }) => {
    if (path === '/api/whats-new/seen') {
      server = {
        seen: body.version,
        notices: server.notices.map(item => ({ ...item, seen_at: '2026-10-15T09:00:00Z' })),
      };
    }
    return Promise.resolve({});
  });
  useWhatsNewStore.setState({ openedBy: null });
  useBuilderStore.getState().clearCurrentBuild();
});

describe('opening by itself', () => {
  it('opens on a release the account has not seen, and steps through its entries', async () => {
    const user = userEvent.setup();
    renderShell();

    const dialog = await screen.findByRole('dialog', { name: "What's new in 1.4" });
    expect(
      within(dialog).getByText('Power, ports and the hardware you own are now part of a plan.'),
    ).toBeInTheDocument();
    // Nothing changed in the account's projects, so the notes come first.
    expect(within(dialog).queryByRole('button', { name: /In your projects/ })).toBeNull();
    const rail = within(dialog).getByRole('group', { name: 'Entries' });
    expect(within(rail).getByRole('button', { name: 'Power cables' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(within(dialog).getByRole('button', { name: 'Previous' })).toBeDisabled();

    await user.click(within(dialog).getByRole('button', { name: 'Next' }));
    expect(within(dialog).getByRole('heading', { name: 'Port settings and VLANs' })).toBeInTheDocument();
    expect(within(rail).getByRole('button', { name: 'Power cables' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );

    // The rail answers the arrow keys, and the entry follows the focus.
    await user.click(within(rail).getByRole('button', { name: 'Inventory' }));
    await user.keyboard('{ArrowDown}');
    const proxmox = within(rail).getByRole('button', { name: 'Proxmox import' });
    expect(proxmox).toHaveFocus();
    expect(proxmox).toHaveAttribute('aria-current', 'true');
    expect(within(dialog).getByText('pvesh get /cluster/resources').tagName).toBe('CODE');
    await user.keyboard('{End}');
    expect(within(dialog).getByRole('heading', { name: 'A quieter canvas' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Next' })).toBeDisabled();
  });

  it('opens on a change in a project the account was not shown, with that change first', async () => {
    server = {
      seen: '1.4.0',
      notices: [notice(), notice({ id: 'notice-0', build_name: 'Seen before', seen_at: '2026-10-14T08:00:00Z' })],
    };
    renderShell();

    const dialog = await screen.findByRole('dialog', { name: "What's new in 1.4" });
    expect(within(dialog).getByRole('button', { name: /In your projects/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(within(dialog).getByRole('region', { name: 'Old rack' })).toBeInTheDocument();
    // Only what was not shown before.
    expect(within(dialog).queryByRole('region', { name: 'Seen before' })).toBeNull();
  });

  it('stays closed when everything was seen, and asks nothing for a visitor', async () => {
    server = { seen: '1.4.0', notices: [notice({ seen_at: '2026-10-14T08:00:00Z' })] };
    const { unmount } = renderShell();
    await settled();
    expect(screen.queryByRole('dialog')).toBeNull();
    unmount();

    mocks.user = null;
    mocks.get.mockClear();
    renderShell();
    await tick();
    expect(mocks.get).not.toHaveBeenCalledWith('/api/whats-new');
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('closing', () => {
  it('records the running version once, however the dialog is closed', async () => {
    const user = userEvent.setup();
    renderShell();

    const dialog = await screen.findByRole('dialog', { name: "What's new in 1.4" });
    await user.click(within(dialog).getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(posts()).toEqual([['/api/whats-new/seen', { version: '1.4.0' }]]);

    // Opened again by hand, it shows nothing new, so closing it records nothing.
    act(() => useWhatsNewStore.getState().open('hand'));
    await screen.findByRole('dialog', { name: "What's new in 1.4" });
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(posts()).toHaveLength(1);
  });
});

describe('in your projects', () => {
  it('says what became of each old cable, and Show opens that build on its devices', async () => {
    const user = userEvent.setup();
    server = {
      seen: '1.4.0',
      notices: [
        notice(),
        notice({ id: 'notice-2', build_id: null, build_name: 'Gone lab' }),
      ],
    };
    renderShell();

    const dialog = await screen.findByRole('dialog', { name: "What's new in 1.4" });
    const rack = within(dialog).getByRole('region', { name: 'Old rack' });
    expect(within(rack).getAllByRole('listitem').map(item => item.textContent)).toEqual([
      'UPS to Router: now a power cable',
      'UPS to VPS: removed, VPS takes no power cable',
      'UPS to NAS: removed, UPS has no free socket',
    ]);
    // A deleted project is named, and there is nothing to open.
    const gone = within(dialog).getByRole('region', { name: 'Gone lab' });
    expect(gone).toHaveTextContent('Gone lab (project deleted)');
    expect(within(gone).queryByRole('button')).toBeNull();

    await user.click(within(rack).getByRole('button', { name: 'Show Old rack' }));

    expect(where()).toHaveTextContent(`/builder/${OLD_RACK}`);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    // The canvas brings the two ends of the converted cable into view once that build is drawn.
    expect(useBuilderStore.getState().pendingFocus).toEqual({ buildId: OLD_RACK, ids: [UPS, ROUTER] });
    await waitFor(() => expect(posts()).toHaveLength(1));
  });
});

describe('show me', () => {
  it('opens the canvas of the open project on the devices an entry is about', async () => {
    const user = userEvent.setup();
    useBuilderStore.setState({ currentBuildId: OPEN_BUILD, projectName: 'Basement Lab' });
    renderShell();

    const dialog = await screen.findByRole('dialog', { name: "What's new in 1.4" });
    await user.click(within(dialog).getByRole('button', { name: 'Show me' }));

    expect(where()).toHaveTextContent(`/builder/${OPEN_BUILD}`);
    expect(useBuilderStore.getState().pendingFocus).toEqual({
      buildId: OPEN_BUILD,
      types: ['ups', 'pdu', 'power_outlet'],
      select: true,
    });
  });

  it('offers the canvas only when a project is open, and a page always', async () => {
    const user = userEvent.setup();
    renderShell();

    const dialog = await screen.findByRole('dialog', { name: "What's new in 1.4" });
    expect(within(dialog).queryByRole('button', { name: 'Show me' })).toBeNull();

    await user.click(within(dialog).getByRole('button', { name: 'Service Library' }));
    await user.click(within(dialog).getByRole('button', { name: 'Show me' }));
    expect(where()).toHaveTextContent('/services');
  });
});

describe('the account menu', () => {
  it('opens the notes of this version with every change in the projects', async () => {
    const user = userEvent.setup();
    server = { seen: '1.4.0', notices: [notice({ seen_at: '2026-10-14T08:00:00Z' })] };
    renderShell({ sidebar: true });
    await settled();
    expect(screen.queryByRole('dialog')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Account: Ada Lovelace' }));
    await user.click(await screen.findByRole('menuitem', { name: "What's new" }));

    const dialog = await screen.findByRole('dialog', { name: "What's new in 1.4" });
    // By hand, the changes made before are listed too.
    expect(within(dialog).getByRole('region', { name: 'Old rack' })).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(posts()).toEqual([]);
  });
});
