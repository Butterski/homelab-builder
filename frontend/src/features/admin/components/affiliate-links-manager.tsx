import { useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { api } from "../../../services/api"
import { Button } from "../../../components/ui/button"
import { Input } from "../../../components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../../components/ui/table"
import type { CatalogComponent } from "../../../types"
import { Link, Plus, Trash2, Beaker } from "lucide-react"

export interface AdminHardwareResult {
    data: CatalogComponent[]
    total: number
}

export function AffiliateLinksManager() {
    const qc = useQueryClient()
    const [mockUrlDest, setMockUrlDest] = useState("")

    const { data, isLoading } = useQuery({
        queryKey: ["admin-hardware-links"],
        queryFn: () => api.getHardwareAdmin()
    })

    const updateLinksMut = useMutation({
        mutationFn: ({ id, buy_urls, affiliate_tag }: { id: string, buy_urls: any[], affiliate_tag: string }) => 
            api.updateHardwareBuyUrls(id, { buy_urls, affiliate_tag }),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["admin-hardware-links"] })
        }
    })

    const handleAddLink = (comp: CatalogComponent, urlToAdd: string) => {
        if (!urlToAdd) return
        const currentLinks = Array.isArray(comp.buy_urls) ? comp.buy_urls : []
        const newLinkObj = { url: urlToAdd, store: "Proxy Shop" } // Mock format
        updateLinksMut.mutate({ 
            id: comp.id, 
            buy_urls: [...currentLinks, newLinkObj],
            affiliate_tag: comp.affiliate_tag || "hlb-default-tag"
        })
    }

    const handleGenerateMock = (comp: CatalogComponent) => {
        if (!mockUrlDest) return
        const proxyUrl = `https://mock.retailer.local/item?q=${encodeURIComponent(comp.model)}`
        handleAddLink(comp, proxyUrl)
        setMockUrlDest("")
    }

    const handleRemoveLink = (comp: CatalogComponent, indexToRemove: number) => {
        const currentLinks = Array.isArray(comp.buy_urls) ? comp.buy_urls : []
        const newLinks = currentLinks.filter((_: any, idx: number) => idx !== indexToRemove)
        updateLinksMut.mutate({ 
            id: comp.id, 
            buy_urls: newLinks,
            affiliate_tag: comp.affiliate_tag || ""
        })
    }

    if (isLoading) return <div>Loading...</div>

    return (
        <div className="space-y-4">
            <div className="flex justify-between items-center">
                <h3 className="text-lg font-medium">Affiliate Links Management</h3>
                <div className="flex gap-2 items-center">
                    <Input 
                        placeholder="Mock destination baseline (e.g. x-kom.pl)" 
                        value={mockUrlDest}
                        onChange={e => setMockUrlDest(e.target.value)}
                        className="w-64"
                    />
                </div>
            </div>

            <div className="rounded-md border">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Category</TableHead>
                            <TableHead>Component</TableHead>
                            <TableHead>Affiliate Tag</TableHead>
                            <TableHead>Purchase Links</TableHead>
                            <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {data?.data?.map((comp: CatalogComponent) => {
                            const links = Array.isArray(comp.buy_urls) ? comp.buy_urls : []
                            return (
                                <TableRow key={comp.id}>
                                    <TableCell className="font-medium capitalize">{comp.category}</TableCell>
                                    <TableCell>
                                        <div className="font-semibold">{comp.brand} {comp.model}</div>
                                        <div className="text-xs text-muted-foreground">{comp.price_est} {comp.currency}</div>
                                    </TableCell>
                                    <TableCell>
                                        <code className="text-xs bg-muted p-1 rounded">{comp.affiliate_tag || "None"}</code>
                                    </TableCell>
                                    <TableCell>
                                        <div className="space-y-1">
                                            {links.length === 0 && <span className="text-xs text-muted-foreground italic">No links configured</span>}
                                            {links.map((v: any, i: number) => (
                                                <div key={i} className="flex items-center gap-2 text-xs border rounded p-1 bg-background">
                                                    <Link className="h-3 w-3 text-muted-foreground" />
                                                    <span className="truncate max-w-[200px]" title={v.url || v}>{v.url || v}</span>
                                                    <Button variant="ghost" size="icon" className="h-4 w-4 ml-auto" onClick={() => handleRemoveLink(comp, i)}>
                                                        <Trash2 className="h-3 w-3 text-destructive" />
                                                    </Button>
                                                </div>
                                            ))}
                                        </div>
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <div className="flex justify-end gap-1">
                                            <Button variant="outline" size="sm" onClick={() => handleGenerateMock(comp)} disabled={!mockUrlDest || updateLinksMut.isPending}>
                                                <Beaker className="h-4 w-4 mr-1" /> Mock URL
                                            </Button>
                                            <Button variant="default" size="sm" onClick={() => {
                                                const url = prompt("Enter full buy URL:")
                                                if (url) handleAddLink(comp, url)
                                            }} disabled={updateLinksMut.isPending}>
                                                <Plus className="h-4 w-4" /> Add
                                            </Button>
                                        </div>
                                    </TableCell>
                                </TableRow>
                            )
                        })}
                    </TableBody>
                </Table>
            </div>
        </div>
    )
}
