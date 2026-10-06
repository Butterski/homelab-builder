import { useState } from 'react';
import { ChevronDown, LayoutGrid } from 'lucide-react';
import { Button } from '../../../components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '../../../components/ui/popover';
import {
  LAYOUT_STYLES,
  computeLayout,
  pictureOf,
  withPositions,
  type LayoutMetrics,
  type LayoutPicture,
  type LayoutStyle,
} from '../lib/layout';
import { layoutGraphFromFlow } from '../lib/layout/from-flow';
import { describeLayout, lastPolishStyle, polishCanvas } from '../lib/polish';
import { useBuilderStore } from '../store/builder-store';
import { LayoutThumbnail } from './layout-thumbnail';

interface Preview {
  style: (typeof LAYOUT_STYLES)[number];
  picture: LayoutPicture;
  metrics: LayoutMetrics;
}

/** This canvas arranged in every style, without touching it. */
function previewStyles(): Preview[] {
  const { nodes, edges, hardwareNodes } = useBuilderStore.getState();
  const graph = layoutGraphFromFlow(nodes, edges, hardwareNodes);
  return LAYOUT_STYLES.map(style => {
    const result = computeLayout(graph, { style: style.id });
    return {
      style,
      picture: pictureOf(withPositions(graph, result.positions)),
      metrics: result.metrics,
    };
  });
}

/**
 * The Polish control of the builder toolbar. The button arranges the canvas in
 * the style used last; the caret shows what each style would make of this
 * build before anything moves.
 */
export function PolishMenu() {
  const [open, setOpen] = useState(false);
  const [previews, setPreviews] = useState<Preview[]>([]);
  const [usual, setUsual] = useState<LayoutStyle>(lastPolishStyle);
  const usualLabel = LAYOUT_STYLES.find(style => style.id === usual)?.label ?? usual;

  const apply = (style: LayoutStyle) => {
    setOpen(false);
    setUsual(style);
    polishCanvas(style);
  };

  return (
    <div className="flex">
      <Button
        variant="outline"
        size="sm"
        onClick={() => polishCanvas(usual)}
        title={`Arrange the canvas (${usualLabel})`}
        className="builder-control-button h-10 rounded-r-none px-3"
      >
        <LayoutGrid className="size-4" aria-hidden />
        <span className="builder-action-label ml-2">Polish</span>
      </Button>
      <Popover
        open={open}
        onOpenChange={next => {
          // The previews are of the canvas as it is when the menu opens.
          if (next) setPreviews(previewStyles());
          setOpen(next);
        }}
      >
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            aria-label="Choose a layout style"
            title="Choose a layout style"
            className="builder-control-button h-10 rounded-l-none border-l-0 px-1.5"
          >
            <ChevronDown className="size-4" aria-hidden />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[22rem] max-w-[calc(100vw-2rem)] p-3">
          <p className="text-sm font-medium">Polish the layout</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Arranges every device on the canvas. Undo brings the old layout back.
          </p>
          {previews.some(preview => preview.picture.cards.length > 0) ? (
            <div className="mt-3 grid gap-2">
              {previews.map(({ style, picture, metrics }) => (
                <button
                  key={style.id}
                  type="button"
                  onClick={() => apply(style.id)}
                  className="rounded-lg border border-border bg-card p-2 text-left outline-none transition-colors hover:border-primary/60 hover:bg-accent/40 focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                  <LayoutThumbnail
                    picture={picture}
                    label={`This project in the ${style.label} layout`}
                    className="h-24 w-full rounded-md bg-muted/30"
                  />
                  <span className="mt-2 flex items-center justify-between gap-2">
                    <span className="text-sm font-medium">{style.label}</span>
                    {style.id === usual && (
                      <span className="rounded-full border border-border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                        Polish button
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {style.description}
                  </span>
                  <span className="mt-1 block text-xs tabular-nums text-muted-foreground">
                    {describeLayout(metrics)}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <p className="app-empty-state mt-3 px-3 py-6 text-center text-xs text-muted-foreground">
              Add hardware to the canvas first.
            </p>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}
