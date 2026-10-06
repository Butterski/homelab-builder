import { useEffect, useMemo } from 'react';
import {
  Background,
  BaseEdge,
  Controls,
  EdgeLabelRenderer,
  ReactFlow,
  ReactFlowProvider,
  ConnectionMode,
  getBezierPath,
  getSmoothStepPath,
  getStraightPath,
  useReactFlow,
  type EdgeProps,
  type NodeTypes,
} from '@xyflow/react';
import { Eye } from 'lucide-react';
import { useBuilderStore } from '../store/builder-store';
import { HardwareNode as HardwareNodeComponent } from './hardware-node';
import { RackNode } from './rack-node';
import type { DiffStatus } from '../lib/proposal-preview';
import { stepCableBusY } from '../lib/cable-path';

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

/** A cable on the preview canvas, coloured by what the proposal does to it. */
function ProposalPreviewEdge({
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
  const status = (data as { proposalDiff?: DiffStatus } | undefined)?.proposalDiff;
  const connectionType = (data as { connection_type?: string } | undefined)?.connection_type;

  const params = { sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition };
  const [path, labelX, labelY] =
    lineStyle === 'straight'
      ? getStraightPath(params)
      : lineStyle === 'bezier'
        ? getBezierPath(params)
        : getSmoothStepPath({
            ...params,
            borderRadius: 15,
            // Same bend as the live canvas, so a preview shows cables where they will be.
            centerY: stepCableBusY(sourceY, sourcePosition, targetY, targetPosition),
          });

  const color = status ? DIFF_COLORS[status] : '#71717a';
  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        style={{
          stroke: color,
          strokeWidth: status ? 3 : 2,
          opacity: status === 'removed' ? 0.6 : status ? 1 : 0.55,
          strokeDasharray:
            status === 'removed' ? '6 6' : connectionType === 'wireless' ? '1 8' : undefined,
          strokeLinecap: connectionType === 'wireless' ? 'round' : undefined,
        }}
      />
      {status && (
        <EdgeLabelRenderer>
          <div
            className="pointer-events-none absolute rounded border bg-background px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide"
            style={{
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

const nodeTypes: NodeTypes = { hardware: HardwareNodeComponent, rack: RackNode };
const edgeTypes = { proposal: ProposalPreviewEdge };

function PreviewFlow() {
  const nodes = useBuilderStore(s => s.proposalPreview?.nodes);
  const edges = useBuilderStore(s => s.proposalPreview?.edges);
  const focus = useBuilderStore(s => s.proposalPreview?.focus);
  const { fitView } = useReactFlow();

  const flowNodes = useMemo(
    () =>
      (nodes ?? []).map(node => {
        // Removed devices sit behind whatever takes their place on the canvas.
        const removed = (node.data as { proposalDiff?: DiffStatus }).proposalDiff === 'removed';
        return { ...node, zIndex: node.type === 'rack' ? 10 : removed ? 15 : 20 };
      }),
    [nodes],
  );

  // Bring the changed part of the build into view, and follow clicks in the review list.
  useEffect(() => {
    if (!focus || focus.ids.length === 0) return;
    const frame = requestAnimationFrame(() => {
      void fitView({
        nodes: focus.ids.map(id => ({ id })),
        padding: 0.35,
        duration: 400,
        maxZoom: 1.1,
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [focus, fitView]);

  return (
    <ReactFlow
      defaultNodes={flowNodes}
      defaultEdges={edges ?? []}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      nodesDraggable={false}
      nodesConnectable={false}
      nodesFocusable={false}
      edgesFocusable={false}
      elementsSelectable={false}
      deleteKeyCode={null}
      connectionMode={ConnectionMode.Loose}
      fitView
      className="builder-flow-canvas proposal-preview-canvas"
    >
      <Background gap={20} size={1} color="#A1A1AA" style={{ opacity: 0.25 }} />
      <Controls showInteractive={false} />
    </ReactFlow>
  );
}

/**
 * Read-only canvas shown over the builder while a proposal is reviewed. It
 * renders the build as it would look after applying; the live canvas underneath
 * is untouched, so nothing here can be auto-saved.
 */
export function ProposalPreviewCanvas() {
  const proposalId = useBuilderStore(s => s.proposalPreview?.proposal.id);
  const baseRevision = useBuilderStore(s => s.proposalPreview?.proposal.base_revision);
  if (!proposalId) return null;

  return (
    <div className="absolute inset-0 z-30 bg-background" data-hide-export="true">
      {/* A different proposal or a rebased preview gets a fresh canvas. */}
      <ReactFlowProvider key={`${proposalId}-${baseRevision}`}>
        <PreviewFlow />
      </ReactFlowProvider>
      <div className="pointer-events-none absolute left-4 top-4 flex items-center gap-2 rounded-lg border border-primary/40 bg-card px-3 py-2 text-xs shadow-lg">
        <Eye className="size-4 text-primary" aria-hidden="true" />
        <span>
          <strong className="font-semibold">Preview.</strong> Nothing is changed until you apply.
        </span>
        <span className="ml-2 flex items-center gap-2 text-[10px] text-muted-foreground">
          {(Object.keys(DIFF_COLORS) as DiffStatus[]).map(status => (
            <span key={status} className="flex items-center gap-1">
              <span
                className="inline-block size-2 rounded-full"
                style={{ background: DIFF_COLORS[status] }}
              />
              {DIFF_LABELS[status]}
            </span>
          ))}
        </span>
      </div>
    </div>
  );
}
