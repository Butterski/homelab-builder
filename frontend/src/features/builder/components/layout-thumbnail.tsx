import { memo } from 'react';
import { cn } from '../../../lib/utils';
import type { LayoutPicture } from '../lib/layout';

/** Device types that carry the network; they are drawn stronger so the structure reads at a glance. */
const NETWORK_GEAR = new Set(['modem', 'router', 'firewall', 'switch', 'access_point']);

interface LayoutThumbnailProps {
  picture: LayoutPicture;
  /** What the drawing shows, for screen readers. */
  label: string;
  className?: string;
}

/**
 * A canvas in miniature: every card and every cable where the layout engine
 * says they are. Lines scale with the drawing, so a network of two hundred
 * devices is as legible as one of five.
 */
export const LayoutThumbnail = memo(function LayoutThumbnail({
  picture,
  label,
  className,
}: LayoutThumbnailProps) {
  const { bounds } = picture;
  if (picture.cards.length === 0) {
    return <div className={cn('rounded-md bg-muted/40', className)} role="img" aria-label={label} />;
  }
  // About one pixel at the size these are shown, whatever the canvas measures.
  const unit = Math.max(bounds.width / 240, bounds.height / 90, 2);
  const pad = unit * 4;
  const viewBox = [
    bounds.x - pad,
    bounds.y - pad,
    bounds.width + 2 * pad,
    bounds.height + 2 * pad,
  ].join(' ');

  return (
    <svg
      viewBox={viewBox}
      role="img"
      aria-label={label}
      preserveAspectRatio="xMidYMid meet"
      className={cn('block', className)}
    >
      {picture.cards
        .filter(card => card.rack)
        .map(card => (
          <rect
            key={card.nodeId}
            x={card.x}
            y={card.y}
            width={card.width}
            height={card.height}
            rx={unit * 2}
            strokeWidth={unit}
            className="fill-muted/50 stroke-muted-foreground/50"
          />
        ))}
      {picture.cables.map((cable, index) => (
        <polyline
          key={index}
          points={cable.points.map(point => `${point.x},${point.y}`).join(' ')}
          fill="none"
          strokeWidth={unit * 1.5}
          strokeLinejoin="round"
          strokeDasharray={cable.tree ? undefined : `${unit * 3} ${unit * 2}`}
          className={cable.tree ? 'stroke-muted-foreground' : 'stroke-muted-foreground/60'}
        />
      ))}
      {picture.cards
        .filter(card => !card.rack)
        .map(card => (
          <rect
            key={card.nodeId}
            x={card.x}
            y={card.y}
            width={card.width}
            height={card.height}
            rx={unit * 2}
            strokeWidth={unit}
            className={
              NETWORK_GEAR.has(card.type)
                ? 'fill-primary/55 stroke-primary'
                : 'fill-primary/15 stroke-primary/60'
            }
          />
        ))}
    </svg>
  );
});
