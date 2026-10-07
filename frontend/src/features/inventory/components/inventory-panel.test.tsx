import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, configure, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

const apiMock = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), del: vi.fn() }));
const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));

vi.mock('@/lib/api', () => ({ api: apiMock, ApiError: class ApiError extends Error {} }));
vi.mock('@/features/builder/api/builds', () => ({ buildApi: {} }));
vi.mock('@/features/builder/api/proposals', () => ({ proposalApi: {} }));
vi.mock('@/services/api', () => ({
  api: { getServices: vi.fn().mockResolvedValue({ data: [] }) },
}));
vi.mock('sonner', () => ({ toast: toastMock }));

import { useBuilderStore } from '@/features/builder/store/builder-store';
import { DAC, M75Q, NVME, RAM_KIT, SG108, makeItem } from '../testing/items';
import { InventoryPanel } from './inventory-panel';

configure({ asyncUtilTimeout: 5000 });

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  return render(<InventoryPanel />, { wrapper });
}

const store = () => useBuilderStore.getState();
const SOLD = makeItem({ id: 'old', name: 'Old NAS', type: 'nas', status: 'sold' });

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  store().clearCurrentBuild();
  useBuilderStore.setState({ currentBuildId: 'build-1', buildStatus: 'ready' });
  apiMock.get.mockResolvedValue({ items: [M75Q, SG108, RAM_KIT, NVME, DAC, SOLD], limit: 500 });
});

describe('InventoryPanel', () => {
  it('lists what can be planned with, and counts what is not on this canvas', async () => {
    renderPanel();
    const list = await screen.findByRole('list');

    const names = within(list)
      .getAllByRole('listitem')
      .map(row => row.querySelector('.font-semibold')?.textContent);
    // Machines first; cables and what is sold are in the full list only.
    expect(names).toEqual([
      'Lenovo M75q #1',
      'TP-Link SG108',
      '2× 16 GB DDR4 SODIMM',
      '2× Samsung 970 EVO',
    ]);
    expect(screen.getByText('4 unused')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'View all inventory (6)' })).toBeInTheDocument();

    const machine = within(list).getByText('Lenovo M75q #1').closest('li')!;
    expect(within(machine).getByText('Ryzen 5 PRO 4650GE')).toBeInTheDocument();
    expect(within(machine).getByText('32 GB / 240 GB')).toBeInTheDocument();
    expect(within(machine).getByText('Available, shelf')).toBeInTheDocument();
  });

  it('says which other project plans a machine, and still offers it here', async () => {
    const elsewhere = {
      ...M75Q,
      state: 'in_use' as const,
      placements: [
        // The copy of this canvas the server holds, and a variant of it.
        {
          build_id: 'build-1',
          build_name: 'Main Homelab',
          node_id: 'gone',
          node_name: 'old',
          component: false,
          quantity: 1,
        },
        {
          build_id: 'build-2',
          build_name: 'Future Upgrade',
          node_id: 'n2',
          node_name: 'pve01',
          component: false,
          quantity: 1,
        },
      ],
    };
    apiMock.get.mockResolvedValue({ items: [elsewhere, SG108], limit: 500 });
    renderPanel();

    const row = (await screen.findByText('Lenovo M75q #1')).closest('button')!;
    expect(within(row).getByText('Planned in Future Upgrade')).toBeInTheDocument();
    // The same machine can be planned in a variant: it is not on this canvas, so it can go on it.
    expect(row).toHaveAttribute('draggable', 'true');
    expect(screen.getByText('2 unused')).toBeInTheDocument();
  });

  it('puts a machine on the canvas with a click, and then says where it is', async () => {
    const user = userEvent.setup();
    renderPanel();
    const row = (await screen.findByText('Lenovo M75q #1')).closest('button')!;
    expect(row).toHaveAttribute('draggable', 'true');

    await user.click(row);
    expect(store().hardwareNodes).toHaveLength(1);
    expect(store().hardwareNodes[0].details?.inventory_item_id).toBe('m75q');
    expect(toastMock.success).toHaveBeenCalledWith('Added Lenovo M75q #1 from your inventory.');

    // One machine is one node: it is shown now, not offered again.
    expect(await screen.findByText('On this canvas as Lenovo M75q #1')).toBeInTheDocument();
    expect(screen.getByText('3 unused')).toBeInTheDocument();
    const placed = screen.getByText('Lenovo M75q #1').closest('button')!;
    expect(placed).toHaveAttribute('draggable', 'false');
    await user.click(placed);
    expect(store().hardwareNodes).toHaveLength(1);
    expect(store().selectedNodeId).toBe(store().hardwareNodes[0].id);
  });

  it('puts memory into the selected machine, and asks for one when none is selected', async () => {
    const user = userEvent.setup();
    renderPanel();
    const memory = (await screen.findByText('2× 16 GB DDR4 SODIMM')).closest('button')!;

    await user.click(memory);
    expect(toastMock.info).toHaveBeenCalledWith(
      'Drag 16 GB DDR4 SODIMM onto a server, PC, mini PC or NAS, or select one first.',
    );

    act(() => {
      store().addHardware({
        id: 'host-1',
        type: 'minipc',
        name: 'pve02',
        x: 0,
        y: 0,
        details: { cpu: 6, ram: 16 },
      });
      store().selectNode('host-1');
    });
    await user.click(memory);
    expect(store().hardwareNodes[0].details?.ram).toBe(32);
    expect(await screen.findByText('In pve02')).toBeInTheDocument();
  });

  it('carries the item on a drag the way the canvas takes it', async () => {
    renderPanel();
    const row = (await screen.findByText('TP-Link SG108')).closest('button')!;
    const data = new Map<string, string>();
    fireEvent.dragStart(row, {
      dataTransfer: {
        setData: (type: string, value: string) => data.set(type, value),
        effectAllowed: '',
      },
    });

    expect(data.get('application/reactflow')).toBe('switch');
    expect(JSON.parse(data.get('application/reactflow-data')!)).toMatchObject({
      type: 'switch',
      name: 'TP-Link SG108',
      details: { inventory_item_id: 'sg108', ports: 8 },
      inventory: { id: 'sg108', kind: 'device', units: 1 },
    });
  });

  it('says what the inventory is for while it is empty, and folds away', async () => {
    const user = userEvent.setup();
    apiMock.get.mockResolvedValue({ items: [], limit: 500 });
    renderPanel();
    expect(await screen.findByText(/List the hardware you own/)).toBeInTheDocument();
    expect(screen.queryByText(/unused/)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'My inventory' }));
    expect(screen.queryByText(/List the hardware you own/)).not.toBeInTheDocument();
    expect(localStorage.getItem('hlb-inventory-panel')).toBe('closed');
  });

  it('opens the form for a new item and for an existing one', async () => {
    const user = userEvent.setup();
    renderPanel();
    await screen.findByText('Lenovo M75q #1');

    await user.click(screen.getByRole('button', { name: 'Add an item to your inventory' }));
    expect(
      await screen.findByRole('dialog', { name: 'Add to your inventory' }),
    ).toBeInTheDocument();
    await user.keyboard('{Escape}');

    await user.click(screen.getByRole('button', { name: 'Edit TP-Link SG108' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit item' });
    expect(within(dialog).getByLabelText('Name')).toHaveValue('TP-Link SG108');
    expect(within(dialog).getByLabelText('Ports')).toHaveValue('8');
  });
});
