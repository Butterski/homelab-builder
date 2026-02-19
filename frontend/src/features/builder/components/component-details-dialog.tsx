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
    const [spec, setSpec] = useState<HardwareSpec>(initialDetails || {})

    // Split states for units and CPU
    const [cpuModel, setCpuModel] = useState("")
    const [cpuCores, setCpuCores] = useState("")
    const [ramValue, setRamValue] = useState("")
    const [ramUnit, setRamUnit] = useState("GB")
    const [storageValue, setStorageValue] = useState("")
    const [storageUnit, setStorageUnit] = useState("TB")

    // Helper to parse "32GB" -> ["32", "GB"]
    const parseValueUnit = (val?: string): [string, string] => {
        if (!val) return ["", ""]
        const match = val.match(/^(\d+(\.\d+)?)?\s*(MB|GB|TB|TB)?$/i)
        if (match) {
            return [match[1] || "", (match[3] || "").toUpperCase()]
        }
        return [val, ""] // Fallback
    }

    useEffect(() => {
        if (open) {
            setName(initialName || "")
            setModel(initialDetails?.model || "")
            setSpec(initialDetails || {})

            setCpuModel(initialDetails?.cpu?.toString() || "")
            setCpuCores(initialDetails?.cpu_cores?.toString() || "")

            const [rVal, rUnit] = parseValueUnit(initialDetails?.ram?.toString())
            setRamValue(rVal)
            if (rUnit) setRamUnit(rUnit) // Keep default if parsing failed/empty

            const [sVal, sUnit] = parseValueUnit(initialDetails?.storage?.toString())
            setStorageValue(sVal)
            // Default storage unit logic could be better, but TB default is fine for now
            if (sUnit) setStorageUnit(sUnit)
        }
    }, [open, initialName, initialDetails])

    const handleConfirm = () => {
        const finalSpec: HardwareSpec = { ...spec, model }
        
        if (cpuModel) finalSpec.cpu = cpuModel
        if (cpuCores) finalSpec.cpu_cores = parseInt(cpuCores, 10)
        
        if (ramValue) finalSpec.ram = `${ramValue}${ramUnit}`
        if (storageValue) finalSpec.storage = `${storageValue}${storageUnit}`

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
                                <Label htmlFor="cpu" className="text-right">CPU Model</Label>
                                <Input
                                    id="cpu"
                                    value={cpuModel}
                                    onChange={(e) => setCpuModel(e.target.value)}
                                    className="col-span-3"
                                    placeholder="e.g. i7-13700K"
                                />
                            </div>
                            <div className="grid grid-cols-4 items-center gap-4">
                                <Label htmlFor="cpu_cores" className="text-right">Cores</Label>
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
                    <Button onClick={handleConfirm}>Add Component</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
