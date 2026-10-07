import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { INVENTORY_KEY, type InventoryItem } from '@/features/inventory/api/inventory';

/** What a reading of a cluster holds, in a line. */
export type ProxmoxSummary = {
  version?: string;
  cluster?: string;
  nodes: number;
  nodes_online: number;
  vms: number;
  containers: number;
  templates: number;
};

/** A connection to a Proxmox cluster, or an export pasted from one. The secret is never part of it. */
export type Integration = {
  id: string;
  kind: string;
  name: string;
  /** "api" reads the cluster itself; "paste" holds an export the owner pasted. */
  source: 'api' | 'paste';
  base_url: string;
  token_id: string;
  has_secret: boolean;
  secret_usable: boolean;
  /** SHA-256 of the certificate the owner chose to trust. */
  tls_fingerprint: string;
  synced_at: string | null;
  last_error: string;
  summary: ProxmoxSummary | null;
  notes: string[];
  created_at: string;
};

/** What this instance can do with integrations. */
export type IntegrationAvailability = {
  enabled: boolean;
  /** The instance can keep a token secret and read a cluster over its API. */
  live: boolean;
  /** The instance may call private addresses, where a home Proxmox host is. */
  allow_private: boolean;
  master_key_source?: string;
  limit: number;
};

export type Certificate = {
  fingerprint: string;
  subject: string;
  issuer: string;
  not_after: string;
};

export type IntegrationTestInput = {
  integration_id?: string;
  base_url: string;
  token_id: string;
  secret?: string;
  tls_fingerprint?: string;
};

export type IntegrationTestResult = {
  ok: boolean;
  summary?: ProxmoxSummary;
  notes: string[];
  certificate?: Certificate;
  /** invalid | blocked | unreachable | certificate | fingerprint | auth | permission | protocol */
  error_kind?: string;
  error?: string;
};

export type IntegrationInput = {
  name?: string;
  base_url?: string;
  token_id?: string;
  /** Write-only. */
  secret?: string;
  tls_fingerprint?: string;
  /** Output of `pvesh get /cluster/resources --output-format json`. */
  export?: string;
};

export type Figure = { planned: number; actual: number; state: 'same' | 'differs' | 'unknown' };
export type Load = { capacity: number; planned: number; actual: number };

/** One guest of a comparison. */
export type GuestRow = {
  /** On both sides, only on Proxmox, or only in the plan. */
  state: 'matched' | 'discovered' | 'missing';
  vmid?: number;
  name: string;
  kind: string;
  status?: string;
  ip?: string;
  planned_id?: string;
  planned_name?: string;
  matched_by?: 'id' | 'name';
  cpus: Figure;
  memory_mb: Figure;
  disk_gb?: number;
  differs: boolean;
};

export type MatchReason = { signal: string; agrees: boolean; text: string };
export type MatchSuggestion = {
  item_id: string;
  item_name: string;
  confidence: number;
  reasons: MatchReason[];
};

export type HostFacts = {
  name: string;
  online: boolean;
  address?: string;
  cidr?: string;
  gateway?: string;
  cpu_model?: string;
  cores?: number;
  threads: number;
  memory_mb: number;
  disk_gb?: number;
  version?: string;
  interfaces?: {
    name: string;
    type: string;
    active: boolean;
    address?: string;
    bridge_ports?: string;
  }[];
};

export type HostStorage = {
  name: string;
  node: string;
  type?: string;
  shared?: boolean;
  total_gb: number;
  used_gb: number;
};

/** One Proxmox host: how it compares with the plan, and which inventory item it may be. */
export type ImportHost = {
  node: string;
  online: boolean;
  skipped: boolean;
  planned_id?: string;
  planned_name?: string;
  /** choice | link | inventory | name */
  paired_by?: string;
  cpus: Figure;
  ram_gb: Figure;
  storage_gb: Figure;
  guests: GuestRow[];
  memory_mb: Load;
  vcpus: Load;
  disk_gb: Load;
  /** Memory left free by the larger of plan and reality; -1 when unknown. */
  headroom_percent: number;
  warnings: string[];
  facts: HostFacts;
  storage: HostStorage[];
  linked_item: { id: string; name: string; type: string } | null;
  suggestions: MatchSuggestion[];
};

export type ImportPlan = {
  integration: Integration;
  fetched_at: string;
  build: { id: string; name: string; revision: number } | null;
  hosts: ImportHost[];
  /** Devices of the build a host could be. */
  candidates: { id: string; name: string; type: string }[];
  totals: { vcpus: Load; memory_mb: Load; disk_gb: Load };
  counts: { matched: number; differing: number; discovered: number; missing: number };
  notes: string[];
  /** How many changes one import into an existing build can make. */
  operation_limit: number;
};

export type ImportDecision = {
  build_id?: string | null;
  build_name?: string;
  /** For a host: the id of the planned device it is, "new" or "skip". */
  hosts: Record<string, string>;
  use_actual_specs: string[];
  add_guests: number[];
  update_guests: number[];
  remove_guests: string[];
};

export type ImportResult = {
  outcome: 'proposal' | 'build' | 'nothing';
  build_id?: string;
  proposal_id?: string;
  summary: string;
  addresses_left_out: boolean;
  /**
   * How many real addresses were left to the project's address plan because
   * they lie in the DHCP range of its router, where nothing is pinned.
   */
  addresses_in_pool?: number;
};

type IntegrationList = { integrations: Integration[]; availability: IntegrationAvailability };

export const integrationsApi = {
  list: () => api.get<IntegrationList>('/api/integrations'),
  test: (input: IntegrationTestInput) =>
    api.post<IntegrationTestResult>('/api/integrations/test', input),
  create: (input: IntegrationInput) => api.post<Integration>('/api/integrations', input),
  update: (id: string, input: IntegrationInput) =>
    api.put<Integration>(`/api/integrations/${id}`, input),
  remove: (id: string) => api.del<unknown>(`/api/integrations/${id}`),
  sync: (id: string) => api.post<Integration>(`/api/integrations/${id}/sync`, {}),
  reconcile: (id: string, buildId: string | null, hosts: Record<string, string>) =>
    api.post<ImportPlan>(`/api/integrations/${id}/reconcile`, { build_id: buildId, hosts }),
  link: (id: string, node: string, itemId: string | null) =>
    api.post<unknown>(`/api/integrations/${id}/link`, { node, item_id: itemId }),
  createItem: (
    id: string,
    input: { node: string; name?: string; type?: string; location?: string },
  ) => api.post<InventoryItem>(`/api/integrations/${id}/inventory`, input),
  import: (id: string, decision: ImportDecision) =>
    api.post<ImportResult>(`/api/integrations/${id}/import`, decision),
};

export const INTEGRATIONS_KEY = ['integrations'];
const PLAN_KEY = 'integration-plan';

export function useIntegrations(enabled = true) {
  return useQuery({ queryKey: INTEGRATIONS_KEY, queryFn: integrationsApi.list, enabled });
}

/** Refreshes everything a change to an integration can show up in. */
function useRefresh() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: INTEGRATIONS_KEY }),
      queryClient.invalidateQueries({ queryKey: INVENTORY_KEY }),
      queryClient.invalidateQueries({ queryKey: [PLAN_KEY] }),
    ]);
}

export function useTestIntegration() {
  return useMutation({ mutationFn: integrationsApi.test });
}

/** Creates an integration, or changes the one with the given id. */
export function useSaveIntegration() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: IntegrationInput }) =>
      id ? integrationsApi.update(id, input) : integrationsApi.create(input),
    onSuccess: refresh,
  });
}

export function useDeleteIntegration() {
  const refresh = useRefresh();
  return useMutation({ mutationFn: integrationsApi.remove, onSuccess: refresh });
}

/** Reads the cluster again. A failed reading also changes what the integration shows. */
export function useSyncIntegration() {
  const refresh = useRefresh();
  return useMutation({ mutationFn: integrationsApi.sync, onSettled: refresh });
}

export function useLinkHost(integrationId: string) {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: ({ node, itemId }: { node: string; itemId: string | null }) =>
      integrationsApi.link(integrationId, node, itemId),
    onSuccess: refresh,
  });
}

export function useCreateItemFromHost(integrationId: string) {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (input: { node: string; name?: string; type?: string; location?: string }) =>
      integrationsApi.createItem(integrationId, input),
    onSuccess: refresh,
  });
}

export function useImportFromIntegration(integrationId: string) {
  return useMutation({
    mutationFn: (decision: ImportDecision) => integrationsApi.import(integrationId, decision),
  });
}

/**
 * Compares what the integration read with a build, or with nothing when
 * `buildId` is null. `hosts` are the owner's choices of which device a host is;
 * changing them asks again.
 */
export function useImportPlan(
  integrationId: string | undefined,
  buildId: string | null,
  hosts: Record<string, string>,
  enabled = true,
) {
  return useQuery({
    queryKey: [PLAN_KEY, integrationId, buildId, hosts],
    queryFn: () => integrationsApi.reconcile(integrationId as string, buildId, hosts),
    enabled: enabled && !!integrationId,
    // Keep the table on screen while a changed choice is being compared.
    placeholderData: previous => previous,
    retry: false,
    staleTime: 0,
  });
}
