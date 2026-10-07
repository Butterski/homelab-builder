import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

const mocks = vi.hoisted(() => ({ startAutosave: vi.fn(() => () => undefined) }));

// The page saves ticks through the builder's autosave; here only the store is looked at.
vi.mock('../../builder/store/autosave', () => ({ startAutosave: mocks.startAutosave }));
vi.mock('../../builder/api/builds', () => ({ buildApi: {} }));
vi.mock('sonner', () => ({ toast: { info: vi.fn(), error: vi.fn(), success: vi.fn() } }));

import type { Edge } from '@xyflow/react';
import type { HardwareNode, Service } from '../../../types';
import { useBuilderStore } from '../../builder/store/builder-store';
import ChecklistPage from './checklist-page';

const BUILD = '11111111-1111-4111-8111-111111111111';

const hardware: HardwareNode[] = [
  {
    id: 'router',
    type: 'router',
    name: 'Lab Router',
    ip: '192.168.10.1',
    x: 0,
    y: 0,
    details: { dhcp_pool: { start: '192.168.10.50', end: '192.168.10.135', size: 86, clients: 0 } },
  },
  { id: 'switch', type: 'switch', name: 'Core Switch', ip: '192.168.10.10', x: 0, y: 0 },
  {
    id: 'mini',
    type: 'minipc',
    name: 'Mini PC',
    ip: '192.168.10.186',
    x: 0,
    y: 0,
    vms: [
      { id: 'vm-1', name: 'Jellyfin', type: 'container', status: 'running', ip: '192.168.10.187' },
    ],
  },
];

const edges = [
  {
    id: 'e1',
    source: 'router',
    target: 'switch',
    sourceHandle: 'eth1',
    data: { connection_type: 'ethernet', speed: '1 GbE' },
  },
  {
    id: 'e2',
    source: 'switch',
    target: 'mini',
    sourceHandle: 'eth1',
    data: { connection_type: 'ethernet', speed: '2.5 GbE' },
  },
] as Edge[];

function openBuild(settings: Record<string, unknown> = {}) {
  useBuilderStore.setState({
    currentBuildId: BUILD,
    projectName: 'Basement Lab',
    buildKind: 'homelab',
    buildStatus: 'ready',
    hardwareNodes: hardware,
    edges,
    gamingPlan: {},
    buildSettings: settings,
    // Loaded already, so the page has no reason to ask the server for the catalog.
    availableServices: [{ id: 'svc', name: 'Jellyfin' } as Service],
  });
}

const renderPage = () =>
  render(
    <MemoryRouter>
      <ChecklistPage />
    </MemoryRouter>,
  );

beforeEach(() => {
  vi.clearAllMocks();
  useBuilderStore.getState().clearCurrentBuild();
  useBuilderStore.setState({ hardwareNodes: [], edges: [], buildSettings: {} });
});

describe('Setup Guide', () => {
  it('is written from the open project: its cables, its addresses, its hosts', () => {
    openBuild();
    renderPage();

    expect(screen.getByRole('heading', { level: 1, name: 'Setup Guide' })).toBeInTheDocument();
    expect(screen.getByText('Basement Lab')).toBeInTheDocument();

    const cables = screen.getByRole('table', { name: 'Which cable goes where' });
    expect(
      within(cables).getByRole('row', { name: /Lab Router eth1 Core Switch 1 GbE/ }),
    ).toBeInTheDocument();
    expect(
      within(cables).getByRole('row', { name: /Core Switch eth1 Mini PC 2\.5 GbE/ }),
    ).toBeInTheDocument();

    const addresses = screen.getByRole('table', { name: 'The address of every device' });
    expect(
      within(addresses).getByRole('row', { name: /Mini PC Mini PC 192\.168\.10\.186/ }),
    ).toBeInTheDocument();

    expect(screen.getByRole('heading', { level: 2, name: /Mini PC/ })).toBeInTheDocument();
    expect(screen.getByText('ssh-copy-id username@192.168.10.186')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open the Config Generator' })).toHaveAttribute(
      'href',
      '/generate',
    );
    expect(screen.getByRole('link', { name: 'Open the canvas' })).toHaveAttribute(
      'href',
      `/builder/${BUILD}`,
    );
  });

  it('keeps what is ticked off in the settings of the build, where it is saved with it', async () => {
    const user = userEvent.setup();
    openBuild({ planner: { name: 'kept' } });
    renderPage();

    const progress = screen.getByRole('progressbar', { name: 'Setup progress' });
    expect(progress).toHaveAttribute('aria-valuenow', '0');

    await user.click(
      screen.getByRole('checkbox', { name: 'Lab Router eth1 is connected to Core Switch' }),
    );
    await user.click(screen.getByRole('checkbox', { name: /Set the LAN address of Lab Router/ }));

    expect(useBuilderStore.getState().buildSettings).toEqual({
      planner: { name: 'kept' },
      setupDone: ['cable:router~switch', 'router:router:lan'],
    });
    expect(progress).toHaveAttribute('aria-valuenow', '2');
    expect(
      screen.getByRole('checkbox', { name: 'Lab Router eth1 is connected to Core Switch' }),
    ).toBeChecked();
    // Saving is the autosave's job, started while the guide is open.
    expect(mocks.startAutosave).toHaveBeenCalledTimes(1);

    await user.click(
      screen.getByRole('checkbox', { name: 'Lab Router eth1 is connected to Core Switch' }),
    );
    expect(useBuilderStore.getState().buildSettings.setupDone).toEqual(['router:router:lan']);
  });

  it('starts from what was ticked before, and can start over', async () => {
    const user = userEvent.setup();
    // One tick is for a step this build no longer has: it is not counted, and not kept.
    openBuild({ setupDone: ['cable:router~switch', 'host:gone:os'] });
    renderPage();

    expect(screen.getByRole('progressbar', { name: 'Setup progress' })).toHaveAttribute(
      'aria-valuenow',
      '1',
    );
    expect(
      screen.getByRole('checkbox', { name: 'Lab Router eth1 is connected to Core Switch' }),
    ).toBeChecked();

    await user.click(screen.getByRole('button', { name: 'Untick everything' }));
    expect(useBuilderStore.getState().buildSettings.setupDone).toEqual([]);
    expect(screen.queryByRole('button', { name: 'Untick everything' })).not.toBeInTheDocument();
  });

  it('leaves an untouched build untouched', () => {
    openBuild();
    const before = useBuilderStore.getState().buildSettings;
    renderPage();

    // Opening the guide is not an edit: the settings object is the one that was loaded.
    expect(useBuilderStore.getState().buildSettings).toBe(before);
  });

  it('says where to go when no project is open', () => {
    renderPage();

    expect(screen.getByText(/written for one project/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to Projects' })).toHaveAttribute('href', '/');
  });

  it('sends an empty project to the canvas', () => {
    useBuilderStore.setState({ currentBuildId: BUILD, projectName: 'Empty', buildStatus: 'ready' });
    renderPage();

    expect(screen.getByRole('link', { name: 'Open the canvas' })).toHaveAttribute(
      'href',
      `/builder/${BUILD}`,
    );
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });
});
