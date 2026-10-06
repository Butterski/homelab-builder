import { api } from '../../../lib/api';
import { apiUrl } from '../../../lib/api-base';
import type { BuildKind, GamingPlan } from '../../../types';

let topologyQueue: Promise<void> = Promise.resolve();

function serializeTopologyMutation<T>(operation: () => Promise<T>): Promise<T> {
  const result = topologyQueue.then(operation, operation);
  topologyQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

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
  settings: any; // e.g. boughtItems, showBought
  share_token?: string;
  is_shared?: boolean;
  shared_editable?: boolean;
  created_at: string;
  updated_at: string;

  // Relational Data from Preloads
  nodes?: any[];
  edges?: any[];
  virtual_machines?: any[];
  service_instances?: any[];
}

export type CreateBuildParams = {
  name: string;
  thumbnail?: string;
  settings: any;
  nodes: any[];
  edges: any[];
  services: any[];
  /** Left out, the server keeps the kind and plan the build already has. */
  kind?: BuildKind;
  gaming_plan?: Partial<GamingPlan>;
};

export type TopologyUpdateParams = CreateBuildParams & { revision: number };

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
  validation?: { valid: boolean; errors: any[]; warnings: any[] };
};

export const buildApi = {
  list: async () => {
    const response = await api.get<Build[]>('/api/builds');
    return response; // api.get returns data directly in this codebase's wrapper
  },
  get: async (id: string) => {
    const response = await api.get<Build>(`/api/builds/${id}`);
    return response;
  },
  create: async (params: CreateBuildParams) => {
    const response = await api.post<Build>('/api/builds', params);
    return response;
  },
  rename: async (id: string, name: string, revision: number) => {
    const response = await api.patch<Build>(`/api/builds/${id}`, { name, revision });
    return response;
  },
  updateTopology: async (id: string, params: TopologyUpdateParams) => {
    return serializeTopologyMutation(() =>
      api.put<TopologyUpdateResponse>(`/api/builds/${id}/topology`, params),
    );
  },
  delete: async (id: string) => {
    await api.del(`/api/builds/${id}`);
  },
  duplicate: async (id: string) => {
    const response = await api.post<Build>(`/api/builds/${id}/duplicate`, {});
    return response;
  },
  calculateNetwork: async (id: string) => {
    await api.post(`/api/builds/${id}/calculate-network`, {});
  },
  validateNetwork: async (id: string) => {
    const response = await api.post<any>(`/api/builds/${id}/validate-network`, {});
    return response;
  },
  generateConfig: async (id: string) => {
    const response = await api.post<ConfigBundle>(`/api/builds/${id}/generate-config`, {});
    return response;
  },
  downloadExportBundle: async (id: string) => {
    const token = localStorage.getItem('auth_token');
    const response = await fetch(apiUrl(`/api/builds/${id}/export-bundle`), {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Export failed' }));
      throw new Error(error.error || 'Export failed');
    }
    const disposition = response.headers.get('content-disposition') || '';
    const filename = disposition.match(/filename="?([^";]+)"?/i)?.[1] || 'homelab-export.zip';
    return { blob: await response.blob(), filename };
  },
  share: async (id: string) => {
    const response = await api.post<Build>(`/api/builds/${id}/share`, {});
    return response;
  },
  unshare: async (id: string) => {
    const response = await api.post<Build>(`/api/builds/${id}/unshare`, {});
    return response;
  },
  setShareEditable: async (id: string, editable: boolean) => {
    const response = await api.patch<Build>(`/api/builds/${id}/share`, { editable });
    return response;
  },
  getShared: async (token: string) => {
    const response = await api.get<Build>(`/api/shared/${token}`);
    return response;
  },
  updateShared: async (token: string, params: TopologyUpdateParams) => {
    const response = await api.put<Build>(`/api/shared/${token}`, params);
    return response;
  },
};
