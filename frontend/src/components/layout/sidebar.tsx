import { NavLink } from "react-router-dom"
import { LayoutDashboard, ShoppingCart, CheckSquare, Settings, Hammer, HardDrive, FileCode } from "lucide-react"
import { cn } from "../../lib/utils"

// import { Button } from "../ui/button" // Might be used for logout/collapse

const NAV_ITEMS = [
  { label: "Projects", href: "/", icon: LayoutDashboard },
  { label: "Config Generator", href: "/generate", icon: FileCode },
  { label: "Service Catalog", href: "/services", icon: CheckSquare },
  { label: "Hardware Catalog", href: "/hardware", icon: HardDrive },
  { label: "Shopping List", href: "/shopping-list", icon: ShoppingCart },
  { label: "Setup Guide", href: "/checklist", icon: CheckSquare },
  { label: "Admin", href: "/admin", icon: Settings },
]

import { useAuth } from "../../features/admin/hooks/use-auth"
import { GoogleLoginButton } from "../auth/google-login-button"
import { LogOut } from "lucide-react"

export function Sidebar({ className }: { className?: string }) {
  const { user, logout } = useAuth()
  
  return (
    <aside className={cn("hidden md:flex flex-col w-64 border-r bg-card h-full", className)}>
      <div className="flex h-16 items-center border-b px-6">
        <Hammer className="mr-2 h-6 w-6 text-primary" />
        <span className="text-lg font-bold tracking-tight">Homelab Builder</span>
      </div>
      
      <div className="flex-1 overflow-y-auto py-4">
        {/* ... nav items ... */}
        <nav className="grid gap-1 px-2">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.href}
              to={item.href}
              className={({ isActive }) =>
                cn(
                  "group flex items-center rounded-md px-3 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground",
                  isActive ? "bg-accent text-accent-foreground" : "text-muted-foreground"
                )
              }
            >
              <item.icon className="mr-2 h-4 w-4" />
              {item.label}
            </NavLink>
          ))}
        </nav>
      </div>

      <div className="border-t p-4 flex gap-2">
        <div className="flex-1 flex items-center gap-3 rounded-lg border bg-muted/50 p-2 min-h-[3.5rem]">
            {user ? (
                 <>
                    <img src={user.avatar_url} className="h-8 w-8 rounded-full bg-primary/20" alt={user.name} />
                    <div className="flex flex-col overflow-hidden w-full">
                        <span className="text-sm font-medium truncate" title={user.name}>{user.name}</span>
                        <button 
                          onClick={logout}
                          className="text-xs text-muted-foreground hover:text-destructive flex items-center gap-1"
                        >
                            <LogOut className="h-3 w-3" /> Logout
                        </button>
                    </div>
                 </>
            ) : (
                <div className="w-full">
                     <GoogleLoginButton />
                </div>
            )}
        </div>
      </div>
    </aside>
  )
}


