import { useMemo } from 'react';
import { useParams } from 'react-router-dom';
import {
  Background,
  ReactFlow,
  ReactFlowProvider,
  type Edge,
  type Node,
  type NodeTypes,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { SeoMeta } from '../../../components/seo/seo-meta';
import { HardwareNode } from '../../builder/components/hardware-node';
import { RackNode } from '../../builder/components/rack-node';
import { CustomEdge } from '../../builder/components/custom-edge';
import type { HardwareType, VirtualMachine } from '../../../types';

const nodeTypes: NodeTypes = {
  hardware: HardwareNode,
  rack: RackNode,
};

const edgeTypes = {
  custom: CustomEdge,
};

type VisualNode = {
  id: string;
  type: HardwareType;
  label: string;
  ip?: string;
  x: number;
  y: number;
  details?: Record<string, string | number | boolean>;
  vms?: VirtualMachine[];
};

export type VisualSpec = {
  title: string;
  nodes: VisualNode[];
  edges: Array<[string, string, string, string?]>;
};

function n(
  id: string,
  type: HardwareType,
  label: string,
  ip: string,
  x: number,
  y: number,
  details: Record<string, string | number | boolean> = {},
  vms: VirtualMachine[] = [],
): VisualNode {
  return { id, type, label, ip, x, y, details, vms };
}

const mediaVms: VirtualMachine[] = [
  { id: 'plex', name: 'Plex', type: 'container', ip: '192.168.1.151', status: 'running', cpu_cores: 2, ram_mb: 2048 },
  { id: 'jellyfin', name: 'Jellyfin', type: 'container', ip: '192.168.1.152', status: 'running', cpu_cores: 2, ram_mb: 2048 },
];

const appVms: VirtualMachine[] = [
  { id: 'dns', name: 'Pi-hole', type: 'container', ip: '192.168.1.171', status: 'running', cpu_cores: 1, ram_mb: 512 },
  { id: 'proxy', name: 'Caddy', type: 'container', ip: '192.168.1.172', status: 'running', cpu_cores: 1, ram_mb: 512 },
];

export const VISUALS: Record<string, VisualSpec> = {
  'homelab-network-diagram-examples': {
    title: 'Homelab network diagram examples',
    nodes: [
      n('router', 'router', 'Gateway Router', '192.168.1.1', 80, 90, { model: 'OPNsense box', ports: 4 }),
      n('switch', 'switch', 'Core Switch', '192.168.1.10', 380, 90, { model: '8-port managed', ports: 8 }),
      n('server', 'server_v2', 'Service Server', '192.168.1.150', 240, 300, { model: 'Proxmox host', cpu: 8, ram: 64 }, appVms),
      n('nas', 'nas', 'Backup NAS', '192.168.1.100', 540, 300, { model: '4-bay NAS', storage: 8000 }),
      n('ap', 'access_point', 'Wi-Fi AP', '192.168.1.20', 670, 90, { model: 'Wi-Fi 6 AP' }),
    ],
    edges: [
      ['router', 'switch', '10 GbE'],
      ['switch', 'server', '1 GbE'],
      ['switch', 'nas', '1 GbE'],
      ['switch', 'ap', '1 GbE'],
    ],
  },
  'router-switch-homelab-topology': {
    title: 'Router and switch homelab topology',
    nodes: [
      n('router', 'router', 'Gateway Router', '192.168.1.1', 90, 120, { model: 'Firewall appliance', ports: 4 }),
      n('switch', 'switch', 'Managed Switch', '192.168.1.10', 370, 120, { model: 'PoE switch', ports: 8 }),
      n('ap', 'access_point', 'Access Point', '192.168.1.20', 640, 60, { model: 'Ceiling AP' }),
      n('nas', 'nas', 'NAS', '192.168.1.100', 330, 330, { model: 'Storage target', storage: 12000 }),
      n('server', 'server_v2', 'Server', '192.168.1.150', 620, 300, { model: 'VM host', cpu: 12, ram: 64 }),
    ],
    edges: [
      ['router', 'switch', 'LAN trunk'],
      ['switch', 'ap', 'PoE'],
      ['switch', 'nas', '1 GbE'],
      ['switch', 'server', '2.5 GbE'],
    ],
  },
  'home-server-and-nas-network-layout': {
    title: 'Home server and NAS network layout',
    nodes: [
      n('router', 'router', 'Router', '192.168.1.1', 90, 90, { ports: 4 }),
      n('switch', 'switch', 'Switch', '192.168.1.10', 360, 90, { ports: 8 }),
      n('nas', 'nas', 'Storage NAS', '192.168.1.100', 240, 310, { model: 'Snapshots', storage: 16000 }),
      n('server', 'server_v2', 'Home Server', '192.168.1.150', 520, 310, { model: 'Proxmox', cpu: 8, ram: 64 }, appVms),
      n('mini', 'minipc', 'Light Apps', '192.168.1.170', 690, 90, { model: 'N100 mini PC', cpu: 4, ram: 16 }),
    ],
    edges: [
      ['router', 'switch', 'LAN'],
      ['switch', 'nas', 'storage'],
      ['switch', 'server', 'service data'],
      ['switch', 'mini', 'apps'],
    ],
  },
  'mini-pc-cluster-homelab-layout': {
    title: 'Mini PC cluster homelab layout',
    nodes: [
      n('router', 'router', 'Router', '192.168.1.1', 60, 80, { ports: 4 }),
      n('switch', 'switch', 'Cluster Switch', '192.168.1.10', 340, 80, { ports: 8 }),
      n('mini-a', 'minipc', 'Mini PC A', '192.168.1.170', 80, 310, { model: 'N100 node', cpu: 4, ram: 16 }, appVms),
      n('mini-b', 'minipc', 'Mini PC B', '192.168.1.171', 350, 310, { model: 'Ryzen node', cpu: 8, ram: 32 }),
      n('mini-c', 'minipc', 'Mini PC C', '192.168.1.172', 620, 310, { model: 'Lab tests', cpu: 4, ram: 16 }),
      n('nas', 'nas', 'Shared NAS', '192.168.1.100', 650, 80, { storage: 8000 }),
    ],
    edges: [
      ['router', 'switch', 'LAN'],
      ['switch', 'mini-a', 'node 1'],
      ['switch', 'mini-b', 'node 2'],
      ['switch', 'mini-c', 'node 3'],
      ['switch', 'nas', 'storage'],
    ],
  },
  'self-hosted-media-server-layout': {
    title: 'Self-hosted media server layout',
    nodes: [
      n('router', 'router', 'Router', '192.168.1.1', 70, 90, { ports: 4 }),
      n('switch', 'switch', 'Switch', '192.168.1.10', 350, 90, { ports: 8 }),
      n('nas', 'nas', 'Media Library', '192.168.1.100', 180, 310, { storage: 24000 }),
      n('server', 'server_v2', 'Media Server', '192.168.1.150', 480, 310, { model: 'Transcode host', cpu: 8, ram: 32 }, mediaVms),
      n('ap', 'access_point', 'Client Wi-Fi', '192.168.1.20', 660, 90, { model: 'Wi-Fi 6' }),
    ],
    edges: [
      ['router', 'switch', 'LAN'],
      ['switch', 'nas', 'media files'],
      ['switch', 'server', 'streaming apps'],
      ['switch', 'ap', 'clients'],
    ],
  },
  'homelab-backup-network-layout': {
    title: 'Homelab backup network layout',
    nodes: [
      n('router', 'router', 'Router', '192.168.1.1', 70, 90, { ports: 4 }),
      n('switch', 'switch', 'Switch', '192.168.1.10', 350, 90, { ports: 8 }),
      n('server', 'server_v2', 'Service Host', '192.168.1.150', 180, 310, { cpu: 8, ram: 64 }, appVms),
      n('nas', 'nas', 'Backup NAS', '192.168.1.100', 480, 310, { storage: 16000 }),
      n('ups', 'ups', 'UPS', '', 650, 90, { model: '1500VA' }),
      n('pdu', 'pdu', 'Rack PDU', '', 650, 310, { ports: 8 }),
    ],
    edges: [
      ['router', 'switch', 'LAN'],
      ['switch', 'server', 'protected'],
      ['switch', 'nas', 'backup path'],
      ['ups', 'router', 'runtime'],
      ['nas', 'ups', 'runtime'],
      ['server', 'pdu', 'outlets'],
    ],
  },
  'homelab-ip-address-planning': {
    title: 'Homelab IP address planning',
    nodes: [
      n('router', 'router', 'Router', '192.168.1.1', 80, 70, { model: 'Gateway', ports: 4 }),
      n('switch', 'switch', 'Switch', '192.168.1.10', 380, 70, { ports: 8 }),
      n('ap', 'access_point', 'Access Point', '192.168.1.20', 650, 70, {}),
      n('nas', 'nas', 'NAS', '192.168.1.100', 160, 310, { storage: 8000 }),
      n('server', 'server_v2', 'Server', '192.168.1.150', 430, 310, { cpu: 8, ram: 64 }, appVms),
      n('mini', 'minipc', 'Mini PC', '192.168.1.170', 670, 310, { cpu: 4, ram: 16 }),
    ],
    edges: [
      ['router', 'switch', 'subnet'],
      ['switch', 'ap', 'infra'],
      ['switch', 'nas', 'storage'],
      ['switch', 'server', 'services'],
      ['switch', 'mini', 'apps'],
    ],
  },
  'wifi-access-point-homelab-layout': {
    title: 'Wi-Fi access point homelab layout',
    nodes: [
      n('router', 'router', 'Router', '192.168.1.1', 80, 90, { ports: 4 }),
      n('switch', 'switch', 'Switch', '192.168.1.10', 360, 90, { ports: 8 }),
      n('ap', 'access_point', 'Wi-Fi AP', '192.168.1.20', 650, 90, { model: 'Wi-Fi 6' }),
      n('server', 'server_v2', 'Server', '192.168.1.150', 210, 310, { cpu: 8, ram: 64 }),
      n('nas', 'nas', 'NAS', '192.168.1.100', 480, 310, { storage: 8000 }),
      n('sbc', 'sbc', 'IoT Bridge', '192.168.1.180', 690, 310, { model: 'SBC' }),
    ],
    edges: [
      ['router', 'switch', 'LAN'],
      ['switch', 'ap', 'PoE uplink'],
      ['switch', 'server', 'wired services'],
      ['switch', 'nas', 'wired storage'],
      ['ap', 'sbc', 'wireless branch', 'wireless'],
    ],
  },
  'homelab-rack-layout-planning': {
    title: 'Homelab rack layout planning',
    nodes: [
      n('rack', 'rack', '24U Rack', '', 50, 40, { rack_size: 8 }),
      n('switch', 'switch', 'Top Switch', '192.168.1.10', 370, 70, { ports: 8, rack_units: 1 }),
      n('server', 'server_v2', 'Rack Server', '192.168.1.150', 370, 250, { cpu: 16, ram: 128, rack_units: 2 }, appVms),
      n('nas', 'nas', 'Rack NAS', '192.168.1.100', 650, 250, { storage: 24000, rack_units: 2 }),
      n('ups', 'ups', 'Rack UPS', '', 650, 70, { model: '2U UPS', rack_units: 2 }),
      n('pdu', 'pdu', 'Rack PDU', '', 650, 410, { ports: 8, rack_units: 1 }),
    ],
    edges: [
      ['switch', 'server', 'compute'],
      ['switch', 'nas', 'storage'],
      ['ups', 'switch', 'runtime'],
      ['server', 'pdu', 'outlets'],
    ],
  },
  'ups-and-power-planning-for-homelab': {
    title: 'UPS and power planning for a homelab',
    nodes: [
      n('ups', 'ups', 'UPS', '', 80, 80, { model: '1500VA' }),
      n('router', 'router', 'Router', '192.168.1.1', 360, 80, { ports: 4 }),
      n('switch', 'switch', 'Switch', '192.168.1.10', 620, 80, { ports: 8 }),
      n('pdu', 'pdu', 'PDU', '', 80, 310, { ports: 8 }),
      n('nas', 'nas', 'NAS', '192.168.1.100', 360, 310, { storage: 8000 }),
      n('server', 'server_v2', 'Server', '192.168.1.150', 620, 310, { cpu: 8, ram: 64 }),
    ],
    edges: [
      ['ups', 'router', 'runtime'],
      ['router', 'switch', 'LAN'],
      ['switch', 'nas', 'storage'],
      ['switch', 'server', 'services'],
      ['server', 'pdu', 'outlets'],
      ['nas', 'ups', 'runtime'],
    ],
  },
};

function toReactFlowNodes(spec: VisualSpec): Node[] {
  return spec.nodes.map(item => ({
    id: item.id,
    type: item.type === 'rack' ? 'rack' : 'hardware',
    position: { x: item.x, y: item.y },
    data: {
      id: item.id,
      label: item.label,
      name: item.label,
      type: item.type,
      ip: item.ip,
      details: item.details ?? {},
      vms: item.vms ?? [],
      internal_components: [],
    },
    ...(item.type === 'rack'
      ? {
          style: { width: 280, height: 768 },
          zIndex: -1,
        }
      : {}),
  }));
}

export function toReactFlowEdges(spec: VisualSpec): Edge[] {
  const usedSourcePorts = new Map<string, number>();

  return spec.edges.map(([source, target, speed, connectionType]) => {
    const sourcePort = usedSourcePorts.get(source) ?? 0;
    usedSourcePorts.set(source, sourcePort + 1);

    return {
      id: `${source}-${target}`,
      source,
      target,
      sourceHandle: `eth${sourcePort}`,
      targetHandle: 'target-0',
      type: 'custom',
      animated: true,
      data: {
        speed,
        connection_type: connectionType ?? 'ethernet',
        wireless_standard: connectionType === 'wireless' ? 'Wi-Fi 6' : undefined,
        direction: 'auto',
      },
    };
  });
}

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
