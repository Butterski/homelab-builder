import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  ReactFlow,
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
import { buildApi, type Build, type BuildNodeInput } from '../api/builds';
import { LoadingScreen } from '../../../components/ui/loading-screen';
import { Button } from '../../../components/ui/button';
import { SeoMeta } from '../../../components/seo/seo-meta';
import { HardwareNode } from '../components/hardware-node';
import { RackNode } from '../components/rack-node';
import { CanvasGrid } from '../components/canvas-grid';
import { useCanvasMoving } from '../hooks/use-canvas-moving';
import { CustomEdge } from '../components/custom-edge';
import { mapBuildToFlow } from '../lib/build-mapper';
import type { HardwareNode as HardwareNodeType } from '../../../types';

const nodeTypes = { hardware: HardwareNode, rack: RackNode };
const edgeTypes = { custom: CustomEdge };

export default function SharedBuildPage() {
  const { token } = useParams<{ token: string }>();
  const [build, setBuild] = useState<Build | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [error, setError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const canvasMoving = useCanvasMoving(canvasRef);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!token) return;
    (async () => {
      try {
        const b = await buildApi.getShared(token);
        const { nodes: rfNodes, edges: rfEdges } = mapBuildToFlow(b);
        // Batch all state updates (React 18 auto-batches in async contexts)
        setBuild(b);
        // Racks sit behind the devices mounted in them.
        setNodes(rfNodes.map(node => (node.type === 'rack' ? { ...node, zIndex: -1 } : node)));
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
      const nodeDTOs = nodes.map((n): BuildNodeInput => {
        const data: Partial<HardwareNodeType> = n.data;
        return {
          id: n.id,
          type: data.type || n.type || '',
          name: data.name || '',
          x: n.position.x,
          y: n.position.y,
          power_draw: data.power_draw || 0,
          ip: data.ip || '',
          details: data.details || {},
          vms: data.vms || [],
          internal_components: data.internal_components || [],
          parent_id: data.parent_id || undefined,
        };
      });

      const edgeDTOs = edges.map((e: Edge) => {
        const data = (e.data ?? {}) as Record<string, string | undefined>;
        return {
          source: e.source,
          source_handle: e.sourceHandle || '',
          target: e.target,
          target_handle: e.targetHandle || '',
          // The medium matters to the server: a Wi-Fi client saved as a cable is rejected.
          type: data.connection_type || 'ethernet',
          speed: data.speed || '1 GbE',
          subnet: data.subnet || '',
          wireless_standard: data.wireless_standard || '',
          direction: data.direction || 'auto',
        };
      });

      const updated = await buildApi.updateShared(token, {
        revision: build.revision,
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
        <SeoMeta
          title="Shared Layout Unavailable | HLBuilder"
          description="This shared HLBuilder layout is unavailable or sharing has been disabled."
          robots="noindex, nofollow"
        />
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
      <SeoMeta
        title={`${build?.name || 'Shared Homelab Layout'} | HLBuilder`}
        description="A shared HLBuilder homelab network layout."
        robots="noindex, nofollow"
      />
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

      <div className="flex-1 min-h-0" ref={canvasRef}>
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
          onMoveStart={canvasMoving.onMoveStart}
          onMoveEnd={canvasMoving.onMoveEnd}
          proOptions={{ hideAttribution: false }}
        >
          <CanvasGrid color="#91919a" opacity={1} />
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
