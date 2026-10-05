import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

export type ProviderPreset = {
  id: string;
  label: string;
  /** Suggested model; empty when the list should be loaded from the provider. */
  default_model: string;
  base_url: string;
  /** True when the user points the provider at their own endpoint. */
  custom_base_url: boolean;
  key_required: boolean;
  key_help_url?: string;
  note?: string;
};

/** How a stored key is held. Everything here is safe to show: no key material. */
export type KeyStorage = {
  algorithm: string;
  /** "env": the master key is outside the database. "database": the instance generated it. */
  master_key_source: 'env' | 'database';
  master_key_version: number;
  nonce_hex: string;
  ciphertext_bytes: number;
  ciphertext_preview: string;
  ciphertext_sha256: string;
  bound_to: string;
  stored_at: string | null;
  last_used_at: string | null;
};

/** Assistant settings as the server returns them. The key itself is never included. */
export type AssistantSettings = {
  /** False when the instance operator switched the assistant off. */
  available: boolean;
  enabled: boolean;
  provider: string;
  model: string;
  base_url: string;
  has_key: boolean;
  /** Last four characters of the stored key. */
  key_hint: string;
  /** False when the stored key can no longer be decrypted and must be entered again. */
  key_usable: boolean;
  key_storage: KeyStorage | null;
  /** True when a chat can start. */
  ready: boolean;
  providers: ProviderPreset[];
  allow_private_endpoints: boolean;
  master_key_source: string;
};

export type AssistantSettingsUpdate = {
  enabled?: boolean;
  provider?: string;
  model?: string;
  base_url?: string;
  /** Write-only. Leave out to keep the stored key. */
  api_key?: string;
};

export type ProviderTestResult = { ok: boolean; models: string[]; error?: string };

export const assistantSettingsApi = {
  get: () => api.get<AssistantSettings>('/api/assistant/settings'),
  update: (changes: AssistantSettingsUpdate) =>
    api.put<AssistantSettings>('/api/assistant/settings', changes),
  deleteKey: () => api.del<AssistantSettings>('/api/assistant/settings/key'),
  test: () => api.post<ProviderTestResult>('/api/assistant/settings/test', {}),
};

export const ASSISTANT_SETTINGS_KEY = ['assistant-settings'];

/** Shared by the settings page and the builder, so a change shows up in both. */
export function useAssistantSettings(enabled = true) {
  return useQuery({
    queryKey: ASSISTANT_SETTINGS_KEY,
    queryFn: assistantSettingsApi.get,
    enabled,
    staleTime: 30_000,
    retry: false,
  });
}

export function useUpdateAssistantSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: assistantSettingsApi.update,
    onSuccess: settings => queryClient.setQueryData(ASSISTANT_SETTINGS_KEY, settings),
  });
}

export function useDeleteAssistantKey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: assistantSettingsApi.deleteKey,
    onSuccess: settings => queryClient.setQueryData(ASSISTANT_SETTINGS_KEY, settings),
  });
}
