import { useEffect, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  type Node,
  type Edge,
  type Connection,
  useNodesState,
  useEdgesState,
  addEdge,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { toast } from 'sonner';
import { Save, Pencil, Eye } from 'lucide-react';
import { buildApi, type Build } from '../api/builds';
import { LoadingScreen } from '../../../components/ui/loading-screen';
import { Button } from '../../../components/ui/button';
import { HardwareNode } from '../components/hardware-node';
import { RackNode } from '../components/rack-node';
import { CustomEdge } from '../components/custom-edge';
import { RACK_U_HEIGHT_PX, RACK_WIDTH_PX, RACK_HEADER_PX, RACK_FOOTER_PX } from '../components/rack-node-constants';
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
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!token) return;
    (async () => {
      try {
        const b = await buildApi.getShared(token);
        const rfNodes = buildReactFlowNodes(b);
        const rfEdges = buildReactFlowEdges(b);
        // Batch all state updates (React 18 auto-batches in async contexts)
        setBuild(b);
        setNodes(rfNodes);
        setEdges(rfEdges);
      } catch {
        setError('This layout is not available or sharing has been disabled.');
      } finally {
        setLoading(false);
      }
    })();
  }, [token, setNodes, setEdges]);

  const onConnect = useCallback(
    (connection: Connection) => {
      setEdges(eds =>
        addEdge({ ...connection, type: 'custom', data: { speed: '1 GbE', subnet: '' } }, eds),
      );
    },
    [setEdges],
  );

  const handleSave = useCallback(async () => {
    if (!token || !build) return;
    setSaving(true);
    try {
      const nodeDTOs = nodes.map((n: Node) => ({
        id: n.id,
        type: (n.data as any).type || n.type,
        name: (n.data as any).name || '',
        x: n.position.x,
        y: n.position.y,
        power_draw: (n.data as any).power_draw || 0,
        ip: (n.data as any).ip || '',
        details: (n.data as any).details || {},
        vms: (n.data as any).vms || [],
        internal_components: (n.data as any).internal_components || [],
        parent_id: (n.data as any).parent_id || null,
      }));

      const edgeDTOs = edges.map((e: Edge) => ({
        source: e.source,
        source_handle: e.sourceHandle || '',
        target: e.target,
        target_handle: e.targetHandle || '',
        speed: (e.data as any)?.speed || '1 GbE',
        subnet: (e.data as any)?.subnet || '',
      }));

      const updated = await buildApi.updateShared(token, {
        name: build.name,
        thumbnail: build.thumbnail || '',
        nodes: nodeDTOs,
        edges: edgeDTOs,
        services: [],
        settings: build.settings || {},
      });

      setBuild(updated);
      toast.success('Changes saved');
    } catch {
      toast.error('Failed to save changes');
    } finally {
      setSaving(false);
    }
  }, [token, build, nodes, edges]);

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

  const editable = !!build?.shared_editable;

  return (
    <div className="flex flex-col h-screen bg-background">
      <header className="flex items-center justify-between px-4 py-2 border-b shrink-0">
        <div className="flex items-center gap-2">
          {editable ? (
            <Pencil className="size-3.5 text-blue-500" />
          ) : (
            <Eye className="size-3.5 text-muted-foreground" />
          )}
          <span className="text-xs text-muted-foreground uppercase tracking-widest">
            {editable ? 'Editable layout' : 'Shared layout'}
          </span>
          <span className="font-semibold">{build?.name}</span>
        </div>
        <div className="flex items-center gap-2">
          {editable && (
            <Button size="sm" onClick={handleSave} disabled={saving}>
              <Save className="mr-1.5 size-3.5" />
              {saving ? 'Saving…' : 'Save changes'}
            </Button>
          )}
          <Link to="/" className="text-sm text-primary hover:underline">
            Open HLBuilder
          </Link>
        </div>
      </header>

      <div className="flex-1 min-h-0">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={editable ? onConnect : undefined}
          nodesDraggable={editable}
          nodesConnectable={editable}
          elementsSelectable={editable}
          deleteKeyCode={editable ? 'Delete' : null}
          fitView
          proOptions={{ hideAttribution: false }}
        >
          <Background />
          <Controls showInteractive={false} />
          <MiniMap />
        </ReactFlow>
      </div>

      <footer className="px-4 py-2 border-t text-xs text-muted-foreground text-center shrink-0">
        {editable ? 'Collaborative edit' : 'Read-only view'} &mdash; shared via{' '}
        <Link to="/" className="text-primary hover:underline">
          HLBuilder
        </Link>
      </footer>
    </div>
  );
}
