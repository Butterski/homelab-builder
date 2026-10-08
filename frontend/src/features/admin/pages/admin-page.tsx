import { Page, PageHeader } from "../../../components/layout/page"
import { useAdminStats, useAdminServices, useAdminUsers, type AdminDashboardStats, type EnrichedUser } from "../api/use-admin"
import { AdminStats } from "../components/admin-stats"
import { ServiceDialog } from "../components/service-dialog"
import { Skeleton } from "../../../components/ui/skeleton"
import { ServicesTable } from "../components/services-table"
import { AdminHardwareManager } from "../components/hardware-manager"
import { BlueprintModerationManager } from "../components/blueprint-moderation-manager"
import { CatalogComponentsManager } from "../components/catalog-components-manager"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/card"
import { Button } from "../../../components/ui/button"
import { useState, useEffect, useRef } from "react"
import { Download, Shield, Network, Server, Cpu, Search } from "lucide-react"
import { useAuth } from "../../auth/hooks/use-auth"
import { Navigate } from "react-router-dom"
import { apiUrl } from "../../../lib/api-base"
import { authHeaders } from "../../../lib/api"

function AnimatedCounter({ value, decimals = 0 }: { value: number; decimals?: number }) {
  const [displayed, setDisplayed] = useState(0)
  const displayedRef = useRef(0)

  useEffect(() => {
    const from = displayedRef.current
    if (from === value) return

    const duration = 1000
    const startTime = performance.now()
    let animationFrameId: number

    const updateCounter = (now: number) => {
      const progress = Math.min((now - startTime) / duration, 1)
      const eased = progress * (2 - progress)
      displayedRef.current = from + eased * (value - from)
      setDisplayed(displayedRef.current)

      if (progress < 1) {
        animationFrameId = requestAnimationFrame(updateCounter)
      }
    }

    animationFrameId = requestAnimationFrame(updateCounter)
    return () => cancelAnimationFrame(animationFrameId)
  }, [value])

  return <>{displayed.toFixed(decimals)}</>
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

const ADMIN_TABS = ["insights", "users", "services", "hardware", "blueprints", "mass-planner"] as const
type AdminTab = (typeof ADMIN_TABS)[number]

const TAB_LABELS: Record<AdminTab, string> = {
  insights: "Topology Insights",
  users: "Active Homelabers",
  services: "Service Catalog",
  hardware: "Community Hardware",
  blueprints: "Blueprint Review",
  "mass-planner": "Component Planner",
}

function TabSwitcher({ tab, onTabChange }: { tab: AdminTab; onTabChange: (t: AdminTab) => void }) {
  return (
    <div className="flex gap-1 rounded-lg border p-1 bg-muted/30 flex-wrap">
      {ADMIN_TABS.map(t => (
        <button
          key={t}
          type="button"
          onClick={() => onTabChange(t)}
          className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors hover:cursor-pointer capitalize ${
            tab === t ? "bg-background shadow-sm" : "hover:bg-muted text-muted-foreground hover:text-foreground"
          }`}
        >
          {TAB_LABELS[t]}
        </button>
      ))}
    </div>
  );
}

/** Counts drawn as bars against the largest one. */
function CountBars({ items, unit, labelClassName, emptyText }: {
  items: Array<{ label: string; count: number }>;
  unit: string;
  labelClassName?: string;
  emptyText: string;
}) {
  if (items.length === 0) {
    return <div className="text-center py-8 text-sm text-muted-foreground">{emptyText}</div>;
  }
  const maxVal = Math.max(...items.map(item => item.count));
  return (
    <>
      {items.map(item => {
        const pct = maxVal > 0 ? (item.count / maxVal) * 100 : 0;
        return (
          <div key={item.label} className="space-y-1">
            <div className="flex items-center justify-between text-xs font-medium">
              <span className={labelClassName}>{item.label}</span>
              <span className="text-muted-foreground">{item.count} {unit}</span>
            </div>
            <div className="h-2 w-full bg-muted rounded-full overflow-hidden">
              <div className="h-full rounded-full bg-foreground/70 transition-all" style={{ width: `${pct}%` }} />
            </div>
          </div>
        );
      })}
    </>
  );
}

function InsightsTab({ stats }: { stats: AdminDashboardStats | undefined }) {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Visual Designs</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold flex items-baseline gap-2">
              <Network className="size-5 shrink-0 text-muted-foreground" />
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
              <Server className="size-5 shrink-0 text-muted-foreground" />
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
              <Cpu className="size-5 shrink-0 text-muted-foreground" />
              <AnimatedCounter value={stats?.avg_vms_per_build || 0} decimals={1} />
              <span className="text-xs font-normal text-muted-foreground">VMs/containers per build</span>
            </div>
          </CardContent>
        </Card>
      </div>
      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Hardware Brands Market Share</CardTitle>
            <CardDescription>Most preferred manufacturers inside user network topologies</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <CountBars
              items={(stats?.brand_market_share ?? []).map(item => ({ label: item.brand, count: item.count }))}
              unit="nodes"
              labelClassName="capitalize"
              emptyText="No brand metrics available yet."
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Top Deployed Apps & Services</CardTitle>
            <CardDescription>Most frequently active services mapped inside user server/NAS nodes</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <CountBars
              items={(stats?.active_services_distribution ?? []).map(item => ({ label: item.name, count: item.count }))}
              unit="active"
              emptyText="No service metrics available yet."
            />
          </CardContent>
        </Card>
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle>Topology Node Types Distribution</CardTitle>
            <CardDescription>Breakdown of standalone physical devices added to builds</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {stats?.node_distribution && stats.node_distribution.length > 0 ? (
              stats.node_distribution.map(item => (
                <div key={`node-${item.type}`} className="flex items-center gap-3 p-3 border rounded-lg bg-card">
                  <div className="size-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-xs capitalize">
                    {item.type.slice(0, 2)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium capitalize leading-none text-muted-foreground">{String(item.type).replace(/_/g, ' ')}</p>
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
  );
}

function downloadAnonymousTopologies() {
  fetch(apiUrl('/api/admin/export-anonymized-topologies'), { headers: authHeaders() })
    .then(res => res.blob())
    .then(blob => {
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'homelab_topologies_anonymized.json';
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    })
    .catch(err => {
      console.error('Failed to download anonymous topologies', err);
    });
}

function UsersTab({ userSearch, onUserSearchChange, userMinBuilds, onUserMinBuildsChange, users, usersLoading }: {
  userSearch: string;
  onUserSearchChange: (v: string) => void;
  userMinBuilds: number;
  onUserMinBuildsChange: (v: number) => void;
  users: EnrichedUser[];
  usersLoading: boolean;
}) {
  const filteredUsers = users.filter(u => {
    const anonName = getPseudonym(u.id).toLowerCase();
    const anonEmail = getAnonymizedEmail(u.id).toLowerCase();
    const matchesSearch = anonName.includes(userSearch.toLowerCase()) ||
                          anonEmail.includes(userSearch.toLowerCase());
    const matchesBuilds = u.builds_count >= userMinBuilds;
    return matchesSearch && matchesBuilds;
  });

  return (
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
          <Button onClick={downloadAnonymousTopologies} size="sm" className="hover:cursor-pointer">
            <Download className="mr-2 size-4" /> Download Topology JSON
          </Button>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground leading-relaxed flex items-center gap-2">
            <Shield className="size-4 shrink-0 text-status-ok" />
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
                <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Search homelaber..."
                  value={userSearch}
                  onChange={e => onUserSearchChange(e.target.value)}
                  className="pl-8 pr-3 py-1.5 h-9 w-full sm:w-[220px] rounded-md border bg-background text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
              <select
                value={userMinBuilds}
                onChange={e => onUserMinBuildsChange(Number(e.target.value))}
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
                <thead className="select-none border-b text-xs text-muted-foreground">
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
                      <td className="app-figure px-4 py-3 text-center">{u.vms_count}</td>
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
  );
}

function AdminPage() {
  const { user } = useAuth()
  const { data: stats, isLoading: statsLoading } = useAdminStats()
  const { data: services, isLoading: servicesLoading } = useAdminServices()
  const { data: users, isLoading: usersLoading } = useAdminUsers()
  const [tab, setTab] = useState<AdminTab>("insights")

  const [userSearch, setUserSearch] = useState("")
  const [userMinBuilds, setUserMinBuilds] = useState<number>(0)

  if (!user?.is_admin) return <Navigate to="/" replace />

  return (
    <Page className="flex flex-col gap-8">
      <PageHeader
        title="Admin"
        lede="Manage the platform, analyze layouts, and view homelaber metrics."
        actions={tab === "services" && <ServiceDialog />}
      />

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
      <TabSwitcher tab={tab} onTabChange={setTab} />

      {/* Homelaber Insights Tab */}
      {tab === "insights" && <InsightsTab stats={stats} />}

      {/* Active Homelabers Tab */}
      {tab === "users" && (
        <UsersTab
          userSearch={userSearch}
          onUserSearchChange={setUserSearch}
          userMinBuilds={userMinBuilds}
          onUserMinBuildsChange={setUserMinBuilds}
          users={users ?? []}
          usersLoading={usersLoading}
        />
      )}

      {tab === "services" && (
        <div className="space-y-4">
          <div className="border rounded-md">
            <ServicesTable services={services} isLoading={servicesLoading} />
          </div>
        </div>
      )}
      {tab === "hardware" && <AdminHardwareManager />}
      {tab === "blueprints" && <BlueprintModerationManager />}
      {tab === "mass-planner" && <CatalogComponentsManager />}
    </Page>
  )
}

export default AdminPage
