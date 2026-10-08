import type { Service } from '../../../types';
import { formatMemory } from '../../../lib/format';

type FilterInput = {
  category: string;
  search: string;
  favoriteIds: { has: (serviceId: string) => boolean };
};

export function isUserService(service: Service) {
  return (
    Boolean(service.user_id) || service.visibility === 'private' || service.visibility === 'pending'
  );
}

export function serviceVisibilityLabel(service: Service) {
  if (service.visibility === 'private') return 'Private';
  if (service.visibility === 'pending') return 'In review';
  if (service.user_id) return 'Yours';
  return null;
}

export function filterServiceCatalog(
  services: Service[],
  { category, search, favoriteIds }: FilterInput,
) {
  const normalizedSearch = search.trim().toLowerCase();
  let result = services;

  if (category === 'favorites') {
    result = result.filter(service => favoriteIds.has(service.id));
  } else if (category === 'mine') {
    result = result.filter(isUserService);
  } else if (category && category !== 'all') {
    result = result.filter(service => service.category.toLowerCase() === category.toLowerCase());
  }

  if (normalizedSearch) {
    result = result.filter(
      service =>
        service.name.toLowerCase().includes(normalizedSearch) ||
        service.description?.toLowerCase().includes(normalizedSearch) ||
        service.category.toLowerCase().includes(normalizedSearch),
    );
  }

  return result;
}

/** A category as it is stored ("home_automation") in words ("Home automation"). */
export function categoryLabel(category: string): string {
  const words = category.replace(/[_-]+/g, ' ').trim();
  return words ? words[0].toUpperCase() + words.slice(1) : 'Other';
}

/** How many services each category holds, in the order the categories are listed. */
export function countByCategory(services: Service[]): Array<{ category: string; count: number }> {
  const counts = new Map<string, number>();
  for (const service of services) {
    counts.set(service.category, (counts.get(service.category) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => categoryLabel(a.category).localeCompare(categoryLabel(b.category)));
}

/** Tags are stored as a JSON list in a string; anything else counts as no tags. */
export function parseTags(tags: Service['tags'] | string[] | undefined): string[] {
  if (Array.isArray(tags)) return tags.filter(tag => typeof tag === 'string');
  if (typeof tags !== 'string' || !tags.trim()) return [];
  try {
    const parsed: unknown = JSON.parse(tags);
    return Array.isArray(parsed)
      ? parsed.filter((tag): tag is string => typeof tag === 'string')
      : [];
  } catch {
    return [];
  }
}

export type ServiceSortKey = 'name' | 'ram' | 'cpu' | 'disk';
export type ServiceSort = { key: ServiceSortKey; descending: boolean };

/** The figure a column sorts by: the least a service needs to run. */
function figure(service: Service, key: Exclude<ServiceSortKey, 'name'>): number {
  const needs = service.requirements;
  if (!needs) return 0;
  if (key === 'ram') return needs.min_ram_mb;
  if (key === 'cpu') return needs.min_cpu_cores;
  return needs.min_storage_gb;
}

/** A sorted copy. Services that need the same stay in the order of their names, whichever way the column runs. */
export function sortServices(services: Service[], { key, descending }: ServiceSort): Service[] {
  const direction = descending ? -1 : 1;
  const byName = (a: Service, b: Service) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  return [...services].sort((a, b) => {
    if (key === 'name') return direction * byName(a, b);
    return direction * (figure(a, key) - figure(b, key)) || byName(a, b);
  });
}

export function formatRam(mb: number | undefined): string {
  return mb ? formatMemory(mb) : '';
}

export function formatCores(cores: number | undefined): string {
  if (!cores) return '';
  return String(Number(cores.toFixed(2)));
}

export function formatDisk(gb: number | undefined): string {
  if (!gb) return '';
  if (gb >= 1000) {
    const tb = gb / 1000;
    return `${Number.isInteger(tb) ? tb : tb.toFixed(1)} TB`;
  }
  return `${Number(gb.toFixed(1))} GB`;
}
