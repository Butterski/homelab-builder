import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ReactFlow,
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
import { Joyride, type EventData, STATUS, type Step } from 'react-joyride';
import { BuildConflictError, useBuilderStore } from '../store/builder-store';
import { useShallow } from 'zustand/react/shallow';
import { startAutosave } from '../store/autosave';
import { ApiError } from '../../../lib/api';
import { SaveStateChip } from './save-state-chip';
import { LoadingScreen } from '../../../components/ui/loading-screen';
import { HardwareToolbox } from './hardware-toolbox';
import { HardwareNode as HardwareNodeComponent } from './hardware-node';
import { RackNode } from './rack-node';
import {
  RACK_U_HEIGHT_PX,
  RACK_HEADER_PX,
  RACK_RAIL_WIDTH,
  DEFAULT_DEVICE_U,
} from './rack-node-constants';
import { NodePropertiesPanel } from './node-properties-panel';
import { LiveResourceDashboard } from './live-resource-dashboard';
import { Button } from '../../../components/ui/button';
import {
  Wand2,
  Menu,
  Save,
  Folder,
  Download,
  LogOut,
  Route,
  Image as ImageIcon,
  Map as MapIcon,
  ClipboardCheck,
  Gamepad2,
  LayoutGrid,
  Sparkles,
} from 'lucide-react';
import type { EdgePreferences, HardwareType, HardwareNode } from '../../../types';
import { toPng, toSvg } from 'html-to-image';
import {
  nodeHasDynamicPorts,
  canNodeBeNested,
  canNodeHostNested,
  canNodeHostVMs,
  isFloorNode,
} from '../../../lib/hardware-config';
import { checkConnection, type LinkEnd } from '../lib/connection-rules';
import { getNodePortCount } from '../lib/port-count';
import { polishCanvas } from '../lib/polish';
import { isNatDownstreamEdge } from '../lib/network-zone';
import { withFreshChildIds } from '../lib/hardware-instance';
import { installComponent, placeDevice } from '../../inventory/lib/place';
import type { InventoryDragData } from '../../inventory/lib/inventory';
import { useUpgradeHints } from '../../inventory/hooks/use-upgrade-hints';
import { upgradeHintText } from '../../inventory/lib/upgrade-hints';
import { useAuth } from '../../auth/hooks/use-auth';
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

import { CanvasGrid } from './canvas-grid';
import { useCanvasMoving } from '../hooks/use-canvas-moving';
import { CustomEdge } from './custom-edge';
import { ReadinessReportDialog } from './readiness-report-dialog';
import { GamingPlanDialog } from '../../gaming/components/gaming-plan-dialog';
import { isGamingKind } from '../../gaming/lib/kind';
import { VirtualNetworkEditor } from './virtual-network-editor';
import { PolishMenu } from './polish-menu';
import { ProposalBanner } from './proposal-banner';
import { ProposalEdge } from './proposal-edge';
import { ProposalReviewBar } from './proposal-review-bar';
import { ProposalReviewPanel } from './proposal-review-panel';
import { SidePanelShell } from './side-panel-shell';
import { useProposals } from '../hooks/use-proposals';
import { AssistantActivityPill } from '../../assistant/components/activity-pill';
import { AssistantPanel } from '../../assistant/components/assistant-panel';
import { useAssistantStore } from '../../assistant/store/assistant-store';
import { useAssistantSettings } from '../../settings/api/assistant-settings';

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

type NetworkZoneData = {
  kind: 'lan' | 'nat' | 'firewall' | 'wireless';
  label: string;
  subLabel: string;
  width: number;
  height: number;
  accent: string;
  opacity: number;
  path: string;
};

const NETWORK_ZONE_KEYS: Array<keyof NetworkZoneData> = [
  'kind',
  'path',
  'width',
  'height',
  'label',
  'subLabel',
  'accent',
  'opacity',
];

const NetworkZoneNode = React.memo(function NetworkZoneNode({ data }: { data: NetworkZoneData }) {
  return (
    <div
      className={`network-zone-node network-zone-${data.kind}`}
      style={
        {
          width: data.width,
          height: data.height,
          '--network-zone-accent': data.accent,
          '--network-zone-opacity': data.opacity,
        } as React.CSSProperties
      }
    >
      <svg
        className="network-zone-svg"
        viewBox={`0 0 ${data.width} ${data.height}`}
        preserveAspectRatio="none"
      >
        <path className="network-zone-fill" d={data.path} />
        <path className="network-zone-outline" d={data.path} />
      </svg>
      <div className="network-zone-node-label">
        <span>{data.label}</span>
        <strong>{data.subLabel}</strong>
      </div>
    </div>
  );
  // The zones are worked out again whenever a card moves; most come out the same.
}, (previous, next) => NETWORK_ZONE_KEYS.every(key => previous.data[key] === next.data[key]));

/** The zone overlays the Visual Settings menu switches on and off. */
const ZONE_TOGGLES = [
  ['showNetworkZones', 'Show zone overlays'],
  ['showNatZones', 'NAT / Firewall zones'],
  ['showLanZones', 'Primary LAN outline'],
] as const;

/** What the toolbox and the service list put on a drag. */
type ToolDropData = Partial<Omit<HardwareNode, 'type'>> & {
  type: HardwareType;
  /** Set on a service dragged from the catalog. */
  serviceId?: string;
  inventory?: undefined;
};

/** What a drag onto the canvas carries under 'application/reactflow-data'. */
type CanvasDropData = ToolDropData | InventoryDragData;

/** How long cards glide to their new places after a Polish. Matches `.is-arranging` in index.css. */
const LAYOUT_GLIDE_MS = 450;

const px = (value: number) => `${Math.round(value)}px` as const;

/** No `animated`: a cable that runs for ever is painted for ever (pitfall 41). */
const DEFAULT_EDGE_OPTIONS = {
  type: 'custom',
  style: { stroke: '#3F3F46', strokeWidth: 2 },
};

const drawnNodes = new WeakMap<ReactFlowNode, { marks: string; node: ReactFlowNode }>();
const drawnData = new WeakMap<object, ReactFlowNode['data']>();

/**
 * What React Flow is given for a node of the store, with the classes that mark
 * it. A node that did not change gets the object it got before, and a node
 * that only moved keeps its `data`: a drag moves one card, and the cards that
 * stay must not render (pitfall 42).
 */
function drawnNode(node: ReactFlowNode, marks: string): ReactFlowNode {
  const drawn = drawnNodes.get(node);
  if (drawn && drawn.marks === marks) return drawn.node;

  let data = drawnData.get(node.data);
  if (!data) {
    data = {
      ...node.data,
      onOpenVirtualNetwork: () => useBuilderStore.getState().openVirtualNetwork(node.id),
    };
    drawnData.set(node.data, data);
  }
  // A device a proposal removes stays visible behind what takes its place.
  const removed = (node.data as { proposalDiff?: string }).proposalDiff === 'removed';
  const flowNode: ReactFlowNode = {
    ...node,
    ...(marks ? { className: marks } : {}),
    data,
    zIndex: node.type === 'rack' ? 10 : removed ? 15 : 20,
  };
  drawnNodes.set(node, { marks, node: flowNode });
  return flowNode;
}

/** One empty list for every "nothing to mark", so memos see the same value. */
const NO_IDS: string[] = [];

/**
 * Padding for bringing something into view: room for the toolbar on top, and
 * for a panel that floats over one side (the library can be dragged anywhere).
 * `margin` is added all around, for when a few devices are shown rather than
 * the whole canvas and should not touch the edges.
 */
function paddingClearOfPanels(canvas: HTMLElement | null, margin = 0) {
  const inset = { top: 96 + margin, right: 48 + margin, bottom: 64 + margin, left: 48 + margin };
  if (canvas) {
    const area = canvas.getBoundingClientRect();
    document
      .querySelectorAll<HTMLElement>('.builder-floating-panel, .builder-resource-dashboard')
      .forEach(panel => {
        const box = panel.getBoundingClientRect();
        // A collapsed panel is only a button in a corner.
        if (box.width === 0 || box.height < area.height * 0.4) return;
        if (box.left + box.width / 2 < area.left + area.width / 2) {
          inset.left = Math.max(inset.left, box.right - area.left + 24 + margin);
        } else {
          inset.right = Math.max(inset.right, area.right - box.left + 24 + margin);
        }
      });
    // Panels on both sides of a narrow window leave nothing to fit into.
    if (inset.left + inset.right > area.width * 0.6) {
      inset.left = 48;
      inset.right = 48;
    }
  }
  return { top: px(inset.top), right: px(inset.right), bottom: px(inset.bottom), left: px(inset.left) };
}

const nodeTypes: NodeTypes = {
  hardware: HardwareNodeComponent,
  rack: RackNode,
};

const edgeTypes = {
  custom: CustomEdge,
  // Cables of a proposal under review.
  proposal: ProposalEdge,
};

/** How long the devices of an applied proposal stay lit. Matches `.applied-glow` in index.css. */
const APPLIED_GLOW_MS = 2600;

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

const TOUR_STEPS: Step[] = [
  {
    target: '.tour-toolbox',
    content:
      'Welcome to HLBuilder! Drag networking gear and servers from this toolbox onto your canvas.',
    skipBeacon: true,
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
];

const ShortcutHints = React.memo(function ShortcutHints() {
  return (
    <div
      id="shortcut-hints"
      className="pointer-events-none absolute bottom-2 left-1/2 z-10 hidden -translate-x-1/2 select-none items-center gap-3 rounded-full border border-border bg-card px-3 py-1.5 text-[10px] text-muted-foreground sm:flex"
    >
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
});

const Flow = React.memo(function Flow() {
  const virtualHostId = useBuilderStore(state => state.virtualHostId);
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const canvasMoving = useCanvasMoving(reactFlowWrapper);
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
        if (
          node.classList &&
          (node.classList.contains('react-flow__panel') ||
            node.classList.contains('react-flow__controls') ||
            node.classList.contains('react-flow__attribution') ||
            node.id === 'shortcut-hints' ||
            node.getAttribute('data-hide-export') === 'true')
        ) {
          return false;
        }
        return true;
      },
    })
      .then(dataUrl => {
        const a = document.createElement('a');
        a.href = dataUrl;
        a.download = `homelab-${projectName || 'export'}.${format}`;
        a.click();
        toast.success(`Export successful.`);
      })
      .catch(err => {
        console.error('Failed to export image', err);
        toast.error('Failed to export image.');
      });
  };

  const [runTour, setRunTour] = useState(false);
  const [readinessOpen, setReadinessOpen] = useState(false);
  const [gamePlanOpen, setGamePlanOpen] = useState(false);

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

  const handleJoyrideCallback = (data: EventData) => {
    const { status } = data;
    if (status === STATUS.FINISHED || status === STATUS.SKIPPED) {
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
    openBuild,
    hardwareNodes,
    projectName,
    edgePreferences,
    setEdgePreferences,
    validationIssues,
    undo,
    redo,
  } = useBuilderStore(
    // Named one by one: a component that takes the whole store renders on
    // every change of anything in it.
    useShallow(state => ({
      nodes: state.nodes,
      edges: state.edges,
      onNodesChange: state.onNodesChange,
      onEdgesChange: state.onEdgesChange,
      onConnect: state.onConnect,
      addHardware: state.addHardware,
      removeHardware: state.removeHardware,
      duplicateHardware: state.duplicateHardware,
      selectNode: state.selectNode,
      selectedNodeId: state.selectedNodeId,
      addInternalComponent: state.addInternalComponent,
      addVM: state.addVM,
      reassignAllIPs: state.reassignAllIPs,
      openBuild: state.openBuild,
      hardwareNodes: state.hardwareNodes,
      projectName: state.projectName,
      edgePreferences: state.edgePreferences,
      setEdgePreferences: state.setEdgePreferences,
      validationIssues: state.validationIssues,
      undo: state.undo,
      redo: state.redo,
    })),
  );

  const {
    screenToFlowPosition,
    getIntersectingNodes,
    fitView,
    getNodesBounds,
    getViewport,
    getEdges,
    deleteElements,
  } = useReactFlow();

  // LLM proposals: polled from the server and reviewed right here. While one
  // is open the canvas draws the build as it would be instead of the live
  // graph; the live graph in the store is not touched, so nothing of a
  // proposal can be saved before it is applied.
  const proposals = useProposals(id);
  const previewNodes = useBuilderStore(state => state.proposalPreview?.nodes);
  const previewEdges = useBuilderStore(state => state.proposalPreview?.edges);
  const previewHardware = useBuilderStore(state => state.proposalPreview?.hardwareNodes);
  const previewFocus = useBuilderStore(state => state.proposalPreview?.focus);
  // A device a proposal adds has no size until React Flow has drawn and
  // measured it, and the camera cannot be pointed at something without a size.
  const previewFocusMeasured = useBuilderStore(state => {
    const preview = state.proposalPreview;
    if (!preview?.focus) return false;
    const wanted = new Set(preview.focus.ids);
    return preview.nodes.every(node => !wanted.has(node.id) || !!node.measured?.width);
  });
  const previewTotal = useBuilderStore(state => state.proposalPreview?.proposal.diff.counts.total);
  const previewId = useBuilderStore(state => state.proposalPreview?.proposal.id);
  const applyPreviewNodeChanges = useBuilderStore(state => state.applyPreviewNodeChanges);
  const reviewingProposal = previewNodes !== undefined;
  const canvasNodes = previewNodes ?? nodes;
  const canvasEdges = previewEdges ?? edges;
  const canvasHardware = previewHardware ?? hardwareNodes;
  // The game plan is offered wherever there is something for it to check.
  const showGamePlan = useBuilderStore(
    state =>
      isGamingKind(state.buildKind) ||
      state.hardwareNodes.some(
        node => node.type === 'lan_table' || node.vms?.some(vm => !!vm.details?.game),
      ),
  );

  // The in-app assistant exists only for users who turned it on in Settings.
  const { data: assistantSettings } = useAssistantSettings();
  const assistantEnabled = !!assistantSettings?.available && assistantSettings.enabled;
  const assistantOpen = useAssistantStore(state => state.open);
  const setAssistantOpen = useAssistantStore(state => state.setOpen);
  const showAssistant = assistantEnabled && assistantOpen && !!id;
  const noteProposal = useAssistantStore(state => state.noteProposal);
  // Devices the assistant's last step was about get a ring while it works.
  const assistantFocus = useAssistantStore(state => (state.buildId === id ? state.focusIds : NO_IDS));
  // While a proposal is reviewed next to an open chat, the side panel shows the
  // chat unless the list of changes was asked for. That choice belongs to the
  // proposal it was made for: the next review starts on the chat again.
  const [changesShownFor, setChangesShownFor] = useState<string | null>(null);
  const sideTab = previewId !== undefined && changesShownFor === previewId ? 'changes' : 'chat';
  const setSideTab = useCallback(
    (tab: 'chat' | 'changes') => setChangesShownFor(tab === 'changes' ? (previewId ?? null) : null),
    [previewId],
  );

  // The card in the chat says at once what was done with its proposal.
  const applyReviewed = useCallback(async () => {
    const proposalId = useBuilderStore.getState().proposalPreview?.proposal.id;
    if (proposalId && (await proposals.apply())) noteProposal(proposalId, 'applied');
  }, [proposals, noteProposal]);
  const rejectReviewed = useCallback(
    async (reason: string) => {
      const proposalId = useBuilderStore.getState().proposalPreview?.proposal.id;
      if (proposalId && (await proposals.reject(reason))) noteProposal(proposalId, 'rejected', reason);
    },
    [proposals, noteProposal],
  );
  const visualPreferences = {
    showNetworkZones: edgePreferences.showNetworkZones ?? true,
    showLanZones: edgePreferences.showLanZones ?? false,
    showNatZones: edgePreferences.showNatZones ?? true,
    zoneOpacity: edgePreferences.zoneOpacity ?? 0.7,
  };

  // Polish writes the final positions at once; only the way there is drawn.
  // The class has to be on the canvas in the same render that moves the cards,
  // which is why it is derived from the counter instead of set in an effect.
  const layoutMotion = useBuilderStore(state => state.layoutMotion);
  const [settledMotion, setSettledMotion] = useState(layoutMotion);
  const arranging = layoutMotion !== settledMotion;
  useEffect(() => {
    if (layoutMotion === settledMotion) return;
    const timer = window.setTimeout(() => setSettledMotion(layoutMotion), LAYOUT_GLIDE_MS + 80);
    return () => window.clearTimeout(timer);
  }, [layoutMotion, settledMotion]);

  const networkZones = useMemo<Array<ReactFlowNode<NetworkZoneData>>>(() => {
    if (!visualPreferences.showNetworkZones) return [];

    const hardwareById = new Map(canvasHardware.map(node => [node.id, node]));
    const reactFlowById = new Map(canvasNodes.map(node => [node.id, node]));
    const edgeByNode = new Map<string, typeof edges>();
    const natChildIds = new Set<string>();

    canvasEdges.forEach(edge => {
      if (edge.data?.connection_type === 'vpn') return;
      edgeByNode.set(edge.source, [...(edgeByNode.get(edge.source) || []), edge]);
      edgeByNode.set(edge.target, [...(edgeByNode.get(edge.target) || []), edge]);
    });

    const isNatProvider = (node?: HardwareNode) =>
      !!node &&
      (node.details?.nat_enabled ||
        node.details?.firewall_enabled ||
        (node.type as string) === 'firewall' ||
        (((node.type as string) === 'server_v2' ||
          (node.type as string) === 'vps' ||
          (node.type as string) === 'firewall') &&
          !!node.details?.dhcp_enabled &&
          !!node.details?.routing_enabled));

    const isUpstreamAnchor = (node?: HardwareNode) =>
      !!node &&
      (node.type === 'router' ||
        node.type === 'modem' ||
        node.details?.public_ip ||
        node.details?.network_zone === 'wan' ||
        node.details?.network_zone === 'cloud');

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
    ): ReactFlowNode<NetworkZoneData> | null => {
      if (members.length === 0) return null;

      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;

      members.forEach(node => {
        const size = getNodeSize(node);
        // A device in a rack is positioned relative to the rack.
        const rack = node.parentId ? reactFlowById.get(node.parentId) : undefined;
        const x = node.position.x + (rack?.position.x ?? 0) - padding;
        const y = node.position.y + (rack?.position.y ?? 0) - padding;
        const width = size.width + padding * 2;
        const height = size.height + padding * 2;

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
      return {
        id,
        type: 'networkZone',
        position,
        data: {
          kind,
          label,
          subLabel,
          width,
          height,
          accent,
          opacity: visualPreferences.zoneOpacity,
          path,
        },
        selectable: false,
        draggable: false,
        focusable: false,
        deletable: false,
        zIndex: 0,
        style: { width, height, pointerEvents: 'none' },
      };
    };

    const zoneNodes: Array<ReactFlowNode<NetworkZoneData>> = [];

    canvasHardware.filter(isNatProvider).forEach(natNode => {
      if (!visualPreferences.showNatZones) return;
      const natId = natNode.id;
      const visited = new Set<string>();
      const queue: string[] = [];

      (edgeByNode.get(natId) || []).forEach(edge => {
        const otherId = edge.source === natId ? edge.target : edge.source;
        if (
          isNatDownstreamEdge(edge, natId, Boolean(isUpstreamAnchor(hardwareById.get(otherId))))
        ) {
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

      const kind =
        natNode.details?.firewall_enabled || natNode.type === 'firewall' ? 'firewall' : 'nat';
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

    const routers = visualPreferences.showLanZones
      ? canvasHardware.filter(node => node.type === 'router')
      : [];
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
  }, [
    canvasNodes,
    canvasEdges,
    canvasHardware,
    visualPreferences.showNetworkZones,
    visualPreferences.showLanZones,
    visualPreferences.showNatZones,
    visualPreferences.zoneOpacity,
  ]);

  // The devices of the proposal applied last light up once.
  const appliedGlow = useBuilderStore(state => state.appliedGlow);
  const [glowSeen, setGlowSeen] = useState(appliedGlow?.nonce ?? 0);
  const glowing = appliedGlow && appliedGlow.nonce !== glowSeen ? appliedGlow.ids : NO_IDS;
  useEffect(() => {
    if (!appliedGlow || appliedGlow.nonce === glowSeen) return;
    const timer = window.setTimeout(() => setGlowSeen(appliedGlow.nonce), APPLIED_GLOW_MS);
    return () => window.clearTimeout(timer);
  }, [appliedGlow, glowSeen]);

  const flowNodes = useMemo<ReactFlowNode[]>(
    () =>
      canvasNodes.map(node =>
        drawnNode(
          node,
          [
            node.className,
            glowing.includes(node.id) && 'applied-glow',
            assistantFocus.includes(node.id) && 'assistant-focus',
          ]
            .filter(Boolean)
            .join(' '),
        ),
      ),
    [canvasNodes, glowing, assistantFocus],
  );

  // Always reload on open: the store may still hold an older revision of this
  // build (renamed or edited elsewhere), and saves from a stale revision are rejected.
  useEffect(() => {
    if (!id) return;
    let active = true;
    openBuild(id).catch(err => {
      if (!active) return;
      console.error('Failed to load build', err);
      useBuilderStore.getState().clearCurrentBuild();
      toast.error(
        err instanceof ApiError && err.status === 404
          ? 'This project no longer exists.'
          : 'This project could not be opened.',
      );
      navigate('/');
    });
    return () => {
      active = false;
    };
  }, [id, openBuild, navigate]);

  const clipboardNodeIdRef = useRef<string | null>(null);

  // The save state lives in the store, so the sidebar shows the same thing.
  const saveState = useBuilderStore(state => state.saveState);
  const saveError = useBuilderStore(state => state.saveError);
  const serverReachable = useBuilderStore(state => state.serverReachable);
  // Nothing of another build is shown while this one is still on its way.
  const buildReady = useBuilderStore(
    state => state.currentBuildId === id && state.buildStatus === 'ready',
  );

  // Autosave watches the store, not this component's renders. Stopping it (on
  // leaving the builder or switching builds) saves what is still pending.
  useEffect(
    () =>
      startAutosave({
        onConflict: error => toast.warning(error.message, { duration: 8000 }),
        onFailure: message => toast.error(message),
      }),
    [],
  );

  const saveNow = useCallback(async () => {
    if (!id) return;
    await reassignAllIPs();
  }, [id, reassignAllIPs]);

  const reviewBusy = proposals.busy === 'apply' || proposals.busy === 'reject' ? proposals.busy : null;

  // An import from an integration ends in a proposal: it is shown at once,
  // like one the assistant made in this session.
  const { refreshSyncState, openReview } = proposals;
  const reviewImported = useCallback(
    (proposalId: string) => {
      void refreshSyncState();
      void openReview(proposalId);
    },
    [refreshSyncState, openReview],
  );
  // Hosts short of memory that the owner's own spare memory would fix.
  const upgradeHints = useUpgradeHints();
  const upgradeHintTexts = useMemo(() => upgradeHints.map(upgradeHintText), [upgradeHints]);
  const openConfigGenerator = useCallback(() => navigate('/generate'), [navigate]);

  const saveErrorText = (err: unknown, fallback: string) =>
    err instanceof BuildConflictError || (err instanceof ApiError && err.status === 422)
      ? err.message
      : fallback;

  // Manual save wrapper (immediate)
  const handleManualSave = useCallback(() => {
    toast.promise(saveNow(), {
      loading: 'Saving…',
      success: 'Project saved',
      error: (err: unknown) => saveErrorText(err, 'Failed to save'),
    });
  }, [saveNow]);

  const handleReassignIPs = useCallback(() => {
    toast.promise(saveNow(), {
      loading: 'Reassigning IPs…',
      success: 'IP addresses reassigned',
      error: (err: unknown) =>
        err instanceof Error && err.message ? err.message : 'Failed to reassign IPs',
    });
  }, [saveNow]);

  // One place moves the camera: an applied proposal, a Polish, "show on canvas".
  const canvasFocus = useBuilderStore(state => state.canvasFocus);
  useEffect(() => {
    if (!canvasFocus) return;
    const frame = requestAnimationFrame(() => {
      void fitView({
        ...(canvasFocus.ids ? { nodes: canvasFocus.ids.map(nodeId => ({ id: nodeId })) } : {}),
        padding: paddingClearOfPanels(reactFlowWrapper.current, canvasFocus.ids ? 72 : 0),
        duration: LAYOUT_GLIDE_MS,
        maxZoom: 1.1,
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [canvasFocus, fitView]);

  // A review brings what it changes into view, unless that is on screen
  // already: then the camera stays where the user left it. A click on a change
  // in the list always goes there.
  useEffect(() => {
    if (!previewFocus || !previewFocusMeasured || previewFocus.ids.length === 0) return;
    const frame = requestAnimationFrame(() => {
      const wanted = previewFocus.ids.map(nodeId => ({ id: nodeId }));
      const canvas = reactFlowWrapper.current;
      if (previewFocus.nonce === 0 && canvas) {
        const bounds = getNodesBounds(previewFocus.ids);
        const { x, y, zoom } = getViewport();
        const left = bounds.x * zoom + x;
        const top = bounds.y * zoom + y;
        const visible =
          bounds.width > 0 &&
          left >= 24 &&
          top >= 72 &&
          left + bounds.width * zoom <= canvas.clientWidth - 24 &&
          top + bounds.height * zoom <= canvas.clientHeight - 96;
        if (visible) return;
      }
      void fitView({ nodes: wanted, padding: 0.35, duration: LAYOUT_GLIDE_MS, maxZoom: 1.1 });
    });
    return () => cancelAnimationFrame(frame);
  }, [previewFocus, previewFocusMeasured, fitView, getNodesBounds, getViewport]);

  // A build opens shown whole. React Flow's own first fit does not know about
  // the panels that float over the canvas, so once the cards are measured the
  // view is fitted again around them.
  const fittedOnOpen = useRef(false);
  const cardsMeasured = useBuilderStore(
    state => state.nodes.length > 0 && state.nodes.every(node => !!node.measured?.width),
  );
  useEffect(() => {
    if (!buildReady || !cardsMeasured || fittedOnOpen.current) return;
    // A moment later than React Flow's own fit, which would otherwise undo this one.
    const timer = window.setTimeout(() => {
      fittedOnOpen.current = true;
      useBuilderStore.getState().requestCanvasFocus(null);
    }, 200);
    return () => window.clearTimeout(timer);
  }, [buildReady, cardsMeasured]);

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
    const portNodeIds: string[] = [];
    for (const n of hardwareNodes) {
      if (nodeHasDynamicPorts(n.type)) {
        portNodeIds.push(n.id);
      }
    }
    if (portNodeIds.length === 0) return;

    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(() => {
          portNodeIds.forEach(nid => updateNodeInternals(nid));
        });
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [hardwareNodes, updateNodeInternals]);

  const handlePrefChange = <K extends keyof EdgePreferences>(key: K, val: EdgePreferences[K]) => {
    setEdgePreferences({ [key]: val });
    void updatePreferences({
      edgePreferences: {
        routingEngine: edgePreferences.routingEngine,
        connectionStyle: edgePreferences.connectionStyle,
        lineStyle: edgePreferences.lineStyle,
        ignoreNetworkLoops: edgePreferences.ignoreNetworkLoops,
        ...visualPreferences,
        [key]: val,
      },
    });
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (useBuilderStore.getState().virtualHostId) return;
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      // The proposal preview is read-only: Escape leaves it, nothing else applies.
      if (useBuilderStore.getState().proposalPreview) {
        if (e.key === 'Escape') useBuilderStore.getState().endProposalPreview();
        return;
      }

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
      if (useBuilderStore.getState().proposalPreview) return;

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

      let data: CanvasDropData | null = null;
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

      if (!data?.type) return;

      const isServiceDrag = event.dataTransfer.getData('service-drag') === 'true';

      // Dropped on a rack: a device is mounted in it.
      const rackTarget = intersecting.find(n => n.type === 'rack');

      // Something the owner has. A component goes into the machine it is
      // dropped on; a device becomes a node that is that machine, once.
      if (data.inventory) {
        if (data.inventory.kind !== 'device') {
          const host = intersecting.find(n => n.type === 'hardware');
          const result = installComponent(host?.id ?? '', {
            id: crypto.randomUUID(),
            type: data.type,
            name: data.name,
            power_draw: data.power_draw,
            details: data.details || {},
          });
          (result.ok ? toast.success : toast.error)(result.message);
          return;
        }
        const deviceType = data.type as HardwareType;
        const rack =
          rackTarget && deviceType !== 'rack' && !isFloorNode(deviceType) ? rackTarget : undefined;
        const uSlot = rack
          ? Math.max(0, Math.round((position.y - rack.position.y - RACK_HEADER_PX) / RACK_U_HEIGHT_PX))
          : 0;
        const result = rack
          ? placeDevice(
              data,
              { x: RACK_RAIL_WIDTH, y: RACK_HEADER_PX + uSlot * RACK_U_HEIGHT_PX },
              {
                parent_id: rack.id,
                details: {
                  ...data.details,
                  rack_units: data.details.rack_units || DEFAULT_DEVICE_U[data.type] || 1,
                  rack_position: uSlot,
                },
              },
            )
          : placeDevice(data, position);
        if (!result.ok) toast.info(result.message);
        return;
      }

      if (rackTarget && data.type !== 'rack' && !isFloorNode(data.type) && !isServiceDrag) {
        // Calculate the U-slot position based on drop position within the rack
        const relY = position.y - rackTarget.position.y - RACK_HEADER_PX;
        const uSlot = Math.max(0, Math.round(relY / RACK_U_HEIGHT_PX));
        const deviceU = data.details?.rack_units || DEFAULT_DEVICE_U[data.type] || 1;

        const newNode: HardwareNode = {
          id: crypto.randomUUID(),
          type: data.type,
          name: data.name || `New ${data.type}`,
          // Position relative to rack, snapped to U-slot grid
          x: RACK_RAIL_WIDTH,
          y: RACK_HEADER_PX + uSlot * RACK_U_HEIGHT_PX,
          details: {
            ...(data.details || {}),
            rack_units: deviceU,
            rack_position: uSlot,
          },
          internal_components: data.internal_components || [],
          vms: data.vms || [],
          power_draw: data.power_draw,
          parent_id: rackTarget.id,
        };
        addHardware(withFreshChildIds(newNode));
        return;
      }

      const targetNode = intersecting[0];

      if (isServiceDrag) {
        if (targetNode && targetNode.type === 'hardware') {
          const targetHardware = useBuilderStore
            .getState()
            .hardwareNodes.find(node => node.id === targetNode.id);
          if (!targetHardware || !canNodeHostVMs(targetHardware.type)) {
            toast.error(
              'Services can only be placed on compute nodes such as servers, NAS devices, PCs, or SBCs.',
            );
            return;
          }

          const cpuVal = data.details?.cpu ? Number(data.details.cpu) : undefined;
          const ramVal = data.details?.ram ? Number(data.details.ram) : undefined;

          addVM(targetNode.id, {
            id: crypto.randomUUID(),
            name: data.name ?? '',
            type: 'container',
            status: 'running',
            details: {
              catalog_service_id: data.serviceId,
              catalog_service_name: data.name,
            },
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
            id: crypto.randomUUID(),
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
        id: crypto.randomUUID(),
        type: data.type,
        name: data.name || `New ${data.type}`,
        x: position.x,
        y: position.y,
        details: data.details || {},
        internal_components: data.internal_components || [],
        vms: data.vms || [],
        power_draw: data.power_draw,
      };
      addHardware(withFreshChildIds(newNode));
    },
    [screenToFlowPosition, getIntersectingNodes, addHardware, addInternalComponent, addVM],
  );

  const onNodeDragStop = useCallback(
    (_: React.MouseEvent, node: ReactFlowNode) => {
      // Rack nodes manage their own position, don't nest them
      if (node.type === 'rack') return;

      const intersectingNodes = getIntersectingNodes(node);
      const rackTarget = intersectingNodes.find(n => n.type === 'rack');
      const storeState = useBuilderStore.getState();

      if (rackTarget) {
        // Find hardware node to check details
        const hardwareNode = storeState.hardwareNodes.find(n => n.id === node.id);
        if (!hardwareNode) return;
        // Consoles and LAN tables stand on the floor; they stay where they were dropped.
        if (isFloorNode(hardwareNode.type)) return;

        // Calculate relative Y
        const isCurrentlyInRack = node.parentId === rackTarget.id;

        // Node position in React Flow is relative IF it has parentId, or absolute if not
        let newRelY = node.position.y;

        if (!isCurrentlyInRack) {
          // It was dropped from outside! node.position is absolute canvas.
          newRelY = node.position.y - rackTarget.position.y - RACK_HEADER_PX;
        }

        const uSlot = Math.max(0, Math.round(newRelY / RACK_U_HEIGHT_PX));

        storeState.updateHardware(node.id, {
          parent_id: rackTarget.id,
          x: RACK_RAIL_WIDTH,
          y: RACK_HEADER_PX + uSlot * RACK_U_HEIGHT_PX,
          details: {
            ...(hardwareNode.details || {}),
            rack_position: uSlot,
          },
        });
      } else if (node.parentId) {
        // Dropped outside a rack but had a parent! It should be detached!
        // Calculate absolute position to drop it on canvas
        const oldParent = storeState.nodes.find(n => n.id === node.parentId);
        const absX = oldParent ? oldParent.position.x + node.position.x : node.position.x;
        const absY = oldParent ? oldParent.position.y + node.position.y : node.position.y;

        const hardwareNode = storeState.hardwareNodes.find(n => n.id === node.id);
        if (!hardwareNode) return;

        // A device taken out of a rack has no slot any more.
        const newDetails = { ...hardwareNode.details };
        delete newDetails.rack_position;

        storeState.updateHardware(node.id, {
          parent_id: undefined,
          x: absX,
          y: absY,
          details: newDetails,
        });
      }
    },
    [getIntersectingNodes],
  );

  const isValidConnection = useCallback(
    (connection: LinkEnd) => {
      // Always read live state so this never operates on stale closures.
      const {
        edges: currentEdges,
        hardwareNodes: currentNodes,
        edgePreferences,
      } = useBuilderStore.getState();

      const result = checkConnection(connection, currentNodes, currentEdges, {
        ignoreLoops: edgePreferences.ignoreNetworkLoops,
      });
      if (!result.ok && result.message) toast.error(result.message);
      return result.ok;
    },
    [], // no deps - reads live state via getState()
  );

  // The project is still on its way from the server. Drawing the canvas now
  // would show whatever was open before, under this project's address.
  if (!buildReady) {
    return (
      <div
        className="builder-workbench flex h-full items-center justify-center"
        role="status"
        aria-live="polite"
      >
        <LoadingScreen message="Opening project…" />
      </div>
    );
  }

  return (
    <div className="builder-workbench flex h-full overflow-hidden relative">
      {virtualHostId && <VirtualNetworkEditor hostId={virtualHostId} />}
      <div
        className="flex h-full w-full"
        inert={!!virtualHostId}
        style={{ visibility: virtualHostId ? 'hidden' : undefined }}
      >
        {runTour && (
          <Joyride
            steps={TOUR_STEPS}
            run
            onEvent={handleJoyrideCallback}
            locale={{ last: 'Close' }}
            continuous
            options={{
              primaryColor: 'var(--primary)',
              zIndex: 10000,
              showProgress: true,
              buttons: ['back', 'close', 'primary', 'skip'],
            }}
          />
        )}

        {/* The library adds to the build; a review only looks at it. */}
        <div className={reviewingProposal ? 'hidden' : 'contents'}>
          <HardwareToolbox buildId={id} onProposal={reviewImported} />
        </div>
        <ReadinessReportDialog
          open={readinessOpen}
          onOpenChange={setReadinessOpen}
          hardwareNodes={hardwareNodes}
          edges={edges}
          validationIssues={validationIssues}
          onGenerateConfig={openConfigGenerator}
          onReassignIPs={handleReassignIPs}
          hints={upgradeHintTexts}
        />
        <GamingPlanDialog
          open={gamePlanOpen}
          onOpenChange={setGamePlanOpen}
          onSelectNode={selectNode}
        />

        <div className="builder-canvas flex-1 h-full min-w-0 relative" ref={reactFlowWrapper}>
          <ReactFlow
            nodes={flowNodes}
            edges={canvasEdges}
            onNodesChange={changes => {
              const own = changes.filter(
                change => !('id' in change) || !String(change.id).startsWith('network-zone-'),
              );
              // During a review only the sizes React Flow measures are kept.
              if (reviewingProposal) applyPreviewNodeChanges(own);
              else onNodesChange(own);
            }}
            onEdgesChange={changes => {
              if (!reviewingProposal) onEdgesChange(changes);
            }}
            onConnect={onConnect}
            isValidConnection={isValidConnection}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onDragOver={onDragOver}
            onDrop={onDrop}
            onNodeDragStop={onNodeDragStop}
            onNodeClick={(_, node) => {
              if (reviewingProposal) return;
              if (node.type === 'hardware' || node.type === 'rack') selectNode(node.id);
            }}
            onPaneClick={() => selectNode(null)}
            onMoveStart={canvasMoving.onMoveStart}
            onMoveEnd={canvasMoving.onMoveEnd}
            // A proposal is looked at, not edited: the canvas pans and zooms only.
            nodesDraggable={!reviewingProposal}
            nodesConnectable={!reviewingProposal}
            elementsSelectable={!reviewingProposal}
            connectionMode={ConnectionMode.Loose}
            fitView
            // A wide build has to fit on the screen as a whole.
            minZoom={0.15}
            attributionPosition="bottom-right"
            className={[
              'builder-flow-canvas',
              arranging && 'is-arranging',
              reviewingProposal && 'is-reviewing',
            ]
              .filter(Boolean)
              .join(' ')}
            defaultEdgeOptions={DEFAULT_EDGE_OPTIONS}
            snapToGrid={true}
            snapGrid={[20, 20]}
          >
            <CanvasGrid gap={20} />
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
            <Controls showInteractive={!reviewingProposal} />

            <Panel
              position="top-left"
              // The toolbar edits the build; during a review there is nothing to edit.
              className={[
                'builder-top-panel flex max-w-[calc(100vw-2rem)] flex-wrap items-start gap-2',
                reviewingProposal && 'hidden',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon"
                    className="builder-control-button size-10 shrink-0"
                    aria-label="Open Project Menu"
                  >
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
                  <DropdownMenuItem onClick={() => setReadinessOpen(true)}>
                    <ClipboardCheck className="mr-2 size-4" /> Readiness Report
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setGamePlanOpen(true)}>
                    <Gamepad2 className="mr-2 size-4" /> Game Plan
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => polishCanvas()}>
                    <LayoutGrid className="mr-2 size-4" /> Polish Layout
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
                  <DropdownMenuItem onClick={() => setRunTour(true)}>
                    <MapIcon className="mr-2 size-4" /> Start Guided Tour
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={logout} className="text-red-500 focus:text-red-500">
                    <LogOut className="mr-2 size-4" /> Sign Out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              <div className="builder-project-title builder-glass-panel flex h-12 min-w-0 flex-col justify-center px-3 py-2">
                <h2 className="text-sm font-semibold leading-none truncate max-w-52">
                  {projectName || 'Untitled project'}
                </h2>
                <SaveStateChip
                  className="mt-1"
                  state={saveState}
                  error={saveError}
                  reachable={serverReachable}
                  onRetry={handleManualSave}
                />
              </div>

              <Button
                variant="secondary"
                onClick={handleReassignIPs}
                title="Fix IP Conflicts"
                size="sm"
                className="builder-control-button h-10 px-3"
              >
                <Wand2 className="size-4" />
                <span className="builder-action-label ml-2">Reassign IPs</span>
              </Button>

              <Button
                variant="outline"
                onClick={() => setReadinessOpen(true)}
                title="Open Readiness Report"
                size="sm"
                className="builder-control-button h-10 px-3"
              >
                <ClipboardCheck className="size-4" />
                <span className="builder-action-label ml-2">Readiness</span>
              </Button>

              {showGamePlan && (
                <Button
                  variant="outline"
                  onClick={() => setGamePlanOpen(true)}
                  title="Open the game plan and its report"
                  size="sm"
                  className="builder-control-button h-10 px-3"
                >
                  <Gamepad2 className="size-4" />
                  <span className="builder-action-label ml-2">Game plan</span>
                </Button>
              )}

              <PolishMenu />

              {assistantEnabled && (
                <Button
                  variant={assistantOpen ? 'secondary' : 'outline'}
                  onClick={() => setAssistantOpen(!assistantOpen)}
                  title={assistantOpen ? 'Close the assistant' : 'Open the assistant'}
                  aria-pressed={assistantOpen}
                  size="sm"
                  className="builder-control-button h-10 px-3"
                >
                  <Sparkles className="size-4" />
                  <span className="builder-action-label ml-2">Assistant</span>
                </Button>
              )}

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="builder-control-button h-10 px-3">
                    <Route className="size-4 shrink-0" />
                    <span className="builder-action-label ml-2">Visual Settings</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-64">
                  <DropdownMenuLabel className="text-xs text-muted-foreground uppercase">
                    Network Zones
                  </DropdownMenuLabel>
                  {ZONE_TOGGLES.map(([key, label]) => (
                    <DropdownMenuItem
                      key={key}
                      onClick={e => {
                        e.preventDefault();
                        handlePrefChange(key, !visualPreferences[key]);
                      }}
                      className="flex items-center justify-between cursor-pointer"
                    >
                      <span>{label}</span>
                      <input
                        type="checkbox"
                        checked={visualPreferences[key]}
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
                    onValueChange={v =>
                      handlePrefChange('routingEngine', v as EdgePreferences['routingEngine'])
                    }
                  >
                    <DropdownMenuRadioItem value="smart">
                      Smart (Avoids Nodes)
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="direct">Direct (Flyover)</DropdownMenuRadioItem>
                  </DropdownMenuRadioGroup>

                  <DropdownMenuSeparator />

                  <DropdownMenuLabel className="text-xs text-muted-foreground uppercase">
                    Connection Pins
                  </DropdownMenuLabel>
                  <DropdownMenuRadioGroup
                    value={edgePreferences.connectionStyle}
                    onValueChange={v =>
                      handlePrefChange('connectionStyle', v as EdgePreferences['connectionStyle'])
                    }
                  >
                    <DropdownMenuRadioItem value="floating">
                      Floating (Chassis)
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="strict">Strict (RJ45 Port)</DropdownMenuRadioItem>
                  </DropdownMenuRadioGroup>

                  <DropdownMenuSeparator />

                  <DropdownMenuLabel className="text-xs text-muted-foreground uppercase">
                    Line Style
                  </DropdownMenuLabel>
                  <DropdownMenuRadioGroup
                    value={edgePreferences.lineStyle}
                    onValueChange={v => handlePrefChange('lineStyle', v as EdgePreferences['lineStyle'])}
                  >
                    <DropdownMenuRadioItem value="bezier">Bezier (Curve)</DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="step">Step (Orthogonal)</DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="straight">
                      Straight (Linear)
                    </DropdownMenuRadioItem>
                  </DropdownMenuRadioGroup>

                  <DropdownMenuSeparator />

                  <DropdownMenuItem
                    onClick={e => {
                      e.preventDefault();
                      handlePrefChange('ignoreNetworkLoops', !edgePreferences.ignoreNetworkLoops);
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
              {selectedNodeId && !reviewingProposal && <NodePropertiesPanel />}
            </Panel>

            {!reviewingProposal && <ShortcutHints />}
            {!reviewingProposal && <LiveResourceDashboard />}
          </ReactFlow>
          {id && assistantEnabled && <AssistantActivityPill buildId={id} />}
          {proposals.pending && (
            <ProposalBanner
              proposal={proposals.pending}
              loading={proposals.busy === 'open'}
              onReview={() => void proposals.openReview(proposals.pending!.id)}
            />
          )}
          {reviewingProposal && (
            <ProposalReviewBar
              busy={reviewBusy}
              onApply={() => void applyReviewed()}
              onReject={reason => void rejectReviewed(reason)}
              onClose={proposals.closeReview}
              onShowChanges={() => setSideTab('changes')}
            />
          )}
        </div>
        {/* Beside the canvas: the assistant, and the list of changes while a proposal
            is reviewed. The chat stays mounted behind the list, so a running reply
            and the place one has scrolled to survive a look at the changes. */}
        {(reviewingProposal || showAssistant) && (
          <SidePanelShell>
            {reviewingProposal && showAssistant && (
              <div role="tablist" aria-label="Side panel" className="flex shrink-0 gap-1 border-b px-2 pt-2">
                {(
                  [
                    ['chat', 'Assistant'],
                    ['changes', `Changes (${previewTotal ?? 0})`],
                  ] as const
                ).map(([tab, label]) => (
                  <button
                    key={tab}
                    type="button"
                    role="tab"
                    aria-selected={sideTab === tab}
                    onClick={() => setSideTab(tab)}
                    className={[
                      'rounded-t-md border border-b-0 px-3 py-1.5 text-xs font-medium transition-colors hover:cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
                      sideTab === tab
                        ? 'border-border bg-background text-foreground'
                        : 'border-transparent text-muted-foreground hover:text-foreground',
                    ].join(' ')}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
            {showAssistant && (
              <div
                role={reviewingProposal ? 'tabpanel' : undefined}
                className={reviewingProposal && sideTab !== 'chat' ? 'hidden' : 'min-h-0 flex-1'}
              >
                <AssistantPanel
                  buildId={id!}
                  openingProposal={proposals.busy === 'open'}
                  onReview={proposalId => void proposals.openReview(proposalId)}
                  onProposal={proposal => {
                    // What the assistant just suggested goes straight onto the canvas.
                    void proposals.refreshSyncState();
                    void proposals.openReview(proposal.id);
                  }}
                  reviewBusy={reviewBusy}
                  onApply={() => void applyReviewed()}
                  onReject={reason => void rejectReviewed(reason)}
                  onShowChanges={() => setSideTab('changes')}
                  onClose={() => setAssistantOpen(false)}
                />
              </div>
            )}
            {reviewingProposal && (
              <div
                role={showAssistant ? 'tabpanel' : undefined}
                className={showAssistant && sideTab !== 'changes' ? 'hidden' : 'min-h-0 flex-1'}
              >
                <ProposalReviewPanel
                  busy={reviewBusy}
                  onApply={() => void applyReviewed()}
                  onReject={reason => void rejectReviewed(reason)}
                  onClose={proposals.closeReview}
                />
              </div>
            )}
          </SidePanelShell>
        )}
      </div>
    </div>
  );
});

export default function VisualBuilderPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <ReactFlowProvider>
      <Flow key={id} />
    </ReactFlowProvider>
  );
}
