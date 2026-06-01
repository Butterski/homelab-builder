import { describe, expect, it } from 'vitest';
import type { Service } from '../../../types';
import { filterServiceCatalog, isUserService, serviceVisibilityLabel } from './service-catalog';

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
