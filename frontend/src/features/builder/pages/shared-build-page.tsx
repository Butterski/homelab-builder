import { useEffect, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  type Node,
  type Edge,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { buildApi, type Build } from '../api/builds';
import { LoadingScreen } from '../../../components/ui/loading-screen';
import { HardwareNode } from '../components/hardware-node';
import { RackNode } from '../components/rack-node';
import { CustomEdge } from '../components/custom-edge';
import { RACK_U_HEIGHT_PX, RACK_WIDTH_PX, RACK_HEADER_PX, RACK_FOOTER_PX } from '../components/rack-node';
import type { HardwareNode as HardwareNodeType, HardwareType } from '../../../types';

const nodeTypes = { hardware: HardwareNode, rack: RackNode };
const edgeTypes = { custom: CustomEdge };

function buildReactFlowNodes(build: Build): Node[] {
  const rawNodes = (build.nodes || []).toSorted((a: any, b: any) => {
    return (a.type === 'rack' ? 0 : 1) - (b.type === 'rack' ? 0 : 1);
  });

  return rawNodes.map((n: any) => {
    const isRack = n.type === 'rack';
    const details = typeof n.details === 'string' ? JSON.parse(n.details) : (n.details || {});
    const rackSize = details.rack_size || 24;
    const totalHeight = RACK_HEADER_PX + rackSize * RACK_U_HEIGHT_PX + RACK_FOOTER_PX;

    const hw: HardwareNodeType = {
      id: n.id,
      type: n.type as HardwareType,
      name: n.name,
      ip: n.ip,
      x: n.x,
      y: n.y,
      vms: n.virtual_machines || [],
      internal_components: n.internal_components || [],
      details,
      parent_id: n.parent_id || undefined,
    };

    return {
      id: n.id,
      type: isRack ? 'rack' : 'hardware',
      position: { x: n.x, y: n.y },
      data: { ...hw, label: n.name },
      ...(isRack ? { style: { width: RACK_WIDTH_PX, height: totalHeight }, zIndex: -1 } : {}),
      ...(n.parent_id ? { parentId: n.parent_id, extent: 'parent' as const } : {}),
    };
  });
}

function buildReactFlowEdges(build: Build): Edge[] {
  return (build.edges || []).map((e: any) => ({
    id: String(e.id || `${e.source_node_id}-${e.target_node_id}`),
    source: String(e.source_node_id),
    sourceHandle: e.source_handle || undefined,
    target: String(e.target_node_id),
    targetHandle: e.target_handle || undefined,
    type: e.type && e.type !== 'ethernet' ? e.type : 'custom',
    data: { speed: e.speed || '1 GbE', subnet: e.subnet || '' },
  }));
}

export default function SharedBuildPage() {
  const { token } = useParams<{ token: string }>();
  const [build, setBuild] = useState<Build | null>(null);
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) return;
    buildApi
      .getShared(token)
      .then(b => {
        setBuild(b);
        setNodes(buildReactFlowNodes(b));
        setEdges(buildReactFlowEdges(b));
      })
      .catch(() => setError('This layout is not available or sharing has been disabled.'))
      .finally(() => setLoading(false));
  }, [token]);

  const onNodeClick = useCallback(() => {}, []);

  if (loading) return <LoadingScreen message="Loading shared layout..." />;

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-screen gap-4">
        <p className="text-muted-foreground text-lg">{error}</p>
        <Link to="/" className="text-primary underline text-sm">
          Go to HLBuilder
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-background">
      <header className="flex items-center justify-between px-4 py-2 border-b shrink-0">
        <div>
          <span className="text-xs text-muted-foreground uppercase tracking-widest mr-2">
            Shared Layout
          </span>
          <span className="font-semibold">{build?.name}</span>
        </div>
        <Link
          to="/"
          className="text-sm text-primary hover:underline"
        >
          Open HLBuilder
        </Link>
      </header>

      <div className="flex-1 min-h-0">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodeClick={onNodeClick}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          fitView
          proOptions={{ hideAttribution: false }}
        >
          <Background />
          <Controls showInteractive={false} />
          <MiniMap />
        </ReactFlow>
      </div>

      <footer className="px-4 py-2 border-t text-xs text-muted-foreground text-center shrink-0">
        Read-only view &mdash; shared via{' '}
        <Link to="/" className="text-primary hover:underline">
          HLBuilder
        </Link>
      </footer>
    </div>
  );
}
