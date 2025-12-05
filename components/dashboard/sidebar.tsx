"use client"

import { useEffect, useState } from "react"
import { cn } from "@/lib/utils"
import {
  Inbox,
  Clock,
  Users,
  BarChart3,
  Settings,
  AlertCircle,
  FileEdit,
  Send,
  Mail,
  MessageSquare,
  Linkedin,
  Building2,
  ChevronDown,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { getInboxCounts } from "@/actions/lead-actions"

export type ViewType = "inbox" | "followups" | "crm" | "analytics" | "settings"

interface Workspace {
  id: string
  name: string
  ghlLocationId: string
}

interface SidebarProps {
  activeChannel: string
  onChannelChange: (channel: string) => void
  activeFilter: string
  onFilterChange: (filter: string) => void
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

interface FilterCounts {
  attention: number
  drafts: number
  awaiting: number
}

export function Sidebar({
  activeChannel,
  onChannelChange,
  activeFilter,
  onFilterChange,
  activeView,
  onViewChange,
  activeWorkspace,
  onWorkspaceChange,
  workspaces,
}: SidebarProps) {
  const [counts, setCounts] = useState<FilterCounts>({
    attention: 0,
    drafts: 0,
    awaiting: 0,
  })

  // Fetch counts on mount, when workspace changes, and periodically
  useEffect(() => {
    async function fetchCounts() {
      const result = await getInboxCounts(activeWorkspace)
      setCounts({
        attention: result.requiresAttention,
        drafts: result.draftsForApproval,
        awaiting: result.awaitingReply,
      })
    }

    fetchCounts()
    
    // Refresh counts every 30 seconds
    const interval = setInterval(fetchCounts, 30000)
    return () => clearInterval(interval)
  }, [activeWorkspace])

  const filterItems = [
    { id: "attention", label: "Requires Attention", icon: AlertCircle, count: counts.attention, variant: "destructive" as const },
    { id: "drafts", label: "Drafts for Approval", icon: FileEdit, count: counts.drafts, variant: "warning" as const },
    { id: "awaiting", label: "Awaiting Reply", icon: Send, count: counts.awaiting, variant: "secondary" as const },
  ]

  const selectedWorkspace = workspaces.find((w) => w.id === activeWorkspace)

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

        <Separator className="my-4" />

        {/* Filter Groups - only show when on inbox view */}
        {activeView === "inbox" && (
          <>
            <div className="space-y-1">
              <p className="px-3 py-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">Filters</p>
              {filterItems.map((item) => (
                <Button
                  key={item.id}
                  variant={activeFilter === item.id ? "secondary" : "ghost"}
                  className="w-full justify-between"
                  onClick={() => onFilterChange(activeFilter === item.id ? "" : item.id)}
                >
                  <span className="flex items-center gap-3">
                    <item.icon className="h-4 w-4" />
                    <span className="text-sm">{item.label}</span>
                  </span>
                  {item.count > 0 && (
                    <Badge
                      variant={item.variant === "warning" ? "outline" : item.variant}
                      className={cn(
                        "ml-auto",
                        item.variant === "warning" && "border-amber-500 bg-amber-500/10 text-amber-500",
                      )}
                    >
                      {item.count}
                    </Badge>
                  )}
                </Button>
              ))}
            </div>

            <Separator className="my-4" />

            {/* Channel Toggles */}
            <div className="space-y-3">
              <p className="px-3 py-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">Channels</p>
              <ToggleGroup
                type="single"
                value={activeChannel}
                onValueChange={(value) => value && onChannelChange(value)}
                className="flex flex-col gap-1 px-3"
              >
                <ToggleGroupItem value="all" aria-label="All channels" className="w-full justify-start px-3">
                  All Channels
                </ToggleGroupItem>
                <ToggleGroupItem value="email" aria-label="Email" className="w-full justify-start gap-2 px-3">
                  <Mail className="h-4 w-4" />
                  Email
                </ToggleGroupItem>
                <ToggleGroupItem value="sms" aria-label="SMS" className="w-full justify-start gap-2 px-3">
                  <MessageSquare className="h-4 w-4" />
                  SMS
                </ToggleGroupItem>
                <ToggleGroupItem value="linkedin" aria-label="LinkedIn" className="w-full justify-start gap-2 px-3">
                  <Linkedin className="h-4 w-4" />
                  LinkedIn
                </ToggleGroupItem>
              </ToggleGroup>
            </div>
          </>
        )}
      </nav>
    </aside>
  )
}
