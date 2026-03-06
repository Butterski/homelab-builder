import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { api } from '../../../lib/api';

export interface HardwareComponent {
  id: string;
  category: string;
  brand: string;
  model: string;
  spec: Record<string, string | number | boolean>;
  price_est: number;
  currency: string;
  buy_urls: Array<{ store: string; url: string; condition: string }>;
  image_url: string;
  approved: boolean;
  likes: number;
  created_at: string;
}

export interface HardwareListResult {
  data: HardwareComponent[];
  total: number;
}

export interface HardwareFilter {
  category?: string;
  brand?: string;
  search?: string;
  min_price?: number;
  max_price?: number;
  limit?: number;
  offset?: number;
}

function buildQuery(f: HardwareFilter) {
  const p = new URLSearchParams();
  if (f.category) p.set('category', f.category);
  if (f.brand) p.set('brand', f.brand);
  if (f.search) p.set('search', f.search);
  if (f.min_price) p.set('min_price', String(f.min_price));
  if (f.max_price) p.set('max_price', String(f.max_price));
  if (f.limit) p.set('limit', String(f.limit));
  if (f.offset) p.set('offset', String(f.offset));
  return p.toString();
}

export function useHardware(filter: HardwareFilter = {}) {
  return useQuery<HardwareListResult>({
    queryKey: ['hardware', filter],
    queryFn: () => api.get<HardwareListResult>(`/api/hardware?${buildQuery(filter)}`),
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });
}

export function useHardwareCategories() {
  return useQuery<{ data: string[] }>({
    queryKey: ['hardware-categories'],
    queryFn: () => api.get<{ data: string[] }>('/api/hardware/categories'),
    staleTime: 300_000,
  });
}

export function useHardwareBrands(category?: string) {
  return useQuery<{ data: string[] }>({
    queryKey: ['hardware-brands', category],
    queryFn: () =>
      api.get<{ data: string[] }>(`/api/hardware/brands${category ? `?category=${category}` : ''}`),
    staleTime: 300_000,
  });
}
