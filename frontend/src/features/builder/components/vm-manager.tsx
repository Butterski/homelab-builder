import { useState } from "react"
import { useBuilderStore } from "../store/builder-store"
import type { VirtualMachine, VMType } from "../../../types"
import { Button } from "../../../components/ui/button"
import { Input } from "../../../components/ui/input"
import { Label } from "../../../components/ui/label"
import { Badge } from "../../../components/ui/badge"
import { Plus, Trash2, Cpu, Box, Container, Wifi, Pencil, Check, X } from "lucide-react"

const VM_TYPE_ICONS: Record<VMType, React.ElementType> = {
    vm: Cpu,
    container: Container,
    lxc: Box,
}

const STATUS_COLORS = {
    running: 'bg-green-500',
    stopped: 'bg-red-500',
    paused: 'bg-yellow-500',
}

interface Props {
    nodeId: string
}

export function VMManager({ nodeId }: Props) {
    const { hardwareNodes, addVM, removeVM, updateVM } = useBuilderStore()
    const node = hardwareNodes.find(n => n.id === nodeId)
    const vms = node?.vms || []

    const [isAdding, setIsAdding] = useState(false)
    const [editingVmId, setEditingVmId] = useState<string | null>(null)
    const [editVM, setEditVM] = useState<Partial<VirtualMachine>>({})
    const [newVM, setNewVM] = useState<Partial<VirtualMachine>>({
        type: 'container',
        status: 'running',
        name: '',
        os: '',
        ip: '',
        cpu_cores: 1,
        ram_mb: 512,
    })

    const handleAdd = () => {
        if (!newVM.name?.trim()) return
        addVM(nodeId, {
            id: `vm-${Date.now()}`,
            name: newVM.name!,
            type: newVM.type as VMType || 'container',
            status: newVM.status as VirtualMachine['status'] || 'running',
            ip: newVM.ip || undefined,
            os: newVM.os || undefined,
            cpu_cores: newVM.cpu_cores,
            ram_mb: newVM.ram_mb,
        })
        setIsAdding(false)
        setNewVM({ type: 'container', status: 'running', name: '', os: '', ip: '', cpu_cores: 1, ram_mb: 512 })
    }

    const cycleStatus = (vm: VirtualMachine) => {
        const next: Record<string, VirtualMachine['status']> = {
            running: 'stopped',
            stopped: 'running',
            paused: 'running',
        }
        updateVM(nodeId, vm.id, { status: next[vm.status] })
    }

    const startEditing = (vm: VirtualMachine) => {
        setEditingVmId(vm.id)
        setEditVM({
            name: vm.name,
            type: vm.type,
            os: vm.os || '',
            ip: vm.ip || '',
            cpu_cores: vm.cpu_cores || 1,
            ram_mb: vm.ram_mb || 512,
        })
    }

    const saveEdit = () => {
        if (!editingVmId || !editVM.name?.trim()) return
        updateVM(nodeId, editingVmId, {
            name: editVM.name!,
            type: editVM.type as VMType || 'container',
            os: editVM.os || undefined,
            ip: editVM.ip || undefined,
            cpu_cores: editVM.cpu_cores,
            ram_mb: editVM.ram_mb,
        })
        setEditingVmId(null)
        setEditVM({})
    }

    const cancelEdit = () => {
        setEditingVmId(null)
        setEditVM({})
    }

    return (
        <div className="space-y-3">
            <div className="flex items-center justify-between">
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    VMs & Containers ({vms.length})
                </h4>
                <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 px-2 text-xs"
                    onClick={() => setIsAdding(!isAdding)}
                >
                    <Plus className="h-3 w-3 mr-1" /> Add
                </Button>
            </div>

            {/* Add form */}
            {isAdding && (
                <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                        <div>
                            <Label className="text-[10px]">Name</Label>
                            <Input
                                className="h-7 text-xs"
                                placeholder="e.g. nginx"
                                value={newVM.name}
                                onChange={e => setNewVM(p => ({ ...p, name: e.target.value }))}
                            />
                        </div>
                        <div>
                            <Label className="text-[10px]">Type</Label>
                            <select
                                className="w-full h-7 text-xs rounded-md border bg-background px-2"
                                value={newVM.type}
                                onChange={e => setNewVM(p => ({ ...p, type: e.target.value as VMType }))}
                            >
                                <option value="container">Container</option>
                                <option value="vm">VM</option>
                                <option value="lxc">LXC</option>
                            </select>
                        </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                        <div>
                            <Label className="text-[10px]">OS / Image</Label>
                            <Input
                                className="h-7 text-xs"
                                placeholder="Ubuntu 22.04"
                                value={newVM.os}
                                onChange={e => setNewVM(p => ({ ...p, os: e.target.value }))}
                            />
                        </div>
                        <div>
                            <Label className="text-[10px]">IP (auto if blank)</Label>
                            <Input
                                className="h-7 text-xs"
                                placeholder="auto"
                                value={newVM.ip}
                                onChange={e => setNewVM(p => ({ ...p, ip: e.target.value }))}
                            />
                        </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                        <div>
                            <Label className="text-[10px]">CPU Cores</Label>
                            <Input
                                className="h-7 text-xs"
                                type="number"
                                min={1}
                                max={32}
                                value={newVM.cpu_cores}
                                onChange={e => setNewVM(p => ({ ...p, cpu_cores: Number(e.target.value) }))}
                            />
                        </div>
                        <div>
                            <Label className="text-[10px]">RAM (MB)</Label>
                            <Input
                                className="h-7 text-xs"
                                type="number"
                                min={128}
                                step={128}
                                value={newVM.ram_mb}
                                onChange={e => setNewVM(p => ({ ...p, ram_mb: Number(e.target.value) }))}
                            />
                        </div>
                    </div>
                    <div className="flex gap-2 pt-1">
                        <Button size="sm" className="h-7 text-xs flex-1" onClick={handleAdd}>
                            Add {newVM.type === 'vm' ? 'VM' : newVM.type === 'lxc' ? 'LXC' : 'Container'}
                        </Button>
                        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setIsAdding(false)}>
                            Cancel
                        </Button>
                    </div>
                </div>
            )}

            {/* VM list */}
            {vms.length === 0 && !isAdding && (
                <p className="text-xs text-muted-foreground text-center py-3 border border-dashed rounded-lg">
                    No VMs or containers yet. Click Add to create one.
                </p>
            )}

            {vms.map(vm => {
                const Icon = VM_TYPE_ICONS[vm.type] || Box
                const isEditing = editingVmId === vm.id

                if (isEditing) {
                    return (
                        <div key={vm.id} className="rounded-lg border border-primary/50 bg-muted/30 p-3 space-y-2">
                            <div className="grid grid-cols-2 gap-2">
                                <div>
                                    <Label className="text-[10px]">Name</Label>
                                    <Input
                                        className="h-7 text-xs"
                                        value={editVM.name}
                                        onChange={e => setEditVM(p => ({ ...p, name: e.target.value }))}
                                    />
                                </div>
                                <div>
                                    <Label className="text-[10px]">Type</Label>
                                    <select
                                        className="w-full h-7 text-xs rounded-md border bg-background px-2"
                                        value={editVM.type}
                                        onChange={e => setEditVM(p => ({ ...p, type: e.target.value as VMType }))}
                                    >
                                        <option value="container">Container</option>
                                        <option value="vm">VM</option>
                                        <option value="lxc">LXC</option>
                                    </select>
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                                <div>
                                    <Label className="text-[10px]">OS / Image</Label>
                                    <Input
                                        className="h-7 text-xs"
                                        placeholder="Ubuntu 22.04"
                                        value={editVM.os}
                                        onChange={e => setEditVM(p => ({ ...p, os: e.target.value }))}
                                    />
                                </div>
                                <div>
                                    <Label className="text-[10px]">IP (auto if blank)</Label>
                                    <Input
                                        className="h-7 text-xs"
                                        placeholder="auto"
                                        value={editVM.ip}
                                        onChange={e => setEditVM(p => ({ ...p, ip: e.target.value }))}
                                    />
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                                <div>
                                    <Label className="text-[10px]">CPU Cores</Label>
                                    <Input
                                        className="h-7 text-xs"
                                        type="number"
                                        min={1}
                                        max={32}
                                        value={editVM.cpu_cores}
                                        onChange={e => setEditVM(p => ({ ...p, cpu_cores: Number(e.target.value) }))}
                                    />
                                </div>
                                <div>
                                    <Label className="text-[10px]">RAM (MB)</Label>
                                    <Input
                                        className="h-7 text-xs"
                                        type="number"
                                        min={128}
                                        step={128}
                                        value={editVM.ram_mb}
                                        onChange={e => setEditVM(p => ({ ...p, ram_mb: Number(e.target.value) }))}
                                    />
                                </div>
                            </div>
                            <div className="flex gap-2 pt-1">
                                <Button size="sm" className="h-7 text-xs flex-1" onClick={saveEdit}>
                                    <Check className="h-3 w-3 mr-1" /> Save
                                </Button>
                                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={cancelEdit}>
                                    <X className="h-3 w-3 mr-1" /> Cancel
                                </Button>
                            </div>
                        </div>
                    )
                }

                return (
                    <div key={vm.id} className="flex items-start gap-2 rounded-lg border bg-background/60 p-2.5">
                        <div className="mt-0.5 shrink-0">
                            <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                        </div>
                        <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                                <span className="text-xs font-semibold truncate">{vm.name}</span>
                                <Badge variant="outline" className="text-[9px] h-3.5 px-1 shrink-0">
                                    {vm.type.toUpperCase()}
                                </Badge>
                            </div>
                            {vm.os && <p className="text-[10px] text-muted-foreground">{vm.os}</p>}
                            <div className="flex items-center gap-2 mt-1">
                                {vm.ip && (
                                    <span className="flex items-center gap-0.5 text-[10px] text-primary font-mono">
                                        <Wifi className="h-2.5 w-2.5" />{vm.ip}
                                    </span>
                                )}
                                {vm.cpu_cores && (
                                    <span className="text-[10px] text-muted-foreground">{vm.cpu_cores}vCPU</span>
                                )}
                                {vm.ram_mb && (
                                    <span className="text-[10px] text-muted-foreground">{vm.ram_mb >= 1024 ? `${vm.ram_mb/1024}GB` : `${vm.ram_mb}MB`} RAM</span>
                                )}
                            </div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                            {/* Status toggle */}
                            <button
                                onClick={() => cycleStatus(vm)}
                                className={`h-4 w-4 rounded-full ${STATUS_COLORS[vm.status]} hover:opacity-80 transition-opacity`}
                                title={`Status: ${vm.status}. Click to toggle.`}
                            />
                            <Button
                                size="icon"
                                variant="ghost"
                                className="h-6 w-6 text-muted-foreground hover:text-primary"
                                onClick={() => startEditing(vm)}
                                title="Edit"
                            >
                                <Pencil className="h-3 w-3" />
                            </Button>
                            <Button
                                size="icon"
                                variant="ghost"
                                className="h-6 w-6 text-muted-foreground hover:text-destructive"
                                onClick={() => removeVM(nodeId, vm.id)}
                            >
                                <Trash2 className="h-3 w-3" />
                            </Button>
                        </div>
                    </div>
                )
            })}
        </div>
    )
}
