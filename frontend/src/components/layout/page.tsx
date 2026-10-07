import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';

const WIDTH = {
  /** Tables and grids: as wide as is still comfortable to scan. */
  wide: 'max-w-[88rem]',
  /** An article beside a rail. */
  article: 'max-w-[76rem]',
  /** A form or a short text. */
  narrow: 'max-w-[56rem]',
} as const;

type PageProps = {
  children: ReactNode;
  width?: keyof typeof WIDTH;
  className?: string;
};

/**
 * The frame of a screen outside the canvas. Every page starts at the same left
 * edge, so the title stands in the same place wherever one goes; how far the
 * page runs to the right depends on what it holds.
 */
export function Page({ children, width = 'wide', className }: PageProps) {
  return (
    <div className={cn('app-page w-full px-5 py-8 sm:px-8 lg:px-10', WIDTH[width], className)}>
      {children}
    </div>
  );
}

type PageHeaderProps = {
  title: ReactNode;
  /** One or two sentences under the title. */
  lede?: ReactNode;
  /** What can be done with the page as a whole, at the right. */
  actions?: ReactNode;
  className?: string;
};

type PageRowProps = {
  /** Anchor of the section; the heading gets `${id}-title`. */
  id: string;
  title: ReactNode;
  /** A sentence under the heading, in the rail. */
  note?: ReactNode;
  children: ReactNode;
  className?: string;
};

/**
 * A section of a page that is read: its heading stands in a rail at the left
 * and stays in view while the content beside it scrolls by. The landing page
 * is built the same way.
 */
export function PageRow({ id, title, note, children, className }: PageRowProps) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className={cn(
        'grid scroll-mt-6 gap-x-12 gap-y-5 border-t py-10 lg:grid-cols-[minmax(0,4fr)_minmax(0,7fr)]',
        className,
      )}
    >
      <div className="lg:sticky lg:top-8 lg:self-start">
        <h2 id={`${id}-title`} className="text-xl font-semibold leading-snug tracking-[-0.015em]">
          {title}
        </h2>
        {note && <p className="mt-2 max-w-sm text-sm text-muted-foreground">{note}</p>}
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

/** The title of a page, on the hairline that the content hangs from. */
export function PageHeader({ title, lede, actions, className }: PageHeaderProps) {
  return (
    <header
      className={cn(
        'app-hero flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between',
        className,
      )}
    >
      <div className="min-w-0">
        <h1 className="text-[1.75rem] font-semibold leading-tight tracking-[-0.02em]">{title}</h1>
        {lede && <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">{lede}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}
