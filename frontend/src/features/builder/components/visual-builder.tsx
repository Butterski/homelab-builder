import React, { useState, useCallback, useRef, useEffect, useEffectEvent, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ReactFlow,
  Background,
  Controls,
  useReactFlow,
  useUpdateNodeInternals,
  ViewportPortal,
  type NodeTypes,
  type Node as ReactFlowNode,
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
import { RackNode } from './rack-node';
import { RACK_U_HEIGHT_PX, RACK_HEADER_PX, RACK_RAIL_WIDTH, DEFAULT_DEVICE_U } from './rack-node-constants';
import { NodePropertiesPanel } from './node-properties-panel';
import { LiveResourceDashboard } from './live-resource-dashboard';
import { Button } from '../../../components/ui/button';
import { Wand2, Menu, Save, Folder, Download, LogOut, Route, Image as ImageIcon } from 'lucide-react';
import type { HardwareType, HardwareNode } from '../../../types';
import { buildApi } from '../api/builds';
import { toPng, toSvg } from 'html-to-image';
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

type ZoneBlob = { x: number; y: number; width: number; height: number };

function roundedZonePath(width: number, height: number, inset = 14) {
  const x = inset;
  const y = inset;
  const w = Math.max(80, width - inset * 2);
  const h = Math.max(80, height - inset * 2);
  const radius = Math.min(44, Math.max(18, Math.min(w, h) * 0.12));
  const soft = radius * 0.55;

  return [
    `M ${x + radius} ${y}`,
    `L ${x + w - radius} ${y}`,
    `C ${x + w - soft} ${y}, ${x + w} ${y + soft}, ${x + w} ${y + radius}`,
    `L ${x + w} ${y + h - radius}`,
    `C ${x + w} ${y + h - soft}, ${x + w - soft} ${y + h}, ${x + w - radius} ${y + h}`,
    `L ${x + radius} ${y + h}`,
    `C ${x + soft} ${y + h}, ${x} ${y + h - soft}, ${x} ${y + h - radius}`,
    `L ${x} ${y + radius}`,
    `C ${x} ${y + soft}, ${x + soft} ${y}, ${x + radius} ${y}`,
    'Z',
  ].join(' ');
}

function NetworkZoneNode({ data }: any) {
  const filterId = `zone-filter-${data.zoneId}`;
  return (
    <div
      className={`network-zone-node network-zone-${data.kind}`}
      style={{
        width: data.width,
        height: data.height,
        '--network-zone-accent': data.accent,
        '--network-zone-opacity': data.opacity,
      } as React.CSSProperties}
    >
      <svg className="network-zone-svg" viewBox={`0 0 ${data.width} ${data.height}`} preserveAspectRatio="none">
        <defs>
          <filter id={filterId} x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="18" result="blur" />
            <feColorMatrix
              in="blur"
              mode="matrix"
              values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 19 -8"
              result="goo"
            />
            <feBlend in="SourceGraphic" in2="goo" />
          </filter>
        </defs>
        <g filter={`url(#${filterId})`} className="network-zone-blobs">
          {data.blobs?.map((blob: ZoneBlob, index: number) => (
            <rect
              key={index}
              x={blob.x}
              y={blob.y}
              width={blob.width}
              height={blob.height}
              rx="48"
              ry="48"
            />
          ))}
        </g>
        <path className="network-zone-fill" d={data.path} />
        <path className="network-zone-outline" d={data.path} />
      </svg>
      <div className="network-zone-node-label">
        <span>{data.label}</span>
        <strong>{data.subLabel}</strong>
      </div>
    </div>
  );
}

const nodeTypes: NodeTypes = {
  hardware: HardwareNodeComponent,
  rack: RackNode,
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
    <div id="shortcut-hints" className="absolute bottom-2 left-1/2 -translate-x-1/2 z-10 flex items-center gap-3 px-3 py-1.5 rounded-full bg-card border border-border text-[10px] text-muted-foreground pointer-events-none select-none">
      {shortcuts.map((sh: Shortcut, iter: number) =>
        iter === shortcuts.length - 1 ? (
          <span key={sh.combination} className="flex flex-col items-center">
            <kbd className="font-mono bg-muted px-1 rounded">{sh.combination}</kbd> {sh.name}
          </span>
        ) : (
          <div key={sh.combination} className="flex items-center gap-3">
            <span className="flex flex-col items-center">
              <kbd className="font-mono bg-muted px-1 rounded">{sh.combination}</kbd> {sh.name}
            </span>
            <span className="opacity-30">·</span>
          </div>
        ),
      )}
    </div>
  );
}

const Flow = React.memo(function Flow() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const { logout, updatePreferences } = useAuth();

  const downloadImage = (format: 'png' | 'svg') => {
    if (!reactFlowWrapper.current) return;
    const elem = reactFlowWrapper.current;
    
    // Quick notification
    toast.info(`Exporting ${format.toUpperCase()}...`);

    const op = format === 'png' ? toPng : toSvg;
    op(elem, {
      backgroundColor: 'transparent',
      filter: (node: HTMLElement) => {
        // Hide panels, controls, shortcuts, and dashboard
        if (node.classList && (
          node.classList.contains('react-flow__panel') || 
          node.classList.contains('react-flow__controls') ||
          node.classList.contains('react-flow__attribution') ||
          node.id === 'shortcut-hints' ||
          node.getAttribute('data-hide-export') === 'true'
        )) {
          return false;
        }
        return true;
      }
    }).then((dataUrl) => {
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = `homelab-${projectName || 'export'}.${format}`;
      a.click();
      toast.success(`Export successful.`);
    }).catch(err => {
      console.error('Failed to export image', err);
      toast.error('Failed to export image.');
    });
  };

  // Joyride Tour State
  const [runTour, setRunTour] = useState(() => !localStorage.getItem('hlb_has_seen_tour'));
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

  // Defensive cleanup: strip any scroll locks left behind by Radix dialogs or Joyride
  useEffect(() => {
    return () => {
      document.body.removeAttribute('data-scroll-locked');
      // Reset body styles and only remove specific lock properties from documentElement
      // to avoid wiping out the theme CSS custom properties stored on documentElement.
      document.body.style.cssText = '';
      document.documentElement.style.removeProperty('overflow');
      document.documentElement.style.removeProperty('pointer-events');
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
    edgePreferences,
    setEdgePreferences,
    undo,
    redo,
  } = useBuilderStore();

  const { screenToFlowPosition, getIntersectingNodes } = useReactFlow();
  const visualPreferences = {
    showNetworkZones: edgePreferences.showNetworkZones ?? true,
    showLanZones: edgePreferences.showLanZones ?? false,
    showNatZones: edgePreferences.showNatZones ?? true,
    zoneOpacity: edgePreferences.zoneOpacity ?? 0.7,
  };

  const networkZones = useMemo<ReactFlowNode[]>(() => {
    if (!visualPreferences.showNetworkZones) return [];

    const hardwareById = new Map(hardwareNodes.map(node => [node.id, node]));
    const reactFlowById = new Map(nodes.map(node => [node.id, node]));
    const edgeByNode = new Map<string, typeof edges>();
    const natChildIds = new Set<string>();

    edges.forEach(edge => {
      if (edge.data?.connection_type === 'vpn') return;
      edgeByNode.set(edge.source, [...(edgeByNode.get(edge.source) || []), edge]);
      edgeByNode.set(edge.target, [...(edgeByNode.get(edge.target) || []), edge]);
    });

    const isNatProvider = (node?: HardwareNode) =>
      !!node &&
      (node.details?.nat_enabled ||
        node.details?.firewall_enabled ||
        (node.type as string) === 'firewall' ||
        (((node.type as string) === 'server_v2' || (node.type as string) === 'vps' || (node.type as string) === 'firewall') &&
          !!node.details?.dhcp_enabled &&
          !!node.details?.routing_enabled));

    const isUpstreamAnchor = (node?: HardwareNode) =>
      !!node &&
      (node.type === 'router' ||
        node.type === 'modem' ||
        node.details?.public_ip ||
        node.details?.network_zone === 'wan' ||
        node.details?.network_zone === 'cloud');

    const isDownstreamFromNat = (otherId: string, direction: unknown) => {
      if (direction === 'lan') return true;
      if (direction === 'wan') return false;
      return !isUpstreamAnchor(hardwareById.get(otherId));
    };

    const getNodeSize = (node: ReactFlowNode) => {
      const style = node.style || {};
      const width = Number(node.measured?.width || node.width || style.width || 230);
      const height = Number(node.measured?.height || node.height || style.height || 150);
      return { width, height };
    };

    const buildZone = (
      id: string,
      kind: 'lan' | 'nat' | 'firewall' | 'wireless',
      label: string,
      subLabel: string,
      accent: string,
      members: ReactFlowNode[],
      padding: number,
    ): ReactFlowNode | null => {
      if (members.length === 0) return null;

      const rawBlobs: Array<ZoneBlob & { absX: number; absY: number }> = [];
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;

      members.forEach(node => {
        const size = getNodeSize(node);
        const x = node.position.x - padding;
        const y = node.position.y - padding;
        const width = size.width + padding * 2;
        const height = size.height + padding * 2;

        rawBlobs.push({ x: 0, y: 0, absX: x, absY: y, width, height });
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x + width);
        maxY = Math.max(maxY, y + height);
      });

      const gutter = 18;
      const position = { x: minX - gutter, y: minY - gutter };
      const width = Math.max(240, maxX - minX + gutter * 2);
      const height = Math.max(170, maxY - minY + gutter * 2);
      const path = roundedZonePath(width, height, kind === 'lan' ? 22 : 14);
      const blobs = rawBlobs.map(blob => ({
        x: blob.absX - position.x,
        y: blob.absY - position.y,
        width: blob.width,
        height: blob.height,
      }));

      return {
        id,
        type: 'networkZone',
        position,
        data: {
          zoneId: id.replace(/[^a-zA-Z0-9_-]/g, '-'),
          kind,
          label,
          subLabel,
          width,
          height,
          accent,
          opacity: visualPreferences.zoneOpacity,
          path,
          blobs,
        },
        selectable: false,
        draggable: false,
        focusable: false,
        deletable: false,
        zIndex: 0,
        style: { width, height, pointerEvents: 'none' },
      };
    };

    const zoneNodes: ReactFlowNode[] = [];

    hardwareNodes.filter(isNatProvider).forEach(natNode => {
      if (!visualPreferences.showNatZones) return;
      const natId = natNode.id;
      const visited = new Set<string>();
      const queue: string[] = [];

      (edgeByNode.get(natId) || []).forEach(edge => {
        const otherId = edge.source === natId ? edge.target : edge.source;
        const other = hardwareById.get(otherId);
        const autoFirewallUpstream =
          !edge.data?.direction || edge.data.direction === 'auto'
            ? (natNode.details?.firewall_enabled || (natNode.type as string) === 'firewall') &&
              other &&
              (other.type === 'switch' || other.type === 'router' || other.type === 'access_point')
            : false;
        if (!autoFirewallUpstream && isDownstreamFromNat(otherId, edge.data?.direction)) {
          queue.push(otherId);
        }
      });

      while (queue.length > 0) {
        const id = queue.shift()!;
        if (visited.has(id) || id === natId) continue;
        const hardware = hardwareById.get(id);
        if (!hardware || isUpstreamAnchor(hardware)) continue;

        visited.add(id);

        if (isNatProvider(hardware)) continue;

        (edgeByNode.get(id) || []).forEach(edge => {
          const nextId = edge.source === id ? edge.target : edge.source;
          if (nextId !== natId && !visited.has(nextId)) queue.push(nextId);
        });
      }

      const childNodes = [...visited]
        .map(id => reactFlowById.get(id))
        .filter((node): node is ReactFlowNode => !!node);
      const providerNode = reactFlowById.get(natId);
      if (providerNode) childNodes.push(providerNode);

      if (childNodes.length === 0 && !providerNode) return;
      visited.forEach(id => natChildIds.add(id));

      const kind = natNode.details?.firewall_enabled || natNode.type === 'firewall' ? 'firewall' : 'nat';
      const zone = buildZone(
        `network-zone-nat-${natId}`,
        kind,
        `${natNode.name || 'Protected'} zone`,
        kind === 'firewall' ? 'Firewall protected' : 'NAT / DHCP',
        kind === 'firewall' ? '#ef4444' : '#10b981',
        childNodes,
        kind === 'firewall' ? 34 : 38,
      );
      if (zone) zoneNodes.push(zone);
    });

    const routers = visualPreferences.showLanZones ? hardwareNodes.filter(node => node.type === 'router') : [];
    routers.forEach(router => {
      const routerId = router.id;
      const visited = new Set<string>();
      const queue = [routerId];

      while (queue.length > 0) {
        const id = queue.shift()!;
        if (visited.has(id)) continue;
        const hardware = hardwareById.get(id);
        if (!hardware || natChildIds.has(id)) continue;

        visited.add(id);

        if (id !== routerId && isNatProvider(hardware)) continue;

        (edgeByNode.get(id) || []).forEach(edge => {
          const nextId = edge.source === id ? edge.target : edge.source;
          if (!visited.has(nextId) && !natChildIds.has(nextId)) queue.push(nextId);
        });
      }

      const members = [...visited]
        .map(id => reactFlowById.get(id))
        .filter((node): node is ReactFlowNode => !!node);

      const zone = buildZone(
        `network-zone-lan-${routerId}`,
        'lan',
        `${router.name || 'Router'} LAN`,
        'Primary network',
        '#94a3b8',
        members,
        34,
      );
      if (zone) zoneNodes.unshift(zone);
    });

    return zoneNodes;
  }, [nodes, edges, hardwareNodes, visualPreferences.showNetworkZones, visualPreferences.showLanZones, visualPreferences.showNatZones, visualPreferences.zoneOpacity]);

  const flowNodes = useMemo<ReactFlowNode[]>(
    () =>
      nodes.map(node => ({
        ...node,
        zIndex: node.type === 'rack' ? 10 : 20,
      })),
    [nodes],
  );

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
  const clipboardNodeIdRef = useRef<string | null>(null);
  const isFirstRender = useRef(true);
  // Avoid calling impure Date.now() during render to satisfy react-hooks purity rules.
  // Initialize with 0 and set the actual time on first effect run.
  const lastSaveTime = useRef<number>(0);

  useEffect(() => {
    if (lastSaveTime.current === 0) lastSaveTime.current = Date.now();
  }, []);

  const saveProjectFn = useCallback(async () => {
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
    } catch (err) {
      console.error('Failed to save', err);
      setSaveStatus('error');
      toast.error('Failed to auto-save');
    }
  }, [id, getBuildData, projectName]);

  // Wrap saveProjectFn with useEffectEvent so it can be called from setTimeout
  // without being a dependency, preventing unnecessary effect re-subscriptions
  const saveProject = useEffectEvent(saveProjectFn);

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
  }, [nodes, edges, hardwareNodes]); // Any change triggers debounce

  // Manual save wrapper (immediate)
  const handleManualSave = () => {
    toast.promise(saveProjectFn(), {
      loading: 'Saving…',
      success: 'Project saved',
      error: 'Failed to save',
    });
  };

  const { getEdges, deleteElements } = useReactFlow();
  const updateNodeInternals = useUpdateNodeInternals();

  const prevPortsRef = useRef<Map<string, number>>(new Map());

  // Effect 1 - delete orphaned edges when port count shrinks.
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

  // Effect 2 - always resync handle positions for port-bearing nodes whenever
  // hardwareNodes changes (covers increases, decreases, and first render).
  // Running after every hardwareNodes change is cheap and ensures the triple-rAF
  // fires after *all* state updates (including the deleteElements re-render from
  // Effect 1) have settled.
  useEffect(() => {
    // Combine filter + map into single iteration
    const portNodeIds: string[] = [];
    for (const n of hardwareNodes) {
      if (nodeHasDynamicPorts(n.type)) {
        portNodeIds.push(n.id);
      }
    }
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
      updatePreferences({
        edgePreferences: {
          routingEngine: edgePreferences.routingEngine ?? 'direct',
          connectionStyle: edgePreferences.connectionStyle ?? 'strict',
          lineStyle: edgePreferences.lineStyle ?? 'step',
          ignoreNetworkLoops: edgePreferences.ignoreNetworkLoops ?? false,
          showNetworkZones: visualPreferences.showNetworkZones,
          showLanZones: visualPreferences.showLanZones,
          showNatZones: visualPreferences.showNatZones,
          zoneOpacity: visualPreferences.zoneOpacity,
          [key]: val,
        },
      });
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
        clipboardNodeIdRef.current = selectedNodeId;
        toast.success('Node copied');
        return;
      }

      if (e.key === 'v' && (e.ctrlKey || e.metaKey) && clipboardNodeIdRef.current) {
        e.preventDefault();
        duplicateHardware(clipboardNodeIdRef.current);
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
    clipboardNodeIdRef,
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

      // Check if dropped on a rack node - auto-mount into the rack
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

      const rackTarget = intersecting.find(
        (n: any) => n.type === 'rack',
      );

      if (rackTarget && data.type !== 'rack' && !isServiceDrag) {
        // Calculate the U-slot position based on drop position within the rack
        const relY = position.y - rackTarget.position.y - RACK_HEADER_PX;
        const uSlot = Math.max(0, Math.round(relY / RACK_U_HEIGHT_PX));
        const deviceU = data.details?.rack_units || DEFAULT_DEVICE_U[data.type] || 1;

        const newNode: HardwareNode = {
          id: `node-${Date.now()}`,
          type: data.type as HardwareType,
          name: data.name || `New ${data.type}`,
          // Position relative to rack, snapped to U-slot grid
          x: RACK_RAIL_WIDTH,
          y: RACK_HEADER_PX + uSlot * RACK_U_HEIGHT_PX,
          details: {
            ...(data.details || {}),
            rack_units: deviceU,
            rack_position: uSlot,
          },
          internal_components: [],
          vms: [],
          parent_id: rackTarget.id,
        };
        addHardware(newNode);
        return;
      }

      const targetNode = intersecting[0];

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

  const onNodeDragStop = useCallback(
    (_: React.MouseEvent, node: any) => {
      // Rack nodes manage their own position, don't nest them
      if (node.type === 'rack') return;

      const intersectingNodes = getIntersectingNodes(node);
      const rackTarget = intersectingNodes.find((n: any) => n.type === 'rack');
      const storeState = useBuilderStore.getState();

      if (rackTarget) {
        // Find hardware node to check details
        const hardwareNode = storeState.hardwareNodes.find(n => n.id === node.id);
        if (!hardwareNode) return;

        // Calculate relative Y
        const isCurrentlyInRack = node.parentId === rackTarget.id;
        
        // Node position in React Flow is relative IF it has parentId, or absolute if not
        let newRelX = RACK_RAIL_WIDTH;
        let newRelY = node.position.y;
        
        if (!isCurrentlyInRack) {
          // It was dropped from outside! node.position is absolute canvas.
          newRelY = node.position.y - rackTarget.position.y - RACK_HEADER_PX;
        }

        const uSlot = Math.max(0, Math.round(newRelY / RACK_U_HEIGHT_PX));
        
        storeState.updateHardware(node.id, {
          parent_id: rackTarget.id,
          x: newRelX,
          y: RACK_HEADER_PX + uSlot * RACK_U_HEIGHT_PX,
          details: {
             ...(hardwareNode.details || {}),
             rack_position: uSlot,
          }
        });
      } else if (node.parentId) {
         // Dropped outside a rack but had a parent! It should be detached!
         // Calculate absolute position to drop it on canvas
         const oldParent = storeState.nodes.find(n => n.id === node.parentId);
         const absX = oldParent ? oldParent.position.x + node.position.x : node.position.x;
         const absY = oldParent ? oldParent.position.y + node.position.y : node.position.y;
         
         const hardwareNode = storeState.hardwareNodes.find(n => n.id === node.id);
         if (!hardwareNode) return;

         // We use undefined to delete the rack_position from details, but TypeScript requires a structural match
         const newDetails = { ...hardwareNode.details };
         delete newDetails.rack_position;

         storeState.updateHardware(node.id, {
           parent_id: undefined,
           x: absX,
           y: absY,
           details: newDetails
         });
      }
    },
    [getIntersectingNodes]
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

      // Port exclusivity - each physical handle can carry at most one cable.
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

      // Cycle detection - BFS through the existing undirected graph (skip for UPS).
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
    [], // no deps - reads live state via getState()
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
        <ReactFlow
          nodes={flowNodes}
          edges={edges}
          onNodesChange={changes =>
            onNodesChange(
              changes.filter(change => !('id' in change) || !String(change.id).startsWith('network-zone-')),
            )
          }
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          isValidConnection={isValidConnection}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onDragOver={onDragOver}
          onDrop={onDrop}
          onNodeDragStop={onNodeDragStop}
          onNodeClick={(_, node) => {
            if (node.type === 'hardware' || node.type === 'rack') selectNode(node.id);
          }}
          onPaneClick={() => selectNode(null)}
          connectionMode={ConnectionMode.Loose}
          fitView
          attributionPosition="bottom-right"
          className="builder-flow-canvas"
          defaultEdgeOptions={{
            type: 'custom',
            animated: true,
            style: { stroke: '#3F3F46', strokeWidth: 2 },
          }}
          snapToGrid={true}
          snapGrid={[20, 20]}
        >
          <Background gap={20} size={1} color="#A1A1AA" style={{ opacity: 0.25 }} />
          <ViewportPortal>
            <div className="network-zone-viewport-layer">
              {networkZones.map(zone => (
                <div
                  key={zone.id}
                  className="network-zone-portal-item"
                  style={{
                    transform: `translate(${zone.position.x}px, ${zone.position.y}px)`,
                    width: zone.data?.width as number,
                    height: zone.data?.height as number,
                  }}
                >
                  <NetworkZoneNode data={zone.data} />
                </div>
              ))}
            </div>
          </ViewportPortal>
          <Controls />

          <Panel position="top-left" className="builder-top-panel flex flex-wrap gap-2 items-start">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" className="size-10 bg-card shrink-0">
                  <Menu className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-56">
                <DropdownMenuLabel>Project Menu</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleManualSave}>
                  <Save className="mr-2 size-4" /> Save Project{' '}
                  <span className="ml-auto text-xs text-muted-foreground opacity-60">Ctrl+S</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => navigate('/')}>
                  <Folder className="mr-2 size-4" /> My Projects
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => navigate('/generate')}>
                  <Download className="mr-2 size-4" /> Generate Config
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => downloadImage('png')}>
                  <ImageIcon className="mr-2 size-4" /> Export Diagram (PNG)
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => downloadImage('svg')}>
                  <ImageIcon className="mr-2 size-4" /> Export Diagram (SVG)
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => navigate('/services')}>
                  <Wand2 className="mr-2 size-4" /> Component Catalog
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={logout} className="text-red-500 focus:text-red-500">
                  <LogOut className="mr-2 size-4" /> Sign Out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <div className="builder-project-title flex flex-col min-w-0 rounded-lg border bg-card px-3 py-2 h-12 justify-center">
              <h2 className="text-sm font-semibold leading-none truncate max-w-52">
                {projectName || 'HLBuilder'}
              </h2>
              <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                {saveStatus === 'saving' && (
                  <span className="text-amber-500 flex items-center gap-1">
                    <span className="animate-spin">⟳</span> Saving…
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
              className="h-10 bg-card px-3"
            >
              <Wand2 className="size-4" />
              <span className="builder-action-label ml-2">Reassign IPs</span>
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-10 bg-card px-3">
                  <Route className="size-4 shrink-0" />
                  <span className="builder-action-label ml-2">Visual Settings</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-64">
                <DropdownMenuLabel className="text-xs text-muted-foreground uppercase">
                  Network Zones
                </DropdownMenuLabel>
                {[
                  ['showNetworkZones', 'Show zone overlays'],
                  ['showNatZones', 'NAT / Firewall zones'],
                  ['showLanZones', 'Primary LAN outline'],
                ].map(([key, label]) => (
                  <DropdownMenuItem
                    key={key}
                    onClick={(e) => {
                      e.preventDefault();
                      handlePrefChange(key, !visualPreferences[key as keyof typeof visualPreferences] as any);
                    }}
                    className="flex items-center justify-between cursor-pointer"
                  >
                    <span>{label}</span>
                    <input
                      type="checkbox"
                      checked={Boolean(visualPreferences[key as keyof typeof visualPreferences])}
                      readOnly
                      className="pointer-events-none"
                    />
                  </DropdownMenuItem>
                ))}
                <div className="px-2 py-2 space-y-1">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>Zone opacity</span>
                    <span>{Math.round(visualPreferences.zoneOpacity * 100)}%</span>
                  </div>
                  <input
                    type="range"
                    min="0.2"
                    max="1"
                    step="0.05"
                    value={visualPreferences.zoneOpacity}
                    onChange={e => handlePrefChange('zoneOpacity', Number(e.target.value))}
                    className="w-full accent-primary"
                  />
                </div>

                <DropdownMenuSeparator />

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
          <LiveResourceDashboard />
        </ReactFlow>
      </div>
    </div>
  );
})

export default function VisualBuilderPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <ReactFlowProvider>
      <Flow key={id} />
    </ReactFlowProvider>
  );
}
