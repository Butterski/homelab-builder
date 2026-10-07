import { describe, expect, it } from 'vitest';
import type { Service } from '../../../types';
import {
  categoryLabel,
  countByCategory,
  filterServiceCatalog,
  formatCores,
  formatDisk,
  formatRam,
  isUserService,
  parseTags,
  serviceVisibilityLabel,
  sortServices,
} from './service-catalog';

describe('service catalog helpers', () => {
  it('identifies private, pending, and owned services as user services', () => {
    expect(isUserService(makeService({ visibility: 'private' }))).toBe(true);
    expect(isUserService(makeService({ visibility: 'pending' }))).toBe(true);
    expect(isUserService(makeService({ user_id: 'user-1', visibility: 'public' }))).toBe(true);
    expect(isUserService(makeService({ visibility: 'public' }))).toBe(false);
  });

  it('filters the catalog to user-created services', () => {
    const publicService = makeService({ id: 'public', name: 'Jellyfin', visibility: 'public' });
    const privateService = makeService({ id: 'private', name: 'Personal Bot', visibility: 'private' });
    const pendingService = makeService({ id: 'pending', name: 'Friend Share', visibility: 'pending' });

    const result = filterServiceCatalog([publicService, privateService, pendingService], {
      category: 'mine',
      search: '',
      favoriteIds: new Set(),
    });

    expect(result.map(service => service.id)).toEqual(['private', 'pending']);
  });

  it('still applies search inside the user-created services filter', () => {
    const services = [
      makeService({ id: 'a', name: 'Private DNS', category: 'networking', visibility: 'private' }),
      makeService({ id: 'b', name: 'Private Photos', category: 'media', visibility: 'private' }),
    ];

    const result = filterServiceCatalog(services, {
      category: 'mine',
      search: 'dns',
      favoriteIds: new Set(),
    });

    expect(result.map(service => service.id)).toEqual(['a']);
  });

  it('labels non-public service visibility for cards', () => {
    expect(serviceVisibilityLabel(makeService({ visibility: 'private' }))).toBe('Private');
    expect(serviceVisibilityLabel(makeService({ visibility: 'pending' }))).toBe('In review');
    expect(serviceVisibilityLabel(makeService({ user_id: 'user-1', visibility: 'public' }))).toBe('Yours');
    expect(serviceVisibilityLabel(makeService({ visibility: 'public' }))).toBeNull();
  });
});

describe('the library as a table', () => {
  const needs = (ram: number, cpu: number, disk: number) => ({
    id: '',
    service_id: '',
    min_ram_mb: ram,
    recommended_ram_mb: ram * 2,
    min_cpu_cores: cpu,
    recommended_cpu_cores: cpu,
    min_storage_gb: disk,
    recommended_storage_gb: disk,
  });
  const services = [
    makeService({ id: 'b', name: 'bookstack', requirements: needs(512, 1, 2) }),
    makeService({ id: 'a', name: 'AdGuard Home', requirements: needs(128, 0.5, 2) }),
    makeService({ id: 'c', name: 'Counter-Strike 2', requirements: needs(2560, 2.5, 65) }),
    makeService({ id: 'n', name: 'No Needs', requirements: null }),
  ];

  it('sorts by name whatever the capitals', () => {
    expect(sortServices(services, { key: 'name', descending: false }).map(s => s.id)).toEqual(['a', 'b', 'c', 'n']);
    expect(sortServices(services, { key: 'name', descending: true }).map(s => s.id)).toEqual(['n', 'c', 'b', 'a']);
  });

  it('sorts by what a service needs, lightest first, and back', () => {
    expect(sortServices(services, { key: 'ram', descending: false }).map(s => s.id)).toEqual(['n', 'a', 'b', 'c']);
    expect(sortServices(services, { key: 'ram', descending: true }).map(s => s.id)).toEqual(['c', 'b', 'a', 'n']);
  });

  it('keeps services that need the same in the order of their names, both ways', () => {
    // AdGuard Home and BookStack both need 2 GB of disk.
    expect(sortServices(services, { key: 'disk', descending: false }).map(s => s.id)).toEqual(['n', 'a', 'b', 'c']);
    expect(sortServices(services, { key: 'disk', descending: true }).map(s => s.id)).toEqual(['c', 'a', 'b', 'n']);
  });

  it('does not reorder the list it was given', () => {
    const before = services.map(s => s.id);
    sortServices(services, { key: 'ram', descending: true });
    expect(services.map(s => s.id)).toEqual(before);
  });

  it('counts the services of each category, listed by their names', () => {
    const counted = countByCategory([
      makeService({ category: 'media' }),
      makeService({ category: 'home_automation' }),
      makeService({ category: 'media' }),
      makeService({ category: 'gaming' }),
    ]);
    expect(counted).toEqual([
      { category: 'gaming', count: 1 },
      { category: 'home_automation', count: 1 },
      { category: 'media', count: 2 },
    ]);
  });

  it('writes a stored category in words', () => {
    expect(categoryLabel('home_automation')).toBe('Home automation');
    expect(categoryLabel('media')).toBe('Media');
    expect(categoryLabel('')).toBe('Other');
  });

  it('reads tags however they were stored', () => {
    expect(parseTags('["dns", "privacy"]')).toEqual(['dns', 'privacy']);
    expect(parseTags(['a', 'b'])).toEqual(['a', 'b']);
    expect(parseTags('')).toEqual([]);
    expect(parseTags('not json')).toEqual([]);
    expect(parseTags('{"a":1}')).toEqual([]);
    expect(parseTags(undefined)).toEqual([]);
  });

  it('writes figures the way they are read', () => {
    expect(formatRam(128)).toBe('128 MB');
    expect(formatRam(1024)).toBe('1 GB');
    expect(formatRam(2560)).toBe('2.5 GB');
    expect(formatRam(0)).toBe('');
    expect(formatCores(0.5)).toBe('0.5');
    expect(formatCores(2)).toBe('2');
    expect(formatCores(undefined)).toBe('');
    expect(formatDisk(65)).toBe('65 GB');
    expect(formatDisk(2000)).toBe('2 TB');
    expect(formatDisk(0)).toBe('');
  });
});

function makeService(overrides: Partial<Service>): Service {
  return {
    id: 'service',
    name: 'Service',
    description: 'Test service',
    category: 'management',
    icon: '',
    official_website: '',
    docker_support: true,
    is_active: true,
    visibility: 'public',
    requirements: null,
    created_at: '',
    ...overrides,
  };
}
