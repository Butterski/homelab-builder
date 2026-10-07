import { beforeEach, describe, expect, it, vi } from 'vitest';
import { configure, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

const mocks = vi.hoisted(() => ({
  user: { id: 'user-1', name: 'Ada Lovelace', email: 'ada@example.com', is_admin: false } as Record<
    string,
    unknown
  > | null,
  survey: null as Record<string, unknown> | null,
}));

vi.mock('../../features/admin/hooks/use-auth', () => ({ useAuth: () => ({ user: mocks.user }) }));
vi.mock('../../features/survey/api/use-survey', () => ({
  useSurvey: () => ({ data: mocks.survey }),
}));
vi.mock('../../features/survey/components/survey-modal', () => ({
  SurveyModal: () => <div role="dialog" aria-label="Usage survey" />,
}));
vi.mock('../auth/google-login-button', () => ({ GoogleLoginButton: () => <span>Sign in</span> }));
vi.mock('../../features/builder/api/builds', () => ({
  buildApi: { list: vi.fn().mockResolvedValue([]) },
}));
vi.mock('../../features/builder/api/proposals', () => ({
  proposalApi: {},
  useSyncState: () => ({ data: undefined }),
}));

import { useBuilderStore } from '../../features/builder/store/builder-store';
import { Sidebar } from './sidebar';

// With every test file running at once on a loaded machine, a query that waits
// for a fetch to land needs more than the default second (see pitfall 31).
configure({ asyncUtilTimeout: 5000 });

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
  mocks.user = { id: 'user-1', name: 'Ada Lovelace', email: 'ada@example.com', is_admin: false };
  mocks.survey = null;
  useBuilderStore.getState().clearCurrentBuild();
});

describe('Sidebar', () => {
  it('lists the work and what is looked up for it, with the open project as a card of its own', () => {
    useBuilderStore.setState({
      currentBuildId: BUILD,
      projectName: 'Basement Lab',
      buildKind: 'homelab',
      buildStatus: 'idle',
    });
    renderSidebar();
    const nav = screen.getByRole('navigation', { name: 'Main navigation' });

    const labels = within(nav)
      .getAllByRole('link')
      .map(link => link.textContent?.trim());
    // The project and its pages come right after "Projects"; the pages are
    // not listed a second time among the general places. Starting a plan is
    // not a place: the planner is reached from Projects and the project switcher.
    expect(labels).toEqual([
      'Projects',
      'Basement LabHomelab',
      'Canvas',
      'Config Generator',
      'Setup Guide',
      // What the user owns comes before what is only looked up.
      'Inventory',
      'Hardware Catalog',
      'Service Library',
      'Homelab Guide',
    ]);
    expect(within(nav).getByRole('region', { name: 'Current project' })).toBeInTheDocument();
    expect(screen.queryByText('Active Project')).not.toBeInTheDocument();
  });

  it('keeps the app itself at the foot: commands, settings, a word to its author', () => {
    renderSidebar();

    expect(screen.getByRole('button', { name: /Command menu/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '/settings');
    expect(screen.getByRole('link', { name: 'Support HLBuilder' })).toHaveAttribute(
      'href',
      '/donate',
    );
    // One way to each place: no row of icons saying the same again.
    expect(screen.queryByTitle('Sponsor')).not.toBeInTheDocument();
    expect(screen.queryByTitle('Buy Me a Coffee')).not.toBeInTheDocument();
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
    mocks.user = { id: 'user-1', name: 'Ada Lovelace', email: 'ada@example.com', is_admin: true };
    renderSidebar();
    expect(screen.getByRole('link', { name: 'Admin' })).toHaveAttribute('href', '/admin');
  });

  it('asks for the survey until it is answered, then keeps it in the account menu', async () => {
    const user = userEvent.setup();
    const { unmount } = renderSidebar();

    await user.click(screen.getByRole('button', { name: /Usage survey/ }));
    expect(screen.getByRole('dialog', { name: 'Usage survey' })).toBeInTheDocument();
    unmount();

    mocks.survey = { rating: 5 };
    renderSidebar();
    expect(screen.queryByRole('button', { name: /Usage survey/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Account: Ada Lovelace' }));
    expect(
      await screen.findByRole('menuitem', { name: 'Change survey answers' }),
    ).toBeInTheDocument();
  });

  it('opens the account menu on who is signed in: profile, where the project lives, the small print', async () => {
    const user = userEvent.setup();
    renderSidebar();

    // No picture comes from the sign-in: the initials are drawn, nothing is fetched.
    expect(screen.getByText('AL')).toBeInTheDocument();
    expect(document.querySelector('img[src*="dicebear"]')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Account: Ada Lovelace' }));
    expect(await screen.findByRole('menuitem', { name: 'Profile' })).toHaveAttribute(
      'href',
      '/profile',
    );
    expect(screen.getByRole('menuitem', { name: 'Source on GitHub' })).toHaveAttribute(
      'href',
      'https://github.com/Butterski/homelab-builder',
    );
    expect(screen.getByRole('menuitem', { name: 'Privacy' })).toHaveAttribute('href', '/privacy');
    expect(screen.getByRole('menuitem', { name: 'Terms' })).toHaveAttribute('href', '/terms');
  });

  it('offers a visitor the way in instead of settings and an account', () => {
    mocks.user = null;
    renderSidebar();

    expect(screen.getByText('Sign in')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Settings' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Usage survey/ })).not.toBeInTheDocument();
    // The catalogs and the guide are open to everybody.
    expect(screen.getByRole('link', { name: 'Service Library' })).toHaveAttribute(
      'href',
      '/services',
    );
  });

  it('remembers being collapsed, and keeps the project reachable as an icon', async () => {
    const user = userEvent.setup();
    useBuilderStore.setState({
      currentBuildId: BUILD,
      projectName: 'Basement Lab',
      buildKind: 'homelab',
      buildStatus: 'idle',
    });
    const { unmount } = renderSidebar();

    await user.click(screen.getByTitle('Collapse sidebar'));
    expect(localStorage.getItem('sidebar-collapsed')).toBe('true');
    expect(screen.getByRole('link', { name: 'Basement Lab: open the canvas' })).toHaveAttribute(
      'href',
      `/builder/${BUILD}`,
    );
    expect(screen.queryByRole('region', { name: 'Current project' })).not.toBeInTheDocument();
    // Folded away, every place keeps its name for a screen reader and a tooltip.
    expect(screen.getByRole('link', { name: 'Service Library' })).toHaveAttribute(
      'title',
      'Service Library',
    );

    unmount();
    renderSidebar();
    expect(screen.getByTitle('Expand sidebar')).toBeInTheDocument();
  });
});
