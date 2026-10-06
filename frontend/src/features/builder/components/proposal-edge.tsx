import type { CSSProperties } from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  getSmoothStepPath,
  getStraightPath,
  type EdgeProps,
} from '@xyflow/react';
import { useBuilderStore } from '../store/builder-store';
import { stepCableBusY } from '../lib/cable-path';
import type { DiffStatus } from '../lib/proposal-preview';

const DIFF_COLORS: Record<DiffStatus, string> = {
  added: '#22c55e',
  changed: '#f59e0b',
  removed: '#ef4444',
};

const DIFF_LABELS: Record<DiffStatus, string> = {
  added: 'new',
  changed: 'changed',
  removed: 'removed',
};

type ProposalEdgeData = {
  proposalDiff?: DiffStatus;
  connection_type?: string;
  /** Where this cable comes in the staged reveal of a proposal. */
  revealIndex?: number;
};

/**
 * A cable while a proposal is reviewed, coloured by what the proposal does to
 * it. It follows the same route as a cable of the live canvas, so the review
 * shows cables where they will be.
 */
export function ProposalEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
}: EdgeProps) {
  const lineStyle = useBuilderStore(s => s.edgePreferences.lineStyle);
  const { proposalDiff: status, connection_type: connectionType, revealIndex = 0 } =
    (data ?? {}) as ProposalEdgeData;

  const params = { sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition };
  const [path, labelX, labelY] =
    lineStyle === 'straight'
      ? getStraightPath(params)
      : lineStyle === 'bezier'
        ? getBezierPath(params)
        : getSmoothStepPath({
            ...params,
            borderRadius: 15,
            centerY: stepCableBusY(sourceY, sourcePosition, targetY, targetPosition),
          });

  const color = status ? DIFF_COLORS[status] : '#71717a';
  const wireless = connectionType === 'wireless';
  // A new cable draws itself from port to device. A dotted one cannot (the
  // drawing is done with the dash pattern), so it fades in.
  const drawn = status === 'added' && !wireless;
  const reveal = { '--reveal-index': revealIndex } as CSSProperties;

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        {...(drawn ? { pathLength: 1 } : {})}
        className={
          drawn ? 'proposal-edge-drawn' : status === 'added' ? 'proposal-edge-faded' : undefined
        }
        style={{
          ...reveal,
          stroke: color,
          strokeWidth: status ? 3 : 2,
          opacity: status === 'removed' ? 0.6 : status ? 1 : 0.55,
          ...(drawn
            ? {}
            : {
                strokeDasharray: status === 'removed' ? '6 6' : wireless ? '1 8' : undefined,
                strokeLinecap: wireless ? ('round' as const) : undefined,
              }),
        }}
      />
      {status && (
        <EdgeLabelRenderer>
          <div
            className="proposal-edge-label pointer-events-none absolute rounded border bg-background px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide"
            style={{
              ...reveal,
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              borderColor: color,
              color,
            }}
          >
            {DIFF_LABELS[status]}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
