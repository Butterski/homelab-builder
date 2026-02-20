import { useState, useMemo } from "react"
import { useBuilderStore } from "../../builder/store/builder-store"
import { useUserSelections, useAddSelection, useRemoveSelection } from "../api/use-services"
import { Input } from "../../../components/ui/input"
import {
    Search, Heart, Package, Book, Globe
} from "lucide-react"
import type { Service } from "../../../types"
import { Github } from "../../../components/icons/github"

function ServiceCard({ item, isFavorite, selectionId }: { item: Service, isFavorite: boolean, selectionId?: string }) {
    const addSelection = useAddSelection()
    const removeSelection = useRemoveSelection()

    const handleFavorite = () => {
        if (isFavorite && selectionId) {
            removeSelection.mutate(selectionId)
        } else {
            addSelection.mutate(item.id)
        }
    }

    const tagsArray: string[] = Array.isArray(item.tags) ? item.tags : (typeof item.tags === 'string' ? JSON.parse(item.tags || '[]') : [])

    return (
        <div className="group rounded-xl border bg-card hover:border-primary/40 hover:shadow-md transition-all duration-200 overflow-hidden flex flex-col h-full">
            <div className="p-4 flex items-start gap-4 flex-1">
                <div className="p-2.5 rounded-lg shrink-0 text-blue-500 bg-blue-500/10">
                    <Package className="h-6 w-6" />
                </div>
                <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2 max-w-full">
                        <div className="truncate">
                            <h3 className="font-semibold text-base truncate">{item.name}</h3>
                            <p className="text-xs text-muted-foreground capitalize mt-0.5">{item.category}</p>
                        </div>
                        <button
                            onClick={handleFavorite}
                            className={`shrink-0 p-1.5 rounded-md hover:bg-muted/60 transition-colors ${isFavorite ? "text-red-500 hover:text-red-400" : "text-muted-foreground hover:text-red-400"}`}
                        >
                            <Heart className={`h-4 w-4 ${isFavorite ? "fill-red-500" : ""}`} />
                        </button>
                    </div>
                    <p className="text-sm text-foreground/80 mt-2 line-clamp-3">
                        {item.description || "No description provided."}
                    </p>
                </div>
            </div>

            <div className="border-t px-4 py-3 bg-muted/20 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                 <div className="flex gap-1.5 flex-wrap">
                    {tagsArray.slice(0, 3).map(tag => (
                        <span key={tag} className="px-1.5 py-0.5 rounded-md bg-muted text-[10px] font-medium border">
                            {tag}
                        </span>
                    ))}
                 </div>
                 <div className="flex gap-2">
                    {item.official_website && (
                        <a href={item.official_website} target="_blank" rel="noreferrer" title="Website" className="hover:text-primary transition-colors">
                            <Globe className="h-4 w-4" />
                        </a>
                    )}
                    {item.docs_url && (
                        <a href={item.docs_url} target="_blank" rel="noreferrer" title="Documentation" className="hover:text-primary transition-colors">
                            <Book className="h-4 w-4" />
                        </a>
                    )}
                    {item.github_url && (
                        <a href={item.github_url} target="_blank" rel="noreferrer" title="GitHub" className="hover:text-primary transition-colors">
                            <Github className="h-4 w-4" />
                        </a>
                    )}
                 </div>
            </div>
        </div>
    )
}

export default function ServiceCatalogPage() {
    const { availableServices, fetchServices } = useBuilderStore()
    const { data: selectionsData, isLoading } = useUserSelections()
    const [search, setSearch] = useState("")
    const [category, setCategory] = useState("")

    if (availableServices.length === 0) {
        fetchServices() // Ensure they are loaded if arriving directly
    }

    const selections = selectionsData?.data || []
    const favSet = useMemo(() => {
        const map = new Map<string, string>()
        selections.forEach(s => map.set(s.service_id, s.id))
        return map
    }, [selections])

    // Filter Logic
    const items = useMemo(() => {
        let res = availableServices
        if (category === "favorites") {
            res = res.filter(s => favSet.has(s.id))
        } else if (category && category !== "all") {
            res = res.filter(s => s.category.toLowerCase() === category.toLowerCase())
        }
        if (search) {
            const lowSearch = search.toLowerCase()
            res = res.filter(s => 
                s.name.toLowerCase().includes(lowSearch) || 
                s.description?.toLowerCase().includes(lowSearch)
            )
        }
        return res
    }, [availableServices, category, search, favSet])

    const categories = useMemo(() => {
        const cats = new Set(availableServices.map(s => s.category))
        return Array.from(cats).sort()
    }, [availableServices])

    return (
        <div className="space-y-6 max-w-7xl mx-auto py-8 px-6">
            <div className="flex items-start justify-between">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Service Library</h1>
                    <p className="text-muted-foreground mt-1">
                        Discover and favorite self-hosted services for your homelab
                    </p>
                </div>
            </div>

            <div className="flex flex-wrap gap-3 items-center">
                <div className="relative flex-1 min-w-[200px] max-w-sm">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input placeholder="Search services..." className="pl-9" value={search} onChange={e => setSearch(e.target.value)} />
                </div>
            </div>

            <div className="flex flex-wrap gap-2">
                <button
                    onClick={() => setCategory("")}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${!category || category === "all" ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-muted"}`}
                >All</button>
                <button
                    onClick={() => setCategory("favorites")}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${category === "favorites" ? "bg-red-500/10 text-red-500 border-red-500/20" : "border-border hover:bg-muted"}`}
                >
                    <Heart className={`h-3 w-3 ${category === "favorites" ? "fill-red-500" : ""}`} />
                    Favorites
                </button>
                {categories.map(cat => (
                    <button
                        key={cat}
                        onClick={() => setCategory(cat === category ? "" : cat)}
                        className={`px-3 py-1.5 rounded-full text-xs font-medium border capitalize transition-colors ${cat === category ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-muted"}`}
                    >
                        {cat}
                    </button>
                ))}
            </div>

            {items.length === 0 && !isLoading ? (
                <div className="flex flex-col items-center justify-center py-20 text-center">
                    <Book className="h-12 w-12 text-muted-foreground/40 mb-4" />
                    <h3 className="font-semibold text-lg mb-1">No services found</h3>
                    <p className="text-muted-foreground text-sm">Try adjusting your filters.</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {items.map(item => (
                        <ServiceCard 
                            key={item.id} 
                            item={item} 
                            isFavorite={favSet.has(item.id)} 
                            selectionId={favSet.get(item.id)} 
                        />
                    ))}
                </div>
            )}
        </div>
    )
}
