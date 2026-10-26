import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { getBrandIcon } from '../catalog';

export interface BrandIconProps {
  icon: unknown;
  className?: string;
  fallback: ReactNode;
}

export function BrandIcon({ icon, className, fallback }: BrandIconProps) {
  const entry = getBrandIcon(icon);
  if (!entry) return <>{fallback}</>;

  return (
    <span
      className={cn('inline-flex size-6 shrink-0 items-center justify-center overflow-hidden rounded-sm', className)}
      // These fixed plates belong to the artwork, not the surrounding interface theme.
      style={{ backgroundColor: entry.plate === 'dark' ? '#18181b' : '#ffffff' }}
    >
      <img
        src={entry.asset}
        alt={entry.name}
        width={24}
        height={24}
        draggable={false}
        className="block size-full object-contain p-0.5"
      />
    </span>
  );
}
