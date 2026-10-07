import type { InputHTMLAttributes } from 'react';
import { Check } from 'lucide-react';
import { cn } from '../../lib/utils';

type TickBoxProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>;

/**
 * A checkbox drawn from the theme: an empty box, or a filled one with a tick.
 * It is a real checkbox underneath, so it is focused, toggled and announced
 * like one, and it prints as a box to tick with a pen.
 */
export function TickBox({ className, ...props }: TickBoxProps) {
  return (
    <span className={cn('relative grid size-4 shrink-0 place-items-center', className)}>
      <input
        type="checkbox"
        className="peer size-4 appearance-none rounded-[4px] border border-muted-foreground/70 bg-transparent transition-colors [print-color-adjust:exact] checked:border-primary checked:bg-primary hover:cursor-pointer hover:border-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50"
        {...props}
      />
      <Check
        className="pointer-events-none absolute size-3 text-primary-foreground opacity-0 peer-checked:opacity-100"
        strokeWidth={3.5}
        aria-hidden="true"
      />
    </span>
  );
}
