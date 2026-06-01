import type { Service } from '../../../types';

type FilterInput = {
  category: string;
  search: string;
  favoriteIds: { has: (serviceId: string) => boolean };
};

export function isUserService(service: Service) {
  return Boolean(service.user_id) || service.visibility === 'private' || service.visibility === 'pending';
}

export function serviceVisibilityLabel(service: Service) {
  if (service.visibility === 'private') return 'Private';
  if (service.visibility === 'pending') return 'In review';
  if (service.user_id) return 'Yours';
  return null;
}

export function filterServiceCatalog(services: Service[], { category, search, favoriteIds }: FilterInput) {
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
