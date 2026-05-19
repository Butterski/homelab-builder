import { Menu } from "lucide-react"
import { Sidebar } from "./sidebar"
import { Button } from "../ui/button"
import { useState } from "react"
import { Sheet, SheetContent, SheetTrigger } from "../ui/sheet" // Need to create Sheet for mobile

export function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [isMobileOpen, setIsMobileOpen] = useState(false)

  return (
    <div className="min-h-screen bg-background">
      {/* Desktop Sidebar */}
      <Sidebar className="hidden md:flex" />

      {/* Mobile Header (TODO: Implement proper mobile nav with Sheet) */}
      <div className="flex h-16 items-center border-b bg-card px-4 md:hidden">
        <Sheet open={isMobileOpen} onOpenChange={setIsMobileOpen}>
            <SheetTrigger asChild>
                <Button variant="ghost" size="icon">
                    <Menu className="size-6" />
                </Button>
            </SheetTrigger>
            <SheetContent side="left" className="p-0 w-72">
                <Sidebar />
            </SheetContent>
        </Sheet>
        <span className="ml-2 font-bold">HLBuilder</span>
      </div>

      {/* Main Content */}
      <main className="md:pl-64 transition-all duration-300 ease-in-out">
        <div className="container py-6 px-6 md:px-8">
            {children}
        </div>
      </main>
    </div>
  )
}
