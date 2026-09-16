import { api } from '../../../lib/api';
import { apiUrl } from '../../../lib/api-base';

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
};

export type TopologyUpdateParams = CreateBuildParams & { revision: number };
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
    const response = await api.post<{
      docker_compose: string;
      env: string;
      ansible_inventory: string;
      nginx: string;
    }>(`/api/builds/${id}/generate-config`, {});
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
