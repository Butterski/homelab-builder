import { useMemo, useState } from 'react';
import {
  Background,
  ConnectionMode,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import { ArrowLeft, Network, Plus, Save, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { useBuilderStore } from '../store/builder-store';
import { useShallow } from 'zustand/react/shallow';
import {
  connectedVirtualMachines,
  removeVirtualEndpoints,
  UPLINK_ID,
} from '../lib/virtual-network';
import { VMManager } from './vm-manager';

function VirtualNode({ data, selected }: NodeProps) {
  return (
    <div
      className={`w-52 rounded-xl border bg-card p-4 shadow-sm ${selected ? 'border-primary ring-2 ring-primary/20' : 'border-border'}`}
    >
      <Handle type="target" position={Position.Top} id="in" className="!h-3 !w-3" />
      <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
        <Network className="h-4 w-4" />
        {String(data.kind)}
      </div>
      <div className="truncate font-medium">{String(data.label)}</div>
      <div className="mt-2 font-mono text-xs text-muted-foreground">{String(data.subtitle)}</div>
      <Handle type="source" position={Position.Bottom} id="out" className="!h-3 !w-3" />
    </div>
  );
}

const nodeTypes = { virtual: VirtualNode };

export function VirtualNetworkEditor({ hostId }: { hostId: string }) {
  return (
    <ReactFlowProvider>
      <Editor key={hostId} hostId={hostId} />
    </ReactFlowProvider>
  );
}

function Editor({ hostId }: { hostId: string }) {
  const host = useBuilderStore(state => state.hardwareNodes.find(node => node.id === hostId));
  const projectName = useBuilderStore(state => state.projectName);
  const { openVirtualNetwork, updateVirtualNetwork, updateVM, reassignAllIPs, undo, redo } =
    useBuilderStore(
      useShallow(state => ({
        openVirtualNetwork: state.openVirtualNetwork,
        updateVirtualNetwork: state.updateVirtualNetwork,
        updateVM: state.updateVM,
        reassignAllIPs: state.reassignAllIPs,
        undo: state.undo,
        redo: state.redo,
      })),
    );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [staticIP, setStaticIP] = useState('');
  const [switchName, setSwitchName] = useState('');
  const [dragPositions, setDragPositions] = useState<Record<string, { x: number; y: number }>>({});
  const network = host?.details?.virtual_network;
  const reached = useMemo(
    () => (network ? connectedVirtualMachines(network) : new Set<string>()),
    [network],
  );
  const nodes: Node[] = useMemo(() => {
    if (!host || !network) return [];
    return [
      {
        id: UPLINK_ID,
        type: 'virtual',
        position: network.positions[UPLINK_ID] || { x: 280, y: 0 },
        deletable: false,
        data: {
          kind: 'Physical uplink',
          label: host.name,
          subtitle: host.ip || 'Connect the host to a router',
        },
      },
      ...network.switches.map(sw => ({
        id: sw.id,
        type: 'virtual',
        position: { x: sw.x, y: sw.y },
        data: {
          kind: 'Virtual switch',
          label: sw.name,
          subtitle: reached.has(sw.id) ? 'Bridged to physical network' : 'Isolated network',
        },
      })),
      ...(host.vms || []).map((vm, i) => ({
        id: vm.id,
        type: 'virtual',
        deletable: false,
        position: network.positions[vm.id] || {
          x: (i % 3) * 260,
          y: 380 + Math.floor(i / 3) * 160,
        },
        data: {
          kind: vm.type === 'vm' ? 'Virtual machine' : 'Container',
          label: vm.name,
          subtitle: !reached.has(vm.id)
            ? 'Disconnected from uplink'
            : vm.ip || 'Awaiting IP assignment',
        },
      })),
    ].map(node => ({
      ...node,
      position: dragPositions[node.id] || node.position,
      selected: node.id === selectedId,
    }));
  }, [host, network, reached, selectedId, dragPositions]);
  // Kept while unchanged: the editor renders on every frame of a drag.
  const edges = useMemo(
    () =>
      (network?.edges ?? []).map(edge => ({
        ...edge,
        selected: edge.id === selectedEdge,
        type: 'smoothstep',
      })),
    [network, selectedEdge],
  );
  if (!host || !network) return null;
  const selectedVM = host.vms?.find(vm => vm.id === selectedId);
  const selectedSwitch = network.switches.find(sw => sw.id === selectedId);
  const save = async () => {
    setSaving(true);
    try {
      await reassignAllIPs();
      toast.success('Virtual network saved');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Save failed. Try again.');
    } finally {
      setSaving(false);
    }
  };
  const deleteSelection = () => {
    if (selectedSwitch)
      updateVirtualNetwork(hostId, removeVirtualEndpoints(network, new Set([selectedSwitch.id])));
    else if (selectedEdge)
      updateVirtualNetwork(hostId, {
        ...network,
        edges: network.edges.filter(edge => edge.id !== selectedEdge),
      });
    setSelectedId(null);
    setSelectedEdge(null);
  };
  return (
    <section
      aria-label={`${host.name} virtual network`}
      className="absolute inset-0 z-40 flex flex-col bg-background"
      onKeyDown={event => {
        event.stopPropagation();
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
          event.preventDefault();
          if (!saving) void save();
        }
      }}
    >
      <header className="flex flex-wrap items-center gap-3 border-b p-3">
        <Button variant="outline" onClick={() => openVirtualNetwork(null)}>
          <ArrowLeft className="h-4 w-4" />
          Back to project
        </Button>
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted-foreground">{projectName} / Virtual network</p>
          <h1 className="truncate text-lg font-semibold">{host.name}</h1>
        </div>
        <Button
          variant="outline"
          onClick={() => {
            let index = 0;
            while (network.switches.some(sw => sw.name === `vmbr${index}`)) index++;
            updateVirtualNetwork(hostId, {
              ...network,
              switches: [
                ...network.switches,
                { id: crypto.randomUUID(), name: `vmbr${index}`, x: 280 + index * 260, y: 180 },
              ],
            });
          }}
        >
          <Plus className="h-4 w-4" />
          Add switch
        </Button>
        <Button disabled={saving} onClick={() => void save()}>
          <Save className="h-4 w-4" />
          {saving ? 'Saving…' : 'Save and assign IPs'}
        </Button>
      </header>
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <div className="relative min-h-72 flex-1">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            fitView
            fitViewOptions={{ padding: 0.2 }}
            connectionMode={ConnectionMode.Loose}
            deleteKeyCode={null}
            onNodeClick={(_, node) => {
              setSelectedId(node.id);
              setSelectedEdge(null);
              const vm = host.vms?.find(item => item.id === node.id);
              setStaticIP(String(vm?.details?.static_ip || ''));
              setSwitchName(network.switches.find(sw => sw.id === node.id)?.name || '');
            }}
            onEdgeClick={(_, edge) => {
              setSelectedEdge(edge.id);
              setSelectedId(null);
            }}
            onPaneClick={() => {
              setSelectedId(null);
              setSelectedEdge(null);
            }}
            onNodesChange={changes => {
              const next = { ...dragPositions };
              let moved = false;
              for (const change of changes) {
                if (change.type !== 'position' || !change.position) continue;
                next[change.id] = change.position;
                moved = true;
              }
              if (moved) setDragPositions(next);
            }}
            onNodeDragStop={(_, node) => {
              updateVirtualNetwork(hostId, {
                ...network,
                positions: { ...network.positions, [node.id]: node.position },
                switches: network.switches.map(sw =>
                  sw.id === node.id ? { ...sw, ...node.position } : sw,
                ),
              });
              setDragPositions({});
            }}
            isValidConnection={connection =>
              connection.source !== connection.target &&
              !network.edges.some(
                edge =>
                  (edge.source === connection.source && edge.target === connection.target) ||
                  (edge.target === connection.source && edge.source === connection.target),
              )
            }
            onConnect={connection => {
              if (!connection.source || !connection.target) return;
              updateVirtualNetwork(hostId, {
                ...network,
                edges: [
                  ...network.edges,
                  { id: crypto.randomUUID(), source: connection.source, target: connection.target },
                ],
              });
            }}
          >
            <Background gap={20} />
            <Controls />
            <MiniMap
              pannable
              zoomable
              position="top-right"
              style={{ width: 120, height: 80, background: 'var(--card)' }}
              nodeColor="var(--muted-foreground)"
              maskColor="transparent"
            />
          </ReactFlow>
        </div>
        <aside className="max-h-[45vh] w-full space-y-5 overflow-y-auto border-t bg-card p-4 md:max-h-none md:w-80 md:border-l md:border-t-0">
          <div>
            <h2 className="font-medium">Network connections</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Drag between the ports to connect VMs and switches. Connect a switch to the physical
              uplink for automatic IP assignment. VMs do not forward traffic.
            </p>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={undo}>
              Undo
            </Button>
            <Button size="sm" variant="outline" onClick={redo}>
              Redo
            </Button>
          </div>
          {selectedSwitch && (
            <form
              className="space-y-2"
              onSubmit={event => {
                event.preventDefault();
                if (switchName.trim())
                  updateVirtualNetwork(hostId, {
                    ...network,
                    switches: network.switches.map(sw =>
                      sw.id === selectedId ? { ...sw, name: switchName.trim() } : sw,
                    ),
                  });
              }}
            >
              <label htmlFor="switch-name" className="text-sm font-medium">
                Switch name
              </label>
              <Input
                id="switch-name"
                value={switchName}
                onChange={event => setSwitchName(event.target.value)}
              />
              <Button size="sm" type="submit">
                Rename switch
              </Button>
            </form>
          )}
          {selectedVM && (
            <form
              className="space-y-2"
              onSubmit={event => {
                event.preventDefault();
                const ip = staticIP.trim();
                if (
                  ip &&
                  (!/^(\d{1,3}\.){3}\d{1,3}$/.test(ip) ||
                    ip.split('.').some(part => Number(part) > 255))
                ) {
                  toast.error('Enter an IPv4 address');
                  return;
                }
                updateVM(hostId, selectedVM.id, {
                  details: { ...selectedVM.details, static_ip: ip },
                });
                void save();
              }}
            >
              <h3 className="font-medium">{selectedVM.name}</h3>
              <label htmlFor="vm-static-ip" className="text-sm">
                Requested IPv4 address
              </label>
              <Input
                id="vm-static-ip"
                placeholder="Automatic"
                value={staticIP}
                onChange={event => setStaticIP(event.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Leave empty for automatic assignment. The address must be free and in the physical
                subnet. An uplink connection is required.
              </p>
              <Button type="submit" size="sm" disabled={saving}>
                Apply IP setting
              </Button>
            </form>
          )}
          {(selectedSwitch || selectedEdge) && (
            <Button variant="outline" onClick={deleteSelection}>
              <Trash2 className="h-4 w-4" />
              Delete {selectedSwitch ? 'switch' : 'connection'}
            </Button>
          )}
          <div className="border-t pt-4">
            <VMManager nodeId={hostId} />
          </div>
        </aside>
      </div>
    </section>
  );
}
