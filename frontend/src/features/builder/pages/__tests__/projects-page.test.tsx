// @ts-nocheck
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import ProjectsPage from '../projects-page';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { buildApi } from '../../api/builds';
import { useBuilderStore } from '../../store/builder-store';
import { useAuth } from '../../../admin/hooks/use-auth';
import { toast } from 'sonner';
import { ApiError } from '../../../../lib/api';

// Mock dependencies
vi.mock('../../../admin/hooks/use-auth', () => ({
  useAuth: vi.fn(),
}));

vi.mock('../../api/builds', () => ({
  buildApi: {
    list: vi.fn(),
    create: vi.fn(),
    get: vi.fn(),
    delete: vi.fn().mockResolvedValue(undefined),
    rename: vi.fn(),
    duplicate: vi.fn(),
    updateTopology: vi.fn(),
    calculateNetwork: vi.fn(),
    validateNetwork: vi.fn(),
  },
}));

vi.mock('../../../../components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: any) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: any) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: any) => <div>{children}</div>,
  DropdownMenuItem: ({ children, onClick }: any) => (
    <button
      onClick={e => {
        e.stopPropagation();
        if (onClick) onClick(e);
      }}
    >
      {children}
    </button>
  ),
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  },
}));

vi.mock('../store/builder-store', () => ({
  useBuilderStore: vi.fn(() => ({
    loadBuild: vi.fn(),
  })),
}));

// The page reads the project list through the shared query; every test gets
// a cache of its own.
function page() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={client}>
      <BrowserRouter>
        <ProjectsPage />
      </BrowserRouter>
    </QueryClientProvider>
  );
}

// Mock URL object methods
const mockCreateObjectURL = vi.fn();
const mockRevokeObjectURL = vi.fn();
URL.createObjectURL = mockCreateObjectURL;
URL.revokeObjectURL = mockRevokeObjectURL;

describe('ProjectsPage Export Functionality', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateObjectURL.mockReturnValue('blob:fake-url');

    // Mock authenticated user
    (useAuth as any).mockReturnValue({
      user: { id: '1', email: 'test@example.com' },
    });
  });

  it('uses Guided Planner as the only assisted project-start path', async () => {
    (buildApi.list as any).mockResolvedValue([]);

    render(
      page(),
    );

    const plannerLink = await screen.findByRole('link', { name: /Guided Planner/i });
    expect(plannerLink).toHaveAttribute('href', '/planner');
    expect(screen.queryByText(/Fast Start/i)).not.toBeInTheDocument();
  });

  it('exports a project matching the .homelab.json schema', async () => {
    // Mock a project in the database
    const mockBuild = {
      id: 'build-1',
      user_id: '1',
      name: 'Test Project',
      thumbnail: '',
      nodes: [{ id: 'react-flow-1' }],
      edges: [{ id: 'edge-1' }],
      settings: { boughtItems: [], showBought: false },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const mockBuildList = [{ ...mockBuild }];

    (buildApi.list as any).mockResolvedValue(mockBuildList);
    (buildApi.get as any).mockResolvedValue(mockBuild);

    render(
      page(),
    );

    // Wait for projects to load
    await waitFor(() => {
      expect(screen.getByText('Test Project')).toBeInTheDocument();
    });

    // Click the Export button directly (Dropdown content is mocked to always render)
    const exportBtn = await screen.findByText(/Export/i);
    fireEvent.click(exportBtn);

    // Verify that a Blob was created (using waitFor since handleExport is now async)
    await waitFor(() => {
      expect(mockCreateObjectURL).toHaveBeenCalledTimes(1);
    });

    // Verify the Blob contents
    const blobArg = mockCreateObjectURL.mock.calls[0][0];
    expect(blobArg).toBeInstanceOf(Blob);

    const text = await blobArg.text();
    const payload = JSON.parse(text);

    // Verify schema compliance
    expect(payload).toHaveProperty('version', 1);
    expect(payload).toHaveProperty('name', 'Test Project');
    expect(payload).toHaveProperty('exportedAt');
    expect(payload.nodes).toHaveLength(1);
    expect(payload.edges).toHaveLength(1);
    expect(payload).toHaveProperty('boughtItems');
    expect(payload).toHaveProperty('showBought');
  });

  it('filters invalid imported edges and warns while allowing partial import', async () => {
    (buildApi.list as any).mockResolvedValue([]);
    (buildApi.create as any).mockResolvedValue({
      id: 'new-build',
      name: 'Imported Build',
      revision: 1,
    });
    (buildApi.updateTopology as any).mockResolvedValue({
      build: { id: 'new-build', name: 'Imported Build', revision: 2, nodes: [] },
      validation: { valid: true, errors: [], warnings: [] },
    });

    const { container } = render(
      page(),
    );

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    expect(fileInput).toBeTruthy();

    const readAsTextSpy = vi
      .spyOn(FileReader.prototype, 'readAsText')
      .mockImplementation(function () {
        const payload = JSON.stringify({
          nodes: [
            { id: 'router-1', type: 'router', name: 'Router' },
            { id: 'pc-1', type: 'pc', name: 'PC' },
          ],
          edges: [
            { source: 'router-1', target: 'pc-1', speed: '1 GbE' },
            { source: 'router-1', target: 'missing-node', speed: '1 GbE' },
          ],
        });
        this.onload?.({ target: { result: payload } } as any);
      });

    const importFile = new File(['ignored'], 'import.homelab.json', { type: 'application/json' });
    fireEvent.change(fileInput, { target: { files: [importFile] } });

    await waitFor(() => {
      expect(screen.getByText('Create New Project')).toBeInTheDocument();
    });

    fireEvent.click(screen.getAllByText('Create Project').at(-1) as HTMLElement);

    await waitFor(() => {
      expect(buildApi.create).toHaveBeenCalled();
    });

    expect((buildApi.create as any).mock.calls[0][0].nodes).toHaveLength(0);
    const topologyArgs = (buildApi.updateTopology as any).mock.calls[0][1];
    expect(topologyArgs.revision).toBe(1);
    expect(topologyArgs.nodes).toHaveLength(2);
    expect(topologyArgs.edges).toHaveLength(1);
    expect(topologyArgs.edges[0].target).toBe('pc-1');
    expect(toast.warning).toHaveBeenCalled();

    readAsTextSpy.mockRestore();
  });

  it('creates a project of the kind picked in the dialog', async () => {
    (buildApi.list as any).mockResolvedValue([]);
    (buildApi.create as any).mockResolvedValue({
      id: 'party-1',
      name: 'Autumn LAN',
      kind: 'lan_party',
      revision: 1,
    });

    render(
      page(),
    );

    fireEvent.click((await screen.findAllByRole('button', { name: /New Project/i }))[0]);
    await waitFor(() => {
      expect(screen.getByText('Create New Project')).toBeInTheDocument();
    });

    // A plain project stays a homelab unless something else is picked.
    expect(screen.getByRole('button', { name: /^Homelab/i })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    fireEvent.click(screen.getByRole('button', { name: /^LAN party/i }));
    fireEvent.click(screen.getAllByText('Create Project').at(-1) as HTMLElement);

    await waitFor(() => {
      expect(buildApi.create).toHaveBeenCalledWith(expect.objectContaining({ kind: 'lan_party' }));
    });
  });

  it('marks gaming projects on their card and leaves homelabs unmarked', async () => {
    const base = {
      user_id: '1',
      thumbnail: '',
      nodes: [],
      settings: {},
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    (buildApi.list as any).mockResolvedValue([
      { ...base, id: 'b1', name: 'Rack at home', kind: 'homelab' },
      { ...base, id: 'b2', name: 'Valheim box', kind: 'game_server' },
      { ...base, id: 'b3', name: 'Old project' },
    ]);

    render(
      page(),
    );

    await waitFor(() => {
      expect(screen.getByText('Valheim box')).toBeInTheDocument();
    });
    expect(screen.getAllByText('Game server')).toHaveLength(1);
    expect(screen.queryByText('Homelab')).not.toBeInTheDocument();
  });

  it('shows a specific error when backend rejects invalid edge references', async () => {
    (buildApi.list as any).mockResolvedValue([]);
    (buildApi.create as any).mockResolvedValue({
      id: 'new-build',
      name: 'Imported Build',
      revision: 1,
    });
    (buildApi.updateTopology as any).mockRejectedValue(
      new ApiError(400, 'UNKNOWN', 'invalid edge references: 1 edge(s) reference missing node(s)'),
    );

    const { container } = render(
      page(),
    );

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    const readAsTextSpy = vi
      .spyOn(FileReader.prototype, 'readAsText')
      .mockImplementation(function () {
        const payload = JSON.stringify({
          nodes: [{ id: 'router-1', type: 'router', name: 'Router' }],
          edges: [],
        });
        this.onload?.({ target: { result: payload } } as any);
      });

    fireEvent.change(fileInput, {
      target: {
        files: [new File(['ignored'], 'import.homelab.json', { type: 'application/json' })],
      },
    });
    await waitFor(() => {
      expect(screen.getByText('Create New Project')).toBeInTheDocument();
    });
    fireEvent.click(screen.getAllByText('Create Project').at(-1) as HTMLElement);

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        'Import failed: wiring references missing nodes. Re-export and retry.',
      );
    });
    expect(buildApi.delete).toHaveBeenCalledWith('new-build');
    readAsTextSpy.mockRestore();
  });
});

describe('ProjectsPage and the open project', () => {
  const listed = {
    id: 'build-1',
    user_id: '1',
    name: 'Garage Lab',
    revision: 3,
    nodes: [],
    settings: {},
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (useAuth as any).mockReturnValue({ user: { id: '1', email: 'test@example.com' } });
    (buildApi.list as any).mockResolvedValue([{ ...listed }]);
    (buildApi.delete as any).mockResolvedValue(undefined);
    // The project is open elsewhere in the app (sidebar, config generator).
    useBuilderStore.getState().clearCurrentBuild();
    useBuilderStore.setState({ currentBuildId: 'build-1', projectName: 'Garage Lab' });
  });

  const openPage = async () => {
    render(
      page(),
    );
    await screen.findByText('Garage Lab');
  };

  it('forgets the open project when it is deleted here', async () => {
    await openPage();

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(buildApi.delete).toHaveBeenCalledWith('build-1'));
    await waitFor(() => expect(useBuilderStore.getState().currentBuildId).toBeNull());
  });

  it('keeps another open project when a different one is deleted', async () => {
    useBuilderStore.setState({ currentBuildId: 'build-2', projectName: 'Other' });
    await openPage();

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Project deleted'));
    expect(useBuilderStore.getState().currentBuildId).toBe('build-2');
  });

  it('shows the new name everywhere after a rename', async () => {
    (buildApi.rename as any).mockResolvedValue({ ...listed, name: 'Basement Lab', revision: 4 });
    await openPage();

    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'Basement Lab' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(useBuilderStore.getState().projectName).toBe('Basement Lab'));
    expect(buildApi.rename).toHaveBeenCalledWith('build-1', 'Basement Lab', 3);
    expect(await screen.findByText('Basement Lab')).toBeInTheDocument();
  });

  it('renames a project that was saved since the list was loaded', async () => {
    // The list still has revision 3; the builder saved revision 6 meanwhile.
    (buildApi.rename as any)
      .mockRejectedValueOnce(
        new ApiError(409, 'UNKNOWN', 'build revision conflict', {
          error: 'build revision conflict',
          build: { ...listed, revision: 6 },
        }),
      )
      .mockResolvedValueOnce({ ...listed, name: 'Basement Lab', revision: 7 });
    await openPage();

    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'Basement Lab' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Project renamed'));
    expect(buildApi.rename).toHaveBeenLastCalledWith('build-1', 'Basement Lab', 6);
    expect(toast.error).not.toHaveBeenCalled();
  });
});
