import {
  memo,
  useDeferredValue,
  useMemo,
  useReducer,
  useState,
  type ChangeEvent,
  type ElementType,
  type FormEvent,
  type ReactNode,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Check,
  ChevronDown,
  Clipboard,
  Cpu,
  Download,
  Gauge,
  HardDrive,
  Heart,
  Layers,
  Loader2,
  Network,
  Package,
  Plus,
  Search,
  Server,
  ShoppingCart,
  SlidersHorizontal,
  Sparkles,
  Upload,
  Wifi,
  X,
  Zap,
} from 'lucide-react';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { api } from '../../../lib/api';
import { cn } from '../../../lib/utils';
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
import { HardwareBlueprintCreator } from '../components/hardware-blueprint-creator';
import {
  blueprintMetricBars,
  componentSummary,
  estimateBlueprintFit,
  fitTone,
  formatMetric,
} from '../lib/blueprint-fit';

const PAGE_SIZE = 24;

const CATEGORY_META: Record<string, { label: string; icon: ElementType; color: string }> = {
  router: { label: 'Routers', icon: Network, color: 'text-blue-500 bg-blue-500/10' },
  switch: { label: 'Switches', icon: Layers, color: 'text-indigo-500 bg-indigo-500/10' },
  nas: { label: 'NAS', icon: HardDrive, color: 'text-orange-500 bg-orange-500/10' },
  server: { label: 'Servers', icon: Server, color: 'text-red-500 bg-red-500/10' },
  minipc: { label: 'Mini PCs', icon: Cpu, color: 'text-green-500 bg-green-500/10' },
  sbc: { label: 'SBCs', icon: Cpu, color: 'text-pink-500 bg-pink-500/10' },
  access_point: { label: 'Access Points', icon: Wifi, color: 'text-cyan-500 bg-cyan-500/10' },
  ups: { label: 'UPS', icon: Zap, color: 'text-yellow-500 bg-yellow-500/10' },
  storage: { label: 'Storage', icon: HardDrive, color: 'text-purple-500 bg-purple-500/10' },
  disk: { label: 'Storage', icon: HardDrive, color: 'text-purple-500 bg-purple-500/10' },
  ram: { label: 'RAM', icon: Package, color: 'text-teal-500 bg-teal-500/10' },
  gpu: { label: 'GPUs', icon: Cpu, color: 'text-violet-500 bg-violet-500/10' },
  hba: { label: 'HBA Cards', icon: Package, color: 'text-slate-500 bg-slate-500/10' },
  nic: { label: 'NICs', icon: Network, color: 'text-sky-500 bg-sky-500/10' },
  accessory: { label: 'Accessories', icon: Package, color: 'text-gray-500 bg-gray-500/10' },
  rack: { label: 'Racks', icon: Server, color: 'text-amber-500 bg-amber-500/10' },
  pdu: { label: 'PDUs', icon: Zap, color: 'text-lime-500 bg-lime-500/10' },
  iot: { label: 'IoT', icon: Package, color: 'text-yellow-600 bg-yellow-600/10' },
  modem: { label: 'Modems', icon: Network, color: 'text-blue-600 bg-blue-600/10' },
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
      dispatch({ type: 'SET_ERROR', value: err instanceof Error ? err.message : 'Submission failed.' });
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
          <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
            <div className="mb-4 flex size-14 items-center justify-center rounded-full bg-green-500/10">
              <Check className="size-7 text-green-500" />
            </div>
            <h3 className="mb-1 text-lg font-semibold">Submitted</h3>
            <p className="text-sm text-muted-foreground">The component is waiting for review.</p>
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
                {state.loading ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
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
      setError(err instanceof Error ? err.message : 'Import failed.');
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
              {importBlueprint.isPending ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
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
    .filter(([key]) => !['note'].includes(key))
    .slice(0, 4);

  return (
    <div className="mt-2 flex flex-wrap gap-1">
      {entries.map(([key, value]) => (
        <span key={key} className="rounded border bg-muted/60 px-1.5 py-0.5 text-[10px] text-muted-foreground">
          {key.replace(/_/g, ' ').toUpperCase()}: <span className="font-medium text-foreground">{String(value)}</span>
        </span>
      ))}
    </div>
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
  const meta = CATEGORY_META[category] ?? { label: hardwareCategoryLabel(category), icon: Package, color: 'text-gray-500 bg-gray-500/10' };
  const Icon = meta.icon;
  const urls = Array.isArray(item.buy_urls) ? item.buy_urls : [];
  const newOffer = urls.find(url => url.condition === 'new') ?? urls[0];
  const usedOffer = urls.find(url => url.condition === 'used');

  return (
    <article className="app-card group flex min-h-56 flex-col overflow-hidden transition-[border-color,transform] hover:-translate-y-0.5 hover:border-primary/40">
      <div className="flex items-start gap-3 p-4">
        <div className={`flex size-11 shrink-0 items-center justify-center rounded-md ${meta.color}`}>
          <Icon className="size-5" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-xs font-medium text-muted-foreground">{item.brand}</p>
              <h3 className="line-clamp-2 text-sm font-semibold leading-tight">{item.model}</h3>
            </div>
            <div className="shrink-0 text-right">
              <p className="text-base font-bold text-primary">
                {Math.round(item.price_est).toLocaleString()}
                <span className="ml-1 text-xs font-normal text-muted-foreground">{item.currency}</span>
              </p>
              <p className="text-[10px] text-muted-foreground">{meta.label}</p>
            </div>
          </div>
          <SpecBadges spec={item.spec} />
        </div>
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

      <div className="mt-auto flex items-center gap-2 border-t bg-muted/20 px-4 py-3">
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
          className={`flex items-center gap-1 rounded-md text-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ${isFavorite ? 'text-red-500' : 'text-muted-foreground hover:text-red-400'}`}
          aria-label={isFavorite ? `Remove ${item.brand} ${item.model} From Favorites` : `Favorite ${item.brand} ${item.model}`}
        >
          <Heart className={`size-3.5 ${isFavorite ? 'fill-red-500' : ''}`} />
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
          <Button size="sm" className="h-7 px-2 text-xs" asChild>
            <a href={newOffer.url} target="_blank" rel="noreferrer">
              <ShoppingCart className="size-3" />
              <span className="sr-only">Buy New</span>
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
  const localFit = estimateBlueprintFit(blueprint.node_data || {}, blueprint.services || []);
  const fit = blueprint.fit ?? localFit;
  const bars = blueprintMetricBars(fit).slice(0, 5);
  const tags = Array.isArray(blueprint.tags) ? blueprint.tags : [];
  const services = Array.isArray(blueprint.services) ? blueprint.services : [];
  const nodeData = blueprint.node_data || {};
  const internalComponents = Array.isArray(nodeData.internal_components) ? nodeData.internal_components : [];
  const components = componentSummary(internalComponents);
  const category = normalizeHardwareCategory(blueprint.category);
  const meta = CATEGORY_META[category] ?? { label: hardwareCategoryLabel(category), icon: Sparkles, color: 'text-primary bg-primary/10' };
  const Icon = meta.icon;

  return (
    <article className="app-card flex min-h-76 flex-col overflow-hidden transition-[border-color,transform] hover:-translate-y-0.5 hover:border-primary/40">
      <div className="border-b bg-muted/20 p-4">
        <div className="flex items-start gap-3">
          <div className={`flex size-11 shrink-0 items-center justify-center rounded-md ${meta.color}`}>
            <Icon className="size-5" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{blueprint.name}</p>
                <p className="text-xs text-muted-foreground">
                  {meta.label} / {blueprint.visibility}
                </p>
              </div>
              <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${fitTone(blueprint.fit?.grade)}`}>
                {blueprint.fit?.score ?? 0}
              </span>
            </div>
            {blueprint.description && <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">{blueprint.description}</p>}
          </div>
        </div>
      </div>

      <div className="space-y-4 p-4">
        <div className="grid grid-cols-3 gap-2 text-xs">
          <MiniStat icon={Gauge} label="Fit" value={blueprint.fit?.label ?? 'Draft'} />
          <MiniStat icon={HardDrive} label="Disks" value={String(components.disks)} />
          <MiniStat icon={Cpu} label="GPUs" value={String(components.gpus)} />
        </div>

        <div className="space-y-2">
          {bars.map(bar => (
            <BlueprintBar key={bar.label} label={bar.label} used={bar.used} total={bar.total} unit={bar.unit} percent={bar.percent} />
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

      <div className="mt-auto flex items-center gap-2 border-t bg-muted/20 px-4 py-3">
        <span className="rounded-md bg-background px-2 py-0.5 text-[10px] text-muted-foreground">
          {shareCode || `${blueprint.upvotes - blueprint.downvotes} score`}
        </span>
        <div className="flex-1" />
        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={onExport} disabled={exporting} aria-label={`Export ${blueprint.name}`}>
          {exporting ? <Loader2 className="size-3 animate-spin" /> : <Download className="size-3" />}
        </Button>
        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={onShare} disabled={sharing} aria-label={`Share ${blueprint.name}`}>
          {sharing ? <Loader2 className="size-3 animate-spin" /> : <Clipboard className="size-3" />}
        </Button>
        {blueprint.visibility === 'private' && (
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onSubmit} disabled={submitting}>
            Submit
          </Button>
        )}
      </div>
    </article>
  );
}

function MiniStat({ icon: Icon, label, value }: { icon: ElementType; label: string; value: string }) {
  return (
    <div className="rounded-md border bg-background p-2">
      <Icon className="mb-1 size-3.5 text-primary" />
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <p className="truncate text-xs font-semibold">{value}</p>
    </div>
  );
}

function BlueprintBar({
  label,
  used,
  total,
  unit,
  percent,
}: {
  label: string;
  used: number;
  total: number;
  unit: string;
  percent: number;
}) {
  const overloaded = total > 0 && used > total;
  const fill = label === 'Power' ? (total > 0 ? 100 : 0) : percent;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2 text-[10px]">
        <span className="font-medium text-muted-foreground">{label}</span>
        <span className="font-mono text-muted-foreground">
          {label === 'Power' ? formatMetric(total, unit) : `${formatMetric(used, unit)} / ${formatMetric(total, unit)}`}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full rounded-full ${overloaded ? 'bg-red-500' : percent > 80 ? 'bg-amber-500' : 'bg-primary'}`}
          style={{ width: `${Math.max(4, fill)}%` }}
        />
      </div>
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
  const activeCount = (showBlueprints ? filteredBlueprints.length : 0) + (showComponents ? displayedItems.length : 0);

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
    <div className="app-page mx-auto max-w-7xl space-y-6 px-6 py-8">
      {showSubmit && <SubmitHardwareModal onClose={() => dispatch({ type: 'SET_SHOW_SUBMIT', value: false })} />}
      <HardwareBlueprintCreator open={showCreator} onClose={() => dispatch({ type: 'SET_SHOW_CREATOR', value: false })} />
      {showImport && <ImportBlueprintModal onClose={() => dispatch({ type: 'SET_SHOW_IMPORT', value: false })} />}

      <div className="app-hero flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <div className="mb-2 flex items-center gap-2">
            <span className="app-chip">Catalog</span>
            <span className="text-xs text-muted-foreground">{activeCount} visible</span>
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-balance">Hardware Catalog</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Routers, switches, NAS, servers, Mini PCs, and reusable builds.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => dispatch({ type: 'SET_SHOW_CREATOR', value: true })}>
            <Plus className="size-4" />
            Create Blueprint
          </Button>
          <Button size="sm" variant="outline" onClick={() => dispatch({ type: 'SET_SHOW_IMPORT', value: true })}>
            <Upload className="size-4" />
            Import
          </Button>
          <Button size="sm" variant="outline" onClick={() => dispatch({ type: 'SET_SHOW_SUBMIT', value: true })}>
            Submit Component
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryTile icon={Sparkles} label="Blueprints" value={blueprints.length} active={source === 'blueprints'} onClick={() => dispatch({ type: 'SET_SOURCE', value: 'blueprints' })} />
        <SummaryTile icon={Package} label="Components" value={total} active={source === 'components'} onClick={() => dispatch({ type: 'SET_SOURCE', value: 'components' })} />
        <SummaryTile icon={Heart} label="Favorites" value={favorites.length} active={source === 'favorites'} onClick={() => dispatch({ type: 'SET_SOURCE', value: 'favorites' })} />
        <SummaryTile icon={SlidersHorizontal} label="Categories" value={categories.length} active={source === 'all'} onClick={() => dispatch({ type: 'SET_SOURCE', value: 'all' })} />
      </div>

      <div className="app-surface flex flex-col gap-3 rounded-lg p-3 lg:flex-row lg:items-center">
        <div className="relative min-w-60 flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search hardware, blueprints, services..."
            className="pl-9"
            value={search}
            onChange={event => dispatch({ type: 'SET_SEARCH', value: event.target.value })}
          />
        </div>

        <select
          className="h-9 rounded-md border bg-background px-3 text-sm text-foreground"
          value={category}
          onChange={event => dispatch({ type: 'SET_CATEGORY', value: event.target.value })}
          aria-label="Filter category"
        >
          <option value="">All categories</option>
          {categories.map(cat => (
            <option key={cat} value={cat}>
              {CATEGORY_META[cat]?.label ?? hardwareCategoryLabel(cat)}
            </option>
          ))}
        </select>

        <select
          className="h-9 rounded-md border bg-background px-3 text-sm text-foreground"
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
          className="h-9 rounded-md border bg-background px-3 text-sm text-foreground"
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

      <div className="flex flex-wrap gap-2">
        {(['all', 'blueprints', 'components', 'favorites'] as CatalogSource[]).map(item => (
          <button
            key={item}
            type="button"
            onClick={() => dispatch({ type: 'SET_SOURCE', value: item })}
            className={cn(
              'app-pill capitalize',
              source === item && 'border-primary bg-primary text-primary-foreground',
            )}
          >
            {item}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        {categories.map(cat => {
          const meta = CATEGORY_META[cat];
          const Icon = meta?.icon ?? Package;
          return (
            <button
              key={cat}
              type="button"
              onClick={() => dispatch({ type: 'SET_CATEGORY', value: cat === category ? '' : cat })}
              className={cn(
                'app-pill flex items-center gap-1.5',
                cat === category && 'border-primary bg-primary text-primary-foreground',
              )}
            >
              <Icon className="size-3" />
              {meta?.label ?? hardwareCategoryLabel(cat)}
            </button>
          );
        })}
      </div>

      {showBlueprints && (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Blueprints</h2>
            <span className="text-xs text-muted-foreground">{filteredBlueprints.length} matches</span>
          </div>
          {filteredBlueprints.length === 0 ? (
            <EmptyState icon={Sparkles} title="No blueprints found" />
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
            <EmptyState icon={Package} title={source === 'favorites' ? 'No favorites yet' : 'No components found'} />
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

      {!category && !search && categories.length > 0 && (
        <div className="border-t pt-6">
          <p className="mb-3 text-sm font-medium text-muted-foreground">Browse by category</p>
          <div className="flex flex-wrap gap-2">
            {categories.map(cat => (
              <Badge key={cat} variant="outline" className="cursor-pointer hover:bg-muted" onClick={() => dispatch({ type: 'SET_CATEGORY', value: cat })}>
                {CATEGORY_META[cat]?.label ?? hardwareCategoryLabel(cat)}
              </Badge>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function SummaryTile({
  icon: Icon,
  label,
  value,
  active,
  onClick,
}: {
  icon: ElementType;
  label: string;
  value: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'app-surface flex items-center gap-3 rounded-lg p-3 text-left transition-[background-color,border-color,transform] hover:-translate-y-0.5 hover:bg-muted/35 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
        active && 'border-primary bg-primary/10',
      )}
    >
      <span className="flex size-10 items-center justify-center rounded-md bg-background text-primary">
        <Icon className="size-5" />
      </span>
      <span>
        <span className="block text-xs text-muted-foreground">{label}</span>
        <span className="text-lg font-semibold">{value.toLocaleString()}</span>
      </span>
    </button>
  );
}

function EmptyState({ icon: Icon, title }: { icon: ElementType; title: string }) {
  return (
    <div className="app-empty-state flex flex-col items-center justify-center py-16 text-center">
      <Icon className="mb-3 size-10 text-muted-foreground/50" />
      <h3 className="text-sm font-semibold">{title}</h3>
      <p className="mt-1 text-xs text-muted-foreground">No matching entries in this view.</p>
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
      case 'popular':
        return b.upvotes - b.downvotes - (a.upvotes - a.downvotes);
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
