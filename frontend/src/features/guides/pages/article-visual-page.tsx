import { useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { Background, ReactFlow, ReactFlowProvider, type NodeTypes } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { SeoMeta } from '../../../components/seo/seo-meta';
import { HardwareNode } from '../../builder/components/hardware-node';
import { RackNode } from '../../builder/components/rack-node';
import { CustomEdge } from '../../builder/components/custom-edge';
import { VISUALS, toReactFlowEdges, toReactFlowNodes, type VisualSpec } from '../lib/article-visuals';

const nodeTypes: NodeTypes = {
  hardware: HardwareNode,
  rack: RackNode,
};

const edgeTypes = {
  custom: CustomEdge,
};

function ArticleVisualCanvas({ spec }: { spec: VisualSpec }) {
  const nodes = useMemo(() => toReactFlowNodes(spec), [spec]);
  const edges = useMemo(() => toReactFlowEdges(spec), [spec]);

  return (
    <ReactFlowProvider>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        panOnDrag={false}
        zoomOnScroll={false}
        zoomOnPinch={false}
        zoomOnDoubleClick={false}
        preventScrolling
        fitView
        fitViewOptions={{ padding: 0.18 }}
        proOptions={{ hideAttribution: true }}
        className="article-real-builder-flow"
      >
        <Background gap={22} size={1} color="#64748b" style={{ opacity: 0.18 }} />
      </ReactFlow>
    </ReactFlowProvider>
  );
}

export default function ArticleVisualPage() {
  const { slug = '' } = useParams<{ slug: string }>();
  const spec = VISUALS[slug] ?? VISUALS['homelab-network-diagram-examples'];

  return (
    <div className="h-screen w-screen overflow-hidden bg-background text-foreground">
      <SeoMeta
        title={`${spec.title} visual | HLBuilder`}
        description="A noindex embedded HLBuilder visual rendered with the real visual builder components."
        robots="noindex, nofollow"
      />
      <ArticleVisualCanvas spec={spec} />
    </div>
  );
}
