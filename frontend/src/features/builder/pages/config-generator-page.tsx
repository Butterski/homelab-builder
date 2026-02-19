import { useState, useCallback, useMemo, useEffect } from "react"
import { useBuilderStore } from "../store/builder-store"
import { buildApi } from "../api/builds"
import {
    generateDockerCompose,
    generateDotEnv,
    generateAnsibleInventory,
    generateAnsiblePlaybook,
    generateNginxConfig,
    generateTraefikLabels,
    generateIpPlan,
} from "../lib/config-generator"
// allocateIPs removed
import type { IpAllocatorOptions } from "../lib/config-generator" // Use type from lib
import { Button } from "../../../components/ui/button"
import { Input } from "../../../components/ui/input"
import {
    Download, Upload, Copy, Check, FileCode, Server, Settings,
    Globe, Package, AlertCircle, ChevronDown, ChevronUp, Network, Home
} from "lucide-react"
import { toast } from "sonner"

type Tab = 'docker-compose' | 'env' | 'ansible-inventory' | 'ansible-playbook' | 'nginx' | 'traefik' | 'ip-plan'

const TABS: { id: Tab; label: string; icon: React.ElementType; ext: string }[] = [
    { id: 'docker-compose',     label: 'Docker Compose',    icon: Package,   ext: 'docker-compose.yml' },
    { id: 'env',                label: '.env',              icon: Settings,  ext: '.env' },
    { id: 'ansible-inventory',  label: 'Ansible Inventory', icon: Server,    ext: 'inventory.ini' },
    { id: 'ansible-playbook',   label: 'Ansible Playbook',  icon: FileCode,  ext: 'playbook.yml' },
    { id: 'nginx',              label: 'Nginx Config',      icon: Globe,     ext: 'nginx.conf' },
    { id: 'traefik',            label: 'Traefik Labels',    icon: Globe,     ext: 'traefik-labels.yml' },
    { id: 'ip-plan',            label: 'IP Address Plan',   icon: Network,   ext: 'ip-plan.txt' },
]

// IpLegend removed as it relied on client-side calculation


// ─── Code Block ───────────────────────────────────────────────────────────────
function CodeBlock({ content, filename }: { content: string; filename: string }) {
    const [copied, setCopied] = useState(false)

    const copy = () => {
        navigator.clipboard.writeText(content)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
    }

    const download = () => {
        const blob = new Blob([content], { type: 'text/plain' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = filename
        a.click()
        URL.revokeObjectURL(url)
    }

    return (
        <div className="rounded-xl border overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2 bg-muted/60 border-b">
                <span className="text-xs font-mono text-muted-foreground">{filename}</span>
                <div className="flex gap-2">
                    <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={copy}>
                        {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
                        {copied ? 'Copied!' : 'Copy'}
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={download}>
                        <Download className="h-3.5 w-3.5 mr-1" /> Download
                    </Button>
                </div>
            </div>
            <pre className="overflow-auto p-4 text-xs font-mono bg-[#0d1117] text-[#e6edf3] max-h-[500px] leading-relaxed">
                <code>{content}</code>
            </pre>
        </div>
    )
}

// ─── Import Section ───────────────────────────────────────────────────────────
function ImportSection() {
    const importLab = useBuilderStore(s => s.importLab)
    const [error, setError] = useState('')
    const [success, setSuccess] = useState(false)

    const handleFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (!file) return
        const reader = new FileReader()
        reader.onload = (ev) => {
            const text = ev.target?.result as string
            const result = importLab(text)
            if (result.ok) {
                setSuccess(true)
                setError('')
                setTimeout(() => setSuccess(false), 3000)
            } else {
                setError(result.error ?? 'Import failed')
            }
        }
        reader.readAsText(file)
        e.target.value = ''
    }, [importLab])

    return (
        <label className="flex items-center gap-2 cursor-pointer">
            <input type="file" accept=".json,.homelab.json" className="hidden" onChange={handleFile} />
            <Button variant="outline" size="sm" asChild>
                <span>
                    {success
                        ? <><Check className="h-4 w-4 mr-2 text-green-500" /> Imported!</>
                        : <><Upload className="h-4 w-4 mr-2" /> Import Lab</>
                    }
                </span>
            </Button>
            {error && <span className="text-xs text-destructive">{error}</span>}
        </label>
    )
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function ConfigGeneratorPage() {
    const { selectedServices, hardwareNodes, exportLab, loadBuild, clearCurrentBuild } = useBuilderStore()
    const [activeTab, setActiveTab] = useState<Tab>('docker-compose')
    const [domain, setDomain] = useState('homelab.local')
    const [labName, setLabName] = useState('my-homelab')
    const [showSettings, setShowSettings] = useState(false)
    
    // Multi-project selection
    const [builds, setBuilds] = useState<{id: string, name: string}[]>([])
    const [selectedBuildId, setSelectedBuildId] = useState<string>("")
    const [loadingBuild, setLoadingBuild] = useState(false)

    // Load project list on mount
    useEffect(() => {
        buildApi.list().then(list => {
            setBuilds(list.map(b => ({ id: b.id, name: b.name })))
            // If store has a build, try to match it
            const current = useBuilderStore.getState().currentBuildId
            if (current) setSelectedBuildId(current)
            else if (list.length > 0) {
                 // Optionally load first one automatically? 
                 // Better to let user choose or stay empty if they navigated here without opening a project
                 // But user complaint is "chooses first one only", implies auto-selection.
                 // Let's default to the first one if nothing loaded.
                 handleSelectBuild(list[0].id)
            }
        }).catch(err => console.error("Failed to list builds", err))
    }, [])

    const handleSelectBuild = async (id: string) => {
        if (!id) return
        console.log(`[ConfigGen] Switching to build ID: ${id}`)
        setLoadingBuild(true)
        setSelectedBuildId(id)
        try {
             const fullBuild = await buildApi.get(id)
             console.log(`[ConfigGen] Fetched build: ${fullBuild.name}`, fullBuild)
             let data = {}
             try {
                data = JSON.parse(fullBuild.data)
             } catch (e) {
                 console.error("[ConfigGen] JSON parse error for build data", e)
                 toast.error("Failed to parse build data")
             }
             
             console.log(`[ConfigGen] Loading data into store...`, data)
             console.log(`[ConfigGen] Loading data into store...`, data)
             loadBuild(fullBuild.id, fullBuild.name, data)
             setLabName(fullBuild.name.toLowerCase().replace(/[^a-z0-9]/g, '-'))
             setLabName(fullBuild.name.toLowerCase().replace(/[^a-z0-9]/g, '-'))
             toast.success(`Loaded project: ${fullBuild.name}`)
        } catch (e) {
            console.error("[ConfigGen] Failed to load build", e)
            toast.error("Failed to load project - it may have been deleted")
            clearCurrentBuild()
            setSelectedBuildId("")
        } finally {
            setLoadingBuild(false)
        }
    }

    // IP settings
    // IP settings (Defaults)
    // const [baseIp, setBaseIp] = useState('192.168.1.0')
    // const [cidr, setCidr] = useState(24)
    // const [homeRouterMode, setHomeRouterMode] = useState(false)
    // const [homeReserve, setHomeReserve] = useState(50)



    const ipOpts: IpAllocatorOptions = useMemo(() => ({
        baseIp: '192.168.1.0',
        cidr: 24,
        homeRouterMode: false,
        homeReserve: 50,
    }), [])

    // Derive comprehensive service list from both Shopping List (selectedServices) AND Visual Builder placements (hardwareNodes)
    const allServices = useMemo(() => {
        const fromNodes = new Map<string, any>(); // Using any to avoid strict Service type construction for minimal mock

        hardwareNodes.forEach(node => {
            node.vms?.forEach(vm => {
                if (vm.type === 'container' || vm.type === 'vm') {
                     if (!fromNodes.has(vm.name)) {
                         fromNodes.set(vm.name, {
                             id: vm.id, // Use VM ID
                             name: vm.name,
                             description: 'Deployed in Visual Builder',
                             category: 'other',
                             icon: 'Package',
                             official_website: '',
                             docker_support: true,
                             is_active: true,
                             requirements: null,
                             created_at: new Date().toISOString()
                         });
                    }
                }
            })
        });

        // Start with selectedServices
        const combined = [...selectedServices];
        
        // Add any from nodes that aren't already in list (deduplicate by Name)
        fromNodes.forEach((svc, name) => {
            if (!combined.find(s => s.name === name)) {
                combined.push(svc);
            }
        });
        return combined;
    }, [selectedServices, hardwareNodes]);

    const hasContent = allServices.length > 0 || hardwareNodes.length > 0

    function getContent(tab: Tab): string {
        switch (tab) {
            case 'docker-compose':    return generateDockerCompose(allServices, hardwareNodes)
            case 'env':               return generateDotEnv(allServices)
            case 'ansible-inventory': return generateAnsibleInventory(hardwareNodes, ipOpts)
            case 'ansible-playbook':  return generateAnsiblePlaybook(allServices, hardwareNodes)
            case 'nginx':             return generateNginxConfig(allServices, domain)
            case 'traefik':           return generateTraefikLabels(allServices, domain)
            case 'ip-plan':           return generateIpPlan(hardwareNodes, ipOpts)
        }
    }

    const activeTabMeta = TABS.find(t => t.id === activeTab)!
    const content = getContent(activeTab)

    return (
        <div className="space-y-6 max-w-6xl mx-auto py-8 px-6">
            {/* Header */}
            <div className="flex items-start justify-between flex-wrap gap-4">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Config Generator</h1>
                    <p className="text-muted-foreground mt-1">
                        Generate deployment configs from your Visual Builder design
                    </p>
                </div>
                
                <div className="flex items-center gap-3">
                     {loadingBuild && <span className="text-xs text-muted-foreground animate-pulse">Loading...</span>}
                     <select
                        className="h-9 w-[200px] rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                        value={selectedBuildId}
                        onChange={(e) => handleSelectBuild(e.target.value)}
                     >
                         <option value="" disabled>Select Project</option>
                         {builds.map(b => (
                             <option key={b.id} value={b.id}>{b.name}</option>
                         ))}
                     </select>
                </div>

                <div className="flex gap-2 flex-wrap mr-16">
                    <ImportSection />
                    <Button variant="outline" size="sm" onClick={() => exportLab(labName)} disabled={!hasContent}>
                        <Download className="h-4 w-4 mr-2" /> Export Lab (.homelab.json)
                    </Button>
                </div>
            </div>

            {/* Empty state */}
            {!hasContent && (
                <div className="rounded-xl border border-dashed p-12 text-center">
                    <AlertCircle className="h-10 w-10 text-muted-foreground/40 mx-auto mb-4" />
                    <h3 className="font-semibold text-lg mb-2">No lab design yet</h3>
                    <p className="text-muted-foreground text-sm mb-4">
                        Go to the <strong>Visual Builder</strong> and add services and hardware nodes, then come back here to generate configs.
                    </p>
                    <Button variant="outline" size="sm" asChild>
                        <a href="/builder">Open Visual Builder →</a>
                    </Button>
                </div>
            )}

            {hasContent && (
                <>
                    {/* Stats bar */}
                    <div className="flex flex-wrap gap-3">
                        <div className="flex items-center gap-2 rounded-lg border bg-card px-4 py-2 text-sm">
                            <Package className="h-4 w-4 text-primary" />
                            <span className="font-medium">{selectedServices.length}</span>
                            <span className="text-muted-foreground">services</span>
                        </div>
                        <div className="flex items-center gap-2 rounded-lg border bg-card px-4 py-2 text-sm">
                            <Server className="h-4 w-4 text-primary" />
                            <span className="font-medium">{hardwareNodes.length}</span>
                            <span className="text-muted-foreground">hardware nodes</span>
                        </div>
                        <div className="flex items-center gap-2 rounded-lg border bg-card px-4 py-2 text-sm">
                            <Network className="h-4 w-4 text-primary" />
                            <span className="font-medium font-mono">{ipOpts.baseIp}/{ipOpts.cidr}</span>
                            <span className="text-muted-foreground">subnet</span>
                        </div>
                        {ipOpts.homeRouterMode && (
                            <div className="flex items-center gap-2 rounded-lg border border-amber-300/50 bg-amber-500/10 px-4 py-2 text-sm">
                                <Home className="h-4 w-4 text-amber-500" />
                                <span className="text-amber-600 dark:text-amber-400">{ipOpts.homeReserve} IPs reserved for home devices</span>
                            </div>
                        )}
                    </div>

                    {/* Settings panel */}
                    <div className="rounded-xl border bg-card overflow-hidden">
                        <button
                            className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium hover:bg-muted/50 transition-colors"
                            onClick={() => setShowSettings(s => !s)}
                        >
                            <span className="flex items-center gap-2">
                                <Settings className="h-4 w-4 text-muted-foreground" />
                                Generator Settings
                            </span>
                            {showSettings ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                        </button>
                        {showSettings && (
                            <div className="border-t px-4 py-4 space-y-4">
                                {/* Row 1: general */}
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    <div>
                                        <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Lab Name</label>
                                        <Input value={labName} onChange={e => setLabName(e.target.value)} placeholder="my-homelab" className="h-8 text-sm" />
                                        <p className="text-xs text-muted-foreground mt-1">Used for export filename</p>
                                    </div>
                                    <div>
                                        <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Domain</label>
                                        <Input value={domain} onChange={e => setDomain(e.target.value)} placeholder="homelab.local" className="h-8 text-sm" />
                                        <p className="text-xs text-muted-foreground mt-1">Used in Nginx/Traefik configs</p>
                                    </div>
                                </div>

                                    {/* IP settings removed as they are now handled by backend */ }
                                    <div className="text-sm text-muted-foreground italic p-4">
                                        IP Allocation settings are now managed securely by the backend.
                                    </div>
                                </div>
                        )}
                    </div>

                    {/* IP Zone Legend removed */}

                    {/* Tab bar */}
                    <div className="flex flex-wrap gap-2">
                        {TABS.map(tab => {
                            const Icon = tab.icon
                            return (
                                <button
                                    key={tab.id}
                                    onClick={() => setActiveTab(tab.id)}
                                    className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
                                        activeTab === tab.id
                                            ? 'bg-primary text-primary-foreground border-primary'
                                            : 'border-border hover:bg-muted'
                                    }`}
                                >
                                    <Icon className="h-4 w-4" />
                                    {tab.label}
                                </button>
                            )
                        })}
                    </div>

                    {/* Code block */}
                    <CodeBlock content={content} filename={activeTabMeta.ext} />

                    {/* Download all */}
                    <div className="flex items-center justify-between border-t pt-4 flex-wrap gap-3">
                        <p className="text-sm text-muted-foreground">
                            Download all configs as individual files, or export the full lab design as JSON.
                        </p>
                        <div className="flex flex-wrap gap-2">
                            {TABS.map(tab => (
                                <Button
                                    key={tab.id}
                                    variant="ghost"
                                    size="sm"
                                    className="text-xs"
                                    onClick={() => {
                                        const c = getContent(tab.id)
                                        const blob = new Blob([c], { type: 'text/plain' })
                                        const url = URL.createObjectURL(blob)
                                        const a = document.createElement('a')
                                        a.href = url
                                        a.download = tab.ext
                                        a.click()
                                        URL.revokeObjectURL(url)
                                    }}
                                >
                                    <Download className="h-3 w-3 mr-1" />
                                    {tab.ext}
                                </Button>
                            ))}
                        </div>
                    </div>
                </>
            )}
        </div>
    )
}
