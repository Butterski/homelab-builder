import { useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { api } from "../../../lib/api"
import { Button } from "../../../components/ui/button"
import { Input } from "../../../components/ui/input"
import { Badge } from "../../../components/ui/badge"
import {
    Check, X, Trash2, Upload, Search, ChevronDown, ChevronUp,
    Package, AlertCircle, Loader2, Plus, RefreshCw
} from "lucide-react"
import type { HardwareComponent } from "../../catalog/api/use-hardware"

interface AdminHardwareResult {
    data: HardwareComponent[]
    total: number
}

function useAdminHardware(approved?: boolean, search = "") {
    const params = new URLSearchParams()
    if (approved !== undefined) params.set("approved", String(approved))
    if (search) params.set("search", search)
    params.set("limit", "200")
    return useQuery<AdminHardwareResult>({
        queryKey: ["admin-hardware", approved, search],
        queryFn: () => api.get<AdminHardwareResult>(`/api/admin/hardware?${params}`),
        staleTime: 30_000,
    })
}

// ─── Approve / Reject button ──────────────────────────────────────────────────
function ApproveButton({ id, approved }: { id: string; approved: boolean }) {
    const qc = useQueryClient()
    const mut = useMutation({
        mutationFn: (val: boolean) => api.patch(`/api/admin/hardware/${id}/approve`, { approved: val }),
        onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-hardware"] }); qc.invalidateQueries({ queryKey: ["hardware"] }) },
    })
    return approved ? (
        <Button size="sm" variant="outline" className="h-7 px-2 text-xs border-red-300/50 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20"
            onClick={() => mut.mutate(false)} disabled={mut.isPending}>
            {mut.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
        </Button>
    ) : (
        <Button size="sm" className="h-7 px-2 text-xs bg-green-600 hover:bg-green-700"
            onClick={() => mut.mutate(true)} disabled={mut.isPending}>
            {mut.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
        </Button>
    )
}

// ─── Delete button ────────────────────────────────────────────────────────────
function DeleteButton({ id }: { id: string }) {
    const qc = useQueryClient()
    const [confirm, setConfirm] = useState(false)
    const mut = useMutation({
        mutationFn: () => api.del(`/api/admin/hardware/${id}`),
        onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-hardware"] }); qc.invalidateQueries({ queryKey: ["hardware"] }) },
    })
    if (confirm) return (
        <div className="flex gap-1">
            <Button size="sm" variant="destructive" className="h-7 px-2 text-xs" onClick={() => mut.mutate()} disabled={mut.isPending}>
                {mut.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Delete"}
            </Button>
            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setConfirm(false)}>Cancel</Button>
        </div>
    )
    return (
        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive" onClick={() => setConfirm(true)}>
            <Trash2 className="h-3.5 w-3.5" />
        </Button>
    )
}

// ─── Bulk Import Panel ────────────────────────────────────────────────────────
function BulkImportPanel() {
    const qc = useQueryClient()
    const [text, setText] = useState("")
    const [result, setResult] = useState<{ imported?: number; error?: string } | null>(null)
    const [loading, setLoading] = useState(false)

    const handleImport = async () => {
        setResult(null)
        setLoading(true)
        try {
            let items
            try { items = JSON.parse(text) } catch { setResult({ error: "Invalid JSON" }); setLoading(false); return }
            if (!Array.isArray(items)) { setResult({ error: "Expected a JSON array" }); setLoading(false); return }
            const res = await api.post<{ imported: number }>("/api/admin/hardware/bulk-import", items)
            setResult({ imported: res.imported })
            setText("")
            qc.invalidateQueries({ queryKey: ["admin-hardware"] })
            qc.invalidateQueries({ queryKey: ["hardware"] })
        } catch (e: unknown) {
            setResult({ error: e instanceof Error ? e.message : "Import failed" })
        } finally {
            setLoading(false)
        }
    }

    const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (!file) return
        const reader = new FileReader()
        reader.onload = ev => setText(ev.target?.result as string)
        reader.readAsText(file)
        e.target.value = ""
    }

    return (
        <div className="rounded-xl border bg-card p-5 space-y-3">
            <div className="flex items-center justify-between">
                <h3 className="font-semibold text-sm">Bulk Import (JSON)</h3>
                <label className="cursor-pointer">
                    <input type="file" accept=".json" className="hidden" onChange={handleFile} />
                    <Button variant="outline" size="sm" asChild>
                        <span><Upload className="h-3.5 w-3.5 mr-1.5" /> Load JSON file</span>
                    </Button>
                </label>
            </div>
            <textarea
                className="w-full rounded-md border bg-background px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-primary resize-none"
                rows={6}
                placeholder={'[\n  {"category":"router","brand":"Ubiquiti","model":"Dream Machine Pro","price_est":379,"currency":"EUR","spec":{"ports":"8x GbE"},"buy_urls":[]}\n]'}
                value={text}
                onChange={e => setText(e.target.value)}
            />
            {result && (
                result.error
                    ? <p className="text-xs text-destructive bg-destructive/10 rounded px-3 py-2">{result.error}</p>
                    : <p className="text-xs text-green-600 bg-green-500/10 rounded px-3 py-2">✓ Imported {result.imported} components</p>
            )}
            <Button size="sm" onClick={handleImport} disabled={!text.trim() || loading}>
                {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-2" /> : <Plus className="h-3.5 w-3.5 mr-2" />}
                Import
            </Button>
        </div>
    )
}

// ─── Hardware Row ─────────────────────────────────────────────────────────────
function HardwareRow({ item }: { item: HardwareComponent }) {
    const [expanded, setExpanded] = useState(false)
    const specEntries = Object.entries(item.spec).slice(0, 3)

    return (
        <>
            <tr className="border-b hover:bg-muted/30 transition-colors">
                <td className="px-4 py-3">
                    <Badge variant={item.approved ? "default" : "outline"} className={`text-[10px] ${item.approved ? "bg-green-500/10 text-green-600 border-green-300/50" : "text-amber-600 border-amber-300/50"}`}>
                        {item.approved ? "Approved" : "Pending"}
                    </Badge>
                </td>
                <td className="px-4 py-3 text-xs text-muted-foreground capitalize">{item.category}</td>
                <td className="px-4 py-3">
                    <p className="text-xs font-medium text-muted-foreground">{item.brand}</p>
                    <p className="text-sm font-semibold">{item.model}</p>
                </td>
                <td className="px-4 py-3 text-sm font-medium">
                    {item.price_est > 0 ? `~${item.price_est} ${item.currency}` : "—"}
                </td>
                <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                        {specEntries.map(([k, v]) => (
                            <span key={k} className="text-[10px] bg-muted px-1.5 py-0.5 rounded">
                                {k}: {String(v)}
                            </span>
                        ))}
                        {Object.keys(item.spec).length > 3 && (
                            <button onClick={() => setExpanded(e => !e)} className="text-[10px] text-primary hover:underline">
                                {expanded ? "less" : `+${Object.keys(item.spec).length - 3} more`}
                            </button>
                        )}
                    </div>
                </td>
                <td className="px-4 py-3 text-xs text-muted-foreground">{item.likes}</td>
                <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                        <ApproveButton id={item.id} approved={item.approved} />
                        <DeleteButton id={item.id} />
                    </div>
                </td>
            </tr>
            {expanded && (
                <tr className="border-b bg-muted/20">
                    <td colSpan={7} className="px-4 py-2">
                        <div className="flex flex-wrap gap-2">
                            {Object.entries(item.spec).map(([k, v]) => (
                                <span key={k} className="text-[10px] bg-muted px-2 py-1 rounded">
                                    <span className="text-muted-foreground">{k}:</span> {String(v)}
                                </span>
                            ))}
                        </div>
                    </td>
                </tr>
            )}
        </>
    )
}

// ─── Main Component ───────────────────────────────────────────────────────────
type FilterTab = "all" | "pending" | "approved"

export function AdminHardwareManager() {
    const [tab, setTab] = useState<FilterTab>("all")
    const [search, setSearch] = useState("")
    const [showImport, setShowImport] = useState(false)
    const qc = useQueryClient()

    const approved = tab === "all" ? undefined : tab === "approved"
    const { data, isLoading } = useAdminHardware(approved, search)
    const items = data?.data ?? []
    const total = data?.total ?? 0

    const pendingCount = items.filter(i => !i.approved).length

    return (
        <div className="space-y-4">
            {/* Toolbar */}
            <div className="flex flex-wrap items-center gap-3 justify-between">
                <div className="flex gap-1 rounded-lg border p-1 bg-muted/30">
                    {(["all", "pending", "approved"] as FilterTab[]).map(t => (
                        <button
                            key={t}
                            onClick={() => setTab(t)}
                            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors capitalize ${tab === t ? "bg-background" : "hover:bg-muted"}`}
                        >
                            {t}
                            {t === "pending" && pendingCount > 0 && (
                                <span className="ml-1.5 bg-amber-500 text-white text-[10px] rounded-full px-1.5 py-0.5">{pendingCount}</span>
                            )}
                        </button>
                    ))}
                </div>

                <div className="flex gap-2 items-center">
                    <div className="relative">
                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                        <Input
                            placeholder="Search..."
                            className="h-8 pl-8 text-xs w-48"
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                        />
                    </div>
                    <Button variant="ghost" size="sm" className="h-8 px-2" onClick={() => qc.invalidateQueries({ queryKey: ["admin-hardware"] })}>
                        <RefreshCw className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="sm" className="h-8" onClick={() => setShowImport(s => !s)}>
                        {showImport ? <ChevronUp className="h-3.5 w-3.5 mr-1.5" /> : <ChevronDown className="h-3.5 w-3.5 mr-1.5" />}
                        Bulk Import
                    </Button>
                </div>
            </div>

            {/* Bulk import panel */}
            {showImport && <BulkImportPanel />}

            {/* Pending alert */}
            {tab === "all" && pendingCount > 0 && (
                <div className="flex items-center gap-3 rounded-lg border border-amber-300/50 bg-amber-500/10 px-4 py-3 text-sm">
                    <AlertCircle className="h-4 w-4 text-amber-500 shrink-0" />
                    <span><strong>{pendingCount}</strong> component{pendingCount > 1 ? "s" : ""} pending review</span>
                    <button onClick={() => setTab("pending")} className="ml-auto text-xs text-amber-600 hover:underline font-medium">
                        Review now →
                    </button>
                </div>
            )}

            {/* Table */}
            <div className="rounded-xl border overflow-hidden">
                <div className="px-4 py-3 border-b bg-muted/30 flex items-center justify-between">
                    <span className="text-sm font-medium">{total} components</span>
                    <span className="text-xs text-muted-foreground">
                        {tab === "pending" ? "Showing pending review" : tab === "approved" ? "Showing approved" : "Showing all"}
                    </span>
                </div>
                {isLoading ? (
                    <div className="p-8 text-center text-muted-foreground text-sm">
                        <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" />
                        Loading hardware catalog…
                    </div>
                ) : items.length === 0 ? (
                    <div className="p-12 text-center">
                        <Package className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
                        <p className="text-muted-foreground text-sm">No components found</p>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b bg-muted/20">
                                    <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Status</th>
                                    <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Category</th>
                                    <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Brand / Model</th>
                                    <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Price</th>
                                    <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Specs</th>
                                    <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Likes</th>
                                    <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {items.map(item => <HardwareRow key={item.id} item={item} />)}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    )
}
