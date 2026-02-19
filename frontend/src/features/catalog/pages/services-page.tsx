import { useState } from "react"
import { useServices } from "../api/use-services"
import { useBuilderStore } from "../../builder/store/builder-store"
import { ServiceCard } from "../components/service-card"
import { ServiceFilters } from "../components/service-filters"
import { BuilderPanel } from "../../builder/components/builder-panel"
import { Skeleton } from "../../../components/ui/skeleton"
import { AlertCircle, Filter } from "lucide-react"
import { Button } from "../../../components/ui/button"
import { Sheet, SheetContent, SheetTrigger } from "../../../components/ui/sheet"

export default function ServicesPage() {
  const { data: services, isLoading, error } = useServices()
  const { selectedServices, toggleService } = useBuilderStore()
  const [selectedCategory, setSelectedCategory] = useState("all")

  const filteredServices = services?.filter(service => 
    selectedCategory === 'all' || service.category === selectedCategory
  )

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-10 w-32" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {[...Array(8)].map((_, i) => (
                <Skeleton key={i} className="h-[200px] rounded-xl" />
            ))}
        </div>
      </div>
    )
  }

  if (error) {
    return (
        <div className="flex flex-col items-center justify-center p-12 text-center border rounded-lg bg-destructive/10 text-destructive">
            <AlertCircle className="h-12 w-12 mb-4" />
            <h3 className="text-lg font-bold">Failed to load services</h3>
            <p className="text-sm opacity-90">{(error as Error).message}</p>
        </div>
    )
  }

  return (
    <div className="flex flex-col gap-6 pb-24 px-6 md:px-8 py-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight">Service Catalog</h1>
        <p className="text-muted-foreground">
            Select the services you want to self-host to generate hardware recommendations.
        </p>
      </div>

      <div className="flex flex-col md:flex-row gap-8">
        {/* Desktop Sidebar Filters */}
        <aside className="hidden md:block w-64 shrink-0">
            <div className="sticky top-6">
                <ServiceFilters 
                    selectedCategory={selectedCategory} 
                    onSelectCategory={setSelectedCategory} 
                />
            </div>
        </aside>

        {/* Mobile Filters Trigger */}
        <div className="md:hidden">
            <Sheet>
                <SheetTrigger asChild>
                    <Button variant="outline" className="w-full">
                        <Filter className="mr-2 h-4 w-4" /> Filters
                    </Button>
                </SheetTrigger>
                <SheetContent side="left">
                    <ServiceFilters 
                        selectedCategory={selectedCategory} 
                        onSelectCategory={setSelectedCategory} 
                    />
                </SheetContent>
            </Sheet>
        </div>
      
        <div className="flex-1">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3 gap-6">
                {filteredServices?.map((service) => (
                    <ServiceCard 
                        key={service.id} 
                        service={service} 
                        isSelected={selectedServices.some(s => s.id === service.id)}
                        onSelect={toggleService}
                    />
                ))}
            </div>
        </div>
      </div>
      
      <BuilderPanel />
    </div>
  )
}
