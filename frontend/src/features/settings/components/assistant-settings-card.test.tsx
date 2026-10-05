import type { ReactNode } from 'react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AssistantSettings } from '../api/assistant-settings';

const apiMock = vi.hoisted(() => ({
  get: vi.fn(),
  put: vi.fn(),
  post: vi.fn(),
  del: vi.fn(),
}));

vi.mock('@/lib/api', () => ({ api: apiMock }));
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

import { AssistantSettingsCard } from './assistant-settings-card';

const NEW_KEY = 'sk-ant-test-key-000000003456';

const providers: AssistantSettings['providers'] = [
  {
    id: 'anthropic',
    label: 'Anthropic (Claude)',
    default_model: 'claude-opus-5',
    base_url: 'https://api.anthropic.com',
    custom_base_url: false,
    key_required: true,
    key_help_url: 'https://console.anthropic.com/settings/keys',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    default_model: '',
    base_url: 'https://api.openai.com/v1',
    custom_base_url: false,
    key_required: true,
  },
  {
    id: 'ollama',
    label: 'Ollama (local models)',
    default_model: '',
    base_url: 'http://host.docker.internal:11434/v1',
    custom_base_url: true,
    key_required: false,
    note: 'Use a model that supports tool calling.',
  },
];

function settings(overrides: Partial<AssistantSettings> = {}): AssistantSettings {
  return {
    available: true,
    enabled: false,
    provider: 'anthropic',
    model: 'claude-opus-5',
    base_url: '',
    has_key: false,
    key_hint: '',
    key_usable: false,
    key_storage: null,
    ready: false,
    providers,
    allow_private_endpoints: false,
    master_key_source: 'env',
    ...overrides,
  };
}

const storedKey: Partial<AssistantSettings> = {
  has_key: true,
  key_hint: 'a1B2',
  key_usable: true,
  key_storage: {
    algorithm: 'AES-256-GCM',
    master_key_source: 'env',
    master_key_version: 1,
    nonce_hex: '0f1e2d3c4b5a69788796a5b4',
    ciphertext_bytes: 67,
    ciphertext_preview: '9ac41f0be2d7a3c5118820ff',
    ciphertext_sha256: '5d41402abc4b2a76',
    bound_to: 'your account id (7b0c2f6e-0000-4000-8000-000000000001)',
    stored_at: '2026-10-01T09:30:00Z',
    last_used_at: null,
  },
};

function renderCard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return render(<AssistantSettingsCard />, { wrapper });
}

beforeAll(() => {
  // jsdom lacks the pointer and scrolling APIs the select component calls.
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => undefined;
  Element.prototype.releasePointerCapture = () => undefined;
  Element.prototype.scrollIntoView = () => undefined;
});

beforeEach(() => {
  vi.clearAllMocks();
  apiMock.get.mockResolvedValue(settings());
  apiMock.post.mockResolvedValue({ ok: true, models: ['claude-opus-5', 'claude-sonnet-5'] });
});

describe('AssistantSettingsCard', () => {
  it('never shows a stored key: the field is empty and only the hint is displayed', async () => {
    apiMock.get.mockResolvedValue(settings({ ...storedKey, enabled: true, ready: true }));
    renderCard();

    const field = await screen.findByLabelText('API key');
    expect(field).toHaveValue('');
    expect(field).toHaveAttribute('type', 'password');
    expect(screen.getByTestId('assistant-key-state')).toHaveTextContent('ends in a1B2');
    expect(screen.getByTestId('assistant-status')).toHaveTextContent(/^Ready\./);
  });

  it('shows how the key is stored and links to the code that does it', async () => {
    apiMock.get.mockResolvedValue(settings(storedKey));
    renderCard();

    const record = await screen.findByTestId('key-storage-record');
    expect(record).toHaveTextContent('AES-256-GCM');
    expect(record).toHaveTextContent('0f1e2d3c4b5a69788796a5b4');
    expect(record).toHaveTextContent('9ac41f0be2d7a3c5118820ff… (67 bytes)');
    expect(record).toHaveTextContent('server environment (version 1)');
    expect(record).toHaveTextContent('7b0c2f6e-0000-4000-8000-000000000001');
    expect(record).toHaveTextContent('never');

    // The honest limit of the protection is stated, not hidden.
    expect(screen.getByText(/whoever operates this instance could do\s+the same/)).toBeInTheDocument();

    const source = 'https://github.com/Butterski/homelab-builder/blob/HEAD/';
    expect(screen.getByRole('link', { name: 'encryption' })).toHaveAttribute(
      'href',
      `${source}backend/internal/secrets/aesgcm.go`,
    );
    expect(screen.getByRole('link', { name: 'key storage' })).toHaveAttribute(
      'href',
      `${source}backend/internal/services/assistant_settings_service.go`,
    );
    expect(screen.getByRole('link', { name: 'security notes' })).toHaveAttribute(
      'href',
      `${source}docs/AI-ASSISTANT-SECURITY.md`,
    );
  });

  it('says so when the instance keeps its master key in the database', async () => {
    apiMock.get.mockResolvedValue(settings({ master_key_source: 'database' }));
    renderCard();

    expect(await screen.findByText(/keeps it in its own database/)).toBeInTheDocument();
    expect(screen.getByText('Nothing. No key is stored for your account.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /delete stored key/i })).not.toBeInTheDocument();
  });

  it('sends a new key once, forgets it, and lists the models it unlocks', async () => {
    const user = userEvent.setup();
    apiMock.put.mockResolvedValue(settings({ ...storedKey, key_hint: '3456' }));
    renderCard();

    const field = await screen.findByLabelText('API key');
    const save = screen.getByRole('button', { name: 'Save' });
    expect(save).toBeDisabled();

    await user.type(field, NEW_KEY);
    await user.click(save);

    // Only the key travels: nothing else on the form changed.
    expect(apiMock.put).toHaveBeenCalledWith('/api/assistant/settings', { api_key: NEW_KEY });
    await waitFor(() => expect(field).toHaveValue(''));
    expect(screen.getByTestId('assistant-key-state')).toHaveTextContent('ends in 3456');
    expect(document.body.innerHTML).not.toContain(NEW_KEY);

    // The stored key is checked by listing models, which costs nothing.
    await waitFor(() =>
      expect(apiMock.post).toHaveBeenCalledWith('/api/assistant/settings/test', {}),
    );
    expect(await screen.findByRole('status')).toHaveTextContent('2 models are available');
    const options = document.querySelectorAll('#assistant-model-options option');
    expect([...options].map(option => option.getAttribute('value'))).toEqual([
      'claude-opus-5',
      'claude-sonnet-5',
    ]);
  });

  it('shows why a connection check failed', async () => {
    const user = userEvent.setup();
    apiMock.get.mockResolvedValue(settings(storedKey));
    apiMock.post.mockResolvedValue({
      ok: false,
      models: [],
      error: 'The provider rejected the API key. Check the key in Settings.',
    });
    renderCard();

    await user.click(await screen.findByRole('button', { name: /check connection/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The provider rejected the API key.');
  });

  it('warns that switching provider deletes the stored key', async () => {
    const user = userEvent.setup();
    apiMock.get.mockResolvedValue(settings(storedKey));
    apiMock.put.mockResolvedValue(settings({ provider: 'openai', model: '' }));
    renderCard();

    await user.click(await screen.findByRole('combobox', { name: 'Provider' }));
    await user.click(await screen.findByRole('option', { name: 'OpenAI' }));

    expect(screen.getByTestId('assistant-key-state')).toHaveTextContent(
      'deletes the stored key',
    );
    expect(screen.getByLabelText('Model')).toHaveValue('');

    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(apiMock.put).toHaveBeenCalledWith('/api/assistant/settings', {
      provider: 'openai',
      model: '',
    });
    // Without a key for the new provider there is nothing to check yet.
    await waitFor(() =>
      expect(screen.getByTestId('assistant-key-state')).toHaveTextContent('No key is stored'),
    );
    expect(apiMock.post).not.toHaveBeenCalled();
  });

  it('asks for an endpoint address only for providers that need one', async () => {
    const user = userEvent.setup();
    apiMock.get.mockResolvedValue(settings({ allow_private_endpoints: true }));
    renderCard();

    await screen.findByLabelText('API key');
    expect(screen.queryByLabelText('Endpoint address')).not.toBeInTheDocument();

    await user.click(screen.getByRole('combobox', { name: 'Provider' }));
    await user.click(await screen.findByRole('option', { name: 'Ollama (local models)' }));

    expect(screen.getByLabelText('Endpoint address')).toHaveValue(
      'http://host.docker.internal:11434/v1',
    );
    expect(screen.getByLabelText('API key (optional)')).toBeInTheDocument();
    expect(screen.getByText('Use a model that supports tool calling.')).toBeInTheDocument();
  });

  it('turns the assistant on and off with the switch', async () => {
    const user = userEvent.setup();
    apiMock.put.mockResolvedValue(settings({ enabled: true }));
    renderCard();

    const toggle = await screen.findByRole('switch', { name: /show the assistant in the builder/i });
    expect(toggle).not.toBeChecked();
    expect(screen.getByTestId('assistant-status')).toHaveTextContent(/^Off\./);

    await user.click(toggle);

    expect(apiMock.put).toHaveBeenCalledWith('/api/assistant/settings', { enabled: true });
    await waitFor(() => expect(toggle).toBeChecked());
    expect(screen.getByTestId('assistant-status')).toHaveTextContent(
      'On, but not ready yet. Enter an API key below.',
    );
  });

  it('deletes the stored key only after confirmation', async () => {
    const user = userEvent.setup();
    apiMock.get.mockResolvedValue(settings(storedKey));
    apiMock.del.mockResolvedValue(settings());
    renderCard();

    await user.click(await screen.findByRole('button', { name: /delete stored key/i }));
    expect(apiMock.del).not.toHaveBeenCalled();

    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Delete key' }));

    await waitFor(() => expect(apiMock.del).toHaveBeenCalledWith('/api/assistant/settings/key'));
    expect(await screen.findByText('Nothing. No key is stored for your account.')).toBeInTheDocument();
  });

  it('explains when the instance has the assistant turned off', async () => {
    apiMock.get.mockResolvedValue(settings({ available: false }));
    renderCard();

    expect(await screen.findByText(/turned off on this instance/)).toBeInTheDocument();
    expect(screen.queryByLabelText('API key')).not.toBeInTheDocument();
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
  });
});
