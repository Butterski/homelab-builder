import { toast } from 'sonner';
import { useBuilderStore } from '../store/builder-store';
import { LAYOUT_STYLES, type LayoutMetrics, type LayoutStyle } from './layout';

const STYLE_KEY = 'hlb-polish-style';

/** The style the Polish button applies: the one used last on this browser. */
export function lastPolishStyle(): LayoutStyle {
  try {
    const stored = localStorage.getItem(STYLE_KEY);
    if (LAYOUT_STYLES.some(style => style.id === stored)) return stored as LayoutStyle;
  } catch {
    // Storage can be unavailable (private mode); the default is fine then.
  }
  return 'hierarchy';
}

function rememberPolishStyle(style: LayoutStyle): void {
  try {
    localStorage.setItem(STYLE_KEY, style);
  } catch {
    // See above.
  }
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** A layout in a few words, from the numbers the engine measured: "No crossings · 1650 × 500". */
export function describeLayout(metrics: LayoutMetrics): string {
  const crossings = metrics.treeCrossings + metrics.otherCrossings;
  const hits = metrics.treeCableHits + metrics.otherCableHits;
  const parts = [crossings === 0 ? 'No crossings' : count(crossings, 'crossing', 'crossings')];
  if (hits > 0) parts.push(count(hits, 'cable over a card', 'cables over a card'));
  parts.push(`${Math.round(metrics.bounds.width)} × ${Math.round(metrics.bounds.height)}`);
  return parts.join(' · ');
}

/**
 * Arranges the open canvas and says what happened. Works from anywhere (the
 * toolbar, the command palette): the positions are written in the store, the
 * canvas animates on its own.
 */
export function polishCanvas(style: LayoutStyle = lastPolishStyle()): void {
  const store = useBuilderStore.getState();
  if (store.proposalPreview) {
    toast.info('Finish reviewing the proposal before polishing the layout.');
    return;
  }
  const result = store.polishLayout(style);
  if (!result) {
    toast.error('Open a project before polishing its layout.');
    return;
  }
  rememberPolishStyle(style);
  if (result.positions.length === 0) {
    toast.info('Add hardware before polishing the layout.');
    return;
  }

  const label = LAYOUT_STYLES.find(entry => entry.id === style)?.label ?? style;
  const description = describeLayout(result.metrics);
  if (result.moved === 0) {
    toast.success(`Already tidy (${label})`, { description });
    return;
  }
  toast.success(`Layout polished: ${label}`, {
    description,
    action: { label: 'Undo', onClick: () => useBuilderStore.getState().undo() },
  });
}
