import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

const mocks = vi.hoisted(() => ({
  user: { id: 'user-1', name: 'Ada', email: 'ada@example.com', is_admin: false } as Record<string, unknown> | null,
}));

vi.mock('../../features/admin/hooks/use-auth', () => ({ useAuth: () => ({ user: mocks.user }) }));
vi.mock('../../features/survey/api/use-survey', () => ({ useSurvey: () => ({ data: null }) }));
vi.mock('../../features/survey/components/survey-modal', () => ({ SurveyModal: () => null }));
vi.mock('../auth/google-login-button', () => ({ GoogleLoginButton: () => <span>Sign in</span> }));
vi.mock('../../features/builder/api/builds', () => ({ buildApi: { list: vi.fn().mockResolvedValue([]) } }));
vi.mock('../../features/builder/api/proposals', () => ({
  proposalApi: {},
  useSyncState: () => ({ data: undefined }),
}));

import { useBuilderStore } from '../../features/builder/store/builder-store';
import { Sidebar } from './sidebar';

const BUILD = '11111111-1111-4111-8111-111111111111';

function renderSidebar(path = '/hardware') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Sidebar />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  mocks.user = { id: 'user-1', name: 'Ada', email: 'ada@example.com', is_admin: false };
  useBuilderStore.getState().clearCurrentBuild();
});

describe('Sidebar', () => {
  it('lists the places of the app, with the open project as a card of its own', () => {
    useBuilderStore.setState({ currentBuildId: BUILD, projectName: 'Basement Lab', buildKind: 'homelab', buildStatus: 'idle' });
    renderSidebar();
    const nav = screen.getByRole('navigation', { name: 'Main navigation' });

    const labels = within(nav)
      .getAllByRole('link')
      .map(link => link.textContent?.trim());
    // The project and its pages come right after "Projects"; the pages are
    // not listed a second time among the general places.
    expect(labels).toEqual([
      'Projects',
      'Basement LabHomelab',
      'Canvas',
      'Config Generator',
      'Setup Guide',
      'Guided Planner',
      'Hardware Catalog',
      'Service Library',
      'Homelab Guide',
      'Settings',
    ]);
    expect(within(nav).getByRole('region', { name: 'Current project' })).toBeInTheDocument();
    expect(screen.queryByText('Active Project')).not.toBeInTheDocument();
  });

  it('has one quiet row instead of a card when no project is open', () => {
    renderSidebar();
    expect(screen.getByRole('link', { name: 'No project open. Choose one.' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Config Generator' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Setup Guide' })).not.toBeInTheDocument();
  });

  it('shows Admin to admins only', () => {
    renderSidebar();
    expect(screen.queryByRole('link', { name: 'Admin' })).not.toBeInTheDocument();
  });

  it('shows Admin to an admin', () => {
    mocks.user = { id: 'user-1', name: 'Ada', email: 'ada@example.com', is_admin: true };
    renderSidebar();
    expect(screen.getByRole('link', { name: 'Admin' })).toHaveAttribute('href', '/admin');
  });

  it('remembers being collapsed, and keeps the project reachable as an icon', async () => {
    const user = userEvent.setup();
    useBuilderStore.setState({ currentBuildId: BUILD, projectName: 'Basement Lab', buildKind: 'homelab', buildStatus: 'idle' });
    const { unmount } = renderSidebar();

    await user.click(screen.getByTitle('Collapse sidebar'));
    expect(localStorage.getItem('sidebar-collapsed')).toBe('true');
    expect(screen.getByRole('link', { name: 'Basement Lab: open the canvas' })).toHaveAttribute('href', `/builder/${BUILD}`);
    expect(screen.queryByRole('region', { name: 'Current project' })).not.toBeInTheDocument();

    unmount();
    renderSidebar();
    expect(screen.getByTitle('Expand sidebar')).toBeInTheDocument();
  });
});
