import { Check } from 'lucide-react';
import { TickBox } from '../../../../components/ui/tick-box';
import { cn } from '../../../../lib/utils';

/**
 * One answer to a question of the planner. It is a form control, drawn as one:
 * a mark that says whether it is chosen, the answer, and what it leads to.
 * `multiple` answers carry a box to tick; one-of-several answers carry a dot.
 */
export function ChoiceCard({
  selected,
  onClick,
  title,
  description,
  meta,
  multiple = false,
}: {
  selected: boolean;
  onClick: () => void;
  title: string;
  description: string;
  /** A figure that goes with the answer, such as a price range. */
  meta?: string;
  multiple?: boolean;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        'grid grid-cols-[1.25rem_minmax(0,1fr)] gap-x-3 rounded-lg border p-4 text-left transition-colors hover:cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
        selected
          ? 'border-foreground bg-muted/50'
          : 'border-border hover:border-muted-foreground/60',
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'mt-0.5 grid size-4 place-items-center border transition-colors',
          multiple ? 'rounded-[4px]' : 'rounded-full',
          selected
            ? 'border-primary bg-primary text-primary-foreground'
            : 'border-muted-foreground/70',
        )}
      >
        {selected &&
          (multiple ? (
            <Check className="size-3" strokeWidth={3.5} />
          ) : (
            <span className="size-1.5 rounded-full bg-primary-foreground" />
          ))}
      </span>
      <span className="min-w-0">
        <span className="block font-medium">{title}</span>
        <span className="mt-0.5 block text-sm text-muted-foreground">{description}</span>
        {meta && <span className="app-figure mt-2 block text-sm">{meta}</span>}
      </span>
    </button>
  );
}

/** A labelled number input for the planner forms. */
export function NumberField({
  id,
  label,
  hint,
  value,
  onChange,
  min = 0,
  max,
  step = 1,
  unit,
}: {
  id: string;
  label: string;
  hint?: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
}) {
  return (
    <div>
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <div className="mt-1.5 flex items-center gap-2">
        <input
          id={id}
          type="number"
          inputMode="decimal"
          min={min}
          max={max}
          step={step}
          value={Number.isFinite(value) ? value : ''}
          onChange={event => onChange(event.target.value === '' ? 0 : Number(event.target.value))}
          className="h-10 w-full rounded-md border border-input bg-transparent px-3 font-mono text-sm tabular-nums focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
        {unit && <span className="shrink-0 text-sm text-muted-foreground">{unit}</span>}
      </div>
      {hint && <p className="mt-1.5 text-xs leading-5 text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** An optional extra, switched on with a tick. */
export function ToggleRow({
  checked,
  onChange,
  title,
  description,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  title: string;
  description: string;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 border-y py-3.5">
      <TickBox
        className="mt-0.5"
        checked={checked}
        onChange={event => onChange(event.target.checked)}
      />
      <span>
        <span className="block text-sm font-medium">{title}</span>
        <span className="mt-0.5 block text-sm text-muted-foreground">{description}</span>
      </span>
    </label>
  );
}
