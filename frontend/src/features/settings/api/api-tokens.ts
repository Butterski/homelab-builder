import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

export type TokenScope = 'read' | 'propose';

/** A personal access token as the server lists it. The secret is never included. */
export type ApiToken = {
  id: string;
  name: string;
  /** First characters of the token, for telling tokens apart. */
  prefix: string;
  scope: TokenScope;
  build_id?: string;
  expires_at?: string;
  last_used_at?: string;
  last_used_ip?: string;
  created_at: string;
};

type CreateTokenInput = {
  name: string;
  scope: TokenScope;
  build_id?: string;
  expires_in_days?: number;
};

export type CreatedToken = {
  /** The full token. The server returns it once and does not store it. */
  token: string;
  record: ApiToken;
};

const apiTokensApi = {
  list: () => api.get<{ tokens: ApiToken[]; limit: number }>('/api/tokens'),
  create: (input: CreateTokenInput) => api.post<CreatedToken>('/api/tokens', input),
  revoke: (id: string) => api.del<unknown>(`/api/tokens/${id}`),
};

const API_TOKENS_KEY = ['api-tokens'];

export function useApiTokens() {
  return useQuery({ queryKey: API_TOKENS_KEY, queryFn: apiTokensApi.list });
}

export function useCreateApiToken() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: apiTokensApi.create,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: API_TOKENS_KEY }),
  });
}

export function useRevokeApiToken() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: apiTokensApi.revoke,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: API_TOKENS_KEY }),
  });
}
