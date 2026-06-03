import { useEffect, useMemo, useState } from 'react';
import { useBuilderStore } from '../../builder/store/builder-store';
import {
  useUserSelections,
  useAddSelection,
  useRemoveSelection,
  useCreateCustomService,
  useSubmitCustomService,
  type CustomServicePayload,
} from '../api/use-services';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Search, Heart, Package, Book, Globe, Plus, X, Loader2, Check } from 'lucide-react';
import type { Service } from '../../../types';
import { Github } from '../../../components/icons/github';
import { SeoMeta } from '../../../components/seo/seo-meta';
import { toast } from 'sonner';
import { filterServiceCatalog, isUserService, serviceVisibilityLabel } from '../lib/service-catalog';

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

function ServiceCard({
  item,
  isFavorite,
  selectionId,
}: {
  item: Service;
  isFavorite: boolean;
  selectionId?: string;
}) {
  const addSelection = useAddSelection();
  const removeSelection = useRemoveSelection();
  const visibilityLabel = serviceVisibilityLabel(item);

  const handleFavorite = () => {
    if (isFavorite && selectionId) {
      removeSelection.mutate(selectionId);
    } else {
      addSelection.mutate(item.id);
    }
  };

  const tagsArray: string[] = Array.isArray(item.tags)
    ? item.tags
    : typeof item.tags === 'string'
      ? JSON.parse(item.tags || '[]')
      : [];

  return (
    <div className="group rounded-xl border bg-card hover:border-primary/40 transition-all duration-200 overflow-hidden flex flex-col h-full">
      <div className="p-4 flex items-start gap-4 flex-1">
        <div className="p-2.5 rounded-lg shrink-0 text-blue-500 bg-blue-500/10">
          <Package className="size-6" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2 max-w-full">
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2">
                <h3 className="truncate text-base font-semibold">{item.name}</h3>
                {visibilityLabel && (
                  <span className="shrink-0 rounded-md border border-primary/20 bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                    {visibilityLabel}
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground capitalize mt-0.5">{item.category}</p>
            </div>
            <button
              type="button"
              onClick={handleFavorite}
              className={`shrink-0 p-1.5 rounded-md hover:bg-muted/60 transition-colors hover:cursor-pointer ${isFavorite ? 'text-red-500 hover:text-red-400' : 'text-muted-foreground hover:text-red-400'}`}
            >
              <Heart className={`size-4 ${isFavorite ? 'fill-red-500' : ''}`} />
            </button>
          </div>
          <p className="text-sm text-foreground/80 mt-2 line-clamp-3">
            {item.description || 'No description provided.'}
          </p>
        </div>
      </div>

      <div className="border-t px-4 py-3 bg-muted/20 flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <div className="flex gap-1.5 flex-wrap">
          {tagsArray.slice(0, 3).map(tag => (
            <span
              key={tag}
              className="px-1.5 py-0.5 rounded-md bg-muted text-[10px] font-medium border"
            >
              {tag}
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          {item.official_website && (
            <a
              href={item.official_website}
              target="_blank"
              rel="noreferrer"
              title="Website"
              className="hover:text-primary transition-colors"
            >
              <Globe className="size-4" />
            </a>
          )}
          {item.docs_url && (
            <a
              href={item.docs_url}
              target="_blank"
              rel="noreferrer"
              title="Documentation"
              className="hover:text-primary transition-colors"
            >
              <Book className="size-4" />
            </a>
          )}
          {item.github_url && (
            <a
              href={item.github_url}
              target="_blank"
              rel="noreferrer"
              title="GitHub"
              className="hover:text-primary transition-colors"
            >
              <Github className="size-4" />
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

const SERVICE_CATEGORIES = [
  'media',
  'networking',
  'monitoring',
  'storage',
  'management',
  'home_automation',
  'gaming',
  'other',
];

function CustomServiceModal({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: (service: Service, submittedToCommunity: boolean) => void;
}) {
  const { fetchServices } = useBuilderStore();
  const createService = useCreateCustomService();
  const submitService = useSubmitCustomService();
  const [name, setName] = useState('');
  const [category, setCategory] = useState('other');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState('custom, useful');
  const [website, setWebsite] = useState('');
  const [docs, setDocs] = useState('');
  const [github, setGithub] = useState('');
  const [minCpu, setMinCpu] = useState('0.5');
  const [recCpu, setRecCpu] = useState('1');
  const [minRam, setMinRam] = useState('256');
  const [recRam, setRecRam] = useState('512');
  const [minStorage, setMinStorage] = useState('1');
  const [recStorage, setRecStorage] = useState('5');
  const [dockerSupport, setDockerSupport] = useState(true);
  const [submitToCommunity, setSubmitToCommunity] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const parseNumber = (value: string) => Number(value || 0);

  const handleSave = async () => {
    setError('');
    if (!name.trim() || !description.trim()) {
      setError('Name and description are required.');
      return;
    }

    const payload: CustomServicePayload = {
      name: name.trim(),
      description: description.trim(),
      category,
      official_website: website.trim(),
      docs_url: docs.trim(),
      github_url: github.trim(),
      tags: JSON.stringify(tags.split(',').map(tag => tag.trim()).filter(Boolean)),
      docker_support: dockerSupport,
      min_cpu_cores: parseNumber(minCpu),
      recommended_cpu_cores: parseNumber(recCpu),
      min_ram_mb: parseNumber(minRam),
      recommended_ram_mb: parseNumber(recRam),
      min_storage_gb: parseNumber(minStorage),
      recommended_storage_gb: parseNumber(recStorage),
    };

    try {
      const created = await createService.mutateAsync(payload);
      let savedService = created.data;
      if (submitToCommunity) {
        const submitted = await submitService.mutateAsync(created.data.id);
        savedService = submitted.data;
      }
      await fetchServices();
      onSaved(savedService, submitToCommunity);
      setSuccess(true);
      setTimeout(onClose, 900);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not save service.';
      setError(message);
      toast.error(message);
    }
  };

  const pending = createService.isPending || submitService.isPending;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/65" onClick={onClose} role="presentation" />
      <div className="relative z-10 w-full max-w-3xl overflow-hidden rounded-xl border bg-card shadow-xl">
        <div className="flex items-center justify-between border-b px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold">Custom Service</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">Private first, community optional</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-1.5 hover:bg-muted">
            <X className="size-4" />
          </button>
        </div>

        {success ? (
          <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
            <div className="mb-4 flex size-14 items-center justify-center rounded-full bg-green-500/10 text-green-600">
              <Check className="size-7" />
            </div>
            <p className="font-semibold">Service saved</p>
          </div>
        ) : (
          <div className="max-h-[78vh] space-y-5 overflow-y-auto p-6">
            <div className="grid gap-3 sm:grid-cols-[1fr_190px]">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Name</label>
                <Input value={name} onChange={event => setName(event.target.value)} />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Category</label>
                <select
                  className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                  value={category}
                  onChange={event => setCategory(event.target.value)}
                >
                  {SERVICE_CATEGORIES.map(cat => (
                    <option key={cat} value={cat}>
                      {cat.replace('_', ' ')}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Description</label>
              <textarea
                className="min-h-20 w-full resize-none rounded-md border bg-background px-3 py-2 text-sm"
                value={description}
                onChange={event => setDescription(event.target.value)}
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <ServiceNumber label="Min CPU" value={minCpu} setValue={setMinCpu} />
              <ServiceNumber label="Rec CPU" value={recCpu} setValue={setRecCpu} />
              <ServiceNumber label="Min RAM MB" value={minRam} setValue={setMinRam} />
              <ServiceNumber label="Rec RAM MB" value={recRam} setValue={setRecRam} />
              <ServiceNumber label="Min Disk GB" value={minStorage} setValue={setMinStorage} />
              <ServiceNumber label="Rec Disk GB" value={recStorage} setValue={setRecStorage} />
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <Input placeholder="Website" value={website} onChange={event => setWebsite(event.target.value)} />
              <Input placeholder="Docs" value={docs} onChange={event => setDocs(event.target.value)} />
              <Input placeholder="GitHub" value={github} onChange={event => setGithub(event.target.value)} />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Tags</label>
              <Input value={tags} onChange={event => setTags(event.target.value)} />
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              <label className="flex items-center justify-between rounded-md border bg-muted/20 px-3 py-2 text-sm">
                <span>Docker support</span>
                <input type="checkbox" className="size-4" checked={dockerSupport} onChange={event => setDockerSupport(event.target.checked)} />
              </label>
              <label className="flex items-center justify-between rounded-md border bg-muted/20 px-3 py-2 text-sm">
                <span>Submit to community</span>
                <input type="checkbox" className="size-4" checked={submitToCommunity} onChange={event => setSubmitToCommunity(event.target.checked)} />
              </label>
            </div>

            {error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

            <div className="flex justify-end gap-2 border-t pt-4">
              <Button variant="outline" onClick={onClose} disabled={pending}>Cancel</Button>
              <Button onClick={handleSave} disabled={pending}>
                {pending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
                Save Service
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ServiceNumber({
  label,
  value,
  setValue,
}: {
  label: string;
  value: string;
  setValue: (value: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      <Input type="number" min="0" step="0.5" value={value} onChange={event => setValue(event.target.value)} />
    </div>
  );
}

export default function ServiceCatalogPage() {
  const { availableServices, fetchServices } = useBuilderStore();
  const { data: selectionsData, isLoading } = useUserSelections();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [showCreator, setShowCreator] = useState(false);

  useEffect(() => {
    fetchServices();
  }, [fetchServices]);

  const selections = useMemo(() => selectionsData?.data || [], [selectionsData]);
  const favSet = useMemo(() => {
    const map = new Map<string, string>();
    selections.forEach(s => map.set(s.service_id, s.id));
    return map;
  }, [selections]);

  const items = useMemo(() => {
    return filterServiceCatalog(availableServices, { category, search, favoriteIds: favSet });
  }, [availableServices, category, search, favSet]);

  const categories = useMemo(() => {
    const cats = new Set(availableServices.map(s => s.category));
    return Array.from(cats).sort();
  }, [availableServices]);

  const myServicesCount = useMemo(() => availableServices.filter(isUserService).length, [availableServices]);

  const handleServiceSaved = (service: Service, submittedToCommunity: boolean) => {
    setSearch('');
    setCategory('mine');
    toast.success(
      submittedToCommunity
        ? `${service.name} saved and submitted for review`
        : `${service.name} saved to My services`,
    );
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto py-8 px-6">
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
      {showCreator && (
        <CustomServiceModal onClose={() => setShowCreator(false)} onSaved={handleServiceSaved} />
      )}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Service Library</h1>
          <p className="text-muted-foreground mt-1">
            Discover and favorite self-hosted services for your homelab
          </p>
        </div>
        <Button size="sm" onClick={() => setShowCreator(true)}>
          <Plus className="size-4 mr-2" /> Create Service
        </Button>
      </div>

      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-50 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            placeholder="Search services..."
            className="pl-9"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setCategory('')}
          className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${!category || category === 'all' ? 'bg-primary text-primary-foreground border-primary' : 'border-border hover:bg-muted'}`}
        >
          All
        </button>
        <button
          type="button"
          onClick={() => setCategory('favorites')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors hover:cursor-pointer ${category === 'favorites' ? 'bg-red-500/10 text-red-500 border-red-500/20' : 'border-border hover:bg-muted'}`}
        >
          <Heart className={`size-3 ${category === 'favorites' ? 'fill-red-500' : ''}`} />
          Favorites
        </button>
        <button
          type="button"
          onClick={() => setCategory(category === 'mine' ? '' : 'mine')}
          className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors hover:cursor-pointer ${category === 'mine' ? 'border-primary bg-primary text-primary-foreground' : 'border-border hover:bg-muted'}`}
        >
          <Package className="size-3" />
          My services
          <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${category === 'mine' ? 'bg-background/20' : 'bg-muted text-muted-foreground'}`}>
            {myServicesCount}
          </span>
        </button>
        {categories.map(cat => (
          <button
            key={cat}
            type="button"
            onClick={() => setCategory(cat === category ? '' : cat)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium border capitalize transition-colors ${cat === category ? 'bg-primary text-primary-foreground border-primary' : 'border-border hover:bg-muted'}`}
          >
            {cat}
          </button>
        ))}
      </div>

      {items.length === 0 && !isLoading ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Book className="size-12 text-muted-foreground/40 mb-4" />
          <h3 className="font-semibold text-lg mb-1">No services found</h3>
          <p className="text-muted-foreground text-sm">Try adjusting your filters.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {items.map(item => (
            <ServiceCard
              key={item.id}
              item={item}
              isFavorite={favSet.has(item.id)}
              selectionId={favSet.get(item.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
