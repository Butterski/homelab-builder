import type { HardwareNode } from '../../../../types';
import type { CreateBuildParams } from '../../api/builds';
import { computeLayout } from '../layout';
import { buildLayoutGraph } from '../layout/from-flow';
import type { PlannedEdge, PlannedNode } from './types';

/** Where the top-left corner of a planned canvas goes. */
const ORIGIN = 80;

/**
 * Gives a plan the positions the Polish button would give it, so a new build
 * opens tidy. Nothing has been drawn yet, so card sizes are estimated; devices
 * in a rack keep the slot the planner chose.
 */
export function arrangePlan(plan: CreateBuildParams): CreateBuildParams {
  const nodes = plan.nodes as PlannedNode[];
  const edges = plan.edges as PlannedEdge[];
  const graph = buildLayoutGraph(
    nodes.map(node => ({
      hardware: node as unknown as HardwareNode,
      x: node.x,
      y: node.y,
      parentId: node.parent_id,
    })),
    edges.map((edge, index) => ({
      id: `planned-${index}`,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.source_handle,
      targetHandle: edge.target_handle,
      type: edge.type,
    })),
  );
  const { positions } = computeLayout(graph, { style: 'hierarchy' });
  if (positions.length === 0) return plan;

  // The layout keeps the first root where the planner put it; the canvas as a
  // whole starts at the same corner for every plan. Whole grid steps, so
  // nothing shifts against anything else.
  const dx = ORIGIN - Math.floor(Math.min(...positions.map(position => position.x)) / 20) * 20;
  const dy = ORIGIN - Math.floor(Math.min(...positions.map(position => position.y)) / 20) * 20;
  const placed = new Map(positions.map(position => [position.id, position]));
  return {
    ...plan,
    nodes: nodes.map(node => {
      const to = placed.get(node.id);
      return to ? { ...node, x: to.x + dx, y: to.y + dy } : node;
    }),
  };
}
