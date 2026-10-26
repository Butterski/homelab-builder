import manifest from '../../../public/brand-icons/manifest.json';

export type BrandIconCategory = 'hardware' | 'platform' | 'network' | 'service';

export interface BrandIconEntry {
  readonly id: string;
  readonly name: string;
  readonly category: BrandIconCategory;
  readonly aliases: readonly string[];
  readonly asset: string;
  readonly plate: 'light' | 'dark';
}

// The public manifest is also the offline source attribution and artwork inventory.
export const BRAND_ICONS = manifest.icons as readonly BrandIconEntry[];
export const BRAND_ICON_CATEGORIES = manifest.categories as readonly {
  id: BrandIconCategory;
  label: string;
}[];
const byId: Readonly<Record<string, BrandIconEntry>> = Object.fromEntries(
  BRAND_ICONS.map(icon => [icon.id, icon]),
);

/** Only catalog IDs can resolve to local artwork; URLs and SVG input never do. */
export function getBrandIcon(icon: unknown): BrandIconEntry | undefined {
  return typeof icon === 'string' && Object.hasOwn(byId, icon) ? byId[icon] : undefined;
}

function normalizeSearch(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase('en')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

const searchable = BRAND_ICONS.map(icon => ({
  icon,
  text: normalizeSearch([icon.id, icon.name, ...icon.aliases].join(' ')),
}));

export function searchBrandIcons(
  query: string,
  category?: BrandIconCategory,
): readonly BrandIconEntry[] {
  const tokens = normalizeSearch(query).split(' ').filter(Boolean);
  return searchable
    .filter(({ icon, text }) =>
      (!category || icon.category === category) && tokens.every(token => text.includes(token)),
    )
    .map(({ icon }) => icon);
}
