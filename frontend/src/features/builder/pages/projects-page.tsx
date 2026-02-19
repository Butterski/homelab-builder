import { useState, useEffect } from "react"
import { useNavigate } from "react-router-dom"
import { useAuth } from "../../admin/hooks/use-auth"
import { Plus, Folder, Clock, MoreVertical, Trash2, Edit2, Play, HardDrive, Search } from "lucide-react" 
// Removed unused imports: ExternalLink, Cpu
import { Button } from "../../../components/ui/button"
import { Card } from "../../../components/ui/card"
import { Badge } from "../../../components/ui/badge"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "../../../components/ui/dropdown-menu"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../../../components/ui/dialog"
import { Input } from "../../../components/ui/input"
import { Label } from "../../../components/ui/label"
import { toast } from "sonner"
import { buildApi, type Build } from "../api/builds"
import { useBuilderStore } from "../store/builder-store"
import { formatDistanceToNow } from "date-fns"

export default function ProjectsPage() {
    const navigate = useNavigate()
    const { user } = useAuth()
    const isAuthenticated = !!user
    const { loadBuild } = useBuilderStore()
    const [builds, setBuilds] = useState<Build[]>([])
    const [loading, setLoading] = useState(true)
    const [search, setSearch] = useState("")

    // Modal states
    const [isCreateOpen, setIsCreateOpen] = useState(false)
    const [newProjectName, setNewProjectName] = useState("")
    const [isDeleteOpen, setIsDeleteOpen] = useState(false)
    const [projectToDelete, setProjectToDelete] = useState<string | null>(null)

    useEffect(() => {
        if (isAuthenticated) {
            fetchBuilds()
        } else {
            setLoading(false)
        }
    }, [isAuthenticated])

    const fetchBuilds = async () => {
        try {
            const data = await buildApi.list()
            setBuilds(data)
        } catch (error) {
            console.error("Failed to fetch builds", error)
            toast.error("Failed to load projects")
        } finally {
            setLoading(false)
        }
    }

    const handleCreateNew = () => {
        setNewProjectName("New Project")
        setIsCreateOpen(true)
    }

    const confirmCreate = async () => {
        try {
            const name = newProjectName.trim() || "New Project"
            const newBuild = await buildApi.create({
                name: name,
                data: JSON.stringify({}), // Empty state
                thumbnail: "",
            });
            
            // Navigate to builder
            // Navigate to builder
            loadBuild(newBuild.id, newBuild.name, {})
            toast.success("Project created successfully")
            toast.success("Project created successfully")
            navigate(`/builder/${newBuild.id}`)
        } catch (error) {
            console.error("Failed to create", error)
            toast.error("Failed to create project")
        } finally {
            setIsCreateOpen(false)
        }
    }

    const handleOpen = (build: Build) => {
        // Just navigate, let the builder page fetch the full data
        navigate(`/builder/${build.id}`)
    }

    const handleDelete = (e: React.MouseEvent, id: string) => {
        e.stopPropagation()
        setProjectToDelete(id)
        setIsDeleteOpen(true)
    }

    const confirmDelete = async () => {
        if (!projectToDelete) return
        try {
            await buildApi.delete(projectToDelete)
            setBuilds(prev => prev.filter(b => b.id !== projectToDelete))
            toast.success("Project deleted")
        } catch (error) {
            console.error("Failed to delete", error)
            toast.error("Failed to delete project")
        } finally {
            setIsDeleteOpen(false)
            setProjectToDelete(null)
        }
    }

    const filteredBuilds = builds.filter(b => 
        b.name.toLowerCase().includes(search.toLowerCase())
    )

    return (
        <div className="container mx-auto py-8 px-4 max-w-7xl">
            <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 mb-8">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">My Projects</h1>
                    <p className="text-muted-foreground mt-1">
                        Manage your homelab designs and configurations.
                    </p>
                </div>
                <div className="flex items-center gap-2 w-full md:w-auto">
                    <div className="relative flex-1 md:w-64">
                        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                        <Input 
                            placeholder="Search projects..." 
                            className="pl-9" 
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                        />
                    </div>
                    <Button onClick={handleCreateNew}>
                        <Plus className="mr-2 h-4 w-4" /> New Project
                    </Button>
                </div>
            </div>

            {loading ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                   {[1,2,3].map(i => (
                       <div key={i} className="h-64 rounded-xl border bg-muted/20 animate-pulse" />
                   ))}
                </div>
            ) : filteredBuilds.length === 0 ? (
                <div className="text-center py-20 border-2 border-dashed rounded-xl">
                    <div className="bg-primary/10 p-4 rounded-full w-fit mx-auto mb-4">
                        <Folder className="h-8 w-8 text-primary" />
                    </div>
                    <h3 className="text-lg font-semibold mb-2">No projects found</h3>
                    <p className="text-muted-foreground mb-6 max-w-sm mx-auto">
                        Get started by creating your first homelab design. You can visualize your network and generate configs.
                    </p>
                    <Button onClick={handleCreateNew}>Create Project</Button>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {filteredBuilds.map(build => {
                        // Quick stats parsing
                        let nodeCount = 0
                        try {
                            if (build.data) {
                                const d = JSON.parse(build.data)
                                if (d.nodes) nodeCount = d.nodes.filter((n: any) => n.type==='hardware').length
                            }
                        } catch {}

                        return (
                            <Card 
                                key={build.id} 
                                className="group cursor-pointer hover:border-primary/50 transition-all hover:shadow-md overflow-hidden flex flex-col"
                                onClick={() => handleOpen(build)}
                            >
                                <div className="aspect-video bg-muted/30 relative border-b flex items-center justify-center group-hover:bg-muted/50 transition-colors">
                                    {build.thumbnail ? (
                                        <img src={build.thumbnail} alt={build.name} className="w-full h-full object-cover" />
                                    ) : (
                                        <div className="flex flex-col items-center gap-2 text-muted-foreground/40">
                                            <Folder className="h-12 w-12" />
                                        </div>
                                    )}
                                    
                                    <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <DropdownMenu>
                                            <DropdownMenuTrigger asChild>
                                                <Button variant="secondary" size="icon" className="h-8 w-8" onClick={e => e.stopPropagation()}>
                                                    <MoreVertical className="h-4 w-4" />
                                                </Button>
                                            </DropdownMenuTrigger>
                                            <DropdownMenuContent align="end">
                                                <DropdownMenuItem onClick={(e) => { e.stopPropagation(); handleOpen(build) }}>
                                                    <Edit2 className="mr-2 h-4 w-4" /> Edit
                                                </DropdownMenuItem>
                                                <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={(e) => handleDelete(e, build.id)}>
                                                    <Trash2 className="mr-2 h-4 w-4" /> Delete
                                                </DropdownMenuItem>
                                            </DropdownMenuContent>
                                        </DropdownMenu>
                                    </div>
                                </div>
                                
                                <div className="p-4 flex-1 flex flex-col">
                                    <div className="flex items-start justify-between mb-2">
                                        <h3 className="font-semibold truncate pr-2" title={build.name}>{build.name}</h3>
                                        <Badge variant="secondary" className="text-[10px] shrink-0">
                                            v1.0
                                        </Badge>
                                    </div>
                                    
                                    <div className="mt-auto space-y-3">
                                        <div className="flex items-center gap-4 text-xs text-muted-foreground">
                                            <div className="flex items-center gap-1.5">
                                                <HardDrive className="h-3.5 w-3.5" />
                                                {nodeCount} Nodes
                                            </div>
                                            <div className="flex items-center gap-1.5">
                                                <Clock className="h-3.5 w-3.5" />
                                                {formatDistanceToNow(new Date(build.updated_at), { addSuffix: true })}
                                            </div>
                                        </div>

                                        <div className="pt-3 border-t flex items-center gap-2">
                                            <Button size="sm" className="w-full" onClick={(e) => { e.stopPropagation(); handleOpen(build) }}>
                                                <Play className="mr-2 h-3.5 w-3.5" /> Open Editor
                                            </Button>
                                        </div>
                                    </div>
                                </div>
                            </Card>
                        )
                    })}
                </div>
            )}

            {/* Create Project Modal */}
            <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Create New Project</DialogTitle>
                        <DialogDescription>
                            Give your homelab project a name to get started. You can change this later.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="py-4">
                        <Label htmlFor="project-name" className="mb-2 block">Project Name</Label>
                        <Input 
                            id="project-name" 
                            value={newProjectName} 
                            onChange={(e) => setNewProjectName(e.target.value)} 
                            placeholder="e.g. Dream Lab 2026"
                            autoFocus
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') confirmCreate()
                            }}
                        />
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setIsCreateOpen(false)}>Cancel</Button>
                        <Button onClick={confirmCreate}>Create Project</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Delete Confirmation Modal */}
            <Dialog open={isDeleteOpen} onOpenChange={setIsDeleteOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Delete Project?</DialogTitle>
                        <DialogDescription>
                            Are you sure you want to delete this project? This action cannot be undone.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setIsDeleteOpen(false)}>Cancel</Button>
                        <Button variant="destructive" onClick={confirmDelete}>Delete</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
