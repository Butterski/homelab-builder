import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const TOKEN = 'hlb_' + 'k'.repeat(43);

const apiMock = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  del: vi.fn(),
}));

vi.mock('@/lib/api', () => ({ api: apiMock }));
vi.mock('@/features/builder/api/builds', () => ({
  buildApi: { list: vi.fn().mockResolvedValue([{ id: 'build-1', name: 'Home Lab' }]) },
}));
vi.mock('@/features/auth/lib/auth-config', () => ({
  getAuthConfig: vi.fn().mockResolvedValue({ mcp_enabled: true, assistant_enabled: true }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { McpAccessCard } from './mcp-access-card';

function renderCard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return render(<McpAccessCard />, { wrapper });
}

const existingToken = {
  id: 'token-1',
  name: 'Cursor at home',
  prefix: 'hlb_Ab12',
  scope: 'read',
  build_id: 'build-1',
  created_at: new Date(Date.now() - 86_400_000).toISOString(),
};

beforeEach(() => {
  vi.clearAllMocks();
  apiMock.get.mockResolvedValue({ tokens: [existingToken], limit: 20 });
  apiMock.del.mockResolvedValue({});
  apiMock.post.mockResolvedValue({
    token: TOKEN,
    record: { id: 'token-2', name: 'Claude Code', prefix: 'hlb_kkkk', scope: 'propose', created_at: new Date().toISOString() },
  });
});

describe('McpAccessCard', () => {
  it('lists tokens by prefix and never shows a secret', async () => {
    renderCard();

    const row = (await screen.findByText('Cursor at home')).closest('li')!;
    expect(within(row).getByText('Read only')).toBeInTheDocument();
    expect(within(row).getByText('Home Lab')).toBeInTheDocument();
    expect(within(row).getByText('hlb_Ab12…')).toBeInTheDocument();
    expect(within(row).getByText(/Last used never/)).toBeInTheDocument();

    // The endpoint is shown, and setup snippets only carry a placeholder.
    expect(screen.getAllByText(/\/mcp$/).length).toBeGreaterThan(0);
    expect(document.body.textContent).toContain('<your-token>');
    expect(document.body.textContent).not.toContain(TOKEN);
  });

  it('shows a new token once, with ready-to-paste client setup', async () => {
    const user = userEvent.setup();
    renderCard();
    await screen.findByText('Cursor at home');

    await user.click(screen.getByRole('button', { name: /create token/i }));
    const dialog = await screen.findByRole('dialog');
    const submit = within(dialog).getByRole('button', { name: /create token/i });
    expect(submit).toBeDisabled();

    await user.type(within(dialog).getByLabelText('Name'), '  Claude Code  ');
    await user.click(submit);

    // Defaults: propose scope, all builds, 90 days.
    expect(apiMock.post).toHaveBeenCalledWith('/api/tokens', {
      name: 'Claude Code',
      scope: 'propose',
      build_id: undefined,
      expires_in_days: 90,
    });
    expect(await within(dialog).findByTestId('new-token')).toHaveTextContent(TOKEN);
    expect(within(dialog).getByText(/only time the token is shown/i)).toBeInTheDocument();
    expect(dialog.textContent).toContain(`--header "Authorization: Bearer ${TOKEN}"`);

    // Closing the dialog forgets the secret; the list is refreshed.
    await user.click(within(dialog).getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(document.body.textContent).not.toContain(TOKEN);
    expect(apiMock.get).toHaveBeenCalledTimes(2);
  });

  it('revokes a token only after confirmation', async () => {
    const user = userEvent.setup();
    renderCard();
    await screen.findByText('Cursor at home');

    await user.click(screen.getByRole('button', { name: 'Revoke Cursor at home' }));
    expect(apiMock.del).not.toHaveBeenCalled();

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/loses access immediately/i)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Revoke' }));

    await waitFor(() => expect(apiMock.del).toHaveBeenCalledWith('/api/tokens/token-1'));
  });
});
