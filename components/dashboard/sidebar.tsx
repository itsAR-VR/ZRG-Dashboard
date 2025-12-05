"use client"

import { cn } from "@/lib/utils"
import {
  Inbox,
  Clock,
  Users,
  BarChart3,
  Settings,
  Building2,
  ChevronDown,
  LogOut,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { signOut } from "@/actions/auth-actions"
import { useUser } from "@/contexts/user-context"

export type ViewType = "inbox" | "followups" | "crm" | "analytics" | "settings"

interface Workspace {
  id: string
  name: string
  ghlLocationId: string
}

interface SidebarProps {
  activeView: ViewType
  onViewChange: (view: ViewType) => void
  activeWorkspace: string | null
  onWorkspaceChange: (workspace: string | null) => void
  workspaces: Workspace[]
}

const navItems = [
  { id: "inbox" as ViewType, label: "Master Inbox", icon: Inbox },
  { id: "followups" as ViewType, label: "Follow-ups", icon: Clock },
  { id: "crm" as ViewType, label: "CRM / Leads", icon: Users },
  { id: "analytics" as ViewType, label: "Analytics", icon: BarChart3 },
  { id: "settings" as ViewType, label: "Settings", icon: Settings },
]

export function Sidebar({
  activeView,
  onViewChange,
  activeWorkspace,
  onWorkspaceChange,
  workspaces,
}: SidebarProps) {
  const { user } = useUser()

  const selectedWorkspace = workspaces.find((w) => w.id === activeWorkspace)

  const getInitials = (name: string) => {
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2)
  }

  const handleSignOut = async () => {
    await signOut()
  }

  return (
    <aside className="flex h-full w-64 flex-col border-r border-border bg-card">
      {/* Branding */}
      <div className="flex items-center gap-3 border-b border-border p-4">
        <img src="/images/zrg-logo-3.png" alt="ZRG Logo" className="h-8 w-auto" />
        <span className="text-lg font-semibold text-foreground">Inbox</span>
      </div>

      {/* Workspace Selector */}
      {workspaces.length > 0 && (
        <div className="border-b border-border p-3">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="w-full justify-between">
                <span className="flex items-center gap-2 truncate">
                  <Building2 className="h-4 w-4 shrink-0" />
                  <span className="truncate">
                    {selectedWorkspace ? selectedWorkspace.name : "All Workspaces"}
                  </span>
                </span>
                <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              <DropdownMenuItem onClick={() => onWorkspaceChange(null)}>
                <span className={cn(!activeWorkspace && "font-semibold")}>
                  All Workspaces
                </span>
              </DropdownMenuItem>
              {workspaces.map((workspace) => (
                <DropdownMenuItem
                  key={workspace.id}
                  onClick={() => onWorkspaceChange(workspace.id)}
                >
                  <span className={cn(activeWorkspace === workspace.id && "font-semibold")}>
                    {workspace.name}
                  </span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}

      {/* Navigation */}
      <nav className="flex-1 space-y-1 p-3 overflow-y-auto">
        {navItems.map((item) => (
          <Button
            key={item.id}
            variant={activeView === item.id ? "secondary" : "ghost"}
            className="w-full justify-start gap-3"
            onClick={() => onViewChange(item.id)}
          >
            <item.icon className="h-4 w-4" />
            {item.label}
          </Button>
        ))}
      </nav>

      {/* User Profile */}
      {user && (
        <div className="border-t border-border p-3">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="w-full justify-start gap-3 h-auto py-2">
                <Avatar className="h-8 w-8">
                  {user.avatarUrl && <AvatarImage src={user.avatarUrl} alt={user.fullName} />}
                  <AvatarFallback className="bg-primary/10 text-primary text-xs">
                    {getInitials(user.fullName)}
                  </AvatarFallback>
                </Avatar>
                <div className="flex flex-col items-start min-w-0">
                  <span className="text-sm font-medium truncate w-full">{user.fullName}</span>
                  <span className="text-xs text-muted-foreground truncate w-full">{user.email}</span>
                </div>
                <ChevronDown className="h-4 w-4 shrink-0 opacity-50 ml-auto" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem onClick={() => onViewChange("settings")}>
                <Settings className="h-4 w-4 mr-2" />
                Settings
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleSignOut} className="text-destructive focus:text-destructive">
                <LogOut className="h-4 w-4 mr-2" />
                Sign Out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
    </aside>
  )
}
