import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import type { MouseEvent, ReactNode } from 'react';
import ProjectsPage from '../projects-page';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { buildApi, type Build } from '../../api/builds';
import { useBuilderStore } from '../../store/builder-store';
import { toast } from 'sonner';
import { ApiError } from '../../../../lib/api';

const user = vi.hoisted(() => ({ id: '1', email: 'test@example.com', name: 'Test User' }));

// Mock dependencies
vi.mock('../../../auth/hooks/use-auth', () => ({
  useAuth: () => ({ user }),
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
    validateNetwork: vi.fn(),
  },
}));

type MenuProps = { children?: ReactNode; onClick?: (event: MouseEvent) => void };

vi.mock('../../../../components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: MenuProps) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: MenuProps) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: MenuProps) => <div>{children}</div>,
  DropdownMenuItem: ({ children, onClick }: MenuProps) => (
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

/** A build as the server returns it; tests fill in what they look at. */
function serverBuild(fields: Partial<Build>): Build {
  return {
    id: 'build-1',
    user_id: '1',
    name: 'test',
    revision: 1,
    created_at: '',
    updated_at: '',
    ...fields,
  };
}

// Mock URL object methods
const mockCreateObjectURL = vi.fn<(blob: Blob) => string>();
const mockRevokeObjectURL = vi.fn();
URL.createObjectURL = mockCreateObjectURL;
URL.revokeObjectURL = mockRevokeObjectURL;

describe('ProjectsPage Export Functionality', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateObjectURL.mockReturnValue('blob:fake-url');
  });

  it('uses Guided Planner as the only assisted project-start path', async () => {
    vi.mocked(buildApi.list).mockResolvedValue([]);

    render(
      page(),
    );

    const plannerLink = await screen.findByRole('link', { name: /Guided Planner/i });
    expect(plannerLink).toHaveAttribute('href', '/planner');
    expect(screen.queryByText(/Fast Start/i)).not.toBeInTheDocument();
  });

  it('asks what to plan when there is no project yet, and sends each answer to the planner', async () => {
    vi.mocked(buildApi.list).mockResolvedValue([]);

    render(page());

    expect(
      await screen.findByRole('heading', { name: 'What do you want to plan?' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /^Homelab/ })).toHaveAttribute('href', '/planner');
    expect(screen.getByRole('link', { name: /^LAN party/ })).toHaveAttribute(
      'href',
      '/planner?kind=lan_party',
    );
    expect(screen.getByRole('link', { name: /^Game server/ })).toHaveAttribute(
      'href',
      '/planner?kind=game_server',
    );

    // The way around the planner opens the usual dialog.
    fireEvent.click(screen.getByRole('button', { name: 'start with an empty canvas' }));
    expect(await screen.findByText('Create New Project')).toBeInTheDocument();
  });

  it('says so when a search matches nothing, without offering a first project', async () => {
    vi.mocked(buildApi.list).mockResolvedValue([
      serverBuild({ name: 'Rack room', nodes: [], updated_at: '2026-10-01T00:00:00Z' }),
    ]);

    render(page());

    fireEvent.change(await screen.findByPlaceholderText('Search projects...'), {
      target: { value: 'zzz' },
    });

    expect(screen.getByText(/No project matches/)).toBeInTheDocument();
    expect(screen.queryByText('What do you want to plan?')).not.toBeInTheDocument();
  });

  it('exports a project matching the .homelab.json schema', async () => {
    // Mock a project in the database
    const mockBuild = serverBuild({
      name: 'Test Project',
      thumbnail: '',
      nodes: [
        { id: 'router-1', type: 'router', name: 'Router' },
        { id: 'server-1', type: 'server', name: 'Server' },
      ],
      edges: [{ id: 'edge-1', source_node_id: 'router-1', target_node_id: 'server-1' }],
      settings: { planner: { goals: ['backup'] }, setupDone: ['router'] },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    const mockBuildList = [{ ...mockBuild }];

    vi.mocked(buildApi.list).mockResolvedValue(mockBuildList);
    vi.mocked(buildApi.get).mockResolvedValue(mockBuild);

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
    expect(payload.nodes).toEqual(mockBuild.nodes);
    expect(payload.edges).toEqual(mockBuild.edges);
    // The settings go out as the server keeps them.
    expect(payload.settings).toEqual(mockBuild.settings);
  });

  it('filters invalid imported edges and warns while allowing partial import', async () => {
    vi.mocked(buildApi.list).mockResolvedValue([]);
    vi.mocked(buildApi.create).mockResolvedValue(
      serverBuild({ id: 'new-build', name: 'Imported Build', revision: 1 }),
    );
    vi.mocked(buildApi.updateTopology).mockResolvedValue({
      build: serverBuild({ id: 'new-build', name: 'Imported Build', revision: 2, nodes: [] }),
      validation: { valid: true, errors: [], warnings: [] },
    });

    const { container } = render(
      page(),
    );

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    expect(fileInput).toBeTruthy();

    const readAsTextSpy = vi
      .spyOn(FileReader.prototype, 'readAsText')
      .mockImplementation(function (this: FileReader) {
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
        // The page reads the text off the load event's reader.
        Object.defineProperty(this, 'result', { value: payload });
        this.dispatchEvent(new Event('load'));
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

    expect(vi.mocked(buildApi.create).mock.calls[0][0].nodes).toHaveLength(0);
    const topologyArgs = vi.mocked(buildApi.updateTopology).mock.calls[0][1];
    expect(topologyArgs.revision).toBe(1);
    expect(topologyArgs.nodes).toHaveLength(2);
    expect(topologyArgs.edges).toHaveLength(1);
    expect(topologyArgs.edges[0].target).toBe('pc-1');
    expect(toast.warning).toHaveBeenCalled();

    readAsTextSpy.mockRestore();
  });

  it('creates a project of the kind picked in the dialog', async () => {
    vi.mocked(buildApi.list).mockResolvedValue([]);
    vi.mocked(buildApi.create).mockResolvedValue(
      serverBuild({ id: 'party-1', name: 'Autumn LAN', kind: 'lan_party', revision: 1 }),
    );

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
    vi.mocked(buildApi.list).mockResolvedValue([
      serverBuild({ ...base, id: 'b1', name: 'Rack at home', kind: 'homelab' }),
      serverBuild({ ...base, id: 'b2', name: 'Valheim box', kind: 'game_server' }),
      serverBuild({ ...base, id: 'b3', name: 'Old project' }),
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
    vi.mocked(buildApi.list).mockResolvedValue([]);
    vi.mocked(buildApi.create).mockResolvedValue(
      serverBuild({ id: 'new-build', name: 'Imported Build', revision: 1 }),
    );
    vi.mocked(buildApi.updateTopology).mockRejectedValue(
      new ApiError(400, 'UNKNOWN', 'invalid edge references: 1 edge(s) reference missing node(s)'),
    );

    const { container } = render(
      page(),
    );

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    const readAsTextSpy = vi
      .spyOn(FileReader.prototype, 'readAsText')
      .mockImplementation(function (this: FileReader) {
        const payload = JSON.stringify({
          nodes: [{ id: 'router-1', type: 'router', name: 'Router' }],
          edges: [],
        });
        // The page reads the text off the load event's reader.
        Object.defineProperty(this, 'result', { value: payload });
        this.dispatchEvent(new Event('load'));
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
  const listed = serverBuild({
    name: 'Garage Lab',
    revision: 3,
    nodes: [],
    settings: {},
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(buildApi.list).mockResolvedValue([{ ...listed }]);
    vi.mocked(buildApi.delete).mockResolvedValue(undefined);
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
    vi.mocked(buildApi.rename).mockResolvedValue({ ...listed, name: 'Basement Lab', revision: 4 });
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
    vi.mocked(buildApi.rename)
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
