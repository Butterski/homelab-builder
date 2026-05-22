import { api } from '../../../lib/api';

export interface Build {
  id: string;
  user_id: string;
  name: string;
  thumbnail?: string;
  total_power?: number;
  settings: any; // e.g. boughtItems, showBought
  share_token?: string;
  is_shared?: boolean;
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
  update: async (id: string, params: CreateBuildParams) => {
    const response = await api.put<Build>(`/api/builds/${id}`, params);
    return response;
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
  share: async (id: string) => {
    const response = await api.post<Build>(`/api/builds/${id}/share`, {});
    return response;
  },
  unshare: async (id: string) => {
    const response = await api.post<Build>(`/api/builds/${id}/unshare`, {});
    return response;
  },
  getShared: async (token: string) => {
    const response = await api.get<Build>(`/api/shared/${token}`);
    return response;
  },
};
