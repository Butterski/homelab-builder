import { useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { api } from "../../../services/api"
import { Button } from "../../../components/ui/button"
import { Input } from "../../../components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../../components/ui/table"
import { Trash2, ArrowUp, ArrowDown } from "lucide-react"

export interface SteeringRule {
    category: string
    retailer_order: string[]
}

export function SteeringRulesManager() {
    const qc = useQueryClient()
    const [newCategory, setNewCategory] = useState("")

    const { data, isLoading } = useQuery({
        queryKey: ["admin-steering"],
        queryFn: () => api.getSteeringRules()
    })

    const upsertMut = useMutation({
        mutationFn: ({ category, order } : { category: string, order: string[] }) => 
            api.upsertSteeringRule(category, order),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["admin-steering"] })
            setNewCategory("")
        }
    })

    const deleteMut = useMutation({
        mutationFn: (category: string) => api.deleteSteeringRule(category),
        onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-steering"] })
    })

    if (isLoading) return <div>Loading...</div>

    const rules: SteeringRule[] = data?.data || []

    const handleReorder = (rule: SteeringRule, idx: number, direction: 'up' | 'down') => {
        const newOrder = [...rule.retailer_order]
        if (direction === 'up' && idx > 0) {
            [newOrder[idx-1], newOrder[idx]] = [newOrder[idx], newOrder[idx-1]]
        } else if (direction === 'down' && idx < newOrder.length - 1) {
            [newOrder[idx+1], newOrder[idx]] = [newOrder[idx], newOrder[idx+1]]
        } else return

        upsertMut.mutate({ category: rule.category, order: newOrder })
    }

    const handleAddStore = (rule: SteeringRule) => {
        const store = prompt("Enter store name:")
        if (!store) return
        upsertMut.mutate({ category: rule.category, order: [...rule.retailer_order, store] })
    }

    const handleRemoveStore = (rule: SteeringRule, store: string) => {
        const newOrder = rule.retailer_order.filter(s => s !== store)
        upsertMut.mutate({ category: rule.category, order: newOrder })
    }

    const handleCreateRule = () => {
        if (!newCategory) return
        upsertMut.mutate({ category: newCategory.toLowerCase().trim(), order: [] })
    }

    return (
        <div className="space-y-4">
            <div className="flex justify-between items-center">
                <h3 className="text-lg font-medium">Retailer Steering Rules</h3>
                <div className="flex gap-2 items-center">
                    <Input 
                        placeholder="e.g. 'cpu', 'router'" 
                        value={newCategory}
                        onChange={e => setNewCategory(e.target.value)}
                        className="w-48"
                    />
                    <Button onClick={handleCreateRule} disabled={!newCategory || upsertMut.isPending}>
                        Add Category
                    </Button>
                </div>
            </div>
            
            <p className="text-sm text-muted-foreground">
                Define the priority list of retailers per category. The shopping list uses this array to rank retailers for proxy purchase link generation.
            </p>

            <div className="rounded-md border">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead className="w-1/4">Category</TableHead>
                            <TableHead>Prioritized Retailers (Top = Highest Priority)</TableHead>
                            <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {rules.map((rule) => (
                            <TableRow key={rule.category}>
                                <TableCell className="font-medium capitalize">{rule.category}</TableCell>
                                <TableCell>
                                    <div className="space-y-2">
                                        {rule.retailer_order.length === 0 && <span className="text-xs italic text-muted-foreground">No preferences set</span>}
                                        {rule.retailer_order.map((store, i) => (
                                            <div key={i} className="flex items-center gap-2 border rounded p-1.5 w-fit bg-muted/20">
                                                <span className="text-xs font-semibold w-5 text-center">{i+1}.</span>
                                                <span className="text-sm min-w-24">{store}</span>
                                                <div className="flex gap-1 ml-4 border-l pl-2">
                                                    <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => handleReorder(rule, i, 'up')} disabled={i === 0}>
                                                        <ArrowUp className="h-3 w-3" />
                                                    </Button>
                                                    <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => handleReorder(rule, i, 'down')} disabled={i === rule.retailer_order.length - 1}>
                                                        <ArrowDown className="h-3 w-3" />
                                                    </Button>
                                                    <Button variant="ghost" size="icon" className="h-5 w-5 text-destructive ml-1" onClick={() => handleRemoveStore(rule, store)}>
                                                        <Trash2 className="h-3 w-3" />
                                                    </Button>
                                                </div>
                                            </div>
                                        ))}
                                        <Button variant="outline" size="sm" className="h-7 mt-2 text-xs" onClick={() => handleAddStore(rule)}>
                                            + Add Store
                                        </Button>
                                    </div>
                                </TableCell>
                                <TableCell className="text-right align-top pt-5">
                                    <Button variant="ghost" size="icon" className="text-destructive" onClick={() => {
                                        if (window.confirm(`Delete rule for ${rule.category}?`)) deleteMut.mutate(rule.category)
                                    }}>
                                        <Trash2 className="h-4 w-4" />
                                    </Button>
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </div>
        </div>
    )
}
