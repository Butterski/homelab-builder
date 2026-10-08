import {
  memo,
  useDeferredValue,
  useMemo,
  useReducer,
  useState,
  type ChangeEvent,
  type FormEvent,
  type ReactNode,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  ChevronDown,
  Clipboard,
  Download,
  Heart,
  Loader2,
  Search,
  X,
} from 'lucide-react';
import { Page, PageHeader } from '../../../components/layout/page';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { SeoMeta } from '../../../components/seo/seo-meta';
import { api } from '../../../lib/api';
import { hardwareCategoryLabel, normalizeHardwareCategory } from '../../../lib/hardware-taxonomy';
import {
  useAddHardwareFavorite,
  useHardware,
  useHardwareCategories,
  useHardwareFavorites,
  useRemoveHardwareFavorite,
  type HardwareComponent,
} from '../api/use-hardware';
import {
  useCreateHardwareBlueprintShareCode,
  useExportHardwareBlueprint,
  useHardwareBlueprints,
  useImportHardwareBlueprint,
  useSubmitHardwareBlueprint,
  type HardwareBlueprintExport,
  type HardwareBlueprint,
} from '../api/use-hardware-blueprints';
import { CapacityBar, HardwareBlueprintCreator } from '../components/hardware-blueprint-creator';
import {
  blueprintMetricBars,
  componentSummary,
  estimateBlueprintFit,
  fitTone,
} from '../lib/blueprint-fit';
import { errorMessage } from '../../../lib/utils';

const PAGE_SIZE = 24;

const hardwareStructuredData = {
  '@context': 'https://schema.org',
  '@type': 'CollectionPage',
  name: 'Homelab hardware catalog',
  url: 'https://hlbldr.com/hardware',
  description:
    'Browse homelab routers, switches, NAS devices, servers, mini PCs, SBCs, UPS units, and reusable build blueprints.',
  isPartOf: {
    '@type': 'WebSite',
    name: 'HLBuilder',
    url: 'https://hlbldr.com/',
  },
};

const CATEGORY_META: Record<string, { label: string }> = {
  router: { label: 'Routers' },
  switch: { label: 'Switches' },
  nas: { label: 'NAS' },
  server: { label: 'Servers' },
  minipc: { label: 'Mini PCs' },
  sbc: { label: 'SBCs' },
  access_point: { label: 'Access Points' },
  ups: { label: 'UPS' },
  storage: { label: 'Storage' },
  disk: { label: 'Storage' },
  ram: { label: 'RAM' },
  gpu: { label: 'GPUs' },
  hba: { label: 'HBA Cards' },
  nic: { label: 'NICs' },
  accessory: { label: 'Accessories' },
  rack: { label: 'Racks' },
  pdu: { label: 'PDUs' },
  iot: { label: 'IoT' },
  modem: { label: 'Modems' },
  pc: { label: 'PCs' },
  console: { label: 'Consoles' },
};

type CatalogSource = 'all' | 'blueprints' | 'components' | 'favorites';
type SortMode = 'fit' | 'popular' | 'recent' | 'price' | 'name';

type SubmitState = {
  category: string;
  brand: string;
  model: string;
  price_est: string;
  currency: string;
  buy_url: string;
  buy_store: string;
  spec_raw: string;
  loading: boolean;
  error: string;
  success: boolean;
};

type SubmitAction =
  | { type: 'SET_FIELD'; field: string; value: string }
  | { type: 'SET_LOADING'; value: boolean }
  | { type: 'SET_ERROR'; value: string }
  | { type: 'SET_SUCCESS'; value: boolean };

const initialSubmitState: SubmitState = {
  category: 'router',
  brand: '',
  model: '',
  price_est: '',
  currency: 'EUR',
  buy_url: '',
  buy_store: '',
  spec_raw: '',
  loading: false,
  error: '',
  success: false,
};

function submitReducer(state: SubmitState, action: SubmitAction): SubmitState {
  switch (action.type) {
    case 'SET_FIELD':
      return { ...state, [action.field]: action.value };
    case 'SET_LOADING':
      return { ...state, loading: action.value };
    case 'SET_ERROR':
      return { ...state, error: action.value };
    case 'SET_SUCCESS':
      return { ...state, success: action.value };
    default:
      return state;
  }
}

function SubmitHardwareModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [state, dispatch] = useReducer(submitReducer, initialSubmitState);

  const setField =
    (field: string) =>
    (event: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      dispatch({ type: 'SET_FIELD', field, value: event.target.value });

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    dispatch({ type: 'SET_ERROR', value: '' });
    if (!state.brand.trim() || !state.model.trim()) {
      dispatch({ type: 'SET_ERROR', value: 'Brand and model are required.' });
      return;
    }

    let spec: Record<string, string | number | boolean> = {};
    if (state.spec_raw.trim()) {
      try {
        spec = JSON.parse(state.spec_raw);
      } catch {
        dispatch({ type: 'SET_ERROR', value: 'Spec must be valid JSON.' });
        return;
      }
    }

    const buy_urls = state.buy_url.trim()
      ? [{ store: state.buy_store || 'Store', url: state.buy_url.trim(), condition: 'new' }]
      : [];

    dispatch({ type: 'SET_LOADING', value: true });
    try {
      await api.post('/api/hardware', {
        category: state.category,
        brand: state.brand.trim(),
        model: state.model.trim(),
        price_est: parseFloat(state.price_est) || 0,
        currency: state.currency,
        buy_urls,
        spec,
      });
      dispatch({ type: 'SET_SUCCESS', value: true });
      qc.invalidateQueries({ queryKey: ['hardware'] });
      setTimeout(onClose, 1400);
    } catch (err: unknown) {
      dispatch({ type: 'SET_ERROR', value: errorMessage(err, 'Submission failed.') });
    } finally {
      dispatch({ type: 'SET_LOADING', value: false });
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} role="presentation" />
      <div className="relative z-10 w-full max-w-lg overflow-hidden rounded-xl border bg-card shadow-xl">
        <div className="flex items-start justify-between border-b px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold">Submit Component</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">Reviewed catalog hardware</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-1.5 hover:bg-muted">
            <X className="size-4" />
          </button>
        </div>

        {state.success ? (
          <div className="px-6 py-10" role="status">
            <h3 className="font-semibold">Submitted</h3>
            <p className="mt-1 text-sm text-muted-foreground">The component is waiting for review.</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4 p-6">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Category">
                <select
                  className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                  value={state.category}
                  onChange={setField('category')}
                >
                  {Object.entries(CATEGORY_META).map(([key, meta]) => (
                    <option key={key} value={key}>
                      {meta.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Brand">
                <Input value={state.brand} onChange={setField('brand')} className="h-9 text-sm" required />
              </Field>
            </div>

            <Field label="Model">
              <Input value={state.model} onChange={setField('model')} className="h-9 text-sm" required />
            </Field>

            <div className="grid grid-cols-3 gap-3">
              <Field label="Price" className="col-span-2">
                <Input type="number" min="0" value={state.price_est} onChange={setField('price_est')} className="h-9 text-sm" />
              </Field>
              <Field label="Currency">
                <select className="h-9 w-full rounded-md border bg-background px-3 text-sm" value={state.currency} onChange={setField('currency')}>
                  <option>EUR</option>
                  <option>USD</option>
                  <option>GBP</option>
                  <option>PLN</option>
                </select>
              </Field>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <Field label="Buy Link" className="col-span-2">
                <Input type="url" value={state.buy_url} onChange={setField('buy_url')} className="h-9 text-sm" />
              </Field>
              <Field label="Store">
                <Input value={state.buy_store} onChange={setField('buy_store')} className="h-9 text-sm" />
              </Field>
            </div>

            <Field label="Specs">
              <textarea
                className="h-24 w-full resize-none rounded-md border bg-background px-3 py-2 font-mono text-sm"
                placeholder='{"ram":"16GB","ports":"4x GbE"}'
                value={state.spec_raw}
                onChange={setField('spec_raw')}
              />
            </Field>

            {state.error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{state.error}</p>}

            <div className="flex gap-3 pt-1">
              <Button type="button" variant="outline" className="flex-1" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" className="flex-1" disabled={state.loading}>
                {state.loading && <Loader2 className="size-4 animate-spin" />}
                Submit
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

function ImportBlueprintModal({ onClose }: { onClose: () => void }) {
  const importBlueprint = useImportHardwareBlueprint();
  const [value, setValue] = useState('');
  const [error, setError] = useState('');

  const handleImport = async () => {
    setError('');
    const trimmed = value.trim();
    if (!trimmed) {
      setError('Paste a share code or exported JSON.');
      return;
    }

    try {
      if (trimmed.startsWith('{')) {
        const parsed = JSON.parse(trimmed) as HardwareBlueprintExport;
        await importBlueprint.mutateAsync({ blueprint: parsed });
      } else {
        await importBlueprint.mutateAsync({ import_code: trimmed });
      }
      onClose();
    } catch (err) {
      setError(errorMessage(err, 'Import failed.'));
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} role="presentation" />
      <div className="relative z-10 w-full max-w-xl overflow-hidden rounded-xl border bg-card shadow-xl">
        <div className="flex items-start justify-between border-b px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold">Import Blueprint</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">Paste a friend code or exported JSON</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-1.5 hover:bg-muted">
            <X className="size-4" />
          </button>
        </div>
        <div className="space-y-4 p-6">
          <textarea
            className="min-h-44 w-full resize-none rounded-md border bg-background px-3 py-2 font-mono text-xs"
            value={value}
            onChange={event => setValue(event.target.value)}
            placeholder="HLB-ABC123... or exported blueprint JSON"
          />
          {error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose} disabled={importBlueprint.isPending}>
              Cancel
            </Button>
            <Button onClick={handleImport} disabled={importBlueprint.isPending}>
              {importBlueprint.isPending && <Loader2 className="size-4 animate-spin" />}
              Import
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children, className = '' }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={`space-y-1.5 ${className}`}>
      <span className="block text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function SpecBadges({ spec }: { spec: Record<string, string | number | boolean> }) {
  const entries = Object.entries(spec)
    .filter(([key]) => key !== 'note')
    .slice(0, 4);

  return (
    <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-0.5 text-xs">
      {entries.map(([key, value]) => (
        <div key={key} className="flex gap-1.5">
          <dt className="text-muted-foreground">{key.replace(/_/g, ' ')}</dt>
          <dd>{String(value)}</dd>
        </div>
      ))}
    </dl>
  );
}

const HardwareCard = memo(function HardwareCard({
  item,
  isFavorite,
  onToggleFavorite,
}: {
  item: HardwareComponent;
  isFavorite: boolean;
  onToggleFavorite: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const category = normalizeHardwareCategory(item.category);
  const meta = CATEGORY_META[category] ?? { label: hardwareCategoryLabel(category) };
  const urls = Array.isArray(item.buy_urls) ? item.buy_urls : [];
  const newOffer = urls.find(url => url.condition === 'new') ?? urls[0];
  const usedOffer = urls.find(url => url.condition === 'used');

  return (
    <article className="app-card group flex min-h-44 flex-col overflow-hidden">
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-xs text-muted-foreground">
              {item.brand}, {meta.label}
            </p>
            <h3 className="mt-0.5 line-clamp-2 text-sm font-medium leading-snug">{item.model}</h3>
          </div>
          <p className="app-figure shrink-0 text-right text-sm">
            {Math.round(item.price_est).toLocaleString()}
            <span className="ml-1 text-xs text-muted-foreground">{item.currency}</span>
          </p>
        </div>
        <SpecBadges spec={item.spec} />
      </div>

      <div className="grid transition-[grid-template-rows] duration-200" style={{ gridTemplateRows: expanded ? '1fr' : '0fr' }}>
        <div className="overflow-hidden">
          <div className="border-t bg-muted/30 px-4 py-3">
            <div className="space-y-1">
              {Object.entries(item.spec).map(([key, value]) => (
                <div key={key} className="flex justify-between gap-2 text-xs">
                  <span className="text-muted-foreground">{key.replace(/_/g, ' ')}</span>
                  <span className="text-right font-medium">{String(value)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="mt-auto flex items-center gap-2 border-t px-4 py-2.5">
        <button
          type="button"
          onClick={() => setExpanded(current => !current)}
          className="flex items-center gap-1 rounded-md text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          aria-expanded={expanded}
        >
          <ChevronDown className={`size-3 transition-transform ${expanded ? 'rotate-180' : ''}`} />
          {expanded ? 'Less' : 'Specs'}
        </button>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => onToggleFavorite(item.id)}
          className={`flex items-center gap-1 rounded-md text-xs transition-colors hover:cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ${isFavorite ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
          aria-label={isFavorite ? `Remove ${item.brand} ${item.model} From Favorites` : `Favorite ${item.brand} ${item.model}`}
        >
          <Heart className={`size-3.5 ${isFavorite ? 'fill-current' : ''}`} />
          {item.likes}
        </button>
        {usedOffer && (
          <Button size="sm" variant="outline" className="h-7 px-2 text-xs" asChild>
            <a href={usedOffer.url} target="_blank" rel="noreferrer">
              Used
            </a>
          </Button>
        )}
        {newOffer && (
          <Button size="sm" variant="outline" className="h-7 px-2 text-xs" asChild>
            <a href={newOffer.url} target="_blank" rel="noreferrer">
              Buy<span className="sr-only"> new</span>
            </a>
          </Button>
        )}
      </div>
    </article>
  );
});

function BlueprintCard({
  blueprint,
  onSubmit,
  onExport,
  onShare,
  submitting,
  sharing,
  exporting,
  shareCode,
}: {
  blueprint: HardwareBlueprint;
  onSubmit: () => void;
  onExport: () => void;
  onShare: () => void;
  submitting: boolean;
  sharing: boolean;
  exporting: boolean;
  shareCode?: string;
}) {
  const fit = blueprint.fit ?? estimateBlueprintFit(blueprint.node_data || {}, blueprint.services || []);
  const bars = blueprintMetricBars(fit).slice(0, 5);
  const tags = Array.isArray(blueprint.tags) ? blueprint.tags : [];
  const services = Array.isArray(blueprint.services) ? blueprint.services : [];
  const nodeData = blueprint.node_data || {};
  const internalComponents = Array.isArray(nodeData.internal_components) ? nodeData.internal_components : [];
  const components = componentSummary(internalComponents);
  const category = normalizeHardwareCategory(blueprint.category);
  const meta = CATEGORY_META[category] ?? { label: hardwareCategoryLabel(category) };

  return (
    <article className="app-card flex min-h-76 flex-col overflow-hidden">
      <div className="border-b p-4">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{blueprint.name}</p>
                <p className="text-xs text-muted-foreground">
                  {meta.label}, {blueprint.visibility}
                </p>
              </div>
              <span
                title="Fit score"
                className={`app-figure shrink-0 rounded-md border px-2 py-0.5 text-xs ${fitTone(blueprint.fit?.grade)}`}
              >
                {blueprint.fit?.score ?? 0}
              </span>
            </div>
            {blueprint.description && <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">{blueprint.description}</p>}
          </div>
        </div>
      </div>

      <div className="space-y-4 p-4">
        <dl className="grid grid-cols-3 border-y py-2 text-xs">
          <MiniStat label="Fit" value={blueprint.fit?.label ?? 'Draft'} />
          <MiniStat label="Disks" value={String(components.disks)} />
          <MiniStat label="GPUs" value={String(components.gpus)} />
        </dl>

        <div className="space-y-2">
          {bars.map(bar => (
            <CapacityBar key={bar.label} metric={bar} />
          ))}
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-muted-foreground">Services</span>
            <span className="text-[10px] text-muted-foreground">{services.length}</span>
          </div>
          {services.length === 0 ? (
            <p className="text-xs text-muted-foreground">No bundled services</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {services.slice(0, 5).map(service => (
                <span key={service.id} className="rounded border bg-muted/60 px-1.5 py-0.5 text-[10px]">
                  {service.name}
                </span>
              ))}
              {services.length > 5 && <span className="rounded border bg-muted/60 px-1.5 py-0.5 text-[10px]">+{services.length - 5}</span>}
            </div>
          )}
        </div>

        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {tags.slice(0, 4).map(tag => (
              <span key={tag} className="rounded border px-1.5 py-0.5 text-[10px] text-muted-foreground">
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="mt-auto flex items-center gap-2 border-t px-4 py-2.5">
        {shareCode && <span className="app-figure text-xs text-muted-foreground">{shareCode}</span>}
        <div className="flex-1" />
        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={onExport} disabled={exporting} aria-label={`Export ${blueprint.name}`}>
          {exporting ? <Loader2 className="size-3 animate-spin" /> : <Download className="size-3" />}
        </Button>
        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={onShare} disabled={sharing} aria-label={`Share ${blueprint.name}`}>
          {sharing ? <Loader2 className="size-3 animate-spin" /> : <Clipboard className="size-3" />}
        </Button>
        {blueprint.visibility === 'private' && (
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onSubmit} disabled={submitting}>
            Submit for review
          </Button>
        )}
      </div>
    </article>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="truncate font-medium">{value}</dd>
    </div>
  );
}

type FilterState = {
  search: string;
  category: string;
  maxPrice: number;
  source: CatalogSource;
  sort: SortMode;
  page: number;
  showSubmit: boolean;
  showCreator: boolean;
  showImport: boolean;
};

type FilterAction =
  | { type: 'SET_SEARCH'; value: string }
  | { type: 'SET_CATEGORY'; value: string }
  | { type: 'SET_MAX_PRICE'; value: number }
  | { type: 'SET_SOURCE'; value: CatalogSource }
  | { type: 'SET_SORT'; value: SortMode }
  | { type: 'SET_PAGE'; value: number }
  | { type: 'SET_SHOW_SUBMIT'; value: boolean }
  | { type: 'SET_SHOW_CREATOR'; value: boolean }
  | { type: 'SET_SHOW_IMPORT'; value: boolean }
  | { type: 'CLEAR_FILTERS' };

const initialFilter: FilterState = {
  search: '',
  category: '',
  maxPrice: 0,
  source: 'all',
  sort: 'fit',
  page: 0,
  showSubmit: false,
  showCreator: false,
  showImport: false,
};

function filterReducer(state: FilterState, action: FilterAction): FilterState {
  switch (action.type) {
    case 'SET_SEARCH':
      return { ...state, search: action.value, page: 0 };
    case 'SET_CATEGORY':
      return { ...state, category: action.value, page: 0 };
    case 'SET_MAX_PRICE':
      return { ...state, maxPrice: action.value, page: 0 };
    case 'SET_SOURCE':
      return { ...state, source: action.value, page: 0 };
    case 'SET_SORT':
      return { ...state, sort: action.value, page: 0 };
    case 'SET_PAGE':
      return { ...state, page: action.value };
    case 'SET_SHOW_SUBMIT':
      return { ...state, showSubmit: action.value };
    case 'SET_SHOW_CREATOR':
      return { ...state, showCreator: action.value };
    case 'SET_SHOW_IMPORT':
      return { ...state, showImport: action.value };
    case 'CLEAR_FILTERS':
      return { ...initialFilter, showSubmit: state.showSubmit, showCreator: state.showCreator, showImport: state.showImport };
    default:
      return state;
  }
}

export default function HardwareCatalogPage() {
  const [state, dispatch] = useReducer(filterReducer, initialFilter);
  const { search, category, maxPrice, source, sort, page, showSubmit, showCreator, showImport } = state;
  const deferredSearch = useDeferredValue(search);
  const [shareCodes, setShareCodes] = useState<Record<string, string>>({});

  const { data: favoritesData } = useHardwareFavorites();
  const favorites = useMemo(() => favoritesData?.data || [], [favoritesData]);
  const favSet = useMemo(() => new Set(favorites.map(favorite => favorite.hardware_component_id)), [favorites]);
  const addFavorite = useAddHardwareFavorite();
  const removeFavorite = useRemoveHardwareFavorite();
  const submitBlueprint = useSubmitHardwareBlueprint();
  const exportBlueprint = useExportHardwareBlueprint();
  const shareBlueprint = useCreateHardwareBlueprintShareCode();

  const { data, isLoading, isFetching } = useHardware({
    search: deferredSearch,
    category: category || undefined,
    max_price: maxPrice || undefined,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  });
  const { data: categoriesData } = useHardwareCategories();
  const { data: blueprintsData } = useHardwareBlueprints();

  const hardwareItems = useMemo(() => data?.data ?? [], [data]);
  const blueprints = useMemo(() => blueprintsData?.data ?? [], [blueprintsData]);
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  const categories = useMemo(() => {
    const catalogCategories = (categoriesData?.data ?? []).map(normalizeHardwareCategory);
    const blueprintCategories = blueprints.map(blueprint => normalizeHardwareCategory(blueprint.category));
    return Array.from(new Set([...catalogCategories, ...blueprintCategories])).sort();
  }, [categoriesData, blueprints]);

  const filteredBlueprints = useMemo(() => {
    return sortBlueprints(
      blueprints.filter(blueprint => {
        const blueprintCategory = normalizeHardwareCategory(blueprint.category);
        if (category && blueprintCategory !== category) return false;
        if (maxPrice > 0 && blueprintPrice(blueprint) > maxPrice) return false;
        if (!deferredSearch) return true;
        const query = deferredSearch.toLowerCase();
        return (
          blueprint.name.toLowerCase().includes(query) ||
          blueprint.description.toLowerCase().includes(query) ||
          (blueprint.tags || []).some(tag => tag.toLowerCase().includes(query)) ||
          (blueprint.services || []).some(service => service.name.toLowerCase().includes(query))
        );
      }),
      sort,
    );
  }, [blueprints, category, deferredSearch, maxPrice, sort]);

  const displayedItems = useMemo(() => {
    const base =
      source === 'favorites'
        ? favorites.flatMap(favorite => (favorite.hardware_component ? [favorite.hardware_component] : []))
        : hardwareItems;
    return sortComponents(
      base.filter(item => {
        const itemCategory = normalizeHardwareCategory(item.category);
        if (category && itemCategory !== category) return false;
        if (maxPrice > 0 && item.price_est > maxPrice) return false;
        if (!deferredSearch) return true;
        const query = deferredSearch.toLowerCase();
        return item.brand.toLowerCase().includes(query) || item.model.toLowerCase().includes(query);
      }),
      sort,
    );
  }, [source, favorites, hardwareItems, category, maxPrice, deferredSearch, sort]);

  const showBlueprints = source === 'all' || source === 'blueprints';
  const showComponents = source === 'all' || source === 'components' || source === 'favorites';

  const handleToggleFavorite = (componentId: string) => {
    if (favSet.has(componentId)) {
      removeFavorite.mutate(componentId);
    } else {
      addFavorite.mutate(componentId);
    }
  };

  const handleExportBlueprint = async (blueprintID: string) => {
    const result = await exportBlueprint.mutateAsync(blueprintID);
    const payload = JSON.stringify(result.data, null, 2);
    const blob = new Blob([payload], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${result.data.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-blueprint.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    if (result.data.share_code) {
      setShareCodes(current => ({ ...current, [blueprintID]: result.data.share_code || '' }));
    }
  };

  const handleShareBlueprint = async (blueprint: HardwareBlueprint) => {
    let code = shareCodes[blueprint.id] || blueprint.share_code;
    if (!code) {
      const result = await shareBlueprint.mutateAsync(blueprint.id);
      code = result.data.share_code || '';
      setShareCodes(current => ({ ...current, [blueprint.id]: code || '' }));
    }
    if (code && navigator.clipboard) {
      await navigator.clipboard.writeText(code);
    }
  };

  return (
    <Page className="space-y-6">
      <SeoMeta
        title="Homelab Hardware Catalog | HLBuilder"
        description="Browse homelab routers, switches, NAS devices, servers, mini PCs, SBCs, UPS units, and reusable hardware blueprints."
        path="/hardware"
        keywords={[
          'homelab hardware',
          'homelab server hardware',
          'homelab router',
          'homelab NAS',
          'mini PC homelab',
        ]}
        structuredData={hardwareStructuredData}
      />
      {showSubmit && <SubmitHardwareModal onClose={() => dispatch({ type: 'SET_SHOW_SUBMIT', value: false })} />}
      <HardwareBlueprintCreator open={showCreator} onClose={() => dispatch({ type: 'SET_SHOW_CREATOR', value: false })} />
      {showImport && <ImportBlueprintModal onClose={() => dispatch({ type: 'SET_SHOW_IMPORT', value: false })} />}

      <PageHeader
        title="Hardware Catalog"
        lede="Routers, switches, NAS, servers, Mini PCs, and reusable builds."
        actions={
          <>
            <Button variant="outline" onClick={() => dispatch({ type: 'SET_SHOW_SUBMIT', value: true })}>
              Submit a component
            </Button>
            <Button variant="outline" onClick={() => dispatch({ type: 'SET_SHOW_IMPORT', value: true })}>
              Import
            </Button>
            <Button onClick={() => dispatch({ type: 'SET_SHOW_CREATOR', value: true })}>
              Create a blueprint
            </Button>
          </>
        }
      />

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative min-w-60 flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            type="search"
            aria-label="Search the catalog"
            placeholder="Search hardware, blueprints, services..."
            className="pl-9"
            value={search}
            onChange={event => dispatch({ type: 'SET_SEARCH', value: event.target.value })}
          />
        </div>

        <select
          className="h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground"
          value={maxPrice}
          onChange={event => dispatch({ type: 'SET_MAX_PRICE', value: Number(event.target.value) })}
          aria-label="Filter price"
        >
          <option value={0}>Any price</option>
          <option value={50}>Under 50 EUR</option>
          <option value={100}>Under 100 EUR</option>
          <option value={200}>Under 200 EUR</option>
          <option value={500}>Under 500 EUR</option>
          <option value={1000}>Under 1000 EUR</option>
        </select>

        <select
          className="h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground"
          value={sort}
          onChange={event => dispatch({ type: 'SET_SORT', value: event.target.value as SortMode })}
          aria-label="Sort catalog"
        >
          <option value="fit">Best blueprint fit</option>
          <option value="popular">Community score</option>
          <option value="recent">Newest</option>
          <option value="price">Lowest price</option>
          <option value="name">Name</option>
        </select>

        {(search || category || maxPrice > 0 || source !== 'all' || sort !== 'fit') && (
          <Button variant="ghost" size="sm" onClick={() => dispatch({ type: 'CLEAR_FILTERS' })}>
            Clear
          </Button>
        )}
      </div>

      <div className="grid gap-2">
        <div className="flex flex-wrap gap-2" role="group" aria-label="What to show">
          {(
            [
              ['all', 'Everything', null],
              ['blueprints', 'Blueprints', blueprints.length],
              ['components', 'Components', total],
              ['favorites', 'Favorites', favorites.length],
            ] as Array<[CatalogSource, string, number | null]>
          ).map(([item, label, count]) => (
            <button
              key={item}
              type="button"
              aria-pressed={source === item}
              onClick={() => dispatch({ type: 'SET_SOURCE', value: item })}
              className="app-filter"
            >
              {label}
              {count !== null && <span className="app-count">{count.toLocaleString()}</span>}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Category">
          {categories.map(cat => (
            <button
              key={cat}
              type="button"
              aria-pressed={cat === category}
              onClick={() => dispatch({ type: 'SET_CATEGORY', value: cat === category ? '' : cat })}
              className="app-filter"
            >
              {CATEGORY_META[cat]?.label ?? hardwareCategoryLabel(cat)}
            </button>
          ))}
        </div>
      </div>

      {showBlueprints && (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Blueprints</h2>
            <span className="text-xs text-muted-foreground">{filteredBlueprints.length} matches</span>
          </div>
          {filteredBlueprints.length === 0 ? (
            <EmptyState title="No blueprints found" />
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {filteredBlueprints.map(blueprint => (
                <BlueprintCard
                  key={blueprint.id}
                  blueprint={blueprint}
                  onSubmit={() => submitBlueprint.mutate(blueprint.id)}
                  onExport={() => handleExportBlueprint(blueprint.id)}
                  onShare={() => handleShareBlueprint(blueprint)}
                  submitting={submitBlueprint.isPending}
                  sharing={shareBlueprint.isPending}
                  exporting={exportBlueprint.isPending}
                  shareCode={shareCodes[blueprint.id] || blueprint.share_code}
                />
              ))}
            </div>
          )}
        </section>
      )}

      {showComponents && (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">{source === 'favorites' ? 'Favorites' : 'Components'}</h2>
            <span className="text-xs text-muted-foreground">{source === 'favorites' ? displayedItems.length : total} matches</span>
          </div>

          {isLoading && source !== 'favorites' ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {Array.from({ length: 12 }).map((_, index) => (
                <div key={index} className="app-card h-56 animate-pulse" />
              ))}
            </div>
          ) : displayedItems.length === 0 ? (
            <EmptyState title={source === 'favorites' ? 'No favorites yet' : 'No components found'} />
          ) : (
            <>
              <div
                className={`grid grid-cols-1 gap-4 transition-opacity duration-200 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 ${
                  isFetching && source !== 'favorites' ? 'opacity-60' : ''
                }`}
              >
                {displayedItems.map(item => (
                  <HardwareCard
                    key={item.id}
                    item={item}
                    isFavorite={favSet.has(item.id)}
                    onToggleFavorite={handleToggleFavorite}
                  />
                ))}
              </div>
              {source !== 'favorites' && totalPages > 1 && (
                <div className="flex items-center justify-center gap-3 pt-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => dispatch({ type: 'SET_PAGE', value: page - 1 })}
                    disabled={page === 0 || isFetching}
                  >
                    Previous
                  </Button>
                  <span className="text-sm text-muted-foreground">
                    Page {page + 1} of {totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => dispatch({ type: 'SET_PAGE', value: page + 1 })}
                    disabled={page >= totalPages - 1 || isFetching}
                  >
                    Next
                  </Button>
                </div>
              )}
            </>
          )}
        </section>
      )}

    </Page>
  );
}

function EmptyState({ title }: { title: string }) {
  return (
    <div className="app-empty-state px-6 py-10">
      <h3 className="text-sm font-semibold">{title}</h3>
      <p className="mt-1 text-sm text-muted-foreground">No matching entries in this view.</p>
    </div>
  );
}

function blueprintPrice(blueprint: HardwareBlueprint) {
  const price = blueprint.node_data?.details?.price_est;
  return typeof price === 'number' ? price : Number(price) || 0;
}

function sortBlueprints(blueprints: HardwareBlueprint[], sort: SortMode) {
  return [...blueprints].sort((a, b) => {
    switch (sort) {
      case 'recent':
        return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
      case 'price':
        return blueprintPrice(a) - blueprintPrice(b);
      case 'name':
        return a.name.localeCompare(b.name);
      case 'fit':
      default:
        return (b.fit?.score ?? 0) - (a.fit?.score ?? 0);
    }
  });
}

function sortComponents(items: HardwareComponent[], sort: SortMode) {
  return [...items].sort((a, b) => {
    switch (sort) {
      case 'recent':
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      case 'price':
        return a.price_est - b.price_est;
      case 'name':
        return `${a.brand} ${a.model}`.localeCompare(`${b.brand} ${b.model}`);
      case 'popular':
        return b.likes - a.likes;
      case 'fit':
      default:
        return 0;
    }
  });
}
