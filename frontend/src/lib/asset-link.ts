/**
 * The link between something on a canvas and the physical thing it stands for:
 * an item of the owner's inventory, and the Proxmox host that item runs as.
 *
 * A node keeps the link in its details. The name on the node is its role in
 * that build ("proxmox-01"); the asset keeps its own name ("Lenovo M75q #1").
 */

/** Details keys that say which physical machine a node or component is. */
const ASSET_DETAIL_KEYS = [
  'inventory_item_id',
  'inventory_label',
  'inventory_quantity',
  'proxmox_node',
] as const;

/** The inventory item a node or component stands for, if any. */
export function assetIdOf(details: object | undefined | null): string | undefined {
  const id = (details as Record<string, unknown> | undefined | null)?.inventory_item_id;
  return typeof id === 'string' && id !== '' ? id : undefined;
}

/** Only the link: what must survive when the rest of the details is rewritten. */
export function assetLinkOf(details: object | undefined | null): Record<string, unknown> {
  const source = (details ?? {}) as Record<string, unknown>;
  const link: Record<string, unknown> = {};
  for (const key of ASSET_DETAIL_KEYS) {
    if (source[key] !== undefined) link[key] = source[key];
  }
  return link;
}

/**
 * The same details without the link. A copy of a device is another device: it
 * cannot be the same physical machine as the one it was copied from.
 */
export function withoutAssetLink<T extends object>(details: T): T {
  const copy = { ...details } as Record<string, unknown>;
  for (const key of ASSET_DETAIL_KEYS) delete copy[key];
  return copy as T;
}
