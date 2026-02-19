
import { api } from "../../../lib/api";

export interface Build {
    id: string;
    user_id: string;
    name: string;
    data: string; // JSON string of builder state
    thumbnail?: string;
    created_at: string;
    updated_at: string;

    // Relational Data (Optional, populated by backend Preload)
    nodes?: any[];
    edges?: any[];
    virtual_machines?: any[];
    service_instances?: any[];
}

export type CreateBuildParams = {
    name: string;
    data: string;
    thumbnail?: string;
};

export const buildApi = {
    list: async () => {
        const response = await api.get<Build[]>("/api/builds");
        return response; // api.get returns data directly in this codebase's wrapper
    },
    get: async (id: string) => {
        const response = await api.get<Build>(`/api/builds/${id}`);
        return response;
    },
    create: async (params: CreateBuildParams) => {
        const response = await api.post<Build>("/api/builds", params);
        return response;
    },
    update: async (id: string, params: CreateBuildParams) => {
        const response = await api.put<Build>(`/api/builds/${id}`, params);
        return response;
    },
    delete: async (id: string) => {
        await api.del(`/api/builds/${id}`);
    },
    calculateNetwork: async (id: string) => {
        await api.post(`/api/builds/${id}/calculate-network`, {});
    },
};
