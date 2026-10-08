import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { configure, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

const apiMock = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), del: vi.fn() }));

vi.mock('@/lib/api', () => ({ api: apiMock, ApiError: class ApiError extends Error {} }));
vi.mock('@/features/builder/api/builds', () => ({
  buildApi: { list: vi.fn().mockResolvedValue([]) },
}));
vi.mock('@/features/builder/api/proposals', () => ({ proposalApi: {} }));
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

import { DAC, M75Q, NVME, RAM_KIT, SG108, makeItem } from '../testing/items';
import InventoryPage from './inventory-page';

configure({ asyncUtilTimeout: 5000 });

// As the server lists them: the owner never marked these two, and they read as
// in use because a host runs on the machine and a project plans both modules.
const DEPLOYED = {
  ...M75Q,
  state: 'in_use' as const,
  location: 'rack' as const,
  integration_id: 'int-1',
  integration_ref: 'pve01',
  placements: [
    {
      build_id: 'build-1',
      build_name: 'Main Homelab',
      node_id: 'n1',
      node_name: 'proxmox-01',
      component: false,
      quantity: 1,
    },
    {
      build_id: 'build-2',
      build_name: 'Future Upgrade',
      node_id: 'n2',
      node_name: 'truenas',
      component: false,
      quantity: 1,
    },
  ],
  deployment: {
    integration_id: 'int-1',
    integration_name: 'Homelab',
    kind: 'proxmox',
    ref: 'pve01',
    online: true,
    version: '8.4.1',
    guests: 6,
    synced_at: '2026-10-07T10:00:00Z',
  },
};
const PLACED_RAM = {
  ...RAM_KIT,
  state: 'in_use' as const,
  placements: [
    {
      build_id: 'build-2',
      build_name: 'Future Upgrade',
      node_id: 'n3',
      node_name: 'pve02',
      component: true,
      quantity: 2,
    },
  ],
};
const SOLD = makeItem({
  id: 'old',
  name: 'Old NAS',
  type: 'nas',
  status: 'sold',
  location: 'storage',
});

const INTEGRATION = {
  id: 'int-1',
  kind: 'proxmox',
  name: 'Homelab',
  source: 'api',
  base_url: 'https://192.168.10.11:8006',
  token_id: 'hlbuilder@pve!hlbuilder',
  has_secret: true,
  secret_usable: true,
  tls_fingerprint: 'AA:BB',
  synced_at: new Date(Date.now() - 3_600_000).toISOString(),
  last_error: '',
  summary: {
    version: '8.4.1',
    cluster: 'homelab',
    nodes: 3,
    nodes_online: 3,
    vms: 11,
    containers: 7,
    templates: 0,
  },
  notes: [],
  created_at: '2026-10-01T10:00:00Z',
};
const AVAILABILITY = { enabled: true, live: true, allow_private: true, limit: 5 };

function respond(
  items: unknown[],
  integrations: unknown[] = [INTEGRATION],
  availability = AVAILABILITY,
) {
  apiMock.get.mockImplementation((path: string) =>
    Promise.resolve(
      path === '/api/inventory' ? { items, limit: 500 } : { integrations, availability },
    ),
  );
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  return render(<InventoryPage />, { wrapper });
}

const rowOf = (name: string) =>
  screen.getByRole('rowheader', { name: new RegExp(name) }).closest('tr')!;

beforeEach(() => {
  vi.clearAllMocks();
  respond([DEPLOYED, SG108, PLACED_RAM, NVME, DAC, SOLD]);
});

describe('InventoryPage', () => {
  it('lists everything under the place it is kept in, with its figures, state and where it is planned', async () => {
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: 'Inventory' })).toBeInTheDocument();
    await screen.findByText('6 items');

    // The groups, in the order one walks the room.
    const groups = screen
      .getAllByRole('columnheader')
      .filter(header => header.getAttribute('scope') === 'colgroup');
    expect(groups.map(header => header.textContent)).toEqual([
      'Rack 1',
      'Shelf 1',
      'Drawer 3',
      'Storage 1',
    ]);

    const machine = rowOf('Lenovo M75q #1');
    expect(
      within(machine).getByText('Lenovo ThinkCentre M75q (Ryzen 5 PRO 4650GE)'),
    ).toBeInTheDocument();
    expect(within(machine).getByText('Mini PC')).toBeInTheDocument();
    expect(within(machine).getByText('32 GB / 240 GB')).toBeInTheDocument();
    expect(within(machine).getByText('In use')).toBeInTheDocument();
    // What its integration reports about it.
    expect(machine).toHaveTextContent('Runs as pve01, online, 6 guests');
    // The same machine is planned in two projects, under another name in each.
    expect(within(machine).getByRole('link', { name: 'Main Homelab' })).toHaveAttribute(
      'href',
      '/builder/build-1',
    );
    expect(machine).toHaveTextContent('Main Homelab as proxmox-01');
    expect(machine).toHaveTextContent('Future Upgrade as truenas');

    const memory = rowOf('16 GB DDR4 SODIMM');
    expect(memory).toHaveTextContent('2× 16 GB DDR4 SODIMM');
    expect(memory).toHaveTextContent('Future Upgrade in pve02, 2 of them');
    expect(rowOf('TP-Link SG108')).toHaveTextContent('Not planned');
    expect(rowOf('DAC 1 m')).toHaveTextContent('DAC cable');
  });

  it('narrows by state and by a word, and groups by kind on request', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('6 items');

    const filters = screen.getByRole('navigation', { name: 'Filter by state' });
    expect(within(filters).getByRole('button', { name: /Everything/ })).toHaveTextContent('6');
    expect(within(filters).getByRole('button', { name: /Available/ })).toHaveTextContent('3');
    expect(within(filters).getByRole('button', { name: /In use/ })).toHaveTextContent('2');
    await user.click(within(filters).getByRole('button', { name: /Sold/ }));
    expect(screen.getByText('1 item, sold')).toBeInTheDocument();
    expect(screen.queryByRole('rowheader', { name: /Lenovo M75q/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show all' }));

    await user.type(screen.getByRole('searchbox', { name: 'Search your inventory' }), 'nvme');
    expect(screen.getByText('1 item matching “nvme”')).toBeInTheDocument();
    await user.clear(screen.getByRole('searchbox', { name: 'Search your inventory' }));

    await user.click(screen.getByRole('button', { name: 'Kind' }));
    const groups = screen
      .getAllByRole('columnheader')
      .filter(header => header.getAttribute('scope') === 'colgroup');
    expect(groups.map(header => header.textContent)).toEqual([
      'Devices 3',
      'Components 2',
      'Accessories 1',
    ]);

    await user.type(
      screen.getByRole('searchbox', { name: 'Search your inventory' }),
      'nothing like it',
    );
    expect(screen.getByRole('heading', { name: 'No item matches' })).toBeInTheDocument();
  });

  it('says what the list is for while it is empty, and adds the first item', async () => {
    const user = userEvent.setup();
    respond([], []);
    apiMock.post.mockResolvedValue({ ...RAM_KIT, placements: undefined });
    renderPage();

    expect(await screen.findByRole('heading', { name: 'Nothing listed yet' })).toBeInTheDocument();
    await user.click(screen.getAllByRole('button', { name: 'Add an item' })[0]);
    const dialog = await screen.findByRole('dialog', { name: 'Add to your inventory' });

    // A component: how many, and the figures a module has.
    await user.click(within(dialog).getByRole('button', { name: 'Component' }));
    expect(within(dialog).getByLabelText('Type')).toHaveValue('ram');
    expect(within(dialog).queryByLabelText('Processor')).not.toBeInTheDocument();
    await user.type(within(dialog).getByLabelText('Name'), '16 GB DDR4 SODIMM');
    await user.type(within(dialog).getByLabelText('Memory per module, GB'), '16');
    await user.type(within(dialog).getByLabelText('Memory type'), 'DDR4 SODIMM');
    await user.clear(within(dialog).getByLabelText('How many'));
    await user.type(within(dialog).getByLabelText('How many'), '2');
    await user.selectOptions(within(dialog).getByLabelText('Kept in'), 'drawer');
    await user.click(within(dialog).getByRole('button', { name: 'Add item' }));

    await waitFor(() => expect(apiMock.post).toHaveBeenCalledTimes(1));
    expect(apiMock.post).toHaveBeenCalledWith(
      '/api/inventory',
      expect.objectContaining({
        kind: 'component',
        type: 'ram',
        name: '16 GB DDR4 SODIMM',
        quantity: 2,
        location: 'drawer',
        status: 'available',
        specs: expect.objectContaining({ ram_gb: 16, ram_type: 'DDR4 SODIMM' }),
        mac_addresses: [],
      }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('changes an item, keeps a device at one, and asks before removing it', async () => {
    const user = userEvent.setup();
    apiMock.put.mockResolvedValue(DEPLOYED);
    apiMock.del.mockResolvedValue({});
    renderPage();
    await screen.findByText('6 items');

    await user.click(screen.getByRole('button', { name: 'Edit Lenovo M75q #1' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit item' });
    expect(within(dialog).getByLabelText('Processor')).toHaveValue('Ryzen 5 PRO 4650GE');
    expect(within(dialog).getByLabelText('Threads')).toHaveValue('12');
    expect(within(dialog).getByLabelText('MAC addresses')).toHaveValue('AA:BB:CC:DD:EE:FF');
    // A machine is one item; there is nothing to count.
    expect(within(dialog).queryByLabelText('How many')).not.toBeInTheDocument();
    // The form holds what the owner set, and says why the list reads otherwise.
    expect(within(dialog).getByLabelText('State')).toHaveValue('available');
    expect(dialog).toHaveTextContent('It is listed as in use while it runs as pve01.');

    await user.selectOptions(within(dialog).getByLabelText('State'), 'broken');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(apiMock.put).toHaveBeenCalledTimes(1));
    expect(apiMock.put).toHaveBeenCalledWith(
      '/api/inventory/m75q',
      expect.objectContaining({
        status: 'broken',
        quantity: 1,
        specs: expect.objectContaining({ cpu_threads: 12, ram_gb: 32 }),
      }),
    );

    await user.click(await screen.findByRole('button', { name: 'Edit Lenovo M75q #1' }));
    await user.click(
      within(await screen.findByRole('dialog', { name: 'Edit item' })).getByRole('button', {
        name: 'Remove from inventory',
      }),
    );
    const confirm = await screen.findByRole('dialog', { name: 'Remove Lenovo M75q #1?' });
    expect(confirm).toHaveTextContent('It is planned in 2 places');
    await user.click(within(confirm).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(apiMock.del).toHaveBeenCalledWith('/api/inventory/m75q'));
  });

  it('refuses an item without a name before asking the server', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('6 items');
    await user.click(screen.getAllByRole('button', { name: 'Add an item' })[0]);
    const dialog = await screen.findByRole('dialog', { name: 'Add to your inventory' });
    await user.click(within(dialog).getByRole('button', { name: 'Add item' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Give the item a name');
    expect(apiMock.post).not.toHaveBeenCalled();
  });

  it('lists the integrations that say what runs on the hardware', async () => {
    renderPage();
    const section = (await screen.findByRole('heading', { name: 'Integrations' })).closest(
      'section',
    )!;
    const row = within(section)
      .getByRole('rowheader', { name: /Homelab/ })
      .closest('tr')!;
    expect(row).toHaveTextContent(
      'Proxmox VE 8.4.1, cluster homelab, 3 nodes, 11 VMs, 7 containers',
    );
    expect(row).toHaveTextContent('https://192.168.10.11:8006');
    expect(within(section).getByRole('button', { name: 'Connect Proxmox' })).toBeInTheDocument();
    // Nothing of the secret is ever on the page.
    expect(document.body.textContent).not.toMatch(/secret/i);
  });

  it('leaves the integrations out where the instance has them switched off', async () => {
    respond([SG108], [], { ...AVAILABILITY, enabled: false });
    renderPage();
    await screen.findByText('1 item');
    expect(screen.queryByRole('heading', { name: 'Integrations' })).not.toBeInTheDocument();
  });
});
