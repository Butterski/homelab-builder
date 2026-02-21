import { useState, useEffect } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "../../../components/ui/dialog"
import { Button } from "../../../components/ui/button"
import { Input } from "../../../components/ui/input"
import { Label } from "../../../components/ui/label"
import type { HardwareType, HardwareSpec } from "../../../types"

interface Props {
    open: boolean
    onOpenChange: (open: boolean) => void
    onConfirm: (data: { name: string; details: HardwareSpec }) => void
    initialType: HardwareType
    initialName?: string
    initialDetails?: HardwareSpec
    title?: string // Added optional title prop as it's used in VisualBuilder
}

export function ComponentDetailsDialog({ open, onOpenChange, onConfirm, initialType, initialName, initialDetails, title }: Props) {
    const [name, setName] = useState(initialName || "")
    const [model, setModel] = useState(initialDetails?.model || "")

    // Split states for units and CPU
    const [cpuCores, setCpuCores] = useState("")
    const [ramValue, setRamValue] = useState("")
    const [ramUnit, setRamUnit] = useState("GB")
    const [storageValue, setStorageValue] = useState("")
    const [storageUnit, setStorageUnit] = useState("TB")

    // Helper: convert storage/RAM value (raw number OR old string "4TB"/"500GB") -> [display value, unit]
    const formatStorageForDisplay = (val?: number | string): [string, string] => {
        if (val === undefined || val === null || val === '') return ['', 'GB']
        // If already a number (new format: raw GB stored as int)
        if (typeof val === 'number') {
            if (val >= 1000 && val % 1000 === 0) return [String(val / 1000), 'TB']
            return [String(val), 'GB']
        }
        // Handle old string format: "4TB", "500GB", "2000"
        const match = val.match(/^(\d+(?:\.\d+)?)\s*(MB|GB|TB)?$/i)
        if (match) {
            const n = parseFloat(match[1])
            const unit = (match[2] || 'GB').toUpperCase()
            return [String(n), unit]
        }
        return ['', 'GB']
    }

    const formatRamForDisplay = (val?: number | string): [string, string] => {
        if (val === undefined || val === null || val === '') return ['', 'GB']
        if (typeof val === 'number') return [String(val), 'GB']
        const match = val.match(/^(\d+(?:\.\d+)?)\s*(MB|GB|TB)?$/i)
        if (match) {
            const n = parseFloat(match[1])
            const unit = (match[2] || 'GB').toUpperCase()
            return [String(n), unit]
        }
        return ['', 'GB']
    }

    useEffect(() => {
        if (open) {
            setName(initialName || "")
            setModel(initialDetails?.model || "")

            // Support both `cpu` (new) and `cpu_cores` (legacy)
            setCpuCores(initialDetails?.cpu?.toString() || initialDetails?.cpu_cores?.toString() || "")

            // RAM: may be stored as number (GB) OR old string ("32GB")
            const [rVal, rUnit] = formatRamForDisplay(initialDetails?.ram)
            setRamValue(rVal)
            setRamUnit(rUnit)

            // Storage: may be stored as number (GB) OR old string ("4TB", "500GB")
            const [sVal, sUnit] = formatStorageForDisplay(initialDetails?.storage)
            setStorageValue(sVal)
            setStorageUnit(sUnit)
        }
    }, [open, initialName, initialDetails])

    const handleConfirm = () => {
        const finalSpec: HardwareSpec = { model }
        
        // Output cores to `cpu` attribute since that is the new standard
        if (cpuCores) finalSpec.cpu = parseInt(cpuCores, 10)
        
        if (ramValue) {
            const r = parseFloat(ramValue)
            if (!isNaN(r)) {
                finalSpec.ram = ramUnit === 'TB' ? r * 1000 : (ramUnit === 'MB' ? r / 1000 : r)
            }
        }

        if (storageValue) {
            const s = parseFloat(storageValue)
            if (!isNaN(s)) {
                finalSpec.storage = storageUnit === 'TB' ? s * 1000 : s
            }
        }

        onConfirm({
            name: name || `New ${initialType}`,
            details: finalSpec
        })
        onOpenChange(false)
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle>{title || `Add ${initialType.toUpperCase()} Component`}</DialogTitle>
                </DialogHeader>
                <div className="grid gap-4 py-4" onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        handleConfirm();
                    }
                }}>
                    {/* Name */}
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="name" className="text-right">Name</Label>
                        <Input
                            id="name"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            className="col-span-3"
                            placeholder={`e.g. My ${initialType}`}
                            autoFocus
                        />
                    </div>

                    {/* Model - Always show */}
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="model" className="text-right">Model</Label>
                        <Input
                            id="model"
                            value={model}
                            onChange={(e) => setModel(e.target.value)}
                            className="col-span-3"
                            placeholder="e.g. Samsung 980 Pro"
                        />
                    </div>

                    {/* CPU - Compute types */}
                    {['server', 'pc', 'minipc', 'sbc'].includes(initialType) && (
                        <>
                            <div className="grid grid-cols-4 items-center gap-4">
                                <Label htmlFor="cpu_cores" className="text-right">CPU Cores</Label>
                                <Input
                                    id="cpu_cores"
                                    type="number"
                                    value={cpuCores}
                                    onChange={(e) => setCpuCores(e.target.value)}
                                    className="col-span-3"
                                    placeholder="e.g. 16"
                                />
                            </div>
                        </>
                    )}

                    {/* RAM - Compute + GPU */}
                    {['server', 'pc', 'minipc', 'sbc', 'gpu', 'nas'].includes(initialType) && (
                        <div className="grid grid-cols-4 items-center gap-4">
                            <Label htmlFor="ram" className="text-right">
                                {initialType === 'gpu' ? 'VRAM' : 'RAM'}
                            </Label>
                            <div className="col-span-3 flex gap-2">
                                <Input
                                    id="ram"
                                    type="number"
                                    value={ramValue}
                                    onChange={(e) => setRamValue(e.target.value)}
                                    className="flex-1"
                                    placeholder="32"
                                />
                                <select
                                    className="h-10 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                                    value={ramUnit}
                                    onChange={(e) => setRamUnit(e.target.value)}
                                >
                                    <option value="MB">MB</option>
                                    <option value="GB">GB</option>
                                </select>
                            </div>
                        </div>
                    )}

                    {/* Storage - Compute + Disk + NAS */}
                    {['server', 'pc', 'minipc', 'sbc', 'disk', 'nas'].includes(initialType) && (
                        <div className="grid grid-cols-4 items-center gap-4">
                            <Label htmlFor="storage" className="text-right">Storage</Label>
                            <div className="col-span-3 flex gap-2">
                                <Input
                                    id="storage"
                                    type="number"
                                    value={storageValue}
                                    onChange={(e) => setStorageValue(e.target.value)}
                                    className="flex-1"
                                    placeholder="4"
                                />
                                <select
                                    className="h-10 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                                    value={storageUnit}
                                    onChange={(e) => setStorageUnit(e.target.value)}
                                >
                                    <option value="GB">GB</option>
                                    <option value="TB">TB</option>
                                </select>
                            </div>
                        </div>
                    )}
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
                    <Button onClick={handleConfirm}>{initialName ? 'Save Changes' : 'Add Component'}</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
