import {
  ReactFlow,
  Background,
  ReactFlowProvider,
  type Node,
  type Edge,
  type NodeTypes,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { HardwareNode as HardwareNodeComponent } from './hardware-node';
import { CustomEdge } from './custom-edge';

// ─── Node & edge types (reuse the real ones) ─────────────────────────────────
const nodeTypes: NodeTypes = { hardware: HardwareNodeComponent };
const edgeTypes = { custom: CustomEdge };

// ─── Hardcoded demo topology ─────────────────────────────────────────────────
const DEMO_NODES: Node[] = [
  {
    id: 'demo-modem',
    type: 'hardware',
    position: { x: 360, y: 0 },
    data: {
      label: 'Cable Modem',
      id: 'demo-modem',
      type: 'modem',
      name: 'Cable Modem',
      ip: '192.168.0.1',
      details: { model: 'Arris S33', ports: 1 },
    },
  },
  {
    id: 'demo-router',
    type: 'hardware',
    position: { x: 340, y: 160 },
    data: {
      label: 'UDM Pro',
      id: 'demo-router',
      type: 'router',
      name: 'UDM Pro',
      ip: '10.0.0.1',
      details: { model: 'UniFi Dream Machine Pro', cpu: 4, ram: 4, ports: 8 },
    },
  },
  {
    id: 'demo-switch',
    type: 'hardware',
    position: { x: 300, y: 340 },
    data: {
      label: 'USW-24-PoE',
      id: 'demo-switch',
      type: 'switch',
      name: 'USW-24-PoE',
      ip: '10.0.0.2',
      details: { model: 'UniFi Switch 24 PoE', ports: 8 },
    },
  },
  {
    id: 'demo-server1',
    type: 'hardware',
    position: { x: 40, y: 550 },
    data: {
      label: 'Proxmox Node 1',
      id: 'demo-server1',
      type: 'server',
      name: 'Proxmox Node 1',
      ip: '10.0.0.10',
      details: { model: 'Dell R720', cpu: 16, ram: 128 },
      vms: [
        { id: 'vm-1', name: 'Plex', type: 'container', status: 'running', cpu_cores: 4, ram_mb: 4096 },
        { id: 'vm-2', name: 'Nextcloud', type: 'container', status: 'running', cpu_cores: 2, ram_mb: 2048 },
        { id: 'vm-3', name: 'Home Assistant', type: 'vm', status: 'running', cpu_cores: 2, ram_mb: 2048 },
      ],
    },
  },
  {
    id: 'demo-server2',
    type: 'hardware',
    position: { x: 340, y: 550 },
    data: {
      label: 'Proxmox Node 2',
      id: 'demo-server2',
      type: 'server',
      name: 'Proxmox Node 2',
      ip: '10.0.0.11',
      details: { model: 'HP DL380 G9', cpu: 28, ram: 256 },
      vms: [
        { id: 'vm-4', name: 'Pi-hole', type: 'container', status: 'running', cpu_cores: 1, ram_mb: 512 },
        { id: 'vm-5', name: 'Grafana', type: 'container', status: 'running', cpu_cores: 2, ram_mb: 1024 },
      ],
    },
  },
  {
    id: 'demo-nas',
    type: 'hardware',
    position: { x: 660, y: 550 },
    data: {
      label: 'Synology DS923+',
      id: 'demo-nas',
      type: 'nas',
      name: 'Synology DS923+',
      ip: '10.0.0.20',
      details: { model: 'DS923+ (Ryzen R1600)', cpu: 2, ram: 4 },
    },
  },
  {
    id: 'demo-ap',
    type: 'hardware',
    position: { x: 700, y: 330 },
    data: {
      label: 'UniFi AP',
      id: 'demo-ap',
      type: 'access_point',
      name: 'UniFi AP',
      ip: '10.0.0.30',
      details: { model: 'U6 Pro' },
    },
  },
];

const DEMO_EDGES: Edge[] = [
  { id: 'e-modem-router', source: 'demo-modem', target: 'demo-router', type: 'custom', animated: true, data: { speed: '1 GbE' } },
  { id: 'e-router-switch', source: 'demo-router', target: 'demo-switch', type: 'custom', animated: true, data: { speed: '10 GbE' } },
  { id: 'e-switch-srv1', source: 'demo-switch', target: 'demo-server1', type: 'custom', animated: true, data: { speed: '1 GbE' } },
  { id: 'e-switch-srv2', source: 'demo-switch', target: 'demo-server2', type: 'custom', animated: true, data: { speed: '1 GbE' } },
  { id: 'e-switch-nas', source: 'demo-switch', target: 'demo-nas', type: 'custom', animated: true, data: { speed: '1 GbE' } },
  { id: 'e-switch-ap', source: 'demo-switch', target: 'demo-ap', type: 'custom', animated: true, data: { speed: '1 GbE' } },
];

// ─── Inner flow (needs to be inside ReactFlowProvider) ───────────────────────
function DemoFlow() {
  return (
    <ReactFlow
      nodes={DEMO_NODES}
      edges={DEMO_EDGES}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable={false}
      panOnDrag={true}
      zoomOnScroll={true}
      zoomOnPinch={true}
      zoomOnDoubleClick={true}
      preventScrolling={false}
      fitView
      fitViewOptions={{ padding: 0.15 }}
      attributionPosition="bottom-right"
      className="bg-transparent"
      proOptions={{ hideAttribution: true }}
      defaultEdgeOptions={{
        type: 'custom',
        animated: true,
        style: { stroke: '#3F3F46', strokeWidth: 2 },
      }}
    >
      <Background gap={20} size={1} color="#A1A1AA" style={{ opacity: 0.15 }} />
    </ReactFlow>
  );
}

// ─── Public component ────────────────────────────────────────────────────────
export function BuilderDemoPreview() {
  return (
    <div className="demo-preview-wrapper group">
      {/* Animated gradient border */}
      <div className="demo-glow-border" />

      {/* Glass card */}
      <div className="demo-preview-card">
        <ReactFlowProvider>
          <DemoFlow />
        </ReactFlowProvider>
      </div>
    </div>
  );
}
