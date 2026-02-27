import { useState } from "react"
import { useBuilderStore } from "../store/builder-store"
import { Button } from "../../../components/ui/button"
import { Badge } from "../../../components/ui/badge"
import { Trash2, HardDrive, Cpu, ScanLine, CircuitBoard, Component, Zap, Archive, Pencil } from "lucide-react"
import type { HardwareType, HardwareComponent } from "../../../types"
import { ComponentDetailsDialog } from "./component-details-dialog"
import { ConfirmDialog } from "../../../components/ui/confirm-dialog"

const COMPONENT_ICONS: Partial<Record<HardwareType, React.ElementType>> = {
    disk: HardDrive,
    gpu: ScanLine,
    hba: CircuitBoard,
    pcie: Component,
    ups: Zap,
    minipc: Cpu,
    sbc: Cpu,
    server: Archive,
    nas: Archive,
    router: Component,
    switch: Component,
    // Add others if needed
}

interface Props {
    nodeId: string
}

export function InternalComponentManager({ nodeId }: Props) {
    const { hardwareNodes, removeInternalComponent, updateInternalComponent } = useBuilderStore()
    const node = hardwareNodes.find(n => n.id === nodeId)
    const components = node?.internal_components || []
    
    const [editingComponent, setEditingComponent] = useState<HardwareComponent | null>(null)
    const [deletingCompId, setDeletingCompId] = useState<string | null>(null)

    if (components.length === 0) return null

    return (
        <div className="space-y-3 pt-4 border-t">
            <div className="flex items-center justify-between">
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Internal Components ({components.length})
                </h4>
            </div>

            <div className="space-y-2">
                {components.map(comp => {
                    const Icon = COMPONENT_ICONS[comp.type] || Component
                    return (
                        <div key={comp.id} className="flex items-start gap-2 rounded-lg border bg-background/60 p-2.5 group">
                            <div className="mt-0.5 shrink-0">
                                <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                            </div>
                            <div className="flex-1 min-w-0 cursor-pointer" onClick={() => setEditingComponent(comp)}>
                                <div className="flex items-center gap-1.5">
                                    <span className="text-xs font-semibold truncate hover:underline underline-offset-2 decoration-muted-foreground/50">
                                        {comp.name}
                                    </span>
                                    <Badge variant="outline" className="text-[9px] h-3.5 px-1 shrink-0 uppercase opacity-70">
                                        {comp.type}
                                    </Badge>
                                </div>
                                <div className="flex flex-wrap gap-x-2 text-[10px] text-muted-foreground truncate">
                                    {comp.details?.model && <span>{comp.details.model}</span>}
                                    {comp.details?.ram && <span>{comp.details.ram} {comp.type === 'gpu' ? 'VRAM' : ''}</span>}
                                    {comp.details?.storage && <span>{comp.details.storage}</span>}
                                </div>
                            </div>
                            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                <Button
                                    size="icon"
                                    variant="ghost"
                                    className="h-6 w-6 text-muted-foreground hover:text-primary"
                                    onClick={() => setEditingComponent(comp)}
                                    title="Edit component"
                                >
                                    <Pencil className="h-3 w-3" />
                                </Button>
                                <Button
                                    size="icon"
                                    variant="ghost"
                                    className="h-6 w-6 text-muted-foreground hover:text-destructive"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        setDeletingCompId(comp.id);
                                    }}
                                    title="Remove component"
                                >
                                    <Trash2 className="h-3 w-3" />
                                </Button>
                            </div>
                        </div>
                    )
                })}
            </div>

            {/* Edit Dialog */}
            {editingComponent && (
                <ComponentDetailsDialog
                    open={true}
                    onOpenChange={(v) => !v && setEditingComponent(null)}
                    initialType={editingComponent.type}
                    initialName={editingComponent.name}
                    initialDetails={editingComponent.details}
                    onConfirm={(data) => {
                        updateInternalComponent(nodeId, editingComponent.id, {
                            name: data.name,
                            details: data.details
                        })
                        setEditingComponent(null)
                    }}
                />
            )}

            {/* Delete Confirm Dialog */}
            <ConfirmDialog
                open={deletingCompId !== null}
                onOpenChange={(v) => !v && setDeletingCompId(null)}
                title="Remove component?"
                description="This action cannot be undone."
                confirmLabel="Remove"
                onConfirm={() => {
                    if (deletingCompId) removeInternalComponent(nodeId, deletingCompId)
                    setDeletingCompId(null)
                }}
            />
        </div>
    )
}
