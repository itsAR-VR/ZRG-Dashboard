"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import Image from "next/image"
import { cn } from "@/lib/utils"
import {
  Inbox,
  Clock,
  Users,
  BarChart3,
  Bot,
  Settings,
  AlertCircle,
  FileEdit,
  Mail,
  MessageSquare,
  Linkedin,
  Building2,
  ChevronDown,
  LogOut,
  Wrench,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { getInboxCounts as getInboxCountsAction } from "@/actions/lead-actions"
import { signOut } from "@/actions/auth-actions"
import { useUser } from "@/contexts/user-context"
import type { Channel } from "@/actions/lead-actions"

export type ViewType = "inbox" | "followups" | "crm" | "analytics" | "insights" | "settings"

interface Workspace {
  id: string
  name: string
  ghlLocationId: string | null
  hasDefaultCalendarLink?: boolean
  brandName?: string | null
  brandLogoUrl?: string | null
}

interface SidebarProps {
  activeChannels: Channel[]
  onChannelsChange: (channels: Channel[]) => void
  activeFilter: string
  onFilterChange: (filter: string) => void
  activeView: ViewType
  onViewChange: (view: ViewType) => void
  onViewIntent?: (view: ViewType) => void
  activeWorkspace: string | null
  onWorkspaceChange: (workspace: string | null) => void
  workspaces: Workspace[]
}

function normalizeBrandLogoSrc(value?: string | null): string | null {
  if (typeof value !== "string") return null

  let normalized = value.trim()
  if (!normalized) return null

  normalized = normalized.replace(/\\/g, "/")

  // Allow absolute URLs for hosted assets.
  if (/^https?:\/\//i.test(normalized)) return normalized

  // Normalize common user-provided values like "public/images/..." to "/images/...".
  if (normalized.startsWith("public/")) normalized = normalized.slice("public".length)

  if (!normalized.startsWith("/")) normalized = `/${normalized}`

  if (normalized === "/") return null
  // Prevent `%20` becoming `%2520` when the stored path is already URI-encoded.
  try {
    normalized = decodeURI(normalized)
  } catch {
    // keep original string when decode fails on malformed input
  }

  return encodeURI(normalized)
}

const navItems = [
  { id: "inbox" as ViewType, label: "Master Inbox", icon: Inbox },
  { id: "followups" as ViewType, label: "Follow-ups", icon: Clock },
  { id: "crm" as ViewType, label: "CRM / Leads", icon: Users },
  { id: "analytics" as ViewType, label: "Analytics", icon: BarChart3 },
  { id: "insights" as ViewType, label: "Campaign Strategist", icon: Bot },
  { id: "settings" as ViewType, label: "Settings", icon: Settings },
]

interface FilterCounts {
  allResponses: number
  attention: number
  previousAttention: number
  needsRepair: number
  aiSent: number
  aiReview: number
}

function areCountsEqual(a: FilterCounts | null, b: FilterCounts) {
  if (!a) return false
  return (
    a.allResponses === b.allResponses &&
    a.attention === b.attention &&
    a.previousAttention === b.previousAttention &&
    a.needsRepair === b.needsRepair &&
    a.aiSent === b.aiSent &&
    a.aiReview === b.aiReview
  )
}

function areChannelsEqual(a: readonly Channel[], b: readonly Channel[]) {
  if (a.length !== b.length) return false
  return a.every((channel) => b.includes(channel))
}

const ALL_CHANNELS_TOGGLE_VALUE: string[] = ["all"]

const USE_INBOX_READ_API = process.env.NEXT_PUBLIC_INBOX_READ_API_V1 === "1";

type InboxCountsResult = Awaited<ReturnType<typeof getInboxCountsAction>>;

async function getInboxCountsRead(clientId: string): Promise<InboxCountsResult> {
  if (!USE_INBOX_READ_API) {
    return getInboxCountsAction(clientId);
  }

  const response = await fetch(`/api/inbox/counts?clientId=${encodeURIComponent(clientId)}`, { method: "GET" });
  const json = (await response.json()) as { success?: boolean; counts?: InboxCountsResult };
  if (!response.ok || !json?.counts) {
    // Fail-open to the legacy Server Action for safety.
    return getInboxCountsAction(clientId);
  }
  return json.counts;
}

export function Sidebar({
  activeChannels,
  onChannelsChange,
  activeFilter,
  onFilterChange,
  activeView,
  onViewChange,
  onViewIntent,
  activeWorkspace,
  onWorkspaceChange,
  workspaces,
}: SidebarProps) {
  const [counts, setCounts] = useState<FilterCounts | null>(null)
  const [isLoadingCounts, setIsLoadingCounts] = useState(true)
  const [workspaceSearch, setWorkspaceSearch] = useState("")
  const hasLoadedCountsRef = useRef(false)
  const lastWorkspaceRef = useRef<string | null>(activeWorkspace)
  const isFetchingCountsRef = useRef(false)
  const { user } = useUser()
  const workspaceCollator = useMemo(
    () => new Intl.Collator(undefined, { sensitivity: "base", numeric: true }),
    []
  )

  // Fetch counts when workspace changes and periodically
  // Don't fetch until workspace is set to avoid showing all-workspace counts
  useEffect(() => {
    let cancelled = false
    if (!activeWorkspace || activeView !== "inbox") {
      hasLoadedCountsRef.current = false
      lastWorkspaceRef.current = activeWorkspace
      setCounts((current) => (current === null ? current : null))
      setIsLoadingCounts(false)
      return () => {
        cancelled = true
      }
    }

    if (lastWorkspaceRef.current !== activeWorkspace) {
      hasLoadedCountsRef.current = false
      lastWorkspaceRef.current = activeWorkspace
    }

    const workspaceId = activeWorkspace

    const canFetch = () => {
      if (typeof document === "undefined") return true
      return document.visibilityState === "visible"
    }

    async function fetchCounts() {
      if (isFetchingCountsRef.current) return
      if (!canFetch()) return

      // Only start loading indicator on initial fetch, not periodic refreshes
      if (!hasLoadedCountsRef.current) {
        setIsLoadingCounts(true)
      }

      isFetchingCountsRef.current = true
      try {
        const result = await getInboxCountsRead(workspaceId)
        const nextCounts: FilterCounts = {
          allResponses: result.allResponses,
          attention: result.requiresAttention,
          previousAttention: result.previouslyRequiredAttention,
          needsRepair: result.needsRepair,
          aiSent: result.aiSent,
          aiReview: result.aiReview,
        }

        if (!cancelled) {
          setCounts((current) => (areCountsEqual(current, nextCounts) ? current : nextCounts))
          hasLoadedCountsRef.current = true
          setIsLoadingCounts(false)
        }
      } catch {
        if (!cancelled) {
          setIsLoadingCounts(false)
        }
      } finally {
        isFetchingCountsRef.current = false
      }
    }

    fetchCounts()

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void fetchCounts()
      }
    }
    document.addEventListener("visibilitychange", handleVisibilityChange)

    // Refresh counts every 60 seconds while inbox is visible
    const interval = setInterval(() => {
      void fetchCounts()
    }, 60000)
    return () => {
      cancelled = true
      document.removeEventListener("visibilitychange", handleVisibilityChange)
      clearInterval(interval)
    }
  }, [activeWorkspace, activeView])

  const filterItems = useMemo(
    () => [
      { id: "responses", label: "All Responses", icon: MessageSquare, count: counts?.allResponses ?? 0, variant: "outline" as const },
      { id: "attention", label: "Requires Attention", icon: AlertCircle, count: counts?.attention ?? 0, variant: "destructive" as const },
      { id: "ai_sent", label: "AI Sent", icon: Bot, count: counts?.aiSent ?? 0, variant: "outline" as const },
      { id: "ai_review", label: "AI Needs Review", icon: FileEdit, count: counts?.aiReview ?? 0, variant: "warning" as const },
      { id: "needs_repair", label: "Needs Repair", icon: Wrench, count: counts?.needsRepair ?? 0, variant: "outline" as const },
      { id: "previous_attention", label: "Previously Required Attention", icon: FileEdit, count: counts?.previousAttention ?? 0, variant: "warning" as const },
    ],
    [counts]
  )

  const selectedWorkspace = workspaces.find((w) => w.id === activeWorkspace)
  const displayBrandName = (selectedWorkspace?.brandName || selectedWorkspace?.name || "Inbox").trim()
  const displayBrandLogoUrl = normalizeBrandLogoSrc(selectedWorkspace?.brandLogoUrl)
  const [brandLogoSrc, setBrandLogoSrc] = useState(displayBrandLogoUrl ?? "/images/zrg-logo-3.png")
  const [logoErrored, setLogoErrored] = useState(false)
  const workspaceQuery = workspaceSearch.trim().toLowerCase()
  const sortedWorkspaces = useMemo(
    () =>
      [...workspaces].sort((a, b) =>
        workspaceCollator.compare(a.name.trim(), b.name.trim())
      ),
    [workspaces, workspaceCollator]
  )
  const filteredWorkspaces =
    workspaceQuery.length === 0
      ? sortedWorkspaces
      : sortedWorkspaces.filter((w) => {
          const name = w.name.toLowerCase()
          const locationId = (w.ghlLocationId ?? "").toLowerCase()
          return name.includes(workspaceQuery) || locationId.includes(workspaceQuery)
        })

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

  useEffect(() => {
    const nextBrandLogo = displayBrandLogoUrl ?? "/images/zrg-logo-3.png"
    setBrandLogoSrc((current) => (current === nextBrandLogo ? current : nextBrandLogo))
    setLogoErrored((current) => (current ? false : current))
  }, [displayBrandLogoUrl])

  const channelToggleValue: string[] =
    activeChannels.length === 0 ? ALL_CHANNELS_TOGGLE_VALUE : activeChannels;

  return (
    <aside className="flex h-full w-[18.5rem] flex-col border-r border-border bg-card overflow-x-hidden">
      {/* Branding */}
      <div className="flex items-center gap-3 border-b border-border p-4">
        <Image
          unoptimized
          src={brandLogoSrc}
          alt={`${displayBrandName} Logo`}
          width={96}
          height={32}
          className="h-8 w-auto"
          onError={() => {
            if (!logoErrored) {
              setLogoErrored(true)
              setBrandLogoSrc("/images/zrg-logo-3.png")
            }
          }}
        />
        <div className="leading-tight">
          <div className="text-sm font-semibold text-foreground truncate">{displayBrandName}</div>
          <div className="text-xs text-muted-foreground">Inbox</div>
        </div>
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
                  {selectedWorkspace && selectedWorkspace.hasDefaultCalendarLink === false ? (
                    <span title="No default calendar link configured">
                      <AlertCircle className="h-4 w-4 shrink-0 text-amber-500" />
                    </span>
                  ) : null}
                </span>
                <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              <div className="p-2">
                <Input
                  value={workspaceSearch}
                  onChange={(e) => setWorkspaceSearch(e.target.value)}
                  placeholder="Search workspaces…"
                  className="h-8"
                />
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => onWorkspaceChange(null)}>
                <span className={cn(!activeWorkspace && "font-semibold")}>
                  All Workspaces
                </span>
              </DropdownMenuItem>
              {filteredWorkspaces.map((workspace) => (
                <DropdownMenuItem
                  key={workspace.id}
                  onClick={() => onWorkspaceChange(workspace.id)}
                >
                  <div className="flex w-full items-center justify-between gap-2">
                    <span className={cn(activeWorkspace === workspace.id && "font-semibold")}>
                      {workspace.name}
                    </span>
                    {workspace.hasDefaultCalendarLink === false ? (
                      <span title="No default calendar link configured">
                        <AlertCircle className="h-4 w-4 shrink-0 text-amber-500" />
                      </span>
                    ) : null}
                  </div>
                </DropdownMenuItem>
              ))}
              {filteredWorkspaces.length === 0 && (
                <div className="px-2 py-2 text-xs text-muted-foreground">
                  No matching workspaces
                </div>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}

      {/* Navigation */}
      <nav className="flex-1 space-y-1 p-3 overflow-y-auto overflow-x-hidden">
        {navItems.map((item) => (
          <Button
            key={item.id}
            type="button"
            variant={activeView === item.id ? "secondary" : "ghost"}
            className="w-full justify-start gap-3"
            onClick={() => onViewChange(item.id)}
            onMouseEnter={() => onViewIntent?.(item.id)}
            onFocus={() => onViewIntent?.(item.id)}
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
                  type="button"
                  variant={activeFilter === item.id ? "secondary" : "ghost"}
                  className="w-full justify-between overflow-hidden"
                  onClick={() => onFilterChange(activeFilter === item.id ? "" : item.id)}
                >
                  <span className="flex items-center gap-3 min-w-0">
                    <item.icon className="h-4 w-4" />
                    <span className="text-sm truncate">{item.label}</span>
                  </span>
                  {/* Hide counts while loading to avoid showing stale/incorrect data */}
                  {!isLoadingCounts && item.count > 0 && (
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
                type="multiple"
                value={channelToggleValue}
                onValueChange={(values) => {
                  const hasAll = values.includes("all");
                  const nextValues = hasAll ? values.filter((v) => v !== "all") : values;

                  // Special behavior:
                  // - If "All" was selected and user clicks a channel → select that channel (remove "all").
                  // - If any channel(s) were selected and user clicks "All" → clear selection (represents "all").
                  if (hasAll && activeChannels.length > 0) {
                    onChannelsChange([]);
                    return;
                  }

                  const nextChannels = nextValues.filter(
                    (v): v is Channel => v === "email" || v === "sms" || v === "linkedin"
                  );
                  if (areChannelsEqual(activeChannels, nextChannels)) return;
                  onChannelsChange(nextChannels);
                }}
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

// Preserve a readable name for production component stacks (webpack minification renames functions).
;(Sidebar as any).displayName = "Sidebar"
