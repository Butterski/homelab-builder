import { memo, useEffect } from 'react';
import { Handle, Position, useUpdateNodeInternals, type NodeProps } from '@xyflow/react';
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
  Printer,
  Globe,
  Shield,
  Cloud,
  Network,
} from 'lucide-react';
import { Card } from '../../../components/ui/card';
import { cn } from '../../../lib/utils';
import type {
  HardwareType,
  VirtualMachine,
  HardwareComponent,
  HardwareSpec,
  HardwareNodeValidationIssue,
} from '../../../types';
import { isComputeNode, nodeHasDynamicPorts, isNetworkNode } from '../../../lib/hardware-config';
import { useBuilderStore } from '../store/builder-store';
import { getVmResourceUsage } from '../lib/resource-usage';
import { getNodePortCount } from '../lib/port-count';

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
  server_v2: {
    icon: Server,
    border: 'border-border',
    bg: 'bg-orange-500',
    iconColor: 'text-orange-400',
    color: '#f97316',
  },
  firewall: {
    icon: Shield,
    border: 'border-border',
    bg: 'bg-red-500',
    iconColor: 'text-red-400',
    color: '#ef4444',
  },
  vps: {
    icon: Cloud,
    border: 'border-border',
    bg: 'bg-sky-500',
    iconColor: 'text-sky-400',
    color: '#38bdf8',
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
  iot: {
    icon: Printer,
    border: 'border-border',
    bg: 'bg-yellow-600',
    iconColor: 'text-yellow-600',
    color: '#ca8a04',
  },
  modem: {
    icon: Globe,
    border: 'border-border',
    bg: 'bg-blue-600',
    iconColor: 'text-blue-600',
    color: '#2563eb',
  },
  rack: {
    icon: Server,
    border: 'border-border',
    bg: 'bg-violet-600',
    iconColor: 'text-violet-400',
    color: '#7c3aed',
  },
};
const FALLBACK_CONFIG = {
  icon: Server,
  border: 'border-border',
  bg: 'bg-gray-500',
  iconColor: 'text-gray-400',
  color: '#6b7280',
};

const TYPE_LABEL: Record<HardwareType, string> = {
  router: 'Gateway',
  switch: 'Switch',
  nas: 'Storage',
  server: 'Legacy Server',
  server_v2: 'Server',
  firewall: 'Firewall',
  vps: 'VPS',
  pc: 'Workstation',
  access_point: 'Wi-Fi',
  disk: 'Disk',
  gpu: 'GPU',
  hba: 'HBA',
  pcie: 'PCIe',
  ups: 'Power',
  pdu: 'PDU',
  sbc: 'SBC',
  minipc: 'Mini PC',
  iot: 'IoT',
  modem: 'Modem',
  rack: 'Rack',
};

function formatCapacity(value: HardwareSpec['ram'] | HardwareSpec['storage']) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return `${value}`;
  if (numeric >= 1000 && numeric % 1000 === 0) return `${numeric / 1000}TB`;
  return `${numeric}GB`;
}

function formatPercent(value: number) {
  return `${Math.min(999, Math.round(value * 100))}%`;
}

function clampPercent(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value * 100)));
}

function humanizeNodeLabel(label: string) {
  return label
    .replace(/_/g, ' ')
    .replace(/\b(minipc)\b/gi, 'Mini PC')
    .replace(/\b(sbc|nas|ups|pdu|hba|gpu|pc|iot)\b/gi, match => match.toUpperCase())
    .replace(/\b\w/g, char => char.toUpperCase());
}

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
        'node-vm-row flex items-center gap-2 rounded border px-2 py-1.5 text-[10px] font-mono',
        colorClass,
      )}
    >
      <div className="node-vm-icon">
        <Icon className="size-3 shrink-0" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate font-semibold max-w-28" title={vm.name}>
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
        'node-component-row flex items-center gap-2 rounded border px-2 py-1.5 text-[10px] bg-muted/30 border-border/50 text-muted-foreground',
      )}
    >
      <span className="node-component-icon">
        <Icon className={cn('size-3 shrink-0', cfg.iconColor)} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate font-semibold max-w-32" title={component.name}>
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
const CONTAINER_STEP = 10; // mirrors ROLE_ZONE step for compute types
const POOL_HINT_NODE_TYPES: HardwareType[] = ['server', 'server_v2', 'vps', 'pc', 'minipc', 'sbc', 'nas'];

export const HardwareNode = memo(({ id, data, selected }: NodeProps) => {
  const nodeData = data as unknown as HardwareNodeData;
  const details = nodeData.details ?? {};
  const displayLabel = humanizeNodeLabel(nodeData.label);
  const cfg = TYPE_CONFIG[nodeData.type] ?? FALLBACK_CONFIG;
  const Icon = cfg.icon;
  const vms = nodeData.vms ?? [];
  const components = nodeData.internal_components ?? [];
  const hasVMs = vms.length > 0;
  const hasComponents = components.length > 0;
  const isCompute = isComputeNode(nodeData.type);
  const isLegacyServer = nodeData.type === 'server';
  const isNewServer = nodeData.type === 'server_v2';
  const natEnabled = !!details.nat_enabled;
  const firewallEnabled = nodeData.type === 'firewall' || !!details.firewall_enabled;
  const routingEnabled = !!details.routing_enabled;
  const networkZone = details.network_zone;
  const interfaces = Array.isArray(details.interfaces) ? details.interfaces : [];
  const wanInterface = interfaces.find(iface => iface?.role === 'wan');
  const lanInterface = interfaces.find(iface => iface?.role === 'lan');
  const wanIP = details.wan_ip || wanInterface?.ip || nodeData.ip;
  const lanGatewayIP = details.lan_gateway_ip || lanInterface?.ip;
  const lanSubnet = details.lan_subnet || lanInterface?.subnet;
  const isDualHomedGateway = !!(natEnabled || routingEnabled) && !!lanGatewayIP;

  const validationIssues = useBuilderStore(s => s.validationIssues);
  const nodeIssues = validationIssues.filter((i: HardwareNodeValidationIssue) => i.node_id === id);
  const hasIpError = nodeIssues.some((i: HardwareNodeValidationIssue) => i.type === 'error');
  const hasIpWarning = nodeIssues.some((i: HardwareNodeValidationIssue) => i.type === 'warning');

  // React flow handles dynamically
  const updateNodeInternals = useUpdateNodeInternals();
  const numPorts = nodeHasDynamicPorts(nodeData.type)
      ? Math.max(1, getNodePortCount(nodeData.type, nodeData.details?.ports))
      : 1;

  // Resource calculations
  const { cpu: usedCpu, ramMb: usedRam } = getVmResourceUsage(vms);

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
  let pingColor = 'hidden';

  if (nodeData.status === 'offline') {
    lightColor = 'bg-gray-500';
    pingColor = 'hidden';
  } else if (
    maxResourceUsage >= 1 ||
    hasResourceWarning ||
    nodeIssues.some((i: HardwareNodeValidationIssue) => i.type === 'error')
  ) {
    lightColor = 'bg-red-500';
    pingColor = 'bg-red-400 animate-ping';
  } else if (
    maxResourceUsage >= 0.8 ||
    nodeIssues.some((i: HardwareNodeValidationIssue) => i.type === 'warning') ||
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
    tooltipLabel += nodeIssues
      .map((i: HardwareNodeValidationIssue) => `${i.type.toUpperCase()}: ${i.message}`)
      .join('\n');
  }

  // Count edges connected to this node so updateNodeInternals re-fires when
  // a new connection is made (otherwise new edges render at center-bottom).
  const connectedEdgeCount = useBuilderStore(s =>
    s.edges.reduce((n, e) => n + (e.source === id || e.target === id ? 1 : 0), 0),
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
  const poolBaseIP = isDualHomedGateway && lanGatewayIP ? lanGatewayIP : nodeData.ip;
  const containerRangeHint =
    isCompute && poolBaseIP && POOL_HINT_NODE_TYPES.includes(nodeData.type)
      ? (() => {
          const parts = poolBaseIP.split('.');
          const last = parseInt(parts[3] ?? '0', 10);
          const prefix = parts.slice(0, 3).join('.');
          return `${prefix}.${last + 1}-${last + CONTAINER_STEP - 1}`;
        })()
      : null;

  // Calculate dynamic width for high-port-count switches/routers/etc
  const dynamicMinWidth = nodeHasDynamicPorts(nodeData.type) ? numPorts * 16 : 0;
  const shouldShowBody =
    nodeData.details?.model ||
    !isNetworkNode(nodeData.type) ||
    hasComponents ||
    hasVMs ||
    nodeData.details?.cpu ||
    nodeData.details?.ram ||
    nodeData.details?.storage ||
    (isNetworkNode(nodeData.type) && !!nodeData.ip);

  const hasSpecs = !!(
    nodeData.details?.cpu ||
    nodeData.details?.ram ||
    nodeData.details?.storage ||
    nodeData.details?.ports
  );
  const showResourceBars = isCompute && hasVMs && (totalCpu > 0 || totalRamMB > 0);
  const cpuPercent = clampPercent(cpuUsageRatio);
  const ramPercent = clampPercent(ramUsageRatio);

  return (
    <div
      className="hardware-node-shell relative group"
      style={{ '--node-accent': cfg.color } as React.CSSProperties}
    >
      {/* Animated ring on selection - uses device accent color */}
      {selected && (
        <div
          className="absolute -inset-1 -z-10 rounded-xl pointer-events-none node-selected-ring"
          style={{ '--node-accent': cfg.color } as React.CSSProperties}
        />
      )}

      <Card
        className={cn(
          'hardware-node-card transition-[border-color,box-shadow,background-color,transform,opacity] duration-200 ease-out overflow-hidden',
          hasVMs || hasComponents ? 'w-[15.25rem]' : 'w-[13.75rem]',
          hasResourceWarning || hasIpError
            ? 'hardware-node-danger border-destructive'
            : maxResourceUsage >= 0.8 || hasIpWarning
              ? 'hardware-node-warning border-orange-500'
              : '',
          selected ? 'scale-[1.015]' : '',
          natEnabled ? 'hardware-node-nat' : '',
          firewallEnabled ? 'hardware-node-firewall' : '',
          nodeData.type === 'vps' ? 'hardware-node-cloud' : '',
        )}
        style={{
          '--node-accent': cfg.color,
          ...(dynamicMinWidth > 192 ? { minWidth: `${dynamicMinWidth}px` } : {}),
        } as React.CSSProperties}
      >
        <div className="node-accent-rail" />

        {/* Header */}
        <div
          className={cn(
            'node-header px-3 py-2.5 flex items-center gap-2.5 border-b border-border/70',
            hasResourceWarning || hasIpError ? 'node-header-danger' : '',
            maxResourceUsage >= 0.8 || hasIpWarning ? 'node-header-warning' : '',
          )}
        >
          <div className="node-icon-plate">
            <Icon className={cn('size-4 shrink-0', cfg.iconColor)} />
          </div>
          <div className="min-w-0 flex-1">
            <span className="font-semibold text-sm truncate block leading-tight" title={displayLabel}>
              {displayLabel}
            </span>
            <div className="flex items-center gap-1.5 pt-0.5">
              <span className="node-type-pill">{TYPE_LABEL[nodeData.type] ?? nodeData.type}</span>
              {isLegacyServer && <span className="node-legacy-pill">Legacy</span>}
              {nodeHasDynamicPorts(nodeData.type) && (
                <span className="node-port-count">{numPorts} ports</span>
              )}
            </div>
          </div>

          {hasWarning && (
            <div title={tooltipLabel.trim()}>
              <AlertTriangle
                className={cn(
                  'size-3.5 shrink-0 cursor-help',
                  hasResourceWarning || hasIpError
                    ? 'text-destructive animate-pulse'
                    : 'text-orange-500',
                )}
              />
            </div>
          )}

          <span className="relative flex size-2.5 shrink-0" title={nodeData.status ?? 'online'}>
            <span
              className={cn(
                'absolute inline-flex h-full w-full rounded-full opacity-75',
                pingColor,
              )}
            />
            <span className={cn('relative inline-flex rounded-full size-2.5 node-status-led', lightColor)} />
          </span>
        </div>

        {/* Body */}
        {shouldShowBody && (
          <div className="node-body p-3 space-y-2.5">
            {/* Model subtitle */}
            {nodeData.details?.model && (
              <p className="node-model text-[10px] text-muted-foreground/80 truncate -mt-0.5">
                {nodeData.details.model}
              </p>
            )}

            {(isNetworkNode(nodeData.type) || containerRangeHint) && (
              <div className="node-telemetry-grid">
                {isNetworkNode(nodeData.type) && (
                  <div className="node-telemetry-cell">
                    <span className="node-telemetry-label">{isDualHomedGateway ? 'WAN:' : 'IP:'}</span>
                    <span
                      className={cn(
                        'node-telemetry-value font-mono',
                        wanIP ? 'text-foreground' : 'italic opacity-45 text-muted-foreground',
                      )}
                    >
                      {wanIP || 'unassigned'}
                    </span>
                  </div>
                )}

                {isDualHomedGateway && (
                  <div className="node-telemetry-cell">
                    <span className="node-telemetry-label">LAN GW:</span>
                    <span className="node-telemetry-value font-mono text-emerald-300 truncate">
                      {lanGatewayIP}
                    </span>
                  </div>
                )}

                {isDualHomedGateway && lanSubnet && (
                  <div className="node-telemetry-cell">
                    <span className="node-telemetry-label">LAN:</span>
                    <span className="node-telemetry-value font-mono text-emerald-300 truncate">
                      {lanSubnet}
                    </span>
                  </div>
                )}

                {containerRangeHint && (
                  <div className="node-telemetry-cell">
                    <span className="node-telemetry-label flex items-center gap-1">
                      <Container className="size-2.5" /> Pool:
                    </span>
                    <span className="node-telemetry-value font-mono text-sky-300 truncate">
                      {containerRangeHint}
                    </span>
                  </div>
                )}
                {(natEnabled || firewallEnabled || routingEnabled || networkZone) && (
                  <div className="node-telemetry-cell node-net-role-cell">
                    <span className="node-telemetry-label flex items-center gap-1">
                      <Network className="size-2.5" /> Role:
                    </span>
                    <span className="node-telemetry-value node-role-list">
                      {networkZone && <span>{String(networkZone).toUpperCase()}</span>}
                      {natEnabled && <span>NAT</span>}
                      {firewallEnabled && <span>FW</span>}
                      {routingEnabled && <span>ROUTE</span>}
                    </span>
                  </div>
                )}
                {nodeData.type === 'vps' && (details.public_ip || details.provider) && (
                  <div className="node-telemetry-cell">
                    <span className="node-telemetry-label flex items-center gap-1">
                      <Cloud className="size-2.5" /> Cloud:
                    </span>
                    <span className="node-telemetry-value font-mono text-sky-300 truncate">
                      {details.public_ip || `${details.provider ?? 'cloud'} ${details.region ?? ''}`.trim()}
                    </span>
                  </div>
                )}
              </div>
            )}

            {isNewServer && (
              <div className="node-capability-strip">
                {details.hypervisor_enabled && <span>Hypervisor</span>}
                {details.app_host_enabled && <span>Apps</span>}
                {details.storage_enabled && <span>Storage</span>}
                {routingEnabled && <span>Router</span>}
                {natEnabled && <span>NAT</span>}
                {firewallEnabled && <span>Firewall</span>}
              </div>
            )}

            {/* Spec chips */}
            {hasSpecs && (
              <div className="node-spec-grid">
                {details.cpu && (
                  <span
                    className="node-spec-chip"
                    title={`${details.cpu} Cores`}
                  >
                    <Cpu className="size-2.5" />
                    {details.cpu} Core{Number(details.cpu) !== 1 ? 's' : ''}
                  </span>
                )}
                {details.ram && (
                  <span
                    className="node-spec-chip"
                    title={`${details.ram} GB RAM`}
                  >
                    <Layers className="size-2.5" />
                    {formatCapacity(details.ram)}{' '}
                    {nodeData.type === 'gpu' ? 'VRAM' : 'RAM'}
                  </span>
                )}
                {details.storage && (
                  <span
                    className="node-spec-chip"
                    title={`${details.storage} GB Storage`}
                  >
                    <HardDrive className="size-2.5" />
                    {formatCapacity(details.storage)}{' '}
                    Disk
                  </span>
                )}
                {details.ports && (
                  <span className="node-spec-chip" title={`${details.ports} ports`}>
                    <Plug className="size-2.5" />
                    {details.ports} Ports
                  </span>
                )}
              </div>
            )}

            {showResourceBars && (
              <div className="node-resource-panel">
                {totalCpu > 0 && (
                  <div className="node-resource-row">
                    <div className="flex items-center justify-between">
                      <span>CPU</span>
                      <span className={cpuWarning ? 'text-red-300' : ''}>
                        {usedCpu}/{totalCpu} - {formatPercent(cpuUsageRatio)}
                      </span>
                    </div>
                    <div className="node-resource-track">
                      <div
                        className={cn('node-resource-bar', cpuWarning ? 'node-resource-over' : '')}
                        style={{ width: `${cpuPercent}%` }}
                      />
                    </div>
                  </div>
                )}
                {totalRamMB > 0 && (
                  <div className="node-resource-row">
                    <div className="flex items-center justify-between">
                      <span>RAM</span>
                      <span className={ramWarning ? 'text-red-300' : ''}>
                        {Math.round(usedRam / 1024)}GB/{Math.round(totalRamMB / 1024)}GB -{' '}
                        {formatPercent(ramUsageRatio)}
                      </span>
                    </div>
                    <div className="node-resource-track">
                      <div
                        className={cn('node-resource-bar', ramWarning ? 'node-resource-over' : '')}
                        style={{ width: `${ramPercent}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>
            )}

            {hasComponents && (
              <div className="node-section space-y-1.5 pt-2 border-t border-border/70">
                <p className="node-section-title">
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
              <div className="node-section space-y-1.5 pt-2 border-t border-border/70">
                <p className="node-section-title">
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
              <p className="node-empty-hint text-[9px] text-muted-foreground/45 italic text-center py-1">
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
        className="node-flow-handle node-flow-handle-target bg-muted-foreground! w-3 h-1.5 border! border-background! rounded-sm! hover:scale-125 transition-all"
      />

      {/* Source Ports (Bottom, for outgoing cables) */}
      {nodeHasDynamicPorts(nodeData.type) ? (
        (() => {
          const portSpacing = 100 / (numPorts + 1);
          return Array.from({ length: numPorts }).map((_, i) => (
            <Handle
              key={`port-eth${i}`}
              id={`eth${i}`}
              type="source"
              position={Position.Bottom}
              style={{ left: `${portSpacing * (i + 1)}%` }}
              className="node-flow-handle bg-muted-foreground! size-2 border! border-background! rounded-sm! hover:scale-125 transition-all"
              title={`eth${i}`}
            />
          ));
        })()
      ) : (
        // 1 Port for all other components (servers, PCs, UPS, HBA, GPU)
        <Handle
          id="eth0"
          type="source"
          position={Position.Bottom}
          className="node-flow-handle bg-muted-foreground! size-3 border-2! border-background! rounded-sm! hover:scale-125 transition-all"
          title="eth0"
        />
      )}
    </div>
  );
});

HardwareNode.displayName = 'HardwareNode';
