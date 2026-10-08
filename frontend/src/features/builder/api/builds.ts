import { api, authHeaders } from '../../../lib/api';
import { apiUrl } from '../../../lib/api-base';
import type {
  BuildKind,
  GamingPlan,
  HardwareComponent,
  HardwareSpec,
  VirtualMachine,
} from '../../../types';
import type { ValidationReport } from './proposals';

let topologyQueue: Promise<void> = Promise.resolve();

function serializeTopologyMutation<T>(operation: () => Promise<T>): Promise<T> {
  const result = topologyQueue.then(operation, operation);
  topologyQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

/**
 * What a build keeps besides its graph. The builder manages `setupDone`; the
 * planner's answers and keys written by older versions are sent back as loaded,
 * because a save replaces the whole object.
 */
export type BuildSettings = {
  /** The guided planner's answers the build was made from. */
  planner?: Record<string, unknown>;
  /** Which steps of the setup guide are ticked off. */
  setupDone?: string[];
  [key: string]: unknown;
};

/** A node as the build API returns it. */
export type BuildNode = {
  id: string;
  type: string;
  name: string;
  ip?: string;
  mac_address?: string;
  power_draw?: number;
  x?: number;
  y?: number;
  /** An object, or the same as a JSON string. */
  details?: unknown;
  parent_id?: string | null;
  virtual_machines?: VirtualMachine[];
  internal_components?: HardwareComponent[];
};

/** An edge as the build API returns it. */
export type BuildEdge = {
  id?: string;
  source_node_id: string;
  source_handle?: string;
  target_node_id: string;
  target_handle?: string;
  type?: string;
  speed?: string;
  subnet?: string;
  wireless_standard?: string;
  direction?: string;
};

export interface Build {
  id: string;
  user_id: string;
  name: string;
  /** What the build is planned for. Builds saved before 1.3 are homelabs. */
  kind?: BuildKind;
  /** Empty object until the owner fills in a gaming plan. */
  gaming_plan?: Partial<GamingPlan>;
  revision: number;
  thumbnail?: string;
  total_power?: number;
  settings?: BuildSettings;
  share_token?: string;
  is_shared?: boolean;
  shared_editable?: boolean;
  created_at: string;
  updated_at: string;
  nodes?: BuildNode[];
  edges?: BuildEdge[];
}

/** A node as a save sends it. */
export type BuildNodeInput = {
  id: string;
  type: string;
  name: string;
  x: number;
  y: number;
  power_draw?: number;
  ip?: string;
  mac_address?: string;
  details?: HardwareSpec;
  vms?: VirtualMachine[];
  internal_components?: HardwareComponent[];
  parent_id?: string;
};

/** An edge as a save sends it. */
export type BuildEdgeInput = {
  source: string;
  source_handle?: string;
  target: string;
  target_handle?: string;
  type?: string;
  speed?: string;
  subnet?: string;
  wireless_standard?: string;
  direction?: string;
};

export type CreateBuildParams = {
  name: string;
  thumbnail?: string;
  settings: BuildSettings;
  nodes: BuildNodeInput[];
  edges: BuildEdgeInput[];
  services: Array<{ id: string; name: string }>;
  /** Left out, the server keeps the kind and plan the build already has. */
  kind?: BuildKind;
  gaming_plan?: Partial<GamingPlan>;
};

type TopologyUpdateParams = CreateBuildParams & { revision: number };

/** The compose file for the game servers on one host. */
export type GameComposeFile = {
  host_id: string;
  host: string;
  /** Folder of this host under gaming/ in the export bundle. */
  folder: string;
  compose: string;
  env: string;
  services: number;
};

export type ConfigBundle = {
  docker_compose: string;
  env: string;
  ansible_inventory: string;
  nginx: string;
  game_compose?: GameComposeFile[];
};

export type TopologyUpdateResponse = {
  build: Build;
  validation?: ValidationReport;
};

export const buildApi = {
  list: () => api.get<Build[]>('/api/builds'),
  get: (id: string) => api.get<Build>(`/api/builds/${id}`),
  create: (params: CreateBuildParams) => api.post<Build>('/api/builds', params),
  rename: (id: string, name: string, revision: number) =>
    api.patch<Build>(`/api/builds/${id}`, { name, revision }),
  updateTopology: (id: string, params: TopologyUpdateParams) =>
    serializeTopologyMutation(() =>
      api.put<TopologyUpdateResponse>(`/api/builds/${id}/topology`, params),
    ),
  delete: async (id: string) => {
    await api.del(`/api/builds/${id}`);
  },
  duplicate: (id: string) => api.post<Build>(`/api/builds/${id}/duplicate`, {}),
  validateNetwork: (id: string) =>
    api.post<Partial<ValidationReport>>(`/api/builds/${id}/validate-network`, {}),
  generateConfig: (id: string) => api.post<ConfigBundle>(`/api/builds/${id}/generate-config`, {}),
  downloadExportBundle: async (id: string) => {
    const response = await fetch(apiUrl(`/api/builds/${id}/export-bundle`), {
      headers: authHeaders(),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Export failed' }));
      throw new Error(error.error || 'Export failed');
    }
    const disposition = response.headers.get('content-disposition') || '';
    const filename = disposition.match(/filename="?([^";]+)"?/i)?.[1] || 'homelab-export.zip';
    return { blob: await response.blob(), filename };
  },
  share: (id: string) => api.post<Build>(`/api/builds/${id}/share`, {}),
  unshare: (id: string) => api.post<Build>(`/api/builds/${id}/unshare`, {}),
  setShareEditable: (id: string, editable: boolean) =>
    api.patch<Build>(`/api/builds/${id}/share`, { editable }),
  getShared: (token: string) => api.get<Build>(`/api/shared/${token}`),
  updateShared: (token: string, params: TopologyUpdateParams) =>
    api.put<Build>(`/api/shared/${token}`, params),
};
