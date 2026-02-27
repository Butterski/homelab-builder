import { useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { api } from "../../../services/api"
import { Button } from "../../../components/ui/button"
import { Input } from "../../../components/ui/input"
import { Label } from "../../../components/ui/label"
import { Textarea } from "../../../components/ui/textarea"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../../components/ui/table"
import { Trash2, Edit } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../../../components/ui/dialog"

export interface CatalogComponentRaw {
    id: string
    type: string
    name: string
    details: any
    created_at: string
}

export function CatalogComponentsManager() {
    const qc = useQueryClient()
    const [open, setOpen] = useState(false)
    const [editingId, setEditingId] = useState<string | null>(null)
    const [formState, setFormState] = useState({ type: "", name: "", details: "{}" })

    const { data, isLoading } = useQuery({
        queryKey: ["admin-mass-planner"],
        queryFn: () => api.getCatalogComponents()
    })

    const createMut = useMutation({
        mutationFn: (data: any) => api.createCatalogComponent(data),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["admin-mass-planner"] })
            setOpen(false)
        }
    })

    const updateMut = useMutation({
        mutationFn: ({ id, data }: { id: string, data: any }) => api.updateCatalogComponent(id, data),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["admin-mass-planner"] })
            setOpen(false)
        }
    })

    const deleteMut = useMutation({
        mutationFn: (id: string) => api.deleteCatalogComponent(id),
        onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-mass-planner"] })
    })

    if (isLoading) return <div>Loading...</div>

    const components: CatalogComponentRaw[] = data?.data || []

    const handleSave = () => {
        let parsedDetails = {}
        try {
            parsedDetails = JSON.parse(formState.details)
        } catch (e) {
            alert("Invalid JSON in details")
            return
        }

        const payload = {
            type: formState.type.toLowerCase().trim(),
            name: formState.name,
            details: parsedDetails
        }

        if (editingId) {
            updateMut.mutate({ id: editingId, data: payload })
        } else {
            createMut.mutate(payload)
        }
    }

    const openEdit = (comp: CatalogComponentRaw) => {
        setFormState({
            type: comp.type,
            name: comp.name,
            details: JSON.stringify(comp.details, null, 2)
        })
        setEditingId(comp.id)
        setOpen(true)
    }

    const openCreate = () => {
        setFormState({ type: "", name: "", details: "{}" })
        setEditingId(null)
        setOpen(true)
    }

    return (
        <div className="space-y-4">
            <div className="flex justify-between items-center">
                <h3 className="text-lg font-medium">Mass Planner (Component Catalog)</h3>
                <Dialog open={open} onOpenChange={setOpen}>
                    <DialogTrigger asChild>
                        <Button onClick={openCreate}>Add Component Template</Button>
                    </DialogTrigger>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>{editingId ? "Edit Component Template" : "New Component Template"}</DialogTitle>
                        </DialogHeader>
                        <div className="space-y-4 py-4">
                            <div className="space-y-2">
                                <Label>Type (e.g. disk, gpu, ram)</Label>
                                <Input value={formState.type} onChange={e => setFormState(prev => ({...prev, type: e.target.value}))} />
                            </div>
                            <div className="space-y-2">
                                <Label>Display Name</Label>
                                <Input value={formState.name} onChange={e => setFormState(prev => ({...prev, name: e.target.value}))} />
                            </div>
                            <div className="space-y-2">
                                <Label>Details (JSON format)</Label>
                                <Textarea 
                                    className="font-mono text-xs h-32" 
                                    value={formState.details} 
                                    onChange={e => setFormState(prev => ({...prev, details: e.target.value}))} 
                                />
                            </div>
                            <Button className="w-full" onClick={handleSave} disabled={createMut.isPending || updateMut.isPending}>
                                Save Template
                            </Button>
                        </div>
                    </DialogContent>
                </Dialog>
            </div>
            
            <p className="text-sm text-muted-foreground">
                These templates are available to users inside the Canvas to quick-add nested internals to their Server or NAS Nodes.
            </p>

            <div className="rounded-md border">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead className="w-1/6">Type</TableHead>
                            <TableHead className="w-1/3">Name</TableHead>
                            <TableHead>Details (JSON)</TableHead>
                            <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {components.length === 0 && (
                            <TableRow>
                                <TableCell colSpan={4} className="text-center py-6 text-muted-foreground">No templates defined yet.</TableCell>
                            </TableRow>
                        )}
                        {components.map((comp) => (
                            <TableRow key={comp.id}>
                                <TableCell className="font-medium capitalize">{comp.type}</TableCell>
                                <TableCell>{comp.name}</TableCell>
                                <TableCell>
                                    <code className="text-[10px] bg-muted px-1.5 py-0.5 rounded break-all">
                                        {JSON.stringify(comp.details)}
                                    </code>
                                </TableCell>
                                <TableCell className="text-right">
                                    <div className="flex justify-end gap-1">
                                        <Button variant="ghost" size="icon" onClick={() => openEdit(comp)}>
                                            <Edit className="h-4 w-4" />
                                        </Button>
                                        <Button variant="ghost" size="icon" className="text-destructive" onClick={() => {
                                            if (window.confirm("Delete template?")) deleteMut.mutate(comp.id)
                                        }}>
                                            <Trash2 className="h-4 w-4" />
                                        </Button>
                                    </div>
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </div>
        </div>
    )
}
