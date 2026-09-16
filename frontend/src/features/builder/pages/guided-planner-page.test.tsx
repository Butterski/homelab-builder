import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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

vi.mock('../store/builder-store', () => ({
  useBuilderStore: () => ({
    availableServices: [],
    fetchServices: mocks.fetchServices,
    loadBuild: mocks.loadBuild,
  }),
}));

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

    for (let step = 0; step < 3; step += 1) {
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
    expect(mocks.updateTopology.mock.calls[0][1].nodes.length).toBeGreaterThan(2);
    expect(mocks.updateTopology.mock.calls[0][1].edges.length).toBeGreaterThan(1);
  });
});
