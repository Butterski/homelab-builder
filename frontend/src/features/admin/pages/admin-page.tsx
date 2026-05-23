import { useAdminStats, useAdminServices, useAdminUsers } from "../api/use-admin"
import { AdminStats } from "../components/admin-stats"
import { ServiceDialog } from "../components/service-dialog"
import { Skeleton } from "../../../components/ui/skeleton"
import { LoadingScreen } from "../../../components/ui/loading-screen"
import { ServicesTable } from "../components/services-table"
import { AdminHardwareManager } from "../components/hardware-manager"
import { SteeringRulesManager } from "../components/steering-rules-manager"
import { CatalogComponentsManager } from "../components/catalog-components-manager"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/card"
import { Button } from "../../../components/ui/button"
import { useState, useEffect } from "react"
import { Download, Shield, Network, Server, Cpu, Search } from "lucide-react"

import { useAuth } from "../hooks/use-auth"
import { Navigate } from "react-router-dom"

function AnimatedCounter({ value, decimals = 0 }: { value: number; decimals?: number }) {
  const [current, setCurrent] = useState(0)

  useEffect(() => {
    let start = 0
    const end = value
    if (start === end) {
      setCurrent(end)
      return
    }

    const duration = 1000 // 1 second
    const startTime = performance.now()
    let animationFrameId: number

    const updateCounter = (now: number) => {
      const elapsed = now - startTime
      const progress = Math.min(elapsed / duration, 1)
      const easeProgress = progress * (2 - progress) // easeOutQuad
      
      const nextValue = start + easeProgress * (end - start)
      setCurrent(nextValue)

      if (progress < 1) {
        animationFrameId = requestAnimationFrame(updateCounter)
      } else {
        setCurrent(end)
      }
    }

    animationFrameId = requestAnimationFrame(updateCounter)

    return () => {
      cancelAnimationFrame(animationFrameId)
    }
  }, [value])

  return <>{current.toFixed(decimals)}</>
}

const getPseudonym = (id: string) => {
  const short = id.slice(0, 4).toUpperCase()
  return `Homelaber #${short}`
}

const getAnonymizedEmail = (id: string) => {
  const short = id.slice(0, 4).toLowerCase()
  return `homelaber_${short}@internal.local`
}

const getAvatarColor = (id: string) => {
  const colors = [
    "bg-red-500/10 text-red-500 border-red-500/20",
    "bg-orange-500/10 text-orange-500 border-orange-500/20",
    "bg-amber-500/10 text-amber-500 border-amber-500/20",
    "bg-emerald-500/10 text-emerald-500 border-emerald-500/20",
    "bg-cyan-500/10 text-cyan-500 border-cyan-500/20",
    "bg-blue-500/10 text-blue-500 border-blue-500/20",
    "bg-indigo-500/10 text-indigo-500 border-indigo-500/20",
    "bg-purple-500/10 text-purple-500 border-purple-500/20",
    "bg-pink-500/10 text-pink-500 border-pink-500/20",
  ]
  let hash = 0
  for (let i = 0; i < id.length; i++) {
    hash = id.charCodeAt(i) + ((hash << 5) - hash)
  }
  const index = Math.abs(hash) % colors.length
  return colors[index]
}


export default function AdminPage() {
  const { user, loading } = useAuth()
  const { data: stats, isLoading: statsLoading } = useAdminStats()
  const { data: services, isLoading: servicesLoading } = useAdminServices()
  const { data: users, isLoading: usersLoading } = useAdminUsers()
  const [tab, setTab] = useState<"insights" | "users" | "services" | "hardware" | "links" | "steering" | "mass-planner">("insights")

  const [userSearch, setUserSearch] = useState("")
  const [userMinBuilds, setUserMinBuilds] = useState<number>(0)

  const filteredUsers = (users || []).filter(u => {
    const anonName = getPseudonym(u.id).toLowerCase()
    const anonEmail = getAnonymizedEmail(u.id).toLowerCase()
    const matchesSearch = anonName.includes(userSearch.toLowerCase()) || 
                          anonEmail.includes(userSearch.toLowerCase())
    const matchesBuilds = u.builds_count >= userMinBuilds
    return matchesSearch && matchesBuilds
  })

  if (loading) return <LoadingScreen message="Loading Admin Dashboard..." />
  if (!user?.is_admin) return <Navigate to="/" replace />

  const handleDownloadAnonymousTopologies = () => {
    const token = localStorage.getItem('auth_token');
    const defaultApiBase = typeof window !== 'undefined' ? `${window.location.protocol}//${window.location.hostname}:8080` : 'http://localhost:8080';
    const rawApiUrl = import.meta.env.VITE_API_URL;
    const API_BASE = rawApiUrl && rawApiUrl !== 'http://localhost:8080' ? rawApiUrl : defaultApiBase;
    
    fetch(`${API_BASE}/api/admin/export-anonymized-topologies`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    })
    .then(res => res.blob())
    .then(blob => {
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'homelab_topologies_anonymized.json';
      document.body.appendChild(a);
      a.click();
      a.remove();
    })
    .catch(err => {
      console.error('Failed to download anonymous topologies', err);
    });
  };

  return (
    <div className="flex flex-col gap-8 px-6 py-8 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Admin Dashboard</h1>
          <p className="text-muted-foreground mt-0.5">Manage the platform, analyze layouts, and view homelaber metrics.</p>
        </div>
        {tab === "services" && <ServiceDialog />}
      </div>

      {statsLoading ? (
          <div className="grid gap-4 md:grid-cols-3">
            <Skeleton className="h-32" />
            <Skeleton className="h-32" />
            <Skeleton className="h-32" />
          </div>
      ) : (
          <AdminStats stats={stats} />
      )}

      {/* Tab switcher */}
      <div className="flex gap-1 rounded-lg border p-1 bg-muted/30 flex-wrap">
        {(["insights", "users", "services", "hardware", "links", "steering", "mass-planner"] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors hover:cursor-pointer capitalize ${
              tab === t ? "bg-background shadow-sm" : "hover:bg-muted text-muted-foreground hover:text-foreground"
            }`}
          >
            {t === "insights" ? "Topology Insights" : t === "users" ? "Active Homelabers" : t === "services" ? "Service Catalog" : t === "hardware" ? "Community Hardware" : t === "links" ? "Buy Links (Affiliate)" : t === "steering" ? "Store Steering" : "Component Planner"}
          </button>
        ))}
      </div>

      {/* Homelaber Insights Tab */}
      {tab === "insights" && (
        <div className="space-y-6">
          <div className="grid gap-4 md:grid-cols-3">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Total Visual Designs</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold flex items-baseline gap-2">
                  <Network className="size-5 text-purple-500 shrink-0 self-center" />
                  <AnimatedCounter value={stats?.total_builds || 0} />
                  <span className="text-xs font-normal text-muted-foreground">layouts planned</span>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Avg Nodes per Design</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold flex items-baseline gap-2">
                  <Server className="size-5 text-orange-500 shrink-0 self-center" />
                  <AnimatedCounter value={stats?.avg_nodes_per_build || 0} decimals={1} />
                  <span className="text-xs font-normal text-muted-foreground">devices per build</span>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Avg Virtualization Density</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold flex items-baseline gap-2">
                  <Cpu className="size-5 text-green-500 shrink-0 self-center" />
                  <AnimatedCounter value={stats?.avg_vms_per_build || 0} decimals={1} />
                  <span className="text-xs font-normal text-muted-foreground">VMs/containers per build</span>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            {/* Brand Market Share Chart */}
            <Card>
              <CardHeader>
                <CardTitle>Hardware Brands Market Share</CardTitle>
                <CardDescription>Most preferred manufacturers inside user network topologies</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {stats?.brand_market_share && stats.brand_market_share.length > 0 ? (
                  stats.brand_market_share.map((item, index) => {
                    const maxVal = Math.max(...(stats.brand_market_share.map(x => Number(x.count)) || [1]));
                    const pct = maxVal > 0 ? (item.count / maxVal) * 100 : 0;
                    return (
                      <div key={index} className="space-y-1">
                        <div className="flex items-center justify-between text-xs font-medium">
                          <span className="capitalize">{item.brand}</span>
                          <span className="text-muted-foreground">{item.count} nodes</span>
                        </div>
                        <div className="h-2 w-full bg-muted rounded-full overflow-hidden">
                          <div className="h-full bg-gradient-to-r from-blue-500 to-cyan-400 rounded-full transition-all" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="text-center py-8 text-sm text-muted-foreground">No brand metrics available yet.</div>
                )}
              </CardContent>
            </Card>

            {/* Popular Active Deployed Services Chart */}
            <Card>
              <CardHeader>
                <CardTitle>Top Deployed Apps & Services</CardTitle>
                <CardDescription>Most frequently active services mapped inside user server/NAS nodes</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {stats?.active_services_distribution && stats.active_services_distribution.length > 0 ? (
                  stats.active_services_distribution.map((item, index) => {
                    const maxVal = Math.max(...(stats.active_services_distribution.map(x => Number(x.count)) || [1]));
                    const pct = maxVal > 0 ? (item.count / maxVal) * 100 : 0;
                    return (
                      <div key={index} className="space-y-1">
                        <div className="flex items-center justify-between text-xs font-medium">
                          <span>{item.name}</span>
                          <span className="text-muted-foreground">{item.count} active</span>
                        </div>
                        <div className="h-2 w-full bg-muted rounded-full overflow-hidden">
                          <div className="h-full bg-gradient-to-r from-purple-500 to-pink-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="text-center py-8 text-sm text-muted-foreground">No service metrics available yet.</div>
                )}
              </CardContent>
            </Card>

            {/* Node Types Distribution Chart */}
            <Card className="md:col-span-2">
              <CardHeader>
                <CardTitle>Topology Node Types Distribution</CardTitle>
                <CardDescription>Breakdown of standalone physical devices added to builds</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {stats?.node_distribution && stats.node_distribution.length > 0 ? (
                  stats.node_distribution.map((item, index) => (
                    <div key={index} className="flex items-center gap-3 p-3 border rounded-lg bg-card">
                      <div className="size-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-xs capitalize">
                        {item.type.slice(0, 2)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground leading-none">{item.type}</p>
                        <p className="text-lg font-bold leading-tight mt-1">{item.count} <span className="text-xs font-normal text-muted-foreground">placed</span></p>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="text-center py-8 text-sm text-muted-foreground col-span-full">No node type metrics available yet.</div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* Active Homelabers Tab */}
      {tab === "users" && (
        <div className="space-y-6">
          <Card className="border-primary/20 bg-primary/5">
            <CardHeader className="flex flex-row items-center gap-4 flex-wrap justify-between pb-4">
              <div className="space-y-1">
                <CardTitle className="flex items-center gap-2">
                  <Shield className="size-5 text-primary" />
                  Privacy-Safe Topology Export
                </CardTitle>
                <CardDescription>
                  Export anonymized visual builder diagrams to compile a local custom layout model or dashboard templates.
                </CardDescription>
              </div>
              <Button onClick={handleDownloadAnonymousTopologies} size="sm" className="hover:cursor-pointer">
                <Download className="mr-2 size-4" /> Download Topology JSON
              </Button>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground leading-relaxed flex items-center gap-2">
                <Shield className="size-4 shrink-0 text-emerald-500" />
                <span><strong>Absolute Privacy Ensured:</strong> Absolutely no emails, names, user IDs, or specific passwords/IP/MAC addresses are included in this download. It only contains anonymous device groupings and topological connection graphs.</span>
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3 border-b">
              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div>
                  <CardTitle>Active Homelabers</CardTitle>
                  <CardDescription>A list of anonymized active users designing homelab topologies</CardDescription>
                </div>
                <div className="flex flex-col sm:flex-row gap-2 shrink-0">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <input
                      type="text"
                      placeholder="Search homelaber..."
                      value={userSearch}
                      onChange={e => setUserSearch(e.target.value)}
                      className="pl-8 pr-3 py-1.5 h-9 w-full sm:w-[220px] rounded-md border bg-background text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                  </div>
                  <select
                    value={userMinBuilds}
                    onChange={e => setUserMinBuilds(Number(e.target.value))}
                    className="h-9 px-3 py-1.5 rounded-md border bg-background text-sm focus:outline-none focus:ring-1 focus:ring-primary hover:cursor-pointer"
                  >
                    <option value={0}>All Builds Count</option>
                    <option value={1}>1+ Builds</option>
                    <option value={3}>3+ Builds</option>
                    <option value={5}>5+ Builds</option>
                  </select>
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-6">
              {usersLoading ? (
                <div className="space-y-2 py-6">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                </div>
              ) : !filteredUsers || filteredUsers.length === 0 ? (
                <div className="text-center py-10 text-muted-foreground">No active homelabers match the filters.</div>
              ) : (
                <div className="relative overflow-x-auto border rounded-lg">
                  <table className="w-full text-sm text-left text-foreground">
                    <thead className="text-xs uppercase bg-muted text-muted-foreground border-b select-none">
                      <tr>
                        <th className="px-4 py-3">Homelaber</th>
                        <th className="px-4 py-3">Email Address</th>
                        <th className="px-4 py-3 text-center">Visual Builds</th>
                        <th className="px-4 py-3 text-center">Hardware Nodes</th>
                        <th className="px-4 py-3 text-center">Containers/VMs</th>
                        <th className="px-4 py-3">Joined Date</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {filteredUsers.map(u => (
                        <tr key={u.id} className="bg-card hover:bg-muted/30 transition-colors">
                          <td className="px-4 py-3 font-semibold flex items-center gap-2 select-none">
                            <div className={`size-6 rounded-full border flex items-center justify-center text-[10px] font-bold ${getAvatarColor(u.id)}`}>
                              {getPseudonym(u.id).slice(11, 13)}
                            </div>
                            {getPseudonym(u.id)}
                          </td>
                          <td className="px-4 py-3 text-muted-foreground font-mono text-xs">{getAnonymizedEmail(u.id)}</td>
                          <td className="px-4 py-3 text-center font-bold text-primary">{u.builds_count}</td>
                          <td className="px-4 py-3 text-center font-bold">{u.nodes_count}</td>
                          <td className="px-4 py-3 text-center font-bold text-emerald-500">{u.vms_count}</td>
                          <td className="px-4 py-3 text-muted-foreground text-xs">{new Date(u.created_at).toLocaleDateString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {tab === "services" && (
        <div className="space-y-4">
          <div className="border rounded-md">
            <ServicesTable services={services} isLoading={servicesLoading} />
          </div>
        </div>
      )}
      {tab === "hardware" && <AdminHardwareManager />}
      {tab === "links" && (
        <div className="flex flex-col items-center justify-center p-12 border border-dashed rounded-xl bg-muted/10 text-center space-y-3">
          <div className="text-4xl">⏳</div>
          <h3 className="text-xl font-bold">Coming Soon</h3>
          <p className="text-muted-foreground max-w-md">
            Affiliate Links Management is disabled for the Open Beta. This feature is reserved for future implementation to support community funding.
          </p>
        </div>
      )}
      {tab === "steering" && <SteeringRulesManager />}
      {tab === "mass-planner" && <CatalogComponentsManager />}
    </div>
  )
}
