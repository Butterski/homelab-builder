import { useId, useState } from 'react';
import { Image as ImageIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import {
  BRAND_ICON_CATEGORIES,
  getBrandIcon,
  searchBrandIcons,
  type BrandIconCategory,
} from '../catalog';
import { BrandIcon } from './brand-icon';

export interface IconPickerProps {
  value?: string;
  onChange: (icon: string | undefined) => void;
}

export function IconPicker({ value, onChange }: IconPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<BrandIconCategory>();
  const searchId = useId();
  const selected = getBrandIcon(value);
  const matches = searchBrandIcons(query, category);

  const choose = (icon: string | undefined) => {
    onChange(icon);
    setOpen(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={nextOpen => {
        setOpen(nextOpen);
        if (nextOpen) {
          setQuery('');
          setCategory(undefined);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" variant="outline" aria-label="Icon" className="w-full justify-start">
          <BrandIcon
            icon={value}
            className="size-5"
            fallback={<ImageIcon aria-hidden="true" />}
          />
          <span>Icon</span>
          <span className="ml-auto truncate text-muted-foreground">
            {selected?.name ?? (value ? 'Unrecognized icon' : 'Default')}
          </span>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] w-[calc(100%-2rem)] max-w-2xl gap-4 overflow-y-auto">
        <DialogHeader className="pr-6 text-left">
          <DialogTitle>Choose an icon</DialogTitle>
          <DialogDescription>
            Choose a brand mark, or keep the default device icon. Icons are bundled with HLBuilder.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <label htmlFor={searchId} className="text-sm font-medium">Search icons</label>
          <Input
            id={searchId}
            type="search"
            placeholder="Search icons"
            autoComplete="off"
            value={query}
            onChange={event => setQuery(event.target.value)}
          />
        </div>

        <div role="group" aria-label="Icon categories" className="flex flex-wrap gap-2">
          <button
            type="button"
            aria-pressed={!category}
            className={cn('app-filter', !category && 'border-foreground text-foreground')}
            onClick={() => setCategory(undefined)}
          >
            All
          </button>
          {BRAND_ICON_CATEGORIES.map(entry => (
            <button
              key={entry.id}
              type="button"
              aria-pressed={category === entry.id}
              className={cn('app-filter', category === entry.id && 'border-foreground text-foreground')}
              onClick={() => setCategory(entry.id)}
            >
              {entry.label}
            </button>
          ))}
        </div>

        <p role="status" className="text-xs text-muted-foreground">
          {matches.length === 1 ? '1 icon' : `${matches.length} icons`}
          {selected ? `. Selected: ${selected.name}.` : '. Default device icon selected.'}
        </p>
        <div className="max-h-[42dvh] min-h-32 overflow-y-auto overscroll-contain">
          {matches.length ? (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="group" aria-label="Brand icons">
              {matches.map(entry => (
                <button
                  key={entry.id}
                  type="button"
                  aria-label={entry.name}
                  aria-pressed={value === entry.id}
                  onClick={() => choose(entry.id)}
                  className={cn(
                    'flex min-h-24 flex-col items-center justify-center gap-2 rounded-md border p-3 text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    value === entry.id ? 'border-foreground bg-accent' : 'border-border',
                  )}
                >
                  <BrandIcon icon={entry.id} className="size-8" fallback={null} />
                  <span className="max-w-full break-words text-center">{entry.name}</span>
                </button>
              ))}
            </div>
          ) : (
            <p className="py-6 text-sm text-muted-foreground">
              No icons match your search. Try another brand name or category.
            </p>
          )}
        </div>

        <DialogFooter className="gap-2 border-t pt-4 sm:justify-between sm:space-x-0">
          <Button type="button" variant="outline" onClick={() => choose(undefined)}>
            Use default icon
          </Button>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
