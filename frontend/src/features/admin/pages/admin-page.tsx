import { useAdminStats, useAdminServices } from "../api/use-admin"
import { AdminStats } from "../components/admin-stats"
import { ServiceDialog } from "../components/service-dialog"
import { Skeleton } from "../../../components/ui/skeleton"
import { ServicesTable } from "../components/services-table"
import { AdminHardwareManager } from "../components/hardware-manager"
import { AffiliateLinksManager } from "../components/affiliate-links-manager"
import { SteeringRulesManager } from "../components/steering-rules-manager"
import { CatalogComponentsManager } from "../components/catalog-components-manager"
import { useState } from "react"

import { useAuth } from "../hooks/use-auth"
import { Navigate } from "react-router-dom"

export default function AdminPage() {
  const { user, loading } = useAuth()
  const { data: stats, isLoading: statsLoading } = useAdminStats()
  const { data: services, isLoading: servicesLoading } = useAdminServices()
  const [tab, setTab] = useState<"services" | "hardware" | "links" | "steering" | "mass-planner">("services")

  if (loading) return <div className="p-8">Loading...</div>
  if (!user?.is_admin) return <Navigate to="/" replace />

  return (
    <div className="flex flex-col gap-8 px-6 py-8 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">Admin Dashboard</h1>
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
        {(["services", "hardware", "links", "steering", "mass-planner"] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors capitalize ${
              tab === t ? "bg-background shadow-sm" : "hover:bg-muted"
            }`}
          >
            {t === "services" ? "Service Catalog" : t === "hardware" ? "Commmunity Hardware" : t === "links" ? "Buy Links (Affiliate)" : t === "steering" ? "Store Steering" : "Component Planner"}
          </button>
        ))}
      </div>

      {tab === "services" && (
        <div className="space-y-4">
          <div className="border rounded-md">
            <ServicesTable services={services} isLoading={servicesLoading} />
          </div>
        </div>
      )}
      {tab === "hardware" && <AdminHardwareManager />}
      {tab === "links" && <AffiliateLinksManager />}
      {tab === "steering" && <SteeringRulesManager />}
      {tab === "mass-planner" && <CatalogComponentsManager />}
    </div>
  )
}
