import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

export type InventoryKind = 'device' | 'component' | 'accessory';
export type InventoryStatus = 'available' | 'in_use' | 'reserved' | 'broken' | 'sold';
export type InventoryLocation = 'rack' | 'shelf' | 'drawer' | 'storage' | 'other';

/** The figures of an item. For a component they describe one unit. */
export type InventorySpecs = {
  cpu_model?: string;
  cpu_cores?: number;
  cpu_threads?: number;
  ram_gb?: number;
  /** For example "DDR4 SODIMM". */
  ram_type?: string;
  storage_gb?: number;
  /** For example "NVMe", "SATA SSD", "HDD". */
  storage_type?: string;
  ports?: number;
  port_speed?: string;
  rack_units?: number;
  /** A rack: how many units it holds. */
  rack_size?: number;
};

/** One place an item is planned: a device of a build, or a component inside one. */
export type InventoryPlacement = {
  build_id: string;
  build_name: string;
  node_id: string;
  /** The role the item plays there, or the host a component sits in. */
  node_name: string;
  component: boolean;
  quantity: number;
};

/** What an integration last reported about the machine an item is linked to. */
export type InventoryDeployment = {
  integration_id: string;
  integration_name: string;
  kind: string;
  /** The host's name there, for example "pve01". */
  ref: string;
  /** null when the last reading does not list the host. */
  online: boolean | null;
  version?: string;
  guests: number;
  synced_at: string | null;
};

/** A piece of hardware the user owns. It belongs to the account, not to a build. */
export type InventoryItem = {
  id: string;
  kind: InventoryKind;
  type: string;
  name: string;
  manufacturer: string;
  model: string;
  quantity: number;
  /** What the owner set. The form edits this. */
  status: InventoryStatus;
  /**
   * How the item stands: its status, or in use when a project plans it or a
   * host runs on it. Worked out by the server; lists and filters show this.
   */
  state: InventoryStatus;
  location: InventoryLocation;
  specs: InventorySpecs;
  mac_addresses: string[];
  power_draw: number;
  notes: string;
  integration_id?: string;
  integration_ref?: string;
  placements: InventoryPlacement[];
  deployment?: InventoryDeployment;
  created_at: string;
  updated_at: string;
};

/** An item as it is sent to the server. */
export type InventoryInput = {
  kind: InventoryKind;
  type: string;
  name: string;
  manufacturer?: string;
  model?: string;
  quantity?: number;
  status?: InventoryStatus;
  location?: InventoryLocation;
  specs?: InventorySpecs;
  mac_addresses?: string[];
  power_draw?: number;
  notes?: string;
};

type InventoryList = { items: InventoryItem[]; limit: number };

const inventoryApi = {
  list: () => api.get<InventoryList>('/api/inventory'),
  create: (input: InventoryInput) => api.post<InventoryItem>('/api/inventory', input),
  update: (id: string, input: InventoryInput) =>
    api.put<InventoryItem>(`/api/inventory/${id}`, input),
  remove: (id: string) => api.del<unknown>(`/api/inventory/${id}`),
};

export const INVENTORY_KEY = ['inventory'];

/** The user's inventory. With `enabled` off nothing is fetched (a visitor has none). */
export function useInventory(enabled = true) {
  return useQuery({ queryKey: INVENTORY_KEY, queryFn: inventoryApi.list, enabled });
}

/** Creates an item, or updates the one with the given id. */
export function useSaveInventoryItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: InventoryInput }) =>
      id ? inventoryApi.update(id, input) : inventoryApi.create(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: INVENTORY_KEY }),
  });
}

export function useDeleteInventoryItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: inventoryApi.remove,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: INVENTORY_KEY }),
  });
}
