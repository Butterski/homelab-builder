import { useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { toast } from 'sonner';
import { Page, PageHeader } from '../../../components/layout/page';
import { SeoMeta } from '../../../components/seo/seo-meta';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { cn } from '../../../lib/utils';
import type { Service } from '../../../types';
import { useAuth } from '../../auth/hooks/use-auth';
import { useBuilderStore } from '../../builder/store/builder-store';
import { useAddSelection, useRemoveSelection, useUserSelections } from '../api/use-services';
import { CustomServiceDialog } from '../components/custom-service-dialog';
import { ServiceTable } from '../components/service-table';
import {
  categoryLabel,
  countByCategory,
  filterServiceCatalog,
  isUserService,
  sortServices,
  type ServiceSort,
  type ServiceSortKey,
} from '../lib/service-catalog';

const servicesStructuredData = {
  '@context': 'https://schema.org',
  '@type': 'CollectionPage',
  name: 'Self-hosted service library',
  url: 'https://hlbldr.com/services',
  description:
    'Browse self-hosted services for homelab planning, including media, networking, monitoring, storage, management, home automation, and gaming services.',
  isPartOf: {
    '@type': 'WebSite',
    name: 'HLBuilder',
    url: 'https://hlbldr.com/',
  },
};

type Filter = { id: string; label: string; count: number };

/** One way to narrow the list. A row in the rail on a wide screen, a chip on a narrow one. */
function FilterButton({
  filter,
  pressed,
  onPress,
}: {
  filter: Filter;
  pressed: boolean;
  onPress: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onPress}
      className={cn(
        'flex min-h-8 shrink-0 items-center justify-between gap-3 rounded-md border px-3 text-sm transition-colors hover:cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring lg:w-full lg:border-transparent lg:px-2.5',
        pressed
          ? 'border-foreground font-medium text-foreground lg:bg-muted'
          : 'text-muted-foreground hover:text-foreground lg:hover:bg-muted/50',
      )}
    >
      <span className="truncate">{filter.label}</span>
      <span className="app-figure text-xs font-normal text-muted-foreground">{filter.count}</span>
    </button>
  );
}

export default function ServiceCatalogPage() {
  const { user } = useAuth();
  const availableServices = useBuilderStore(state => state.availableServices);
  const fetchServices = useBuilderStore(state => state.fetchServices);
  const { data: selectionsData } = useUserSelections({ enabled: !!user });
  const addSelection = useAddSelection();
  const removeSelection = useRemoveSelection();

  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [sort, setSort] = useState<ServiceSort>({ key: 'name', descending: false });
  const [creating, setCreating] = useState(false);
  const [loaded, setLoaded] = useState(availableServices.length > 0);

  useEffect(() => {
    let cancelled = false;
    void fetchServices().finally(() => {
      if (!cancelled) setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [fetchServices]);

  /** Service id to the id of the selection that marks it as a favorite. */
  const favoriteIds = useMemo(() => {
    const map = new Map<string, string>();
    for (const selection of selectionsData?.data ?? []) map.set(selection.service_id, selection.id);
    return map;
  }, [selectionsData]);

  const items = useMemo(
    () =>
      sortServices(
        filterServiceCatalog(availableServices, { category, search, favoriteIds }),
        sort,
      ),
    [availableServices, category, search, favoriteIds, sort],
  );

  const ownCount = useMemo(
    () => availableServices.filter(isUserService).length,
    [availableServices],
  );
  const categories = useMemo(() => countByCategory(availableServices), [availableServices]);

  const shelves: Filter[] = [
    { id: '', label: 'All services', count: availableServices.length },
    ...(user
      ? [
          { id: 'favorites', label: 'Favorites', count: favoriteIds.size },
          { id: 'mine', label: 'My services', count: ownCount },
        ]
      : []),
  ];
  const categoryFilters: Filter[] = categories.map(entry => ({
    id: entry.category,
    label: categoryLabel(entry.category),
    count: entry.count,
  }));
  const current = [...shelves, ...categoryFilters].find(filter => filter.id === category);

  const toggleFavorite = (service: Service) => {
    const selectionId = favoriteIds.get(service.id);
    if (selectionId) removeSelection.mutate(selectionId);
    else addSelection.mutate(service.id);
  };

  const handleSort = (key: ServiceSortKey) =>
    setSort(previous =>
      previous.key === key
        ? { key, descending: !previous.descending }
        : // A name starts at A; a figure starts with the lightest service.
          { key, descending: false },
    );

  const handleServiceSaved = (service: Service, submittedToCommunity: boolean) => {
    setSearch('');
    setCategory('mine');
    toast.success(
      submittedToCommunity
        ? `${service.name} saved and submitted for review`
        : `${service.name} saved to My services`,
    );
  };

  const narrowed = Boolean(search.trim() || category);
  const clear = () => {
    setSearch('');
    setCategory('');
  };

  return (
    <Page>
      <SeoMeta
        title="Self-Hosted Service Library | HLBuilder"
        description="Browse self-hosted services for a homelab, compare categories, and plan which workloads belong in your network design."
        path="/services"
        keywords={[
          'self-hosted services',
          'homelab services',
          'self-hosting planner',
          'homelab apps',
          'home server services',
        ]}
        structuredData={servicesStructuredData}
      />
      <CustomServiceDialog
        open={creating}
        onOpenChange={setCreating}
        onSaved={handleServiceSaved}
      />

      <PageHeader
        title="Service Library"
        lede={
          user
            ? 'Self-hosted services and the least each one needs to run. Your favorites are listed first in the library on the canvas.'
            : 'Self-hosted services and the least each one needs to run.'
        }
        actions={user && <Button onClick={() => setCreating(true)}>Add a service</Button>}
      />

      <div className="grid gap-x-10 gap-y-5 pt-6 lg:grid-cols-[13rem_minmax(0,1fr)]">
        <div className="grid h-fit gap-4 lg:sticky lg:top-6">
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              type="search"
              aria-label="Search services"
              placeholder="Search services"
              className="pl-9"
              value={search}
              onChange={event => setSearch(event.target.value)}
            />
          </div>
          <nav
            aria-label="Filter services"
            className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-1 sm:-mx-8 sm:px-8 lg:mx-0 lg:grid lg:gap-0.5 lg:overflow-visible lg:px-0 lg:pb-0"
          >
            {shelves.map(filter => (
              <FilterButton
                key={filter.id || 'all'}
                filter={filter}
                pressed={category === filter.id}
                onPress={() => setCategory(filter.id)}
              />
            ))}
            <div className="hidden lg:my-2 lg:block lg:border-t" aria-hidden="true" />
            {categoryFilters.map(filter => (
              <FilterButton
                key={filter.id}
                filter={filter}
                pressed={category === filter.id}
                onPress={() => setCategory(category === filter.id ? '' : filter.id)}
              />
            ))}
          </nav>
        </div>

        <div className="min-w-0">
          <p
            className="flex min-h-8 items-center gap-4 text-sm text-muted-foreground"
            aria-live="polite"
          >
            {loaded && (
              <span>
                {items.length} {items.length === 1 ? 'service' : 'services'}
                {category && current ? ` in ${current.label}` : ''}
                {search.trim() ? ` matching “${search.trim()}”` : ''}
              </span>
            )}
            {narrowed && (
              <button type="button" onClick={clear} className="app-link hover:cursor-pointer">
                Show all
              </button>
            )}
          </p>

          {!loaded ? (
            <div className="grid gap-px pt-2" aria-hidden="true">
              {Array.from({ length: 8 }).map((_, index) => (
                <div key={index} className="h-12 animate-pulse border-b bg-muted/30" />
              ))}
            </div>
          ) : items.length === 0 ? (
            <div className="app-empty-state mt-2 px-6 py-12">
              <h2 className="font-semibold">
                {category === 'favorites' && !search.trim()
                  ? 'No favorites yet'
                  : category === 'mine' && !search.trim()
                    ? 'You have not added a service yet'
                    : 'No service matches'}
              </h2>
              <p className="mt-1 max-w-md text-sm text-muted-foreground">
                {category === 'favorites' && !search.trim()
                  ? 'Mark a service with the heart in front of its name. Favorites are listed first in the library on the canvas.'
                  : category === 'mine' && !search.trim()
                    ? 'A service of your own is private to your account until you submit it for the public library.'
                    : 'Try another word, or another category.'}
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                {category === 'mine' && !search.trim() ? (
                  <Button onClick={() => setCreating(true)}>Add a service</Button>
                ) : (
                  <Button variant="outline" onClick={clear}>
                    Show all services
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <ServiceTable
              services={items}
              sort={sort}
              onSort={handleSort}
              showCategory={!categoryFilters.some(filter => filter.id === category)}
              favorites={
                user ? { has: id => favoriteIds.has(id), toggle: toggleFavorite } : undefined
              }
            />
          )}
        </div>
      </div>
    </Page>
  );
}
