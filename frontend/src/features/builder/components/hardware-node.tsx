import { memo, useEffect } from 'react'
import { Handle, Position, useUpdateNodeInternals, type NodeProps } from '@xyflow/react'
import {
    Server, Router, CircuitBoard, HardDrive, Wifi, Monitor,
    Box, Cpu, Container, Layers, Plug, Battery, AlertTriangle
} from 'lucide-react'
import { Card } from '../../../components/ui/card'
import { cn } from '../../../lib/utils'
import type { HardwareType, VirtualMachine, HardwareComponent, HardwareSpec } from '../../../types'
import { useBuilderStore, NON_NETWORK_TYPES } from '../store/builder-store'

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
    disk:         { icon: HardDrive,  border: 'border-gray-500',    bg: 'bg-gray-500/10',    iconColor: 'text-gray-400' },
    ups:          { icon: Battery,     border: 'border-emerald-500', bg: 'bg-emerald-500/10', iconColor: 'text-emerald-400' },
    pcie:         { icon: Plug,        border: 'border-violet-500',  bg: 'bg-violet-500/10',  iconColor: 'text-violet-400' },
    pdu:          { icon: Plug,        border: 'border-rose-500',    bg: 'bg-rose-500/10',    iconColor: 'text-rose-400' },
}
const FALLBACK_CONFIG = { icon: Server, border: 'border-gray-500', bg: 'bg-gray-500/10', iconColor: 'text-gray-400' }

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

    const validationIssues = useBuilderStore(s => s.validationIssues)
    const nodeIssues = validationIssues.filter((i: any) => i.node_id === id)
    const hasIpError = nodeIssues.some((i: any) => i.type === 'error')
    const hasIpWarning = nodeIssues.some((i: any) => i.type === 'warning')

    // React flow handles dynamically
    const updateNodeInternals = useUpdateNodeInternals()
    const numPorts = (nodeData.type === 'switch' || nodeData.type === 'router') 
        ? (Number(nodeData.details?.ports) || 4) 
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
    const hasWarning = hasResourceWarning || hasIpError || hasIpWarning;

    let tooltipLabel = '';
    if (hasResourceWarning) {
        tooltipLabel += `Resource limit exceeded!\nCPU: ${usedCpu}/${totalCpu}\nRAM: ${Math.round(usedRam/1024)}GB/${Math.round(totalRamMB/1024)}GB\n`;
    }
    if (nodeIssues.length > 0) {
        tooltipLabel += nodeIssues.map((i: any) => (`${i.type.toUpperCase()}: ${i.message}`)).join('\n');
    }

    useEffect(() => {
        updateNodeInternals(id)
    }, [id, numPorts, updateNodeInternals, hasVMs, hasComponents, hasWarning])

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
            {/* Spotlight Effect for selected nodes */}
            {selected && (
                <div className={cn("absolute -inset-16 -z-10 rounded-full blur-3xl opacity-20 pointer-events-none", cfg.bg.replace('/10', ''))} />
            )}
            
            <Card 
                className={cn(
                    'transition-all duration-200 border shadow-none bg-card overflow-hidden',
                    (hasVMs || hasComponents) ? 'w-56' : 'w-48',
                    hasWarning ? 'border-destructive' : 'border-border',
                    hasIpError ? 'border-destructive bg-destructive/5' : '',
                    selected ? 'border-primary scale-[1.02]' : 'hover:border-primary/50'
                )}
                style={dynamicMinWidth > 192 ? { minWidth: `${dynamicMinWidth}px` } : undefined}
            >
                {/* Thin top colored indicator line */}
                <div className={cn("absolute top-0 left-0 right-0 h-[2px]", cfg.bg.replace('/10', ''))} />

                {/* Header */}
                <div className={cn(
                    'px-3 py-2 flex items-center gap-2 border-b border-border bg-background/50 backdrop-blur-sm',
                    hasWarning ? 'bg-destructive/10' : (selected ? 'bg-primary/5' : '')
                )}>
                    <Icon className={cn('h-4 w-4 shrink-0', cfg.iconColor)} />
                    <span className="font-semibold text-sm truncate flex-1" title={nodeData.label}>
                        {nodeData.label}
                    </span>
                    
                    {hasWarning && (
                        <div title={tooltipLabel.trim()}>
                            <AlertTriangle className={cn("h-3.5 w-3.5 shrink-0 cursor-help", hasIpError ? "text-destructive animate-pulse" : "text-yellow-500")} />
                        </div>
                    )}

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
                            <div className="flex items-center justify-between gap-2 pt-1 px-1">
                                <span className="text-[11px] text-muted-foreground tracking-wide font-medium">IP:</span>
                                <span className={cn(
                                    'font-mono text-[12px]',
                                    nodeData.ip ? 'text-foreground' : 'italic opacity-40 text-muted-foreground'
                                )}>
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
                                <span className="font-mono text-[10px] text-blue-400 truncate">{containerRangeHint}</span>
                            </div>
                        )}

                        {/* Spec chips */}
                        {(nodeData.details?.cpu || nodeData.details?.ram || nodeData.details?.storage) && (
                            <div className="flex flex-wrap gap-1 pt-0.5">
                                {nodeData.details.cpu && (
                                    <span className="text-[9px] bg-muted/60 rounded px-1 py-0.5 truncate max-w-full" title={`${nodeData.details.cpu} Cores`}>
                                        {nodeData.details.cpu} Core{Number(nodeData.details.cpu) !== 1 ? 's' : ''}
                                    </span>
                                )}
                                {nodeData.details.ram && (
                                    <span className="text-[9px] bg-muted/60 rounded px-1 py-0.5 truncate max-w-full" title={`${nodeData.details.ram} GB RAM`}>
                                        {Number(nodeData.details.ram) >= 1000 && Number(nodeData.details.ram) % 1000 === 0 
                                            ? `${Number(nodeData.details.ram) / 1000}TB` 
                                            : `${nodeData.details.ram}GB`} {nodeData.type === 'gpu' ? 'VRAM' : 'RAM'}
                                    </span>
                                )}
                                {nodeData.details.storage && (
                                    <span className="text-[9px] bg-muted/60 rounded px-1 py-0.5 truncate max-w-full" title={`${nodeData.details.storage} GB Storage`}>
                                        {Number(nodeData.details.storage) >= 1000 && Number(nodeData.details.storage) % 1000 === 0
                                            ? `${Number(nodeData.details.storage) / 1000}TB` 
                                            : `${nodeData.details.storage}GB`} Disk
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
