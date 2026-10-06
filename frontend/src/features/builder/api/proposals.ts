import { useQuery } from '@tanstack/react-query';
import { api } from '../../../lib/api';
import type { Build, TopologyUpdateResponse } from './builds';

export type ProposalStatus = 'pending' | 'applied' | 'rejected' | 'superseded' | 'conflict';

export type FieldChange = { field: string; before: unknown; after: unknown };

export type NodeDiff = {
  id: string;
  name: string;
  type: string;
  ip?: string;
  parent_id?: string;
  changes?: FieldChange[];
};

export type ConnectionDiff = {
  source: string;
  target: string;
  source_name: string;
  target_name: string;
  source_handle?: string;
  target_handle?: string;
  type: string;
  speed?: string;
  changes?: FieldChange[];
};

export type GuestDiff = {
  id: string;
  name: string;
  type: string;
  host_id: string;
  host_name: string;
  ip?: string;
  changes?: FieldChange[];
};

export type ComponentDiff = {
  id: string;
  name: string;
  type: string;
  host_id: string;
  host_name: string;
};

export type AddressChange = {
  kind: 'node' | 'vm';
  id: string;
  name: string;
  before: string;
  after: string;
};

export type DiffCounts = {
  nodes_added: number;
  nodes_removed: number;
  nodes_changed: number;
  connections_added: number;
  connections_removed: number;
  connections_changed: number;
  vms_added: number;
  vms_removed: number;
  vms_changed: number;
  components_added: number;
  components_removed: number;
  /** Changes to the build kind and the gaming plan. */
  plan_changed?: number;
  ip_changes: number;
  total: number;
};

export type ProposalDiff = {
  counts: DiffCounts;
  build_name?: FieldChange;
  nodes: { added: NodeDiff[]; removed: NodeDiff[]; changed: NodeDiff[] };
  connections: { added: ConnectionDiff[]; removed: ConnectionDiff[]; changed: ConnectionDiff[] };
  vms: { added: GuestDiff[]; removed: GuestDiff[]; changed: GuestDiff[] };
  components: { added: ComponentDiff[]; removed: ComponentDiff[] };
  ip_changes: AddressChange[];
  /** Build kind and gaming plan settings, e.g. "uplink.up_mbps". */
  plan?: FieldChange[];
};

export type ValidationIssue = { node_id?: string; message: string };

export type ValidationReport = {
  valid: boolean;
  errors: ValidationIssue[] | null;
  warnings: ValidationIssue[] | null;
};

/** A proposal as lists and the builder's poll see it. */
export type ProposalSummary = {
  id: string;
  build_id: string;
  summary: string;
  source: 'mcp' | 'chat';
  source_label: string;
  status: ProposalStatus;
  status_reason?: string;
  counts: DiffCounts;
  base_revision: number;
  applied_revision?: number;
  created_at: string;
  resolved_at?: string;
};

/** A full proposal: what would change and the build as it would look. */
export type Proposal = {
  id: string;
  build_id: string;
  summary: string;
  source: 'mcp' | 'chat';
  source_label: string;
  status: ProposalStatus;
  status_reason: string;
  base_revision: number;
  applied_revision?: number;
  diff: ProposalDiff;
  preview?: { build: Build; validation?: ValidationReport };
  created_at: string;
  resolved_at?: string;
};

export type SyncState = {
  revision: number;
  updated_at: string;
  pending: ProposalSummary | null;
  recent: ProposalSummary[];
};

export const proposalApi = {
  syncState: (buildId: string) => api.get<SyncState>(`/api/builds/${buildId}/sync-state`),
  get: (buildId: string, proposalId: string) =>
    api.get<Proposal>(`/api/builds/${buildId}/proposals/${proposalId}`),
  apply: (buildId: string, proposalId: string) =>
    api.post<TopologyUpdateResponse>(`/api/builds/${buildId}/proposals/${proposalId}/apply`, {}),
  reject: (buildId: string, proposalId: string, reason: string) =>
    api.post<ProposalSummary>(`/api/builds/${buildId}/proposals/${proposalId}/reject`, { reason }),
};

export const SYNC_STATE_INTERVAL_MS = 4000;

export const syncStateKey = (buildId: string | null | undefined) => ['build-sync-state', buildId];

/**
 * Polls the build's revision and pending proposal while the tab is visible, so
 * the builder notices changes made by an LLM client or another session. With
 * `enabled` off nothing is fetched, but what another caller fetched for the
 * same build is still returned.
 */
export function useSyncState(
  buildId: string | null | undefined,
  enabled = true,
  intervalMs = SYNC_STATE_INTERVAL_MS,
) {
  return useQuery({
    queryKey: syncStateKey(buildId),
    queryFn: () => proposalApi.syncState(buildId as string),
    enabled: enabled && !!buildId,
    refetchInterval: intervalMs,
    refetchIntervalInBackground: false,
    retry: false,
    staleTime: 0,
  });
}
