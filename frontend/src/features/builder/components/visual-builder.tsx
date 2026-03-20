import { useState, useCallback, useRef, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ReactFlow,
  Background,
  Controls,
  useReactFlow,
  useUpdateNodeInternals,
  type NodeTypes,
  ReactFlowProvider,
  Panel,
  ConnectionMode,
} from '@xyflow/react';
import { toast } from 'sonner';
import '@xyflow/react/dist/style.css';
import Joyride, { type CallBackProps, STATUS, type Step } from 'react-joyride';
import { useBuilderStore } from '../store/builder-store';
import { HardwareToolbox } from './hardware-toolbox';
import { HardwareNode as HardwareNodeComponent } from './hardware-node';
import { NodePropertiesPanel } from './node-properties-panel';
import { LiveResourceDashboard } from './live-resource-dashboard';
import { Button } from '../../../components/ui/button';
import { Wand2, Menu, Save, Folder, Download, LogOut, Route } from 'lucide-react';
import type { HardwareType, HardwareNode } from '../../../types';
import { buildApi } from '../api/builds';
import { nodeHasDynamicPorts, canNodeBeNested, canNodeHostNested, canNodeConnectToAny } from '../../../lib/hardware-config';
import { getNodePortCount } from '../lib/port-count';
import { useAuth } from '../../admin/hooks/use-auth';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '../../../components/ui/dropdown-menu';

import { CustomEdge } from './custom-edge';

const nodeTypes: NodeTypes = {
  hardware: HardwareNodeComponent,
};

const edgeTypes = {
  custom: CustomEdge,
};

type Shortcut = { combination: string; name: string };

const shortcuts: Shortcut[] = [
  { combination: 'Del', name: 'delete' },
  { combination: 'Ctrl+Z', name: 'undo' },
  { combination: 'Ctrl+Y', name: 'redo' },
  { combination: 'Ctrl+C', name: 'copy' },
  { combination: 'Ctrl+V', name: 'paste' },
  { combination: 'Ctrl+D', name: 'duplicate' },
  { combination: 'Esc', name: 'deselect' },
];

function ShortcutHints() {
  return (
    <div className="absolute bottom-2 left-1/2 -translate-x-1/2 z-10 flex items-center gap-3 px-3 py-1.5 rounded-full bg-card border border-border text-[10px] text-muted-foreground pointer-events-none select-none">
      {shortcuts.map((sh: Shortcut, iter: number) =>
        iter === shortcuts.length - 1 ? (
          <span className="flex flex-col items-center">
            <kbd className="font-mono bg-muted px-1 rounded">{sh.combination}</kbd> {sh.name}
          </span>
        ) : (
          <>
            <span className="flex flex-col items-center">
              <kbd className="font-mono bg-muted px-1 rounded">{sh.combination}</kbd> {sh.name}
            </span>
            <span className="opacity-30">·</span>
          </>
        ),
      )}
    </div>
  );
}

function Flow() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const { logout, updatePreferences } = useAuth();

  // Joyride Tour State
  const [runTour, setRunTour] = useState(false);
  const [tourSteps] = useState<Step[]>([
    {
      target: '.tour-toolbox',
      content:
        'Welcome to HLBuilder! Drag networking gear and servers from this toolbox onto your canvas.',
      disableBeacon: true,
    },
    {
      target: '.react-flow__pane',
      content:
        'Hover over a device to reveal its network ports. Drag a cable from one port to another to connect them.',
    },
    {
      target: '.tour-toolbox-services',
      content:
        'Switch to the Services tab. You can drag applications (like Docker, Nextcloud) directly INTO a Server node to deploy them.',
    },
    {
      target: '.tour-properties',
      content:
        'Click any device on the canvas to configure its IPs, hardware specs, and passwords in this properties panel.',
      placement: 'center',
    },
  ]);

  useEffect(() => {
    const hasSeenTour = localStorage.getItem('hlb_has_seen_tour');
    if (!hasSeenTour) {
      setRunTour(true);
    }
  }, []);

  // Defensive cleanup: strip any scroll locks left behind by Radix dialogs or Joyride
  useEffect(() => {
    return () => {
      document.body.removeAttribute('data-scroll-locked');
      document.body.style.overflow = '';
      document.documentElement.style.overflow = '';
    };
  }, []);

  const handleJoyrideCallback = (data: CallBackProps) => {
    const { status } = data;
    if ([STATUS.FINISHED, STATUS.SKIPPED].includes(status as any)) {
      setRunTour(false);
      localStorage.setItem('hlb_has_seen_tour', 'true');
    }
  };

  const {
    nodes,
    edges,
    onNodesChange,
    onEdgesChange,
    onConnect,
    addHardware,
    removeHardware,
    duplicateHardware,
    selectNode,
    selectedNodeId,
    addInternalComponent,
    addVM,
    reassignAllIPs,
    loadBuild,
    getBuildData,
    currentBuildId,
    hardwareNodes,
    projectName,
    validateNetwork,
    edgePreferences,
    setEdgePreferences,
    undo,
    redo,
  } = useBuilderStore();

  const { screenToFlowPosition, getIntersectingNodes } = useReactFlow();

  useEffect(() => {
    if (id && id !== currentBuildId) {
      buildApi
        .get(id)
        .then(build => {
          loadBuild(build.id, build.name, build);
        })
        .catch(err => {
          console.error('Failed to load build', err);
          useBuilderStore.getState().clearCurrentBuild();
          navigate('/');
        });
    }
  }, [id, currentBuildId, loadBuild, navigate]);

  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'error'>('saved');
  const [clipboardNodeId, setClipboardNodeId] = useState<string | null>(null);
  const isFirstRender = useRef(true);
  const lastSaveTime = useRef(Date.now());

  // Effect to mark as "saved" initially when data loads
  useEffect(() => {
    setSaveStatus('saved');
  }, [currentBuildId]);

  const saveProject = useCallback(async () => {
    if (!id) return;
    setSaveStatus('saving');
    try {
      const data = getBuildData();
      await buildApi.update(id, {
        name: projectName || 'Untitled Project', // Use store name
        thumbnail: '',
        ...data,
      });
      setSaveStatus('saved');
      lastSaveTime.current = Date.now();

      // Trigger automatic validation after the changes have been safely persisted
      await validateNetwork();
    } catch (err) {
      console.error('Failed to save', err);
      setSaveStatus('error');
      toast.error('Failed to auto-save');
    }
  }, [id, getBuildData, projectName, validateNetwork]);

  // Auto-save trigger
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }

    // Debounce save
    const timer = setTimeout(() => {
      saveProject();
    }, 2000); // 2 seconds debounce

    return () => clearTimeout(timer);
  }, [nodes, edges, hardwareNodes, saveProject]); // Any change triggers debounce

  // Manual save wrapper (immediate)
  const handleManualSave = () => {
    toast.promise(saveProject(), {
      loading: 'Saving...',
      success: 'Project saved',
      error: 'Failed to save',
    });
  };

  const { getEdges, deleteElements } = useReactFlow();
  const updateNodeInternals = useUpdateNodeInternals();

  const prevPortsRef = useRef<Map<string, number>>(new Map());

  // Effect 1 — delete orphaned edges when port count shrinks.
  // Does NOT call updateNodeInternals here; that happens in Effect 2.
  useEffect(() => {
    hardwareNodes.forEach(node => {
      if (!nodeHasDynamicPorts(node.type)) return;
      const numPorts = Math.max(1, getNodePortCount(node.type, node.details?.ports));
      const prev = prevPortsRef.current.get(node.id);
      if (prev !== undefined && prev !== numPorts) {
        const orphaned = edges.filter(e => {
          if (e.source !== node.id || !e.sourceHandle) return false;
          const match = e.sourceHandle.match(/^eth(\d+)$/);
          return match !== null && parseInt(match[1], 10) >= numPorts;
        });
        if (orphaned.length > 0) deleteElements({ edges: orphaned });
      }
      prevPortsRef.current.set(node.id, numPorts);
    });
  }, [hardwareNodes, edges, deleteElements]);

  // Effect 2 — always resync handle positions for port-bearing nodes whenever
  // hardwareNodes changes (covers increases, decreases, and first render).
  // Running after every hardwareNodes change is cheap and ensures the triple-rAF
  // fires after *all* state updates (including the deleteElements re-render from
  // Effect 1) have settled.
  useEffect(() => {
    const portNodeIds = hardwareNodes
      .filter(n => nodeHasDynamicPorts(n.type))
      .map(n => n.id);
    if (portNodeIds.length === 0) return;

    const r1 = requestAnimationFrame(() => {
      const r2 = requestAnimationFrame(() => {
        const r3 = requestAnimationFrame(() => {
          portNodeIds.forEach(nid => updateNodeInternals(nid));
        });
        return () => cancelAnimationFrame(r3);
      });
      return () => cancelAnimationFrame(r2);
    });
    return () => cancelAnimationFrame(r1);
  }, [hardwareNodes, updateNodeInternals]);

  const handlePrefChange = (key: string, val: any) => {
    setEdgePreferences({ [key]: val });
    // @ts-ignore - useAuth user preferences object might be untyped in this strict context
    if (updatePreferences)
      updatePreferences({ edgePreferences: { ...edgePreferences, [key]: val } });
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        handleManualSave();
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        undo();
        return;
      }

      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.shiftKey && e.key === 'z'))) {
        e.preventDefault();
        redo();
        return;
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        const selectedEdges = getEdges().filter(edge => edge.selected);
        if (selectedEdges.length > 0) {
          e.preventDefault();
          deleteElements({ edges: selectedEdges });
          return;
        }

        if (selectedNodeId) {
          e.preventDefault();
          removeHardware(selectedNodeId);
          return;
        }
      }

      if (e.key === 'd' && (e.ctrlKey || e.metaKey) && selectedNodeId) {
        e.preventDefault();
        duplicateHardware(selectedNodeId);
        return;
      }

      if (e.key === 'c' && (e.ctrlKey || e.metaKey) && selectedNodeId) {
        e.preventDefault();
        setClipboardNodeId(selectedNodeId);
        toast.success('Node copied');
        return;
      }

      if (e.key === 'v' && (e.ctrlKey || e.metaKey) && clipboardNodeId) {
        e.preventDefault();
        duplicateHardware(clipboardNodeId);
        return;
      }

      if (e.key === 'Escape') {
        selectNode(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    selectedNodeId,
    clipboardNodeId,
    undo,
    redo,
    removeHardware,
    duplicateHardware,
    selectNode,
    handleManualSave,
    getEdges,
    deleteElements,
  ]);

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();

      const position = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });

      const intersecting = getIntersectingNodes({
        x: position.x,
        y: position.y,
        width: 1,
        height: 1,
      });

      const targetNode = intersecting[0];

      let data: any = {};
      const dataStr = event.dataTransfer.getData('application/reactflow-data');
      const type = event.dataTransfer.getData('application/reactflow') as HardwareType;
      if (dataStr) {
        try {
          data = JSON.parse(dataStr);
        } catch (e) {
          console.error('Failed to parse drop data', e);
        }
      } else if (type) {
        data = { type, name: `New ${type}` };
      }

      if (!data.type) return;

      const isServiceDrag = event.dataTransfer.getData('service-drag') === 'true';

      if (isServiceDrag) {
        if (targetNode && targetNode.type === 'hardware') {
          const cpuVal = data.details?.cpu ? Number(data.details.cpu) : undefined;
          const ramVal = data.details?.ram ? Number(data.details.ram) : undefined;

          addVM(targetNode.id, {
            id: `vm-${Date.now()}`,
            name: data.name,
            type: 'container',
            status: 'running',
            cpu_cores: cpuVal || undefined,
            ram_mb: ramVal || undefined,
          });
        } else {
          toast.error('Please drag services directly onto a hardware node.');
        }
        return;
      }

      if (targetNode && targetNode.type === 'hardware') {
        const targetType = targetNode.data?.type as HardwareType | undefined;
        const canHost = targetType ? canNodeHostNested(targetType) : false;

        if (canHost && canNodeBeNested(data.type)) {
          addInternalComponent(targetNode.id, {
            id: `comp-${Date.now()}`,
            type: data.type,
            name: data.name || `New ${data.type}`,
            details: data.details || {},
          });
          return;
        } else if (targetType && !canHost && canNodeBeNested(data.type)) {
          toast.error(`Cannot add nested components to ${targetType}.`);
          return;
        } else if (canHost && !canNodeBeNested(data.type)) {
          // It's a full hardware node dropped on another, let it drop onto the canvas instead
        }
      }

      const newNode: HardwareNode = {
        id: `node-${Date.now()}`,
        type: data.type as HardwareType,
        name: data.name || `New ${data.type}`,
        x: position.x,
        y: position.y,
        details: data.details || {},
        internal_components: [],
        vms: [],
      };
      addHardware(newNode);
    },
    [screenToFlowPosition, getIntersectingNodes, addHardware, addInternalComponent, addVM],
  );

  const isValidConnection = useCallback(
    (connection: any) => {
      // Always read live state so this never operates on stale closures.
      const { edges: currentEdges, hardwareNodes: currentNodes } = useBuilderStore.getState();

      // Self-loop guard
      if (connection.source === connection.target) return false;

      const sourceNode = currentNodes.find(n => n.id === connection.source);
      const targetNode = currentNodes.find(n => n.id === connection.target);
      if (!sourceNode || !targetNode) return false;

      const isUPS = sourceNode.type === 'ups' || targetNode.type === 'ups';

      // Port exclusivity — each physical handle can carry at most one cable.
      // UPS connections are power cables and share ports with network connections.
      if (!isUPS) {
        const sourceHandleUsed = currentEdges.some(
          e =>
            (e.source === connection.source && e.sourceHandle === connection.sourceHandle) ||
            (e.target === connection.source && e.targetHandle === connection.sourceHandle),
        );
        if (sourceHandleUsed) {
          toast.error('Source port is already in use.');
          return false;
        }
        const targetHandleUsed = currentEdges.some(
          e =>
            (e.source === connection.target && e.sourceHandle === connection.targetHandle) ||
            (e.target === connection.target && e.targetHandle === connection.targetHandle),
        );
        if (targetHandleUsed) {
          toast.error('Target port is already in use.');
          return false;
        }
      }

      // Cycle detection — BFS through the existing undirected graph (skip for UPS).
      if (!isUPS && !useBuilderStore.getState().edgePreferences.ignoreNetworkLoops) {
        const adj = new Map<string, Set<string>>();
        for (const e of currentEdges) {
          if (!adj.has(e.source)) adj.set(e.source, new Set());
          if (!adj.has(e.target)) adj.set(e.target, new Set());
          adj.get(e.source)!.add(e.target);
          adj.get(e.target)!.add(e.source);
        }
        const visited = new Set<string>();
        const queue = [connection.source];
        visited.add(connection.source);
        while (queue.length > 0) {
          const current = queue.shift()!;
          if (current === connection.target) {
            toast.error('Connection would create a loop.');
            return false;
          }
          for (const neighbor of adj.get(current) ?? []) {
            if (!visited.has(neighbor)) {
              visited.add(neighbor);
              queue.push(neighbor);
            }
          }
        }
      }

      // Devices generally shouldn't connect directly to each other (e.g. server to server).
      // They should connect through a device that has 'canConnectToAny' (like a switch, router, modem, hba)
      // Devices like IoT and UPS also bypass this and can connect anywhere directly.
      const sourceCanConnectToAny = canNodeConnectToAny(sourceNode.type as HardwareType);
      const targetCanConnectToAny = canNodeConnectToAny(targetNode.type as HardwareType);

      if (!sourceCanConnectToAny && !targetCanConnectToAny) {
        toast.error('Devices generally must connect through a network hub (Switch, Router, Modem, etc).');
        return false;
      }

      return true;
    },
    [], // no deps — reads live state via getState()
  );

  // ...

  return (
    <div className="flex h-full border-b bg-background overflow-hidden relative">
      <Joyride
        steps={tourSteps}
        run={runTour}
        continuous={true}
        showSkipButton={true}
        showProgress={true}
        callback={handleJoyrideCallback}
        locale={{ last: 'Close' }}
        styles={{
          options: {
            primaryColor: '#f97316',
            zIndex: 10000,
          },
        }}
      />

      <HardwareToolbox />

      <div className="flex-1 h-full relative" ref={reactFlowWrapper}>
        <LiveResourceDashboard />

        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          isValidConnection={isValidConnection}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onDragOver={onDragOver}
          onDrop={onDrop}
          onNodeClick={(_, node) => {
            if (node.type === 'hardware') selectNode(node.id);
            else selectNode(null);
          }}
          onPaneClick={() => selectNode(null)}
          connectionMode={ConnectionMode.Loose}
          fitView
          attributionPosition="bottom-right"
          className="bg-background"
          defaultEdgeOptions={{
            type: 'custom',
            animated: true,
            style: { stroke: '#3F3F46', strokeWidth: 2 },
          }}
          snapToGrid={true}
          snapGrid={[20, 20]}
        >
          <Background gap={20} size={1} color="#A1A1AA" style={{ opacity: 0.25 }} />
          <Controls />

          <Panel position="top-left" className="flex gap-2 items-center">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" className="h-10 w-10 bg-card">
                  <Menu className="h-5 w-5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-56">
                <DropdownMenuLabel>Project Menu</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={saveProject}>
                  <Save className="mr-2 h-4 w-4" /> Save Project{' '}
                  <span className="ml-auto text-xs text-muted-foreground opacity-60">Ctrl+S</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => navigate('/')}>
                  <Folder className="mr-2 h-4 w-4" /> My Projects
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => navigate('/generate')}>
                  <Download className="mr-2 h-4 w-4" /> Export / Generate Config
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => navigate('/services')}>
                  <Wand2 className="mr-2 h-4 w-4" /> Component Catalog
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={logout} className="text-red-500 focus:text-red-500">
                  <LogOut className="mr-2 h-4 w-4" /> Sign Out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <div className="flex flex-col">
              <h2 className="text-sm font-semibold leading-none">{projectName || 'HLBuilder'}</h2>
              <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                {saveStatus === 'saving' && (
                  <span className="text-amber-500 flex items-center gap-1">
                    <span className="animate-spin">⟳</span> Saving...
                  </span>
                )}
                {saveStatus === 'saved' && (
                  <span className="text-green-500 flex items-center gap-1">Cloud Saved</span>
                )}
                {saveStatus === 'error' && <span className="text-red-500">Save Failed</span>}
              </span>
            </div>

            <Button
              variant="secondary"
              onClick={() => reassignAllIPs()}
              title="Fix IP Conflicts"
              size="sm"
              className="h-10 bg-card ml-4"
            >
              <Wand2 className="mr-2 h-4 w-4" />
              Reassign IPs
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-10 bg-card w-37.5">
                  <Route className="mr-2 h-4 w-4 shrink-0" />
                  Edge Settings
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-56">
                <DropdownMenuLabel className="text-xs text-muted-foreground uppercase">
                  Pathing AI
                </DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  value={edgePreferences.routingEngine}
                  onValueChange={(v: string) => handlePrefChange('routingEngine', v)}
                >
                  <DropdownMenuRadioItem value="smart">Smart (Avoids Nodes)</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="direct">Direct (Flyover)</DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>

                <DropdownMenuSeparator />

                <DropdownMenuLabel className="text-xs text-muted-foreground uppercase">
                  Connection Pins
                </DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  value={edgePreferences.connectionStyle}
                  onValueChange={(v: string) => handlePrefChange('connectionStyle', v)}
                >
                  <DropdownMenuRadioItem value="floating">Floating (Chassis)</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="strict">Strict (RJ45 Port)</DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>

                <DropdownMenuSeparator />

                <DropdownMenuLabel className="text-xs text-muted-foreground uppercase">
                  Line Style
                </DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  value={edgePreferences.lineStyle}
                  onValueChange={(v: string) => handlePrefChange('lineStyle', v)}
                >
                  <DropdownMenuRadioItem value="bezier">Bezier (Curve)</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="step">Step (Orthogonal)</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="straight">Straight (Linear)</DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>

                <DropdownMenuSeparator />

                <DropdownMenuItem
                  onClick={(e) => {
                    e.preventDefault();
                    handlePrefChange('ignoreNetworkLoops', !edgePreferences.ignoreNetworkLoops as any);
                  }}
                  className="flex items-center justify-between cursor-pointer"
                >
                  <span>Ignore Network Loops</span>
                  <input
                    type="checkbox"
                    checked={edgePreferences.ignoreNetworkLoops}
                    readOnly
                    className="pointer-events-none"
                  />
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </Panel>

          <Panel position="top-right" className="tour-properties">
            {selectedNodeId && <NodePropertiesPanel />}
          </Panel>

          <ShortcutHints />
        </ReactFlow>
      </div>
    </div>
  );
}

export default function VisualBuilderPage() {
  return (
    <ReactFlowProvider>
      <Flow />
    </ReactFlowProvider>
  );
}
