import { NavLink, useNavigate } from "react-router-dom"
import { LayoutDashboard, ShoppingCart, CheckSquare, Settings, Hammer, HardDrive, FileCode } from "lucide-react"
import { cn } from "../../lib/utils"

// import { Button } from "../ui/button" // Might be used for logout/collapse

const BASE_NAV_ITEMS = [
  { label: "Projects", href: "/", icon: LayoutDashboard },
  { label: "Config Generator", href: "/generate", icon: FileCode },

  { label: "Hardware Catalog", href: "/hardware", icon: HardDrive },
  { label: "Service Library", href: "/services", icon: CheckSquare },
  { label: "Shopping List", href: "/shopping-list", icon: ShoppingCart },
  { label: "Setup Guide", href: "/checklist", icon: CheckSquare },
  { label: "Admin", href: "/admin", icon: Settings },
]

import { useAuth } from "../../features/admin/hooks/use-auth"
import { useBuilderStore } from "../../features/builder/store/builder-store"
import { GoogleLoginButton } from "../auth/google-login-button"
import { LayoutTemplate } from "lucide-react"

export function Sidebar({ className }: { className?: string }) {
  const { user } = useAuth()
  const { currentBuildId } = useBuilderStore()
  const navigate = useNavigate()
  
  const navItems = [
    BASE_NAV_ITEMS[0],
    ...(currentBuildId ? [{ label: "Active Project", href: `/builder/${currentBuildId}`, icon: LayoutTemplate }] : []),
    ...BASE_NAV_ITEMS.slice(1)
  ]
  
  return (
    <aside className={cn("hidden md:flex flex-col w-64 border-r border-[#27272A] bg-background h-full shadow-none", className)}>
      <div className="flex h-16 items-center border-b border-[#27272A] px-6">
        <Hammer className="mr-2 h-6 w-6 text-primary" />
        <span className="text-lg font-bold tracking-tight">Homelab Builder</span>
      </div>
      
      <div className="flex-1 overflow-y-auto py-4">
        {/* ... nav items ... */}
        <nav className="grid gap-1 px-2">
          {navItems.filter(item => item.label !== "Admin" || user?.is_admin).map((item) => (
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

        <div className="border-t p-4">
          <div
            className="flex items-center gap-3 rounded-lg border bg-muted/50 p-2 min-h-[3.5rem] cursor-pointer hover:bg-accent/50 transition-colors"
            onClick={() => user ? navigate('/profile') : undefined}
            title={user ? 'View profile' : undefined}
          >
            {user ? (
               <>
                  <img
                    src={user.avatar_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(user.email)}`}
                    className="h-8 w-8 rounded-full bg-primary/20 shrink-0"
                    alt={user.name}
                    onError={(e) => { (e.target as HTMLImageElement).src = `https://api.dicebear.com/7.x/initials/svg?seed=${user.name}` }}
                  />
                  <div className="flex flex-col overflow-hidden flex-1">
                      <span className="text-sm font-medium truncate" title={user.name}>{user.name}</span>
                      <span className="text-xs text-muted-foreground truncate">{user.email}</span>
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


