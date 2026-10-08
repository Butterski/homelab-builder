import { useEffect, useRef, useState, type CSSProperties, type MouseEvent } from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  getBezierPath,
  getStraightPath,
  useReactFlow,
  useInternalNode,
  useStore,
  type EdgeProps,
  type Node,
  type ReactFlowState,
} from '@xyflow/react';
import { Button } from '../../../components/ui/button';
import { Cable, LockKeyhole, Radio, Settings2, Wifi, X } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '../../../components/ui/popover';
import { Label } from '../../../components/ui/label';
import { Input } from '../../../components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../components/ui/select';
import { useBuilderStore } from '../store/builder-store';
import { getEdgeParams } from './floating-edge-utils';
import { requiredConnectionType } from '../lib/connection-rules';
import { stepCableBusY } from '../lib/cable-path';
import { getSmartEdge, svgDrawSmoothLinePath } from '@tisoap/react-flow-smart-edge';
import type { EdgeParams, HardwareType } from '@/types';

const SPEED_COLORS: Record<string, string> = {
  '100 MbE': '#94a3b8', // slate-400
  '1 GbE': '#3b82f6', // blue-500
  '2.5 GbE': '#22c55e', // green-500
  '10 GbE': '#a855f7', // purple-500
  '40 GbE': '#f97316', // orange-500
  '100 GbE': '#ef4444', // red-500
};

const WIRELESS_STANDARDS = ['Wi-Fi 4', 'Wi-Fi 5', 'Wi-Fi 6', 'Wi-Fi 6E', 'Wi-Fi 7', '4G LTE', '5G'] as const;

const WIRELESS_COLORS: Record<string, string> = {
  'Wi-Fi 4': '#94a3b8',
  'Wi-Fi 5': '#60a5fa',
  'Wi-Fi 6': '#22d3ee',
  'Wi-Fi 6E': '#a78bfa',
  'Wi-Fi 7': '#f472b6',
  '4G LTE': '#f59e0b',
  '5G': '#34d399',
};

/** A cable's buttons stay this long after the pointer left it, so it can reach them. */
const HOVER_LINGER_MS = 160;

const NO_NODES: Node[] = [];
const allNodes = (state: ReactFlowState) => state.nodes;
const noNodes = () => NO_NODES;

export function CustomEdge({
  id,
  source,
  target,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style: customStyle,
  markerEnd,
  selected,
  data,
}: EdgeProps) {
  const { deleteElements } = useReactFlow();
  const updateEdge = useBuilderStore(s => s.updateEdge);
  const edgePreferences = useBuilderStore(s => s.edgePreferences);
  // Routing around devices needs every device; nothing else here does. A cable
  // that read them all was rendered again on every frame of every drag.
  const obstacles = useStore(edgePreferences.routingEngine === 'smart' ? allNodes : noNodes);
  const [isHovered, setIsHovered] = useState(false);
  const [radialOpen, setRadialOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const lingering = useRef<number | undefined>(undefined);
  const hover = () => {
    window.clearTimeout(lingering.current);
    setIsHovered(true);
  };
  const unhover = () => {
    window.clearTimeout(lingering.current);
    lingering.current = window.setTimeout(() => setIsHovered(false), HOVER_LINGER_MS);
  };
  useEffect(() => () => window.clearTimeout(lingering.current), []);

  // Glow when either connected node is selected
  const isNodeSelected = useStore(
    state => !!(state.nodeLookup.get(source)?.selected || state.nodeLookup.get(target)?.selected),
  );
  const isHighlighted = selected || isNodeSelected;

  const sourceNode = useInternalNode(source);
  const targetNode = useInternalNode(target);

  let sx = sourceX;
  let sy = sourceY;
  let tx = targetX;
  let ty = targetY;
  let sourcePos = sourcePosition;
  let targetPos = targetPosition;

  // 1. Determine Logical Connection Points
  // Floating avoids exact port handles and goes straight for the closest bounding box wall
  if (sourceNode && targetNode && edgePreferences.connectionStyle === 'floating') {
    const params = getEdgeParams(sourceNode, targetNode);

    // Always pin strictly on switches/routers as they have specific ETH port numbering
    if (sourceNode.data?.type !== 'switch' && sourceNode.data?.type !== 'router') {
      sx = params.sx;
      sy = params.sy;
      sourcePos = params.sourcePos;
    }

    if (targetNode.data?.type !== 'switch' && targetNode.data?.type !== 'router') {
      tx = params.tx;
      ty = params.ty;
      targetPos = params.targetPos;
    }
  }

  // 2. Determine the SVG line style primitive function
  const getFallbackPathObj = () => {
    let pathGen = getBezierPath;
    if (edgePreferences.lineStyle === 'step') pathGen = getSmoothStepPath;
    if (edgePreferences.lineStyle === 'straight') pathGen = getStraightPath;

    const params: EdgeParams = {
      sourceX: sx,
      sourceY: sy,
      sourcePosition: sourcePos,
      targetX: tx,
      targetY: ty,
      targetPosition: targetPos,
    };
    if (edgePreferences.lineStyle === 'step') {
      params.borderRadius = 15;
      // The sideways run sits just under the port, like a bus bar, instead of
      // halfway down. The layout engine counts on exactly this route.
      params.centerY = stepCableBusY(sy, sourcePos, ty, targetPos);
    }

    const [fallbackPath, flX, flY] = pathGen(params);

    return { svgPathString: fallbackPath, edgeCenterX: flX, edgeCenterY: flY };
  };

  // 3. Smart routing goes around devices; when it is boxed in, or in direct
  // mode, the cable takes the plain path.
  const smartPath =
    edgePreferences.routingEngine === 'smart'
      ? getSmartEdge({
          sourceX: sx,
          sourceY: sy,
          sourcePosition: sourcePos,
          targetX: tx,
          targetY: ty,
          targetPosition: targetPos,
          nodes: obstacles,
          options: {
            nodePadding: 20,
            drawEdge: edgePreferences.lineStyle === 'bezier' ? svgDrawSmoothLinePath : undefined,
          },
        })
      : null;
  const {
    svgPathString: finalEdgePath,
    edgeCenterX: labelX,
    edgeCenterY: labelY,
  } = smartPath && !(smartPath instanceof Error) ? smartPath : getFallbackPathObj();

  const onEdgeClick = (evt: MouseEvent) => {
    evt.stopPropagation();
    deleteElements({ edges: [{ id }] });
  };

  const speed = (data?.speed as string) || '1 GbE';
  const subnet = (data?.subnet as string) || '';
  const connectionType = (data?.connection_type as string) || 'ethernet';
  const wirelessStandard = (data?.wireless_standard as string) || 'Wi-Fi 6';
  const direction = (data?.direction as string) || 'auto';
  const isWireless = connectionType === 'wireless';
  const isVpn = connectionType === 'vpn';
  // A Wi-Fi client is always wireless and a LAN table always cabled.
  const lockedMedium = requiredConnectionType(
    sourceNode?.data?.type as HardwareType | undefined,
    targetNode?.data?.type as HardwareType | undefined,
  );
  // The buttons of a cable exist while they can be used. Mounted for every
  // cable all the time, they were most of what the canvas had to lay out.
  const showControls = isHovered || !!selected || radialOpen || settingsOpen;
  const showBadge = showControls || isWireless || isVpn || speed !== '1 GbE' || !!subnet;
  const edgeColor = isVpn
    ? '#14b8a6'
    : isWireless ? WIRELESS_COLORS[wirelessStandard] || '#22d3ee' : SPEED_COLORS[speed] || '#f97316';

  const updateEdgeData = (patch: Record<string, string>) => {
    updateEdge(id, { data: { ...(data || {}), ...patch } });
  };

  const chooseWireless = (standard: string) => {
    updateEdgeData({ connection_type: 'wireless', wireless_standard: standard });
    setRadialOpen(false);
  };

  const chooseVpn = () => {
    updateEdgeData({ connection_type: 'vpn', direction: 'auto' });
    setRadialOpen(false);
  };

  return (
    <g
      onMouseEnter={hover}
      onMouseLeave={unhover}
      className="react-flow__edge-path-selector"
    >
      <path
        d={finalEdgePath}
        fill="none"
        stroke="transparent"
        strokeWidth={24}
        pointerEvents="stroke"
        className="cursor-pointer"
        onAuxClick={evt => {
          evt.preventDefault();
          evt.stopPropagation();
          setRadialOpen(v => !v);
        }}
      />
      {/* The glow of a cable that is selected, or whose device is: a wide,
          faint line under it. A blur filter looked the same and had to be
          worked out again whenever anything near the cable was repainted. */}
      {isHighlighted && (
        <path
          d={finalEdgePath}
          fill="none"
          stroke={edgeColor}
          strokeOpacity={0.2}
          strokeWidth={9}
          strokeLinecap="round"
          strokeLinejoin="round"
          pointerEvents="none"
        />
      )}
      {/* Base tracking line. The wide path above takes the pointer, so React
          Flow's own invisible one is left out of both lines. */}
      <BaseEdge
        id={id}
        path={finalEdgePath}
        interactionWidth={0}
        style={{
          stroke: '#3F3F46',
          strokeWidth: 2,
        }}
      />
      {/* The coloured dashes. They stand still: moving dashes cannot be handed
          to the compositor, so each cable was painted again sixty times a
          second for as long as the canvas was open (pitfall 41). */}
      <BaseEdge
        id={id}
        path={finalEdgePath}
        markerEnd={markerEnd}
        interactionWidth={0}
        className="react-flow__edge-path"
        style={{
          ...customStyle,
          stroke: edgeColor,
          strokeWidth: isHighlighted
            ? Math.max(Number(customStyle?.strokeWidth || 2), isWireless || isVpn ? 4.5 : 3.5)
            : isVpn ? 4 : isWireless ? 3.25 : customStyle?.strokeWidth || 2,
          strokeDasharray: isVpn ? '16 8 2 8' : isWireless ? '0.1 12' : '4 8',
          strokeLinecap: isWireless || isVpn ? 'round' : undefined,
        }}
      />
      {showBadge && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: 'all',
              zIndex: selected || isHovered ? 50 : 10,
            }}
            className="flex flex-col items-center gap-1 nodrag nopan"
            onMouseEnter={hover}
            onMouseLeave={unhover}
            onPointerDown={e => e.stopPropagation()}
          >
            {/* The speed or medium: always on a cable that is not a plain 1 GbE
                one, on any cable while the pointer is on it */}
            <div
              className="px-1.5 py-0.5 rounded text-[9px] font-mono bg-background border"
              style={isWireless || isVpn ? { borderColor: edgeColor, boxShadow: `0 0 10px color-mix(in srgb, ${edgeColor} 32%, transparent)` } : undefined}
            >
              {isVpn ? (
                <span className="font-semibold inline-flex items-center gap-1" style={{ color: edgeColor }}>
                  <LockKeyhole className="size-2.5" /> VPN tunnel
                </span>
              ) : isWireless ? (
                <span className="font-semibold inline-flex items-center gap-1" style={{ color: edgeColor }}>
                  <Wifi className="size-2.5" /> {wirelessStandard}
                </span>
              ) : (
                <span className="text-primary font-semibold">{speed}</span>
              )}
              {subnet && <span className="ml-1 text-muted-foreground">({subnet})</span>}
              {direction !== 'auto' && <span className="ml-1 text-muted-foreground">[{direction}]</span>}
            </div>

            {radialOpen && (
              <div className="edge-radial-menu nodrag nopan" onMouseDown={e => e.stopPropagation()} onPointerDown={e => e.stopPropagation()}>
                <button
                  type="button"
                  className="edge-radial-center"
                  onClick={() => {
                    updateEdgeData({ connection_type: 'ethernet' });
                    setRadialOpen(false);
                  }}
                  title="Cable"
                >
                  <Cable className="size-3.5" />
                </button>
                <button
                  type="button"
                  className="edge-radial-item edge-radial-vpn"
                  style={{
                    transform: 'translate(0px, 88px)',
                    '--wireless-color': '#14b8a6',
                  } as CSSProperties}
                  onClick={chooseVpn}
                  title="Site-to-site VPN"
                >
                  VPN
                </button>
                {WIRELESS_STANDARDS.map((standard, index) => {
                  const angle = (Math.PI * 2 * index) / WIRELESS_STANDARDS.length - Math.PI / 2;
                  return (
                    <button
                      type="button"
                      key={standard}
                      className="edge-radial-item"
                      style={{
                        transform: `translate(${Math.cos(angle) * 58}px, ${Math.sin(angle) * 58}px)`,
                        '--wireless-color': WIRELESS_COLORS[standard],
                      } as CSSProperties}
                      onClick={() => chooseWireless(standard)}
                      title={standard}
                    >
                      {standard.replace('Wi-Fi ', '')}
                    </button>
                  );
                })}
              </div>
            )}

            {showControls && (
              <div className="flex items-center gap-1 pointer-events-auto">
                <Popover open={settingsOpen} onOpenChange={setSettingsOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-6 rounded-full bg-background border transition-all text-muted-foreground hover:text-foreground hover:bg-muted"
                      title="Configure Connection"
                    >
                      <Settings2 className="size-3" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent
                    className="w-60 p-3 nodrag nopan"
                    side="top"
                    align="center"
                    onPointerDown={e => e.stopPropagation()}
                    onClick={e => e.stopPropagation()}
                  >
                    <div className="space-y-3">
                      <div className="space-y-1">
                        <h4 className="font-semibold text-xs text-muted-foreground uppercase tracking-wider">
                          Edge Settings
                        </h4>
                      </div>
                      <div className="space-y-2">
                        <Label className="text-xs">Connection Speed</Label>
                        <Select value={speed} onValueChange={val => updateEdgeData({ speed: val })}>
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue placeholder="Select speed" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="100 MbE">100 MbE</SelectItem>
                            <SelectItem value="1 GbE">1 GbE</SelectItem>
                            <SelectItem value="2.5 GbE">2.5 GbE</SelectItem>
                            <SelectItem value="10 GbE">10 GbE</SelectItem>
                            <SelectItem value="40 GbE">40 GbE</SelectItem>
                            <SelectItem value="100 GbE">100 GbE</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label className="text-xs">Medium</Label>
                        <Select
                          value={connectionType}
                          disabled={!!lockedMedium}
                          onValueChange={val => updateEdgeData({ connection_type: val })}
                        >
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue placeholder="Select medium" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="ethernet">
                              <span className="inline-flex items-center gap-2"><Cable className="size-3" /> Cable</span>
                            </SelectItem>
                            <SelectItem value="wireless">
                              <span className="inline-flex items-center gap-2"><Radio className="size-3" /> Wireless</span>
                            </SelectItem>
                            <SelectItem value="vpn">
                              <span className="inline-flex items-center gap-2"><LockKeyhole className="size-3" /> Site-to-site VPN</span>
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      {isWireless && (
                        <div className="space-y-2">
                          <Label className="text-xs">Wireless Type</Label>
                          <Select value={wirelessStandard} onValueChange={val => updateEdgeData({ wireless_standard: val })}>
                            <SelectTrigger className="h-8 text-xs">
                              <SelectValue placeholder="Select wireless type" />
                            </SelectTrigger>
                            <SelectContent>
                              {WIRELESS_STANDARDS.map(standard => (
                                <SelectItem key={standard} value={standard}>{standard}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      )}
                      <div className="space-y-2">
                        <Label className="text-xs">NAT Direction</Label>
                        <Select value={direction} onValueChange={val => updateEdgeData({ direction: val })}>
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue placeholder="Select direction" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="auto">Auto</SelectItem>
                            <SelectItem value="wan">WAN / Upstream</SelectItem>
                            <SelectItem value="lan">LAN / Downstream</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label className="text-xs">Subnet / VLAN (Optional)</Label>
                        <Input
                          placeholder="e.g. VLAN 10 or 192.168.2.0/24"
                          className="h-8 text-xs"
                          value={subnet}
                          onChange={e => updateEdgeData({ subnet: e.target.value })}
                        />
                      </div>
                    </div>
                  </PopoverContent>
                </Popover>

                <Button
                  variant="ghost"
                  size="icon"
                  className="size-6 rounded-full bg-background border hover:bg-destructive hover:text-destructive-foreground active:scale-95 transition-all text-muted-foreground"
                  onClick={onEdgeClick}
                  title="Delete Connection"
                >
                  <X className="size-3" />
                </Button>
              </div>
            )}
          </div>
        </EdgeLabelRenderer>
      )}
    </g>
  );
}
