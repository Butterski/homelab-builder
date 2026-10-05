import type { Edge, Node } from '@xyflow/react';
import type { HardwareNode, HardwareNodeValidationIssue } from '../../../types';
import type { Proposal, ValidationReport } from '../api/proposals';
import { mapBuildToFlow, type FlowBuild } from './build-mapper';

export type DiffStatus = 'added' | 'changed' | 'removed';

export type ProposalPreviewGraph = FlowBuild & {
  validationIssues: HardwareNodeValidationIssue[];
  /** Nodes the proposal touches, in the order they should be brought into view. */
  changedNodeIds: string[];
};

/** Cables are identified by their node pair; edge ids change on every save. */
export function connectionKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export function validationToIssues(
  validation: ValidationReport | undefined | null,
): HardwareNodeValidationIssue[] {
  if (!validation) return [];
  const withType = (issues: ValidationReport['errors'], type: 'error' | 'warning') =>
    (issues || []).map(issue => ({
      node_id: issue.node_id ?? '',
      message: issue.message,
      type,
    }));
  return [...withType(validation.errors, 'error'), ...withType(validation.warnings, 'warning')];
}

/**
 * Builds the read-only canvas for reviewing a proposal: the build as it would
 * look, with added and changed elements marked, plus "ghosts" of everything the
 * proposal removes, taken from the live canvas.
 */
export function buildProposalPreview(proposal: Proposal, live: FlowBuild): ProposalPreviewGraph {
  const proposed = proposal.preview?.build
    ? mapBuildToFlow(proposal.preview.build)
    : { hardwareNodes: [], nodes: [], edges: [] };
  const diff = proposal.diff;

  const nodeStatus = new Map<string, DiffStatus>();
  for (const node of diff.nodes.changed) nodeStatus.set(node.id, 'changed');
  // A host whose services or components change is shown as changed too.
  for (const guest of [...diff.vms.added, ...diff.vms.changed, ...diff.vms.removed]) {
    nodeStatus.set(guest.host_id, 'changed');
  }
  for (const component of [...diff.components.added, ...diff.components.removed]) {
    nodeStatus.set(component.host_id, 'changed');
  }
  for (const node of diff.nodes.added) nodeStatus.set(node.id, 'added');

  const proposedIds = new Set(proposed.nodes.map(node => node.id));
  const removedIds = new Set(diff.nodes.removed.map(node => node.id));
  const liveById = new Map(live.nodes.map(node => [node.id, node]));

  const mark = (node: Node, status: DiffStatus | undefined): Node => ({
    ...node,
    selected: false,
    draggable: false,
    selectable: false,
    connectable: false,
    deletable: false,
    className: status ? `proposal-diff proposal-diff-${status}` : undefined,
    data: { ...node.data, proposalDiff: status },
  });

  const nodes: Node[] = proposed.nodes.map(node => mark(node, nodeStatus.get(node.id)));

  const ghostIds = new Set<string>();
  for (const node of live.nodes) {
    if (!removedIds.has(node.id) || proposedIds.has(node.id)) continue;
    ghostIds.add(node.id);
  }
  for (const node of live.nodes) {
    if (!ghostIds.has(node.id)) continue;
    const ghost = mark(node, 'removed');
    // A ghost whose rack is neither kept nor a ghost itself floats at its old spot.
    if (ghost.parentId && !proposedIds.has(ghost.parentId) && !ghostIds.has(ghost.parentId)) {
      const rack = liveById.get(ghost.parentId);
      ghost.position = {
        x: (rack?.position.x ?? 0) + ghost.position.x,
        y: (rack?.position.y ?? 0) + ghost.position.y,
      };
      delete ghost.parentId;
      delete ghost.extent;
    }
    nodes.push(ghost);
  }
  // React Flow needs a parent before its children.
  nodes.sort((a, b) => (a.type === 'rack' ? 0 : 1) - (b.type === 'rack' ? 0 : 1));

  const edgeStatus = new Map<string, DiffStatus>();
  for (const link of diff.connections.added) {
    edgeStatus.set(connectionKey(link.source, link.target), 'added');
  }
  for (const link of diff.connections.changed) {
    edgeStatus.set(connectionKey(link.source, link.target), 'changed');
  }
  const removedLinks = new Set(
    diff.connections.removed.map(link => connectionKey(link.source, link.target)),
  );

  const previewEdge = (edge: Edge, status: DiffStatus | undefined): Edge => ({
    ...edge,
    type: 'proposal',
    selected: false,
    selectable: false,
    deletable: false,
    focusable: false,
    data: { ...edge.data, proposalDiff: status },
  });

  const visibleIds = new Set(nodes.map(node => node.id));
  const edges: Edge[] = proposed.edges
    .filter(edge => visibleIds.has(edge.source) && visibleIds.has(edge.target))
    .map(edge => previewEdge(edge, edgeStatus.get(connectionKey(edge.source, edge.target))));
  for (const edge of live.edges) {
    if (!removedLinks.has(connectionKey(edge.source, edge.target))) continue;
    if (!visibleIds.has(edge.source) || !visibleIds.has(edge.target)) continue;
    edges.push(previewEdge({ ...edge, id: `removed-${edge.id}` }, 'removed'));
  }

  const hardwareNodes: HardwareNode[] = [
    ...proposed.hardwareNodes,
    ...live.hardwareNodes.filter(node => ghostIds.has(node.id)),
  ];

  const changedNodeIds = nodes
    .filter(node => (node.data as { proposalDiff?: DiffStatus }).proposalDiff)
    .map(node => node.id);
  // A changed cable brings both of its ends into view.
  for (const edge of edges) {
    if (!(edge.data as { proposalDiff?: DiffStatus }).proposalDiff) continue;
    for (const id of [edge.source, edge.target]) {
      if (!changedNodeIds.includes(id)) changedNodeIds.push(id);
    }
  }

  return {
    hardwareNodes,
    nodes,
    edges,
    validationIssues: validationToIssues(proposal.preview?.validation),
    changedNodeIds,
  };
}
