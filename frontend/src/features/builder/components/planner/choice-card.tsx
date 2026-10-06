import { Check, type LucideIcon } from 'lucide-react';

export function ChoiceCard({
  selected,
  onClick,
  title,
  description,
  meta,
  icon: Icon,
}: {
  selected: boolean;
  onClick: () => void;
  title: string;
  description: string;
  meta?: string;
  icon?: LucideIcon;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={`min-h-32 rounded-2xl border p-5 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
        selected
          ? 'border-primary bg-primary/10 shadow-[0_14px_36px_-24px_var(--primary)]'
          : 'border-border bg-card hover:-translate-y-0.5 hover:border-primary/40 hover:bg-muted/30'
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        {Icon && (
          <Icon className={`size-5 ${selected ? 'text-primary' : 'text-muted-foreground'}`} />
        )}
        <span
          className={`grid size-5 place-items-center rounded-full border ${selected ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/30'}`}
        >
          {selected && <Check className="size-3" />}
        </span>
      </div>
      <h3 className="mt-4 font-semibold">{title}</h3>
      <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{description}</p>
      {meta && (
        <p className="mt-3 text-xs font-semibold uppercase tracking-wider text-primary">{meta}</p>
      )}
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
      <label htmlFor={id} className="text-sm font-semibold">
        {label}
      </label>
      <div className="mt-2 flex items-center gap-2">
        <input
          id={id}
          type="number"
          inputMode="decimal"
          min={min}
          max={max}
          step={step}
          value={Number.isFinite(value) ? value : ''}
          onChange={event => onChange(event.target.value === '' ? 0 : Number(event.target.value))}
          className="h-11 w-full rounded-xl border bg-background px-3 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        />
        {unit && <span className="shrink-0 text-sm text-muted-foreground">{unit}</span>}
      </div>
      {hint && <p className="mt-1.5 text-xs leading-5 text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** A switch-style row for an optional extra. */
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
    <label
      className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition-colors ${
        checked ? 'border-primary bg-primary/10' : 'border-border hover:border-primary/40'
      }`}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={event => onChange(event.target.checked)}
        className="mt-1 size-4 accent-[var(--primary)]"
      />
      <span>
        <span className="block text-sm font-semibold">{title}</span>
        <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">{description}</span>
      </span>
    </label>
  );
}
