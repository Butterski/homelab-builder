import { useState, useDeferredValue, memo } from 'react';
import { useHardware, useHardwareCategories, type HardwareComponent } from '../api/use-hardware';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import {
  Search,
  ShoppingCart,
  Heart,
  Cpu,
  HardDrive,
  Network,
  Wifi,
  Server,
  Zap,
  Package,
  Layers,
  ChevronDown,
  Plus,
  X,
  Check,
  Loader2,
} from 'lucide-react';
import { api } from '../../../lib/api';
import { useQueryClient } from '@tanstack/react-query';

const PAGE_SIZE = 24;

const CATEGORY_META: Record<string, { label: string; icon: React.ElementType; color: string }> = {
  router: { label: 'Routers', icon: Network, color: 'text-blue-500 bg-blue-500/10' },
  switch: { label: 'Switches', icon: Layers, color: 'text-indigo-500 bg-indigo-500/10' },
  nas: { label: 'NAS', icon: HardDrive, color: 'text-orange-500 bg-orange-500/10' },
  server: { label: 'Servers', icon: Server, color: 'text-red-500 bg-red-500/10' },
  minipc: { label: 'Mini PCs', icon: Cpu, color: 'text-green-500 bg-green-500/10' },
  sbc: { label: 'SBCs', icon: Cpu, color: 'text-pink-500 bg-pink-500/10' },
  access_point: { label: 'Access Points', icon: Wifi, color: 'text-cyan-500 bg-cyan-500/10' },
  ups: { label: 'UPS', icon: Zap, color: 'text-yellow-500 bg-yellow-500/10' },
  storage: { label: 'Storage', icon: HardDrive, color: 'text-purple-500 bg-purple-500/10' },
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

// ─── Submit Hardware Modal ────────────────────────────────────────────────────
function SubmitHardwareModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [formData, setFormData] = useState({
    category: 'router',
    brand: '',
    model: '',
    price_est: '',
    currency: 'EUR',
    buy_url: '',
    buy_store: '',
    spec_raw: '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const setField =
    (k: keyof typeof formData) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setFormData(f => ({ ...f, [k]: e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!formData.brand.trim() || !formData.model.trim()) {
      setError('Brand and model are required.');
      return;
    }

    let spec: Record<string, string> = {};
    if (formData.spec_raw.trim()) {
      try {
        spec = JSON.parse(formData.spec_raw);
      } catch {
        setError('Spec must be valid JSON, e.g. {"ram":"4GB","ports":"8"}');
        return;
      }
    }

    const buy_urls = formData.buy_url.trim()
      ? [{ store: formData.buy_store || 'Store', url: formData.buy_url.trim(), condition: 'new' }]
      : [];

    setLoading(true);
    try {
      await api.post('/api/hardware', {
        category: formData.category,
        brand: formData.brand.trim(),
        model: formData.model.trim(),
        price_est: parseFloat(formData.price_est) || 0,
        currency: formData.currency,
        buy_urls,
        spec,
      });
      setSuccess(true);
      qc.invalidateQueries({ queryKey: ['hardware'] });
      setTimeout(onClose, 1800);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Submission failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative z-10 w-full max-w-lg rounded-2xl border bg-card">
        <div className="flex items-center justify-between border-b px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold">Submit Hardware</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Submissions are reviewed before appearing publicly
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        {success ? (
          <div className="flex flex-col items-center justify-center py-12 px-6 text-center">
            <div className="h-14 w-14 rounded-full bg-green-500/10 flex items-center justify-center mb-4">
              <Check className="h-7 w-7 text-green-500" />
            </div>
            <h3 className="font-semibold text-lg mb-1">Submitted!</h3>
            <p className="text-muted-foreground text-sm">
              Your hardware will appear after admin review. Thank you!
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="p-6 space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                  Category *
                </label>
                <select
                  className="w-full h-9 rounded-md border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  value={formData.category}
                  onChange={setField('category')}
                >
                  {Object.entries(CATEGORY_META).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                  Brand *
                </label>
                <Input
                  placeholder="e.g. Ubiquiti"
                  value={formData.brand}
                  onChange={setField('brand')}
                  className="h-9 text-sm"
                  required
                />
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                Model *
              </label>
              <Input
                placeholder="e.g. Dream Machine Pro"
                value={formData.model}
                onChange={setField('model')}
                className="h-9 text-sm"
                required
              />
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                  Estimated Price
                </label>
                <Input
                  type="number"
                  placeholder="e.g. 379"
                  value={formData.price_est}
                  onChange={setField('price_est')}
                  className="h-9 text-sm"
                  min="0"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                  Currency
                </label>
                <select
                  className="w-full h-9 rounded-md border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  value={formData.currency}
                  onChange={setField('currency')}
                >
                  <option>EUR</option>
                  <option>USD</option>
                  <option>GBP</option>
                  <option>PLN</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                  Buy Link (optional)
                </label>
                <Input
                  type="url"
                  placeholder="https://amazon.de/..."
                  value={formData.buy_url}
                  onChange={setField('buy_url')}
                  className="h-9 text-sm"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                  Store Name
                </label>
                <Input
                  placeholder="Amazon DE"
                  value={formData.buy_store}
                  onChange={setField('buy_store')}
                  className="h-9 text-sm"
                />
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                Specs (optional JSON)
              </label>
              <textarea
                className="w-full rounded-md border bg-background px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary resize-none"
                rows={3}
                placeholder={'{"ram":"4GB","ports":"8x GbE","cpu":"quad-core"}'}
                value={formData.spec_raw}
                onChange={setField('spec_raw')}
              />
            </div>

            {error && (
              <p className="text-sm text-destructive bg-destructive/10 rounded-lg px-3 py-2">
                {error}
              </p>
            )}

            <div className="flex gap-3 pt-1">
              <Button type="button" variant="outline" className="flex-1" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" className="flex-1" disabled={loading}>
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Plus className="h-4 w-4 mr-2" />
                )}
                {loading ? 'Submitting…' : 'Submit Hardware'}
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

// ─── Spec Badges ──────────────────────────────────────────────────────────────
function SpecBadges({ spec }: { spec: Record<string, string | number | boolean> }) {
  const entries = Object.entries(spec)
    .filter(([k]) => !['note'].includes(k))
    .slice(0, 4);
  return (
    <div className="flex flex-wrap gap-1 mt-1.5">
      {entries.map(([k, v]) => (
        <span key={k} className="text-[10px] bg-muted px-1.5 py-0.5 rounded text-muted-foreground">
          {k.replace(/_/g, ' ').toUpperCase()}:{' '}
          <span className="font-medium text-foreground">{String(v)}</span>
        </span>
      ))}
    </div>
  );
}

// ─── Hardware Card ────────────────────────────────────────────────────────────
const HardwareCard = memo(function HardwareCard({ item }: { item: HardwareComponent }) {
  const [expanded, setExpanded] = useState(false);
  const [liked, setLiked] = useState(false);
  const [likeCount, setLikeCount] = useState(item.likes);
  const meta = CATEGORY_META[item.category] ?? {
    label: item.category,
    icon: Package,
    color: 'text-gray-500 bg-gray-500/10',
  };
  const Icon = meta.icon;
  const urls = Array.isArray(item.buy_urls) ? item.buy_urls : [];
  const newOffers = urls.filter(u => u.condition === 'new');
  const usedOffers = urls.filter(u => u.condition === 'used');

  const handleLike = async () => {
    if (liked) return;
    setLiked(true);
    setLikeCount(c => c + 1);
    await api.post(`/api/hardware/${item.id}/like`, {}).catch(() => {
      setLiked(false);
      setLikeCount(c => c - 1);
    });
  };

  return (
    <div className="group rounded-xl border bg-card hover:border-primary/40 transition-all duration-200 overflow-hidden flex flex-col">
      <div className="p-4 flex items-start gap-3">
        <div className={`p-2.5 rounded-lg shrink-0 ${meta.color}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-xs text-muted-foreground font-medium">{item.brand}</p>
              <h3 className="font-semibold text-sm leading-tight">{item.model}</h3>
            </div>
            <div className="text-right shrink-0">
              <p className="text-lg font-bold text-primary">
                ~{item.price_est.toLocaleString()}
                <span className="text-xs font-normal text-muted-foreground ml-1">
                  {item.currency}
                </span>
              </p>
            </div>
          </div>
          <SpecBadges spec={item.spec} />
        </div>
      </div>

      <div
        className="grid transition-all duration-300 ease-in-out"
        style={{ gridTemplateRows: expanded ? '1fr' : '0fr' }}
      >
        <div className="overflow-hidden">
          <div className="px-4 pb-3 border-t pt-3 bg-muted/30">
            <div className="flex flex-col gap-x-4 gap-y-1">
              {Object.entries(item.spec).map(([k, v]) => (
                <div key={k} className="flex justify-between text-xs">
                  <span className="text-muted-foreground capitalize">{k.replace(/_/g, ' ')}</span>
                  <span className="flex-1 mx-2 border-b border-dashed border-border/50 self-end mb-0.5" />
                  <span className="font-medium ml-2 text-right">{String(v)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="mt-auto border-t px-4 py-3 flex items-center gap-2 bg-muted/20">
        <button
          onClick={() => setExpanded(e => !e)}
          className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors hover:cursor-pointer"
        >
          <ChevronDown
            className={`h-3 w-3 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
          />
          {expanded ? 'Less' : 'Full specs'}
        </button>
        <div className="flex-1" />
        <button
          onClick={handleLike}
          className={`flex items-center gap-1 text-xs transition-colors ${liked ? 'text-red-500' : 'text-muted-foreground hover:text-red-400'}`}
        >
          <Heart className={`h-3.5 w-3.5 hover:cursor-pointer ${liked ? 'fill-red-500' : ''}`} />
          {likeCount}
        </button>
        {newOffers[0] && (
          <Button size="sm" className="h-7 px-3 text-xs" asChild>
            <a href={newOffers[0].url} target="_blank" rel="noreferrer">
              <ShoppingCart className="h-3 w-3 opacity-60" />
            </a>
          </Button>
        )}
        {usedOffers[0] && (
          <Button
            size="sm"
            variant="outline"
            className="h-7 px-3 text-xs border-amber-300/50 text-amber-700 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20"
            asChild
          >
            <a href={usedOffers[0].url} target="_blank" rel="noreferrer">
              <ShoppingCart className="h-3 w-3 opacity-60" />
            </a>
          </Button>
        )}
      </div>
    </div>
  );
});

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function HardwareCatalogPage() {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [maxPrice, setMaxPrice] = useState(0);
  const [page, setPage] = useState(0);
  const [showSubmit, setShowSubmit] = useState(false);
  const deferredSearch = useDeferredValue(search);

  const handleSearch = (value: string) => {
    setSearch(value);
    setPage(0);
  };
  const handleCategory = (cat: string) => {
    setCategory(cat);
    setPage(0);
  };
  const handleMaxPrice = (value: number) => {
    setMaxPrice(value);
    setPage(0);
  };
  const handleClearFilters = () => {
    setSearch('');
    setCategory('');
    setMaxPrice(0);
    setPage(0);
  };

  const { data, isLoading, isFetching } = useHardware({
    search: deferredSearch,
    category,
    max_price: maxPrice || undefined,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  });
  const { data: categoriesData } = useHardwareCategories();
  const categories = categoriesData?.data ?? [];
  const items = data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="space-y-6 max-w-7xl mx-auto py-8 px-6">
      {showSubmit && <SubmitHardwareModal onClose={() => setShowSubmit(false)} />}

      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Hardware Catalog</h1>
          <p className="text-muted-foreground mt-1">
            {total > 0 ? `${total} components` : 'Browse'} — routers, switches, NAS, servers, SBCs
            and more
          </p>
        </div>
        <Button size="sm" onClick={() => setShowSubmit(true)}>
          <Plus className="h-4 w-4 mr-2" /> Submit Hardware
        </Button>
      </div>

      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-50 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search brand or model..."
            className="pl-9"
            value={search}
            onChange={e => handleSearch(e.target.value)}
          />
        </div>
        <select
          className="h-9 rounded-md border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          value={category}
          onChange={e => handleCategory(e.target.value)}
        >
          <option value="">All categories</option>
          {categories.map(cat => (
            <option key={cat} value={cat}>
              {CATEGORY_META[cat]?.label ?? cat}
            </option>
          ))}
        </select>
        <select
          className="h-9 rounded-md border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          value={maxPrice}
          onChange={e => handleMaxPrice(Number(e.target.value))}
        >
          <option value={0}>Any price</option>
          <option value={50}>Under €50</option>
          <option value={100}>Under €100</option>
          <option value={200}>Under €200</option>
          <option value={500}>Under €500</option>
          <option value={1000}>Under €1000</option>
        </select>
        {(search || category || maxPrice > 0) && (
          <Button variant="ghost" size="sm" onClick={handleClearFilters}>
            Clear filters
          </Button>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => handleCategory('')}
          className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors hover:cursor-pointer ${!category ? 'bg-primary text-primary-foreground border-primary' : 'border-border hover:bg-muted'}`}
        >
          All
        </button>
        {categories.map(cat => {
          const meta = CATEGORY_META[cat];
          const Icon = meta?.icon ?? Package;
          return (
            <button
              key={cat}
              onClick={() => handleCategory(cat === category ? '' : cat)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors hover:cursor-pointer ${cat === category ? 'bg-primary text-primary-foreground border-primary' : 'border-border hover:bg-muted'}`}
            >
              <Icon className="h-3 w-3" />
              {meta?.label ?? cat}
            </button>
          );
        })}
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="rounded-xl border bg-card h-48 animate-pulse" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Package className="h-12 w-12 text-muted-foreground/40 mb-4" />
          <h3 className="font-semibold text-lg mb-1">No components found</h3>
          <p className="text-muted-foreground text-sm">Try adjusting your filters</p>
        </div>
      ) : (
        <>
          <div
            className={`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 stagger-children transition-opacity duration-200 ${isFetching ? 'opacity-60' : ''}`}
          >
            {items.map(item => (
              <HardwareCard key={item.id} item={item} />
            ))}
          </div>
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-3 pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage(p => p - 1)}
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
                onClick={() => setPage(p => p + 1)}
                disabled={page >= totalPages - 1 || isFetching}
              >
                Next
              </Button>
            </div>
          )}
        </>
      )}

      {!category && !search && categories.length > 0 && (
        <div className="border-t pt-6">
          <p className="text-sm text-muted-foreground mb-3 font-medium">Browse by category</p>
          <div className="flex flex-wrap gap-2">
            {categories.map(cat => {
              const meta = CATEGORY_META[cat];
              return (
                <Badge
                  key={cat}
                  variant="outline"
                  className="cursor-pointer hover:bg-muted"
                  onClick={() => handleCategory(cat)}
                >
                  {meta?.label ?? cat}
                </Badge>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
