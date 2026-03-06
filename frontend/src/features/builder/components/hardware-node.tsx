import { memo, useEffect } from 'react';
import {
  Handle,
  Position,
  useUpdateNodeInternals,
  type NodeProps,
  type IsValidConnection,
} from '@xyflow/react';
import {
  Server,
  Router,
  CircuitBoard,
  HardDrive,
  Wifi,
  Monitor,
  Box,
  Cpu,
  Container,
  Layers,
  Plug,
  Battery,
  AlertTriangle,
} from 'lucide-react';
import { Card } from '../../../components/ui/card';
import { cn } from '../../../lib/utils';
import type { HardwareType, VirtualMachine, HardwareComponent, HardwareSpec } from '../../../types';
import { useBuilderStore, NON_NETWORK_TYPES } from '../store/builder-store';

type HardwareNodeData = {
  label: string;
  type: HardwareType;
  ip?: string;
  vms?: VirtualMachine[];
  internal_components?: HardwareComponent[];
  status?: 'online' | 'offline' | 'warning';
  details?: HardwareSpec;
};

// ─── Per-type icon + color ─────────────────────────────────────────────────────
const TYPE_CONFIG: Partial<
  Record<
    HardwareType,
    { icon: React.ElementType; border: string; bg: string; iconColor: string; color: string }
  >
> = {
  router: {
    icon: Router,
    border: 'border-border',
    bg: 'bg-purple-500',
    iconColor: 'text-purple-400',
    color: '#a855f7',
  },
  switch: {
    icon: CircuitBoard,
    border: 'border-border',
    bg: 'bg-blue-500',
    iconColor: 'text-blue-400',
    color: '#3b82f6',
  },
  server: {
    icon: Server,
    border: 'border-border',
    bg: 'bg-orange-500',
    iconColor: 'text-orange-400',
    color: '#f97316',
  },
  nas: {
    icon: HardDrive,
    border: 'border-border',
    bg: 'bg-green-500',
    iconColor: 'text-green-400',
    color: '#22c55e',
  },
  pc: {
    icon: Monitor,
    border: 'border-border',
    bg: 'bg-cyan-500',
    iconColor: 'text-cyan-400',
    color: '#06b6d4',
  },
  minipc: {
    icon: Monitor,
    border: 'border-border',
    bg: 'bg-sky-500',
    iconColor: 'text-sky-400',
    color: '#0ea5e9',
  },
  sbc: {
    icon: Cpu,
    border: 'border-border',
    bg: 'bg-lime-500',
    iconColor: 'text-lime-400',
    color: '#84cc16',
  },
  access_point: {
    icon: Wifi,
    border: 'border-border',
    bg: 'bg-yellow-500',
    iconColor: 'text-yellow-400',
    color: '#eab308',
  },
  gpu: {
    icon: Layers,
    border: 'border-border',
    bg: 'bg-pink-500',
    iconColor: 'text-pink-400',
    color: '#ec4899',
  },
  hba: {
    icon: Plug,
    border: 'border-border',
    bg: 'bg-indigo-500',
    iconColor: 'text-indigo-400',
    color: '#6366f1',
  },
  disk: {
    icon: HardDrive,
    border: 'border-border',
    bg: 'bg-gray-500',
    iconColor: 'text-gray-400',
    color: '#6b7280',
  },
  ups: {
    icon: Battery,
    border: 'border-border',
    bg: 'bg-emerald-500',
    iconColor: 'text-emerald-400',
    color: '#10b981',
  },
  pcie: {
    icon: Plug,
    border: 'border-border',
    bg: 'bg-violet-500',
    iconColor: 'text-violet-400',
    color: '#8b5cf6',
  },
  pdu: {
    icon: Plug,
    border: 'border-border',
    bg: 'bg-rose-500',
    iconColor: 'text-rose-400',
    color: '#f43f5e',
  },
};
const FALLBACK_CONFIG = {
  icon: Server,
  border: 'border-border',
  bg: 'bg-gray-500',
  iconColor: 'text-gray-400',
  color: '#6b7280',
};

// ─── VM chip ───────────────────────────────────────────────────────────────────
const VM_TYPE_ICON: Record<string, React.ElementType> = {
  vm: Cpu,
  container: Container,
  lxc: Box,
};
const VM_TYPE_COLOR: Record<string, string> = {
  vm: 'bg-orange-500/10 text-orange-400 border-orange-500/30',
  container: 'bg-blue-500/10 text-blue-400 border-blue-500/30',
  lxc: 'bg-green-500/10 text-green-400 border-green-500/30',
};

function VmChip({ vm }: { vm: VirtualMachine }) {
  const Icon = VM_TYPE_ICON[vm.type] ?? Box;
  const colorClass = VM_TYPE_COLOR[vm.type] ?? 'bg-gray-500/10 text-gray-400 border-gray-500/30';

  return (
    <div
      className={cn(
        'flex items-center gap-1.5 rounded border px-1.5 py-1 text-[10px] font-mono',
        colorClass,
      )}
    >
      <Icon className="h-2.5 w-2.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="truncate font-semibold max-w-[80px]" title={vm.name}>
          {vm.name}
        </div>
        <div className={cn('text-[9px]', vm.ip ? 'opacity-90' : 'opacity-40 italic')}>
          {vm.ip || 'no IP'}
        </div>
      </div>
      <div
        className={cn(
          'h-1.5 w-1.5 rounded-full shrink-0',
          vm.status === 'running'
            ? 'bg-green-400'
            : vm.status === 'paused'
              ? 'bg-yellow-400'
              : 'bg-gray-400',
        )}
      />
    </div>
  );
}

function ComponentChip({ component }: { component: HardwareComponent }) {
  const cfg = TYPE_CONFIG[component.type] ?? FALLBACK_CONFIG;
  const Icon = cfg.icon;

  return (
    <div
      className={cn(
        'flex items-center gap-1.5 rounded border px-1.5 py-1 text-[10px] bg-muted/30 border-border/50 text-muted-foreground',
      )}
    >
      <Icon className={cn('h-2.5 w-2.5 shrink-0', cfg.iconColor)} />
      <div className="min-w-0 flex-1">
        <div className="truncate font-semibold max-w-[90px]" title={component.name}>
          {component.name}
        </div>
        {component.details?.model && (
          <div className="text-[9px] opacity-70 truncate">{component.details.model}</div>
        )}
      </div>
    </div>
  );
}

// ─── Main node card ────────────────────────────────────────────────────────────
const COMPUTE_TYPES: HardwareType[] = ['server', 'pc', 'minipc', 'sbc'];
const CONTAINER_STEP = 10; // mirrors ROLE_ZONE step for compute types

export const HardwareNode = memo(({ id, data, selected }: NodeProps) => {
  const nodeData = data as unknown as HardwareNodeData;
  const cfg = TYPE_CONFIG[nodeData.type] ?? FALLBACK_CONFIG;
  const Icon = cfg.icon;
  const vms = nodeData.vms ?? [];
  const components = nodeData.internal_components ?? [];
  const hasVMs = vms.length > 0;
  const hasComponents = components.length > 0;
  const isCompute = COMPUTE_TYPES.includes(nodeData.type);

  const validationIssues = useBuilderStore(s => s.validationIssues);
  const nodeIssues = validationIssues.filter((i: any) => i.node_id === id);
  const hasIpError = nodeIssues.some((i: any) => i.type === 'error');
  const hasIpWarning = nodeIssues.some((i: any) => i.type === 'warning');

  // React flow handles dynamically
  const updateNodeInternals = useUpdateNodeInternals();
  const numPorts =
    nodeData.type === 'switch' || nodeData.type === 'router'
      ? Number(nodeData.details?.ports) || 4
      : 1;

  // Resource calculations
  let usedCpu = 0;
  let usedRam = 0;
  vms.forEach(vm => {
    usedCpu += vm.cpu_cores || 1;
    usedRam += vm.ram_mb || 512;
  });

  const totalCpu = Number(nodeData.details?.cpu) || 0;
  const totalRamGB = Number(nodeData.details?.ram) || 0;
  const totalRamMB = totalRamGB < 1000 ? totalRamGB * 1024 : totalRamGB;

  const cpuWarning = totalCpu > 0 && usedCpu > totalCpu;
  const ramWarning = totalRamMB > 0 && usedRam > totalRamMB;
  const hasResourceWarning = cpuWarning || ramWarning;

  const cpuUsageRatio = totalCpu > 0 ? usedCpu / totalCpu : 0;
  const ramUsageRatio = totalRamMB > 0 ? usedRam / totalRamMB : 0;
  const maxResourceUsage = Math.max(cpuUsageRatio, ramUsageRatio);

  const hasWarning = hasResourceWarning || maxResourceUsage >= 0.8 || hasIpError || hasIpWarning;

  let lightColor = 'bg-green-500';
  let pingColor = 'bg-green-400 animate-ping';

  if (nodeData.status === 'offline') {
    lightColor = 'bg-gray-500';
    pingColor = 'hidden';
  } else if (
    maxResourceUsage >= 1 ||
    hasResourceWarning ||
    nodeIssues.some((i: any) => i.type === 'error')
  ) {
    lightColor = 'bg-red-500';
    pingColor = 'bg-red-400 animate-ping';
  } else if (
    maxResourceUsage >= 0.8 ||
    nodeIssues.some((i: any) => i.type === 'warning') ||
    nodeData.status === 'warning'
  ) {
    lightColor = 'bg-orange-500';
    pingColor = 'bg-orange-400 animate-ping';
  } else if (maxResourceUsage >= 0.6) {
    lightColor = 'bg-yellow-500';
    pingColor = 'bg-yellow-400 animate-ping';
  }

  let tooltipLabel = '';
  if (hasResourceWarning) {
    tooltipLabel += `Resource limit exceeded!\nCPU: ${usedCpu}/${totalCpu}\nRAM: ${Math.round(usedRam / 1024)}GB/${Math.round(totalRamMB / 1024)}GB\n`;
  } else if (maxResourceUsage >= 0.8) {
    tooltipLabel += `High resource usage\nCPU: ${usedCpu}/${totalCpu}\nRAM: ${Math.round(usedRam / 1024)}GB/${Math.round(totalRamMB / 1024)}GB\n`;
  }
  if (nodeIssues.length > 0) {
    tooltipLabel += nodeIssues.map((i: any) => `${i.type.toUpperCase()}: ${i.message}`).join('\n');
  }

  const noSelfLoop: IsValidConnection = connection => connection.source !== connection.target;

  // Count edges connected to this node so updateNodeInternals re-fires when
  // a new connection is made (otherwise new edges render at center-bottom).
  const connectedEdgeCount = useBuilderStore(
    s => s.edges.reduce((n, e) => n + (e.source === id || e.target === id ? 1 : 0), 0),
  );

  // Double-rAF defers the call past ReactFlow's own internal render cycle.
  // useLayoutEffect fires before ReactFlow re-processes its node graph, so it
  // reads stale handle positions on the first change. By waiting two frames
  // we guarantee ReactFlow has settled and getBoundingClientRect is correct.
  useEffect(() => {
    const raf1 = requestAnimationFrame(() => {
      const raf2 = requestAnimationFrame(() => {
        updateNodeInternals(id);
      });
      return () => cancelAnimationFrame(raf2);
    });
    return () => cancelAnimationFrame(raf1);
  }, [id, numPorts, connectedEdgeCount, updateNodeInternals, hasVMs, hasComponents, hasWarning]);

  // Container pool range hint
  const containerRangeHint =
    isCompute && nodeData.ip
      ? (() => {
          const parts = nodeData.ip.split('.');
          const last = parseInt(parts[3] ?? '0', 10);
          const prefix = parts.slice(0, 3).join('.');
          return `${prefix}.${last + 1} – .${last + CONTAINER_STEP - 1}`;
        })()
      : null;

  // Calculate dynamic width for high-port-count switches
  const dynamicMinWidth =
    nodeData.type === 'switch' || nodeData.type === 'router' ? numPorts * 16 : 0;

  return (
    <div className="relative group">
      {/* Animated ring on selection — uses device accent color */}
      {selected && (
        <div
          className="absolute -inset-[4px] -z-10 rounded-[16px] pointer-events-none node-selected-ring"
          style={{ '--node-accent': cfg.color } as React.CSSProperties}
        />
      )}

      <Card
        className={cn(
          'transition-[border-color,box-shadow,background-color,transform,opacity] duration-200 ease-out border shadow-none bg-card overflow-hidden border-t-2',
          hasVMs || hasComponents ? 'w-56' : 'w-48',
          hasResourceWarning || hasIpError
            ? 'border-destructive shadow-[0_0_10px_rgba(239,68,68,0.3)]'
            : maxResourceUsage >= 0.8 || hasIpWarning
              ? 'border-orange-500 shadow-[0_0_10px_rgba(249,115,22,0.3)]'
              : 'border-border',
          hasIpError ? 'bg-destructive/5' : '',
          selected ? 'scale-[1.02]' : 'hover:border-primary/50',
        )}
        style={{
          borderTopColor: cfg.color,
          ...(dynamicMinWidth > 192 ? { minWidth: `${dynamicMinWidth}px` } : {}),
        }}
      >
        {/* Header */}
        <div
          className={cn(
            'px-3 py-2 flex items-center gap-2 border-b border-border bg-card',
            hasResourceWarning || hasIpError
              ? 'bg-destructive/10'
              : maxResourceUsage >= 0.8 || hasIpWarning
                ? 'bg-orange-500/10'
                : selected
                  ? 'bg-primary/5'
                  : '',
          )}
        >
          <Icon className={cn('h-4 w-4 shrink-0', cfg.iconColor)} />
          <span className="font-semibold text-sm truncate flex-1" title={nodeData.label}>
            {nodeData.label}
          </span>

          {hasWarning && (
            <div title={tooltipLabel.trim()}>
              <AlertTriangle
                className={cn(
                  'h-3.5 w-3.5 shrink-0 cursor-help',
                  hasResourceWarning || hasIpError
                    ? 'text-destructive animate-pulse'
                    : 'text-orange-500',
                )}
              />
            </div>
          )}

          <span className="relative flex h-2 w-2 shrink-0">
            <span
              className={cn(
                'absolute inline-flex h-full w-full rounded-full opacity-75',
                pingColor,
              )}
            />
            <span className={cn('relative inline-flex rounded-full h-2 w-2', lightColor)} />
          </span>
        </div>

        {/* Body */}
        {(nodeData.details?.model ||
          !NON_NETWORK_TYPES.includes(nodeData.type) ||
          hasComponents ||
          hasVMs ||
          nodeData.details?.cpu ||
          nodeData.details?.ram) && (
          <div className="p-2.5 bg-card space-y-1.5">
            {/* Model subtitle */}
            {nodeData.details?.model && (
              <p className="text-[9px] text-muted-foreground/70 truncate -mt-0.5">
                {nodeData.details.model}
              </p>
            )}

            {/* IP Address - Only for networked devices */}
            {!NON_NETWORK_TYPES.includes(nodeData.type) && (
              <div className="flex items-center justify-between gap-2 pt-1 px-1">
                <span className="text-[11px] text-muted-foreground tracking-wide font-medium">
                  IP:
                </span>
                <span
                  className={cn(
                    'font-mono text-[12px]',
                    nodeData.ip ? 'text-foreground' : 'italic opacity-40 text-muted-foreground',
                  )}
                >
                  {nodeData.ip || 'unassigned'}
                </span>
              </div>
            )}

            {/* Container pool hint */}
            {containerRangeHint && (
              <div className="flex items-center justify-between gap-2 px-1 opacity-60">
                <span className="text-[11px] text-muted-foreground flex items-center gap-1 font-medium">
                  <Container className="h-2.5 w-2.5" /> Pool:
                </span>
                <span className="font-mono text-[10px] text-blue-400 truncate">
                  {containerRangeHint}
                </span>
              </div>
            )}

            {/* Spec chips */}
            {(nodeData.details?.cpu || nodeData.details?.ram || nodeData.details?.storage) && (
              <div className="flex flex-wrap gap-1 pt-0.5">
                {nodeData.details.cpu && (
                  <span
                    className="text-[9px] bg-muted/60 rounded px-1 py-0.5 truncate max-w-full"
                    title={`${nodeData.details.cpu} Cores`}
                  >
                    {nodeData.details.cpu} Core{Number(nodeData.details.cpu) !== 1 ? 's' : ''}
                  </span>
                )}
                {nodeData.details.ram && (
                  <span
                    className="text-[9px] bg-muted/60 rounded px-1 py-0.5 truncate max-w-full"
                    title={`${nodeData.details.ram} GB RAM`}
                  >
                    {Number(nodeData.details.ram) >= 1000 &&
                    Number(nodeData.details.ram) % 1000 === 0
                      ? `${Number(nodeData.details.ram) / 1000}TB`
                      : `${nodeData.details.ram}GB`}{' '}
                    {nodeData.type === 'gpu' ? 'VRAM' : 'RAM'}
                  </span>
                )}
                {nodeData.details.storage && (
                  <span
                    className="text-[9px] bg-muted/60 rounded px-1 py-0.5 truncate max-w-full"
                    title={`${nodeData.details.storage} GB Storage`}
                  >
                    {Number(nodeData.details.storage) >= 1000 &&
                    Number(nodeData.details.storage) % 1000 === 0
                      ? `${Number(nodeData.details.storage) / 1000}TB`
                      : `${nodeData.details.storage}GB`}{' '}
                    Disk
                  </span>
                )}
              </div>
            )}

            {hasComponents && (
              <div className="space-y-1 pt-2 border-t border-border">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium px-1">
                  Components
                </p>
                <div className="space-y-1">
                  {components.map(comp => (
                    <ComponentChip key={comp.id} component={comp} />
                  ))}
                </div>
              </div>
            )}

            {/* VMs / Containers */}
            {hasVMs && (
              <div className="space-y-1 pt-2 border-t border-border">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium px-1">
                  {vms.length} container{vms.length !== 1 ? 's' : ''}
                </p>
                <div className="space-y-1 max-h-36 overflow-y-auto">
                  {vms.map(vm => (
                    <VmChip key={vm.id} vm={vm} />
                  ))}
                </div>
              </div>
            )}

            {/* Empty compute hint */}
            {isCompute && !hasVMs && !hasComponents && (
              <p className="text-[9px] text-muted-foreground/40 italic text-center py-0.5">
                drop components here
              </p>
            )}
          </div>
        )}
      </Card>

      {/* Target Port (Top, for incoming cables) */}
      <Handle
        type="target"
        position={Position.Top}
        id="target-0"
        isValidConnection={noSelfLoop}
        className="!bg-muted-foreground w-3 h-1.5 !border !border-background !rounded-sm hover:!bg-primary hover:scale-125 transition-all"
      />

      {/* Source Ports (Bottom, for outgoing cables) */}
      {(() => {
        if (nodeData.type === 'switch' || nodeData.type === 'router') {
          const portSpacing = 100 / (numPorts + 1);
          return Array.from({ length: numPorts }).map((_, i) => (
            <Handle
              key={`port-eth${i}`}
              id={`eth${i}`}
              type="source"
              position={Position.Bottom}
              style={{ left: `${portSpacing * (i + 1)}%` }}
              isValidConnection={noSelfLoop}
              className="!bg-muted-foreground w-2 h-2 !border !border-background !rounded-sm hover:!bg-primary hover:scale-125 transition-all"
              title={`eth${i}`}
            />
          ));
        }

        // 1 Port for all other components (servers, PCs, UPS, HBA, GPU)
        return (
          <Handle
            id="eth0"
            type="source"
            position={Position.Bottom}
            isValidConnection={noSelfLoop}
            className="!bg-muted-foreground w-3 h-3 !border-2 !border-background !rounded-sm hover:!bg-primary hover:scale-125 transition-all"
            title="eth0"
          />
        );
      })()}
    </div>
  );
});

HardwareNode.displayName = 'HardwareNode';
