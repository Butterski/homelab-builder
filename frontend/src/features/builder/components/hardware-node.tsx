import { memo, useEffect } from 'react'
import { Handle, Position, useUpdateNodeInternals, type NodeProps } from '@xyflow/react'
import {
    Server, Router, CircuitBoard, HardDrive, Wifi, Monitor,
    Box, Cpu, Container, Layers, Plug, Battery, HardDrive as DiskIcon
} from 'lucide-react'
import { Card } from '../../../components/ui/card'
import { cn } from '../../../lib/utils'
import type { HardwareType, VirtualMachine, HardwareComponent, HardwareSpec } from '../../../types'

type HardwareNodeData = {
    label: string
    type: HardwareType
    ip?: string
    vms?: VirtualMachine[]
    internal_components?: HardwareComponent[]
    status?: 'online' | 'offline' | 'warning'
    details?: HardwareSpec
}

// ─── Per-type icon + color ─────────────────────────────────────────────────────
const TYPE_CONFIG: Partial<Record<HardwareType, { icon: React.ElementType; border: string; bg: string; iconColor: string }>> = {
    router:       { icon: Router,      border: 'border-purple-500',  bg: 'bg-purple-500/10',  iconColor: 'text-purple-400' },
    switch:       { icon: CircuitBoard,border: 'border-blue-500',    bg: 'bg-blue-500/10',    iconColor: 'text-blue-400' },
    server:       { icon: Server,      border: 'border-orange-500',  bg: 'bg-orange-500/10',  iconColor: 'text-orange-400' },
    nas:          { icon: HardDrive,   border: 'border-green-500',   bg: 'bg-green-500/10',   iconColor: 'text-green-400' },
    pc:           { icon: Monitor,     border: 'border-cyan-500',    bg: 'bg-cyan-500/10',    iconColor: 'text-cyan-400' },
    minipc:       { icon: Monitor,     border: 'border-sky-500',     bg: 'bg-sky-500/10',     iconColor: 'text-sky-400' },
    sbc:          { icon: Cpu,         border: 'border-lime-500',    bg: 'bg-lime-500/10',    iconColor: 'text-lime-400' },
    access_point: { icon: Wifi,        border: 'border-yellow-500',  bg: 'bg-yellow-500/10',  iconColor: 'text-yellow-400' },
    gpu:          { icon: Layers,      border: 'border-pink-500',    bg: 'bg-pink-500/10',    iconColor: 'text-pink-400' },
    hba:          { icon: Plug,        border: 'border-indigo-500',  bg: 'bg-indigo-500/10',  iconColor: 'text-indigo-400' },
    disk:         { icon: DiskIcon,    border: 'border-gray-500',    bg: 'bg-gray-500/10',    iconColor: 'text-gray-400' },
    ups:          { icon: Battery,     border: 'border-emerald-500', bg: 'bg-emerald-500/10', iconColor: 'text-emerald-400' },
    pcie:         { icon: Plug,        border: 'border-violet-500',  bg: 'bg-violet-500/10',  iconColor: 'text-violet-400' },
    pdu:          { icon: Plug,        border: 'border-rose-500',    bg: 'bg-rose-500/10',    iconColor: 'text-rose-400' },
}
const FALLBACK_CONFIG = { icon: Server, border: 'border-gray-500', bg: 'bg-gray-500/10', iconColor: 'text-gray-400' }
const NON_NETWORK_TYPES: HardwareType[] = ['disk', 'gpu', 'hba', 'pcie', 'pdu', 'ups']

// ─── VM chip ───────────────────────────────────────────────────────────────────
const VM_TYPE_ICON: Record<string, React.ElementType> = {
    vm:        Cpu,
    container: Container,
    lxc:       Box,
}
const VM_TYPE_COLOR: Record<string, string> = {
    vm:        'bg-orange-500/10 text-orange-400 border-orange-500/30',
    container: 'bg-blue-500/10 text-blue-400 border-blue-500/30',
    lxc:       'bg-green-500/10 text-green-400 border-green-500/30',
}

function VmChip({ vm }: { vm: VirtualMachine }) {
    const Icon = VM_TYPE_ICON[vm.type] ?? Box
    const colorClass = VM_TYPE_COLOR[vm.type] ?? 'bg-gray-500/10 text-gray-400 border-gray-500/30'

    return (
        <div className={cn(
            'flex items-center gap-1.5 rounded border px-1.5 py-1 text-[10px] font-mono',
            colorClass
        )}>
            <Icon className="h-2.5 w-2.5 shrink-0" />
            <div className="min-w-0 flex-1">
                <div className="truncate font-semibold max-w-[80px]" title={vm.name}>{vm.name}</div>
                <div className={cn(
                    'text-[9px]',
                    vm.ip ? 'opacity-90' : 'opacity-40 italic'
                )}>
                    {vm.ip || 'no IP'}
                </div>
            </div>
            <div className={cn(
                'h-1.5 w-1.5 rounded-full shrink-0',
                vm.status === 'running' ? 'bg-green-400' :
                vm.status === 'paused'  ? 'bg-yellow-400' : 'bg-gray-400'
            )} />
        </div>
    )
}

function ComponentChip({ component }: { component: HardwareComponent }) {
    const cfg = TYPE_CONFIG[component.type] ?? FALLBACK_CONFIG
    const Icon = cfg.icon

    return (
        <div className={cn(
            'flex items-center gap-1.5 rounded border px-1.5 py-1 text-[10px] bg-muted/30 border-border/50 text-muted-foreground'
        )}>
            <Icon className={cn('h-2.5 w-2.5 shrink-0', cfg.iconColor)} />
            <div className="min-w-0 flex-1">
                <div className="truncate font-semibold max-w-[90px]" title={component.name}>{component.name}</div>
                {component.details?.model && (
                    <div className="text-[9px] opacity-70 truncate">{component.details.model}</div>
                )}
            </div>
        </div>
    )
}

// ─── Main node card ────────────────────────────────────────────────────────────
const COMPUTE_TYPES: HardwareType[] = ['server', 'pc', 'minipc', 'sbc']
const CONTAINER_STEP = 10  // mirrors ROLE_ZONE step for compute types

export const HardwareNode = memo(({ id, data, selected }: NodeProps) => {
    const nodeData = data as unknown as HardwareNodeData
    const cfg = TYPE_CONFIG[nodeData.type] ?? FALLBACK_CONFIG
    const Icon = cfg.icon
    const vms = nodeData.vms ?? []
    const components = nodeData.internal_components ?? []
    const hasVMs = vms.length > 0
    const hasComponents = components.length > 0
    const isCompute = COMPUTE_TYPES.includes(nodeData.type)

    // React flow handles dynamically
    const updateNodeInternals = useUpdateNodeInternals()
    const numPorts = (nodeData.type === 'switch' || nodeData.type === 'router') 
        ? (Number(nodeData.details?.ports) || 4) 
        : 1;

    useEffect(() => {
        updateNodeInternals(id)
    }, [id, numPorts, updateNodeInternals, hasVMs, hasComponents])

    // Container pool range hint
    const containerRangeHint = isCompute && nodeData.ip
        ? (() => {
            const parts = nodeData.ip.split('.')
            const last = parseInt(parts[3] ?? '0', 10)
            const prefix = parts.slice(0, 3).join('.')
            return `${prefix}.${last + 1} – .${last + CONTAINER_STEP - 1}`
          })()
        : null

    // Calculate dynamic width for high-port-count switches
    const dynamicMinWidth = (nodeData.type === 'switch' || nodeData.type === 'router') ? (numPorts * 16) : 0;

    return (
        <div className="relative group">
            <Card 
                className={cn(
                    'transition-all duration-200 border-2 overflow-hidden shadow-sm',
                    (hasVMs || hasComponents) ? 'w-56' : 'w-48',
                    cfg.border, cfg.bg,
                    selected ? 'ring-2 ring-primary shadow-lg scale-105' : 'hover:border-primary/50'
                )}
                style={dynamicMinWidth > 192 ? { minWidth: `${dynamicMinWidth}px` } : undefined}
            >
                {/* Header */}
                <div className={cn(
                    'px-3 py-2 flex items-center gap-2 border-b bg-background/50 backdrop-blur-sm',
                    selected ? 'bg-primary/5' : ''
                )}>
                    <Icon className={cn('h-4 w-4 shrink-0', cfg.iconColor)} />
                    <span className="font-semibold text-sm truncate flex-1" title={nodeData.label}>
                        {nodeData.label}
                    </span>
                    <span className="relative flex h-2 w-2 shrink-0">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
                    </span>
                </div>

                {/* Body */}
                {(nodeData.details?.model || !NON_NETWORK_TYPES.includes(nodeData.type) || hasComponents || hasVMs || nodeData.details?.cpu || nodeData.details?.ram) && (
                    <div className="p-2.5 bg-background/80 backdrop-blur-sm space-y-1.5">
                        {/* Model subtitle */}
                        {nodeData.details?.model && (
                            <p className="text-[9px] text-muted-foreground/70 truncate -mt-0.5">{nodeData.details.model}</p>
                        )}

                        {/* IP Address - Only for networked devices */}
                        {!NON_NETWORK_TYPES.includes(nodeData.type) && (
                            <div className="text-xs font-mono flex items-center justify-between gap-2">
                                <span className="text-muted-foreground shrink-0">IP</span>
                                <span className={cn(
                                    'truncate',
                                    nodeData.ip ? 'text-foreground font-medium' : 'italic opacity-40 text-muted-foreground'
                                )}>
                                    {nodeData.ip || 'unassigned'}
                                </span>
                            </div>
                        )}

                        {/* Container pool hint */}
                        {containerRangeHint && (
                            <div className="text-[10px] font-mono flex items-center justify-between gap-2 opacity-60">
                                <span className="text-muted-foreground shrink-0 flex items-center gap-1">
                                    <Container className="h-2.5 w-2.5" /> pool
                                </span>
                                <span className="truncate text-blue-400">{containerRangeHint}</span>
                            </div>
                        )}

                        {/* Spec chips */}
                        {(nodeData.details?.cpu || nodeData.details?.ram || nodeData.details?.storage) && (
                            <div className="flex flex-wrap gap-1 pt-0.5">
                                {nodeData.details.cpu && (
                                    <span className="text-[9px] bg-muted/60 rounded px-1 py-0.5 truncate max-w-full" title={nodeData.details.cpu.toString()}>{nodeData.details.cpu}</span>
                                )}
                                {nodeData.details.ram && (
                                    <span className="text-[9px] bg-muted/60 rounded px-1 py-0.5">{nodeData.details.ram} {nodeData.type === 'gpu' ? 'VRAM' : ''}</span>
                                )}
                                {nodeData.details.storage && (
                                    <span className="text-[9px] bg-muted/60 rounded px-1 py-0.5">{nodeData.details.storage}</span>
                                )}
                            </div>
                        )}

                        {hasComponents && (
                            <div className="space-y-1 pt-1.5 border-t border-border/50">
                                <p className="text-[9px] uppercase tracking-wider text-muted-foreground font-semibold">
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
                            <div className="space-y-1 pt-1.5 border-t border-border/50">
                                <p className="text-[9px] uppercase tracking-wider text-muted-foreground font-semibold">
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
                className="!bg-muted-foreground w-3 h-1.5 !border !border-background !rounded-sm hover:!bg-primary hover:scale-125 transition-all"
            />

            {/* Source Ports (Bottom, for outgoing cables) */}
            {(() => {
                if (nodeData.type === 'switch' || nodeData.type === 'router') {
                    const portSpacing = 100 / (numPorts + 1);
                    return Array.from({ length: numPorts }).map((_, i) => (
                        <Handle
                            key={`port-${numPorts}-${i}`}
                            id={`eth${i}`}
                            type="source"
                            position={Position.Bottom}
                            style={{ left: `${portSpacing * (i + 1)}%` }}
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
                        className="!bg-muted-foreground w-3 h-3 !border-2 !border-background !rounded-sm hover:!bg-primary hover:scale-125 transition-all"
                        title="eth0"
                    />
                );
            })()}
        </div>
    )
})

HardwareNode.displayName = 'HardwareNode'
