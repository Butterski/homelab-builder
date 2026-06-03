import { describe, expect, it } from 'vitest';
import { nodeHasDynamicPorts } from '../../../lib/hardware-config';
import { getNodePortCount } from '../../builder/lib/port-count';
import { VISUALS, toReactFlowEdges } from './article-visual-page';

describe('article visual port assignment', () => {
  it('uses one rendered port per source connection in every article visual', () => {
    for (const [slug, spec] of Object.entries(VISUALS)) {
      const nodesById = new Map(spec.nodes.map(node => [node.id, node]));
      const usedSourcePorts = new Set<string>();

      for (const edge of toReactFlowEdges(spec)) {
        const sourceHandle = edge.sourceHandle ?? 'eth0';
        const sourceNode = nodesById.get(edge.source);
        const sourcePort = `${edge.source}:${sourceHandle}`;
        const sourcePortIndex = Number(String(sourceHandle).replace('eth', ''));
        const renderedPortCount =
          sourceNode && nodeHasDynamicPorts(sourceNode.type)
            ? getNodePortCount(sourceNode.type, sourceNode.details?.ports)
            : 1;

        expect(usedSourcePorts.has(sourcePort), `${slug} reuses ${sourcePort}`).toBe(false);
        expect(sourcePortIndex, `${slug} uses invalid source handle ${sourcePort}`).toBeLessThan(
          renderedPortCount,
        );
        usedSourcePorts.add(sourcePort);
      }
    }
  });

  it('does not stack multiple article edges on the same incoming connector', () => {
    for (const [slug, spec] of Object.entries(VISUALS)) {
      const usedTargetPorts = new Set<string>();

      for (const edge of toReactFlowEdges(spec)) {
        const targetPort = `${edge.target}:${edge.targetHandle ?? 'target-0'}`;

        expect(usedTargetPorts.has(targetPort), `${slug} reuses ${targetPort}`).toBe(false);
        usedTargetPorts.add(targetPort);
      }
    }
  });
});
