import { beforeEach, describe, expect, it, vi } from 'vitest';
import { configure, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

const mocks = vi.hoisted(() => ({
  user: { id: 'user-1', name: 'Ada', email: 'ada@example.com' } as Record<string, unknown> | null,
  get: vi.fn(),
  post: vi.fn(),
  del: vi.fn(),
  patch: vi.fn(),
}));

vi.mock('../../admin/hooks/use-auth', () => ({ useAuth: () => ({ user: mocks.user }) }));
vi.mock('../../../lib/api', () => ({
  api: { get: mocks.get, post: mocks.post, del: mocks.del, patch: mocks.patch },
  ApiError: class extends Error {},
}));
vi.mock('../../builder/api/builds', () => ({ buildApi: {} }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import type { Service } from '../../../types';
import { useBuilderStore } from '../../builder/store/builder-store';
import ServiceCatalogPage from './service-catalog-page';

// With every test file running at once on a loaded machine, a query that waits
// for a fetch to land needs more than the default second (see pitfall 31).
configure({ asyncUtilTimeout: 5000 });

const service = (overrides: Partial<Service> & Pick<Service, 'id' | 'name'>): Service => ({
  description: `${overrides.name} description`,
  category: 'media',
  icon: '',
  official_website: '',
  docker_support: true,
  is_active: true,
  visibility: 'public',
  requirements: {
    id: '',
    service_id: overrides.id,
    min_ram_mb: 512,
    recommended_ram_mb: 1024,
    min_cpu_cores: 1,
    recommended_cpu_cores: 2,
    min_storage_gb: 5,
    recommended_storage_gb: 10,
  },
  created_at: '',
  ...overrides,
});

const CATALOG: Service[] = [
  service({
    id: 'jellyfin',
    name: 'Jellyfin',
    docs_url: 'https://jellyfin.org/docs/',
    tags: '["media", "streaming"]',
  }),
  service({
    id: 'pihole',
    name: 'Pi-hole',
    category: 'networking',
    requirements: {
      id: '',
      service_id: 'pihole',
      min_ram_mb: 128,
      recommended_ram_mb: 256,
      min_cpu_cores: 0.5,
      recommended_cpu_cores: 1,
      min_storage_gb: 2,
      recommended_storage_gb: 4,
    },
  }),
  service({
    id: 'valheim',
    name: 'Valheim Server',
    category: 'gaming',
    requirements: {
      id: '',
      service_id: 'valheim',
      min_ram_mb: 4096,
      recommended_ram_mb: 8192,
      min_cpu_cores: 2,
      recommended_cpu_cores: 4,
      min_storage_gb: 5,
      recommended_storage_gb: 10,
    },
    game: {
      slug: 'valheim',
      service_id: 'valheim',
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
        { name: 'game', port: 2456, proto: 'udp', forward: true },
        { name: 'query', port: 2457, proto: 'udp', forward: false },
      ],
      image: '',
      notes: 'World saves live in the config volume.',
    },
  }),
  service({
    id: 'mine',
    name: 'Family Wiki',
    category: 'management',
    visibility: 'private',
    user_id: 'user-1',
  }),
];

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ServiceCatalogPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const names = () =>
  screen.getAllByRole('rowheader').map(header => within(header).getByRole('button').textContent);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.user = { id: 'user-1', name: 'Ada', email: 'ada@example.com' };
  mocks.get.mockResolvedValue({
    data: [{ id: 'sel-1', service_id: 'pihole', service: CATALOG[1], created_at: '' }],
  });
  mocks.post.mockResolvedValue({});
  mocks.del.mockResolvedValue({});
  useBuilderStore.setState({
    availableServices: CATALOG,
    // The catalog is in the store already; the page asks again and gets the same.
    fetchServices: vi.fn().mockResolvedValue(undefined),
  });
});

describe('Service Library', () => {
  it('lists the services as rows with the least each one needs', async () => {
    renderPage();

    expect(await screen.findByText('4 services')).toBeInTheDocument();
    expect(names()).toEqual(['Family Wiki', 'Jellyfin', 'Pi-hole', 'Valheim Server']);

    const row = screen.getByRole('row', { name: /Pi-hole/ });
    expect(within(row).getByText('128 MB')).toBeInTheDocument();
    expect(within(row).getByText('0.5')).toBeInTheDocument();
    expect(within(row).getByText('2 GB')).toBeInTheDocument();
    expect(within(row).getByText('Networking')).toBeInTheDocument();
    // A service of one's own says so.
    expect(
      within(screen.getByRole('row', { name: /Family Wiki/ })).getByText('Private'),
    ).toBeInTheDocument();
  });

  it('sorts by a column, and the other way on a second click', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('4 services');

    await user.click(screen.getByRole('button', { name: 'RAM' }));
    expect(names()).toEqual(['Pi-hole', 'Family Wiki', 'Jellyfin', 'Valheim Server']);
    expect(screen.getByRole('columnheader', { name: 'RAM' })).toHaveAttribute(
      'aria-sort',
      'ascending',
    );

    await user.click(screen.getByRole('button', { name: 'RAM' }));
    expect(names()[0]).toBe('Valheim Server');
    expect(screen.getByRole('columnheader', { name: 'RAM' })).toHaveAttribute(
      'aria-sort',
      'descending',
    );
  });

  it('narrows by category and by search, and says what is shown', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('4 services');
    const filters = screen.getByRole('navigation', { name: 'Filter services' });

    await user.click(within(filters).getByRole('button', { name: /^Gaming/ }));
    expect(names()).toEqual(['Valheim Server']);
    expect(screen.getByText('1 service in Gaming')).toBeInTheDocument();
    // Every row is of that category: the column would only repeat it.
    expect(screen.queryByRole('columnheader', { name: 'Category' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Show all' }));
    await user.type(screen.getByRole('searchbox', { name: 'Search services' }), 'wiki');
    expect(names()).toEqual(['Family Wiki']);

    await user.clear(screen.getByRole('searchbox', { name: 'Search services' }));
    await user.click(within(filters).getByRole('button', { name: /^My services/ }));
    expect(names()).toEqual(['Family Wiki']);
    await user.click(within(filters).getByRole('button', { name: /^Favorites/ }));
    expect(names()).toEqual(['Pi-hole']);
  });

  it('opens a row to the rest: recommended figures, ports, notes and links', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('4 services');

    const toggle = within(screen.getByRole('rowheader', { name: /Valheim Server/ })).getByRole(
      'button',
    );
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');

    expect(screen.getByText('8 GB')).toBeInTheDocument();
    expect(screen.getByText('5 planned, up to 10')).toBeInTheDocument();
    expect(screen.getByText('2456/udp')).toBeInTheDocument();
    expect(screen.getByText('World saves live in the config volume.')).toBeInTheDocument();

    await user.click(
      within(screen.getByRole('rowheader', { name: /Jellyfin/ })).getByRole('button'),
    );
    // One row is open at a time.
    expect(screen.queryByText('2456/udp')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Documentation' })).toHaveAttribute(
      'href',
      'https://jellyfin.org/docs/',
    );
    expect(screen.getByText('media, streaming')).toBeInTheDocument();
  });

  it('marks and unmarks a favorite', async () => {
    const user = userEvent.setup();
    renderPage();

    const marked = await screen.findByRole('button', { name: 'Remove Pi-hole from favorites' });
    expect(marked).toHaveAttribute('aria-pressed', 'true');
    await user.click(marked);
    expect(mocks.del).toHaveBeenCalledWith('/api/selections/sel-1');

    await user.click(screen.getByRole('button', { name: 'Add Jellyfin to favorites' }));
    expect(mocks.post).toHaveBeenCalledWith('/api/selections', { service_id: 'jellyfin' });
  });

  it('shows a visitor the library without what needs an account', async () => {
    mocks.user = null;
    renderPage();

    expect(await screen.findByText('4 services')).toBeInTheDocument();
    expect(mocks.get).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Add a service' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /favorites$/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^My services/ })).not.toBeInTheDocument();
  });

  it('says so when nothing matches, with a way back', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('4 services');

    await user.type(screen.getByRole('searchbox', { name: 'Search services' }), 'zzz');
    expect(screen.getByRole('heading', { name: 'No service matches' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show all services' }));
    expect(names()).toHaveLength(4);
  });
});
