import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../../services/api';
import { useBuilderStore } from '../../builder/store/builder-store';
import { generateShoppingList } from '../lib/generator';
import type { ShoppingLocale } from '../lib/link-generator';
import { Button } from '../../../components/ui/button';
import { Badge } from '../../../components/ui/badge';
import {
  Printer,
  ShoppingCart,
  Globe,
  ExternalLink,
  Package,
  Cpu,
  HardDrive,
  Network,
  Wifi,
  Server,
  CheckCircle2,
  Eye,
  EyeOff,
} from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../../components/ui/table';

const CATEGORY_ICONS: Record<string, React.ElementType> = {
  Compute: Cpu,
  Memory: Package,
  Storage: HardDrive,
  Router: Network,
  Switch: Network,
  Nas: HardDrive,
  Server: Server,
  Pc: Cpu,
  'Access point': Wifi,
};

// Confirmation dialog after clicking Buy
function BuyConfirmDialog({
  itemName,
  onBought,
  onClose,
}: {
  itemName: string;
  onBought: () => void;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="bg-card border rounded-xl p-6 max-w-sm w-full mx-4 animate-in zoom-in-95"
        onClick={e => e.stopPropagation()}
      >
        <h3 className="font-bold text-lg mb-1">Did you order it?</h3>
        <p className="text-muted-foreground text-sm mb-5">
          Mark <span className="font-semibold text-foreground">"{itemName}"</span> as bought to
          track your progress and hide it from the list.
        </p>
        <div className="flex gap-3">
          <Button className="flex-1" onClick={onBought}>
            <CheckCircle2 className="h-4 w-4 mr-2" /> Yes, mark as bought
          </Button>
          <Button variant="outline" onClick={onClose}>
            Not yet
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function ShoppingListPage() {
  const { hardwareNodes, boughtItems, markAsBought, unmarkAsBought, showBought, setShowBought } =
    useBuilderStore();
  const [locale, setLocale] = useState<ShoppingLocale>('en-US');
  const [pendingBuy, setPendingBuy] = useState<{ itemName: string; url: string } | null>(null);

  const { data: catResponse } = useQuery({
    queryKey: ['public-hardware'],
    queryFn: () => api.getHardwarePublic(),
  });

  const catalog = catResponse?.data || [];
  const allItems = generateShoppingList([], hardwareNodes, locale, catalog);
  const items = showBought ? allItems : allItems.filter(item => !boughtItems.includes(item.name));
  const boughtCount = allItems.filter(item => boughtItems.includes(item.name)).length;

  const currency = locale === 'pl-PL' ? 'PLN' : 'EUR';

  const totalCost = items.reduce((acc, item) => {
    const cheapestNew = item.offers
      .filter(o => o.condition === 'new')
      .sort((a, b) => a.price - b.price)[0];
    return acc + (cheapestNew?.price ?? 0);
  }, 0);

  const handleBuyClick = (itemName: string, url: string) => {
    window.open(url, '_blank', 'noreferrer');
    setPendingBuy({ itemName, url });
  };

  const handlePrint = () => window.print();

  if (hardwareNodes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-center border rounded-lg bg-muted/20 min-h-100">
        <ShoppingCart className="h-16 w-16 mb-6 text-muted-foreground/50" />
        <h3 className="text-xl font-bold mb-2">Your shopping list is empty</h3>
        <p className="text-muted-foreground mb-6 max-w-md">
          Start by adding services or hardware in the Visual Builder to generate a parts list.
        </p>
        <div className="flex gap-4">
          <Button variant="outline" onClick={() => (window.location.href = '/services')}>
            Browse Services
          </Button>
          <Button onClick={() => (window.location.href = '/builder')}>Open Visual Builder</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 print:space-y-4 max-w-5xl mx-auto py-8 px-6">
      {/* Buy confirmation dialog */}
      {pendingBuy && (
        <BuyConfirmDialog
          itemName={pendingBuy.itemName}
          onBought={() => {
            markAsBought(pendingBuy.itemName);
            setPendingBuy(null);
          }}
          onClose={() => setPendingBuy(null)}
        />
      )}

      {/* Header */}
      <div className="flex items-start justify-between print:hidden">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Shopping List</h1>
          <p className="text-muted-foreground">
            Recommended hardware based on your Visual Builder design.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center border rounded-md bg-background px-3 py-1.5">
            <Globe className="mr-2 h-4 w-4 text-muted-foreground" />
            <select
              className="bg-transparent text-sm font-medium focus:outline-none cursor-pointer"
              value={locale}
              onChange={e => setLocale(e.target.value as ShoppingLocale)}
            >
              <option value="en-US">International (EUR)</option>
              <option value="pl-PL">Poland (PLN)</option>
            </select>
          </div>
          <Button variant="outline" onClick={handlePrint}>
            <Printer className="mr-2 h-4 w-4" /> Print
          </Button>
        </div>
      </div>

      {/* Total Banner */}
      <div className="flex items-center justify-between rounded-xl border bg-primary/5 px-6 py-4">
        <div>
          <p className="text-sm text-muted-foreground">Estimated Remaining (cheapest new)</p>
          <p className="text-4xl font-bold text-primary mt-0.5">
            ~{totalCost.toLocaleString()}{' '}
            <span className="text-xl font-normal text-muted-foreground">{currency}</span>
          </p>
        </div>
        <div className="text-right text-sm">
          <div className="flex items-center gap-2 justify-end mb-1">
            {boughtCount > 0 && (
              <Badge
                variant="default"
                className="bg-green-600 hover:bg-green-700 cursor-pointer"
                onClick={() => setShowBought(!showBought)}
              >
                <CheckCircle2 className="h-3 w-3 mr-1" /> {boughtCount} bought
              </Badge>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={() => setShowBought(!showBought)}
            >
              {showBought ? <EyeOff className="h-3 w-3 mr-1" /> : <Eye className="h-3 w-3 mr-1" />}
              {showBought ? 'Hide bought' : 'Show bought'}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {items.length} item{items.length !== 1 ? 's' : ''} remaining
          </p>
          <p className="text-xs text-muted-foreground">*Estimates only. Shipping not included.</p>
        </div>
      </div>

      {/* Table */}
      <div className="border rounded-xl overflow-hidden bg-card">
        <Table>
          <TableHeader className="bg-muted/50">
            <TableRow>
              <TableHead className="w-[35%] pl-6">Component</TableHead>
              <TableHead className="w-[65%]">Offers (2 New · 1 Used)</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item, index) => {
              const Icon = CATEGORY_ICONS[item.category] ?? Package;
              const isBought = boughtItems.includes(item.name);
              const newOffers = item.offers.filter(o => o.condition === 'new');
              const usedOffers = item.offers.filter(o => o.condition === 'used');

              return (
                <TableRow
                  key={index}
                  className={`hover:bg-muted/30 transition-colors align-top ${isBought ? 'opacity-50' : ''}`}
                >
                  {/* Component */}
                  <TableCell className="pl-6 py-5 align-top">
                    <div className="flex items-start gap-3">
                      <div
                        className={`mt-0.5 p-2 rounded-lg shrink-0 ${isBought ? 'bg-green-500/20 text-green-600' : 'bg-primary/10 text-primary'}`}
                      >
                        {isBought ? (
                          <CheckCircle2 className="h-4 w-4" />
                        ) : (
                          <Icon className="h-4 w-4" />
                        )}
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <span
                          className={`font-semibold leading-tight ${isBought ? 'line-through text-muted-foreground' : ''}`}
                        >
                          {item.name}
                        </span>
                        {item.spec && (
                          <span className="text-xs text-muted-foreground leading-snug">
                            {item.spec}
                          </span>
                        )}
                        <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                          <Badge
                            variant={
                              isBought
                                ? 'default'
                                : item.priority === 'essential'
                                  ? 'default'
                                  : 'outline'
                            }
                            className={`text-[10px] h-4 px-1.5 rounded-sm ${isBought ? 'bg-green-600 hover:bg-green-700' : ''}`}
                          >
                            {isBought
                              ? '✓ Bought'
                              : item.priority === 'essential'
                                ? 'Required'
                                : item.priority === 'manual'
                                  ? 'Your Pick'
                                  : 'Optional'}
                          </Badge>
                          <Badge
                            variant="secondary"
                            className="text-[10px] h-4 px-1.5 rounded-sm font-normal"
                          >
                            {item.category}
                          </Badge>
                          {isBought && (
                            <button
                              className="text-[10px] text-muted-foreground hover:text-foreground underline"
                              onClick={() => unmarkAsBought(item.name)}
                            >
                              undo
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </TableCell>

                  {/* Offers */}
                  <TableCell className="py-5 pr-6 align-top">
                    <div className="flex flex-col gap-2">
                      {newOffers.map((offer, i) => (
                        <div
                          key={i}
                          className="flex items-center justify-between gap-3 rounded-lg border bg-background/60 px-3 py-2"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="text-[10px] font-bold text-green-600 dark:text-green-400 bg-green-100 dark:bg-green-900/30 px-1.5 py-0.5 rounded uppercase tracking-wide shrink-0">
                              New
                            </span>
                            <span className="text-sm font-medium truncate">{offer.store}</span>
                          </div>
                          <div className="flex items-center gap-3 shrink-0">
                            <span className="font-mono font-bold text-sm">
                              {offer.price.toLocaleString()}{' '}
                              <span className="text-xs font-normal text-muted-foreground">
                                {offer.currency}
                              </span>
                            </span>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 px-3 text-xs"
                              disabled={isBought}
                              onClick={() => handleBuyClick(item.name, offer.url)}
                            >
                              Buy <ExternalLink className="ml-1 h-3 w-3 opacity-50" />
                            </Button>
                          </div>
                        </div>
                      ))}

                      {usedOffers.map((offer, i) => (
                        <div
                          key={i}
                          className="flex items-center justify-between gap-3 rounded-lg border border-dashed border-amber-300/50 bg-amber-50/30 dark:bg-amber-900/10 px-3 py-2"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="text-[10px] font-bold text-amber-600 dark:text-amber-400 bg-amber-100 dark:bg-amber-900/30 px-1.5 py-0.5 rounded uppercase tracking-wide shrink-0">
                              Used
                            </span>
                            <span className="text-sm font-medium truncate">{offer.store}</span>
                          </div>
                          <div className="flex items-center gap-3 shrink-0">
                            <span className="font-mono font-bold text-sm text-amber-700 dark:text-amber-400">
                              {offer.price.toLocaleString()}{' '}
                              <span className="text-xs font-normal text-muted-foreground">
                                {offer.currency}
                              </span>
                            </span>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 px-3 text-xs border-amber-300/50 hover:bg-amber-50 dark:hover:bg-amber-900/20"
                              disabled={isBought}
                              onClick={() => handleBuyClick(item.name, offer.url)}
                            >
                              Buy <ExternalLink className="ml-1 h-3 w-3 opacity-50" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}

            {/* Bought items section */}
            {showBought && boughtCount > 0 && (
              <TableRow>
                <TableCell colSpan={2} className="py-3 px-6 bg-green-500/5 border-t">
                  <p className="text-xs text-green-600 dark:text-green-400 font-medium flex items-center gap-1.5">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    {boughtCount} item{boughtCount !== 1 ? 's' : ''} already purchased — shown above
                    with strikethrough
                  </p>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Print footer */}
      <div className="hidden print:block text-center text-sm text-muted-foreground mt-12 border-t pt-4">
        Generated by HLBuilder — {new Date().toLocaleDateString()}
      </div>
    </div>
  );
}
