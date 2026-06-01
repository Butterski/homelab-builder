import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../lib/api';
import type { HardwareNode, HardwareType, Service } from '../../../types';

export type HardwareBlueprintVisibility = 'private' | 'pending' | 'community';

export interface HardwareBlueprintFitResource {
  cpu_cores: number;
  ram_gb: number;
  storage_gb: number;
  power_w: number;
  ports: number;
  network_gbps: number;
  drive_bays: number;
  disks: number;
  gpus: number;
}

export interface HardwareBlueprintFit {
  score: number;
  grade: 'excellent' | 'good' | 'tight' | 'risky';
  label: string;
  summary: string;
  capacity: HardwareBlueprintFitResource;
  demand: HardwareBlueprintFitResource;
  utilization: {
    cpu: number;
    ram: number;
    storage: number;
    ports: number;
    network: number;
  };
  factors: Array<{
    key: string;
    label: string;
    score: number;
    weight: number;
    note: string;
  }>;
}

export interface HardwareBlueprint {
  id: string;
  user_id: string;
  name: string;
  description: string;
  category: string;
  node_type: HardwareType;
  visibility: HardwareBlueprintVisibility;
  tags: string[];
  node_data: Partial<HardwareNode>;
  services: Service[];
  upvotes: number;
  downvotes: number;
  share_code?: string;
  moderation_status?: 'none' | 'pending' | 'approved' | 'rejected';
  moderation_note?: string;
  reviewed_by?: string;
  reviewed_at?: string;
  fit?: HardwareBlueprintFit;
  created_at: string;
  updated_at: string;
}

export interface HardwareBlueprintPayload {
  name: string;
  description?: string;
  category: string;
  node_type: HardwareType;
  tags: string[];
  node_data: Partial<HardwareNode>;
  services: Service[];
}

export interface HardwareBlueprintExport {
  version: 1;
  kind: 'hlbuilder.hardware_blueprint';
  name: string;
  description: string;
  category: string;
  node_type: HardwareType;
  tags: string[];
  node_data: Partial<HardwareNode>;
  services: Service[];
  share_code?: string;
  exported_at: string;
  source_id?: string;
}

export function useHardwareBlueprints() {
  return useQuery<{ data: HardwareBlueprint[] }>({
    queryKey: ['hardware-blueprints'],
    queryFn: () => api.get<{ data: HardwareBlueprint[] }>('/api/hardware-blueprints'),
    staleTime: 30_000,
  });
}

export function useCommunityHardwareBlueprints() {
  return useQuery<{ data: HardwareBlueprint[] }>({
    queryKey: ['hardware-blueprints', 'community'],
    queryFn: () => api.get<{ data: HardwareBlueprint[] }>('/api/hardware-blueprints/community'),
    staleTime: 60_000,
  });
}

export function useCreateHardwareBlueprint() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: HardwareBlueprintPayload) =>
      api.post<{ data: HardwareBlueprint }>('/api/hardware-blueprints', payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hardware-blueprints'] });
    },
  });
}

export function useSubmitHardwareBlueprint() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.patch<{ data: HardwareBlueprint }>(`/api/hardware-blueprints/${id}/submit`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hardware-blueprints'] });
    },
  });
}

export function useExportHardwareBlueprint() {
  return useMutation({
    mutationFn: (id: string) =>
      api.get<{ data: HardwareBlueprintExport }>(`/api/hardware-blueprints/${id}/export`),
  });
}

export function useCreateHardwareBlueprintShareCode() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.post<{ data: HardwareBlueprint }>(`/api/hardware-blueprints/${id}/share-code`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hardware-blueprints'] });
    },
  });
}

export function useImportHardwareBlueprint() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: { import_code?: string; blueprint?: HardwareBlueprintExport }) =>
      api.post<{ data: HardwareBlueprint }>('/api/hardware-blueprints/import', payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hardware-blueprints'] });
    },
  });
}

export function useAdminHardwareBlueprints(status = 'pending') {
  return useQuery<{ data: HardwareBlueprint[] }>({
    queryKey: ['admin-hardware-blueprints', status],
    queryFn: () => api.get<{ data: HardwareBlueprint[] }>(`/api/admin/hardware-blueprints?status=${status}`),
    staleTime: 20_000,
  });
}

export function useModerateHardwareBlueprint() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action, note }: { id: string; action: 'approve' | 'reject' | 'pending'; note?: string }) =>
      api.patch<{ data: HardwareBlueprint }>(`/api/admin/hardware-blueprints/${id}/moderate`, { action, note }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-hardware-blueprints'] });
      queryClient.invalidateQueries({ queryKey: ['hardware-blueprints'] });
      queryClient.invalidateQueries({ queryKey: ['hardware-blueprints', 'community'] });
    },
  });
}

export function useVoteHardwareBlueprint() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, value }: { id: string; value: -1 | 0 | 1 }) =>
      api.post<{ data: HardwareBlueprint }>(`/api/hardware-blueprints/${id}/vote`, { value }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hardware-blueprints'] });
      queryClient.invalidateQueries({ queryKey: ['hardware-blueprints', 'community'] });
    },
  });
}
