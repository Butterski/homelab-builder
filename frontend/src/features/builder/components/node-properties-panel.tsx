
import { useEffect, useState } from "react"
import { useBuilderStore, NON_NETWORK_TYPES } from "../store/builder-store"
import { Card, CardContent, CardHeader, CardTitle } from "../../../components/ui/card"
import { Button } from "../../../components/ui/button"
import { Input } from "../../../components/ui/input"
import { Label } from "../../../components/ui/label"
import { X, Trash2, AlertCircle, Wand2 } from "lucide-react"
import { VMManager } from "./vm-manager"
import { InternalComponentManager } from "./internal-component-manager"

const IP_REGEX = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;

export function NodePropertiesPanel() {
    const { selectedNodeId, hardwareNodes, selectNode, updateHardware, removeHardware, autoAssignIP } = useBuilderStore()
    
    const [name, setName] = useState("")
    const [ip, setIp] = useState("")
    const [mask, setMask] = useState("")
    const [gateway, setGateway] = useState("")
    const [model, setModel] = useState("")
    const [cpu, setCpu] = useState("")
    const [ram, setRam] = useState("")
    const [storage, setStorage] = useState("")
    const [errors, setErrors] = useState<{ip?: string, mask?: string, gateway?: string}>({})

    const selectedNode = hardwareNodes.find(n => n.id === selectedNodeId)

    // Sync from store to local state (only if changed to avoid loops)
    useEffect(() => {
        if (selectedNode) {
            if (name !== selectedNode.name) setName(selectedNode.name)
            if (ip !== (selectedNode.ip || "")) setIp(selectedNode.ip || "")
            if (mask !== (selectedNode.subnet_mask || "")) setMask(selectedNode.subnet_mask || "")
            if (gateway !== (selectedNode.gateway || "")) setGateway(selectedNode.gateway || "")
            
            if (model !== (selectedNode.details?.model || "")) setModel(selectedNode.details?.model || "")
            if (cpu !== (selectedNode.details?.cpu?.toString() || "")) setCpu(selectedNode.details?.cpu?.toString() || "")
            if (ram !== (selectedNode.details?.ram?.toString() || "")) setRam(selectedNode.details?.ram?.toString() || "")
            if (storage !== (selectedNode.details?.storage?.toString() || "")) setStorage(selectedNode.details?.storage?.toString() || "")
            
            setErrors({})
        }
    }, [selectedNode]) // Rely on store reference changes

    // Auto-save to store (Debounced)
    useEffect(() => {
        if (!selectedNode) return

        const timer = setTimeout(() => {
            // Validate and Save
            if (validate()) {
                // Convert specs to numbers if they are present
                const cpuVal = cpu ? Number(cpu) : undefined
                const ramVal = ram ? Number(ram) : undefined
                const storageVal = storage ? Number(storage) : undefined

                updateHardware(selectedNode.id, { 
                    name, 
                    ip, 
                    subnet_mask: mask, 
                    gateway,
                    details: { 
                        ...selectedNode.details, 
                        model, 
                        cpu: cpuVal, 
                        ram: ramVal, 
                        storage: storageVal 
                    }
                })
            }
        }, 500) // 500ms debounce

        return () => clearTimeout(timer)
    }, [name, ip, mask, gateway, model, cpu, ram, storage])

    if (!selectedNode) return null

    const validate = () => {
        const newErrors: typeof errors = {}
        if (ip && !IP_REGEX.test(ip)) newErrors.ip = "Invalid IPv4"
        if (mask && !IP_REGEX.test(mask)) newErrors.mask = "Invalid mask"
        if (gateway && !IP_REGEX.test(gateway)) newErrors.gateway = "Invalid gateway"
        setErrors(newErrors)
        return Object.keys(newErrors).length === 0
    }

    const handleDelete = () => {
        removeHardware(selectedNode.id)
        selectNode(null)
    }

    const handleAutoIP = () => {
        const assigned = autoAssignIP(selectedNode.id)
        if (assigned) setIp(assigned)
        else alert("No router with a configured IP found. Add a Router and set its IP first.")
    }

    const isRouter = selectedNode.type === 'router'
    const supportsVMs = ['server', 'pc', 'nas', 'minipc', 'sbc'].includes(selectedNode.type)
    const isNetworked = !NON_NETWORK_TYPES.includes(selectedNode.type)

    return (
        <Card className="absolute top-4 right-4 w-80 shadow-xl z-10 border-l animate-in slide-in-from-right-10 bg-background/95 backdrop-blur max-h-[calc(100vh-6rem)] flex flex-col">
            <CardHeader className="flex flex-row items-center justify-between py-3 bg-muted/50 border-b shrink-0">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                    Node Properties
                    <span className="text-[10px] bg-primary/10 text-primary px-2 py-0.5 rounded-full uppercase tracking-wider">
                        {selectedNode.type}
                    </span>
                </CardTitle>
                <div className="flex items-center gap-1">
                     <Button variant="ghost" size="icon" onClick={handleDelete} className="h-6 w-6 rounded-full hover:bg-destructive/10 hover:text-destructive" title="Delete Node">
                        <Trash2 className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => selectNode(null)} className="h-6 w-6 rounded-full hover:bg-muted" title="Close">
                        <X className="h-4 w-4" />
                    </Button>
                </div>
            </CardHeader>

            <CardContent className="space-y-4 pt-4 overflow-y-auto flex-1">
                {/* Name */}
                <div className="space-y-2">
                    <Label htmlFor="name">Name</Label>
                    <Input
                        id="name" value={name}
                        onChange={e => setName(e.target.value)}
                        placeholder="e.g. Main Router"
                    />
                </div>

                {/* IP Address */}
                <div className="space-y-2">
                    <div className="flex justify-between items-center">
                        <Label htmlFor="ip">
                            IP Address
                            {!isNetworked && <span className="text-[10px] text-muted-foreground font-normal ml-1">(Optional)</span>}
                        </Label>
                        <div className="flex items-center gap-1">
                            {errors.ip && <span className="text-[10px] text-destructive flex items-center"><AlertCircle className="h-3 w-3 mr-0.5"/>{errors.ip}</span>}
                            {!isRouter && isNetworked && (
                                <Button variant="ghost" size="sm" className="h-5 px-1.5 text-[10px] text-primary" onClick={handleAutoIP}>
                                    <Wand2 className="h-3 w-3 mr-0.5" /> Auto
                                </Button>
                            )}
                        </div>
                    </div>
                    <Input
                        id="ip"
                        value={ip}
                        onChange={e => setIp(e.target.value)}
                        placeholder={isRouter ? "192.168.1.1" : (isNetworked ? "auto from router" : "no ip")}
                        className={errors.ip ? "border-destructive focus-visible:ring-destructive" : ""}
                    />
                </div>

                {/* Router-specific: Subnet Mask + Gateway */}
                {isRouter && (
                    <>
                        <div className="space-y-2">
                            <div className="flex justify-between">
                                <Label htmlFor="mask">Subnet Mask</Label>
                                {errors.mask && <span className="text-[10px] text-destructive">{errors.mask}</span>}
                            </div>
                            <Input
                                id="mask"
                                value={mask}
                                onChange={(e) => setMask(e.target.value)}
                                placeholder="255.255.255.0"
                                className={errors.mask ? "border-destructive" : ""}
                            />
                        </div>
                        <div className="space-y-2">
                            <div className="flex justify-between">
                                <Label htmlFor="gateway">Gateway</Label>
                                {errors.gateway && <span className="text-[10px] text-destructive">{errors.gateway}</span>}
                            </div>
                            <Input
                                id="gateway"
                                value={gateway}
                                onChange={(e) => setGateway(e.target.value)}
                                placeholder="192.168.1.1"
                                className={errors.gateway ? "border-destructive" : ""}
                            />
                        </div>
                        <p className="text-[10px] text-muted-foreground bg-primary/5 rounded-md px-2 py-1.5">
                            💡 Set this router's IP to enable auto-assignment for other nodes.
                        </p>
                    </>
                )}

                {/* Hardware Specs (Model, CPU, RAM, Storage) */}
                <div className="space-y-3 pt-2 border-t">
                     <div className="space-y-1">
                        <Label htmlFor="model" className="text-xs text-muted-foreground">Model</Label>
                        <Input
                            id="model"
                            value={model}
                            onChange={(e) => setModel(e.target.value)}
                            className="h-8 text-xs"
                            placeholder="e.g. Raspberry Pi 4"
                        />
                    </div>
                    
                    {['server', 'pc', 'minipc', 'sbc', 'nas'].includes(selectedNode.type) && (
                        <div className="space-y-1">
                            <Label htmlFor="cpu" className="text-xs text-muted-foreground">CPU Cores</Label>
                            <Input
                                id="cpu"
                                type="number"
                                min="1"
                                step="1"
                                value={cpu}
                                onChange={(e) => setCpu(e.target.value)}
                                className="h-8 text-xs"
                                placeholder="e.g. 4"
                            />
                        </div>
                    )}

                    {['server', 'pc', 'minipc', 'sbc', 'nas', 'gpu'].includes(selectedNode.type) && (
                        <div className="space-y-1">
                            <Label htmlFor="ram" className="text-xs text-muted-foreground">
                                {selectedNode.type === 'gpu' ? 'VRAM (GB)' : 'RAM (GB)'}
                            </Label>
                            <Input
                                id="ram"
                                type="number"
                                min="1"
                                value={ram}
                                onChange={(e) => setRam(e.target.value)}
                                className="h-8 text-xs"
                                placeholder="e.g. 16"
                            />
                        </div>
                    )}

                    {['server', 'pc', 'minipc', 'sbc', 'nas', 'disk'].includes(selectedNode.type) && (
                        <div className="space-y-1">
                            <Label htmlFor="storage" className="text-xs text-muted-foreground">Storage (GB)</Label>
                            <Input
                                id="storage"
                                type="number"
                                min="1"
                                value={storage}
                                onChange={(e) => setStorage(e.target.value)}
                                className="h-8 text-xs"
                                placeholder="e.g. 512"
                            />
                        </div>
                    )}
                </div>

                {/* Component Manager (GPUs, Disks, etc) */}
                <InternalComponentManager nodeId={selectedNode.id} />

                {/* VM Manager (servers, PCs, NAS) */}
                {supportsVMs && (
                    <div className="border-t pt-4">
                        <VMManager nodeId={selectedNode.id} />
                    </div>
                )}
            </CardContent>
        </Card>
    )
}
