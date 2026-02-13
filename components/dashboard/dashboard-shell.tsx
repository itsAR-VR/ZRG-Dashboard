"use client"

import { Suspense, memo, useCallback, useEffect, useRef, useState } from "react"
import dynamic from "next/dynamic"
import { useSearchParams } from "next/navigation"
import { AlertTriangle, X } from "lucide-react"
import { Sidebar, type ViewType } from "@/components/dashboard/sidebar"
import { DashboardErrorBoundary } from "@/components/dashboard/dashboard-error-boundary"
import { Button } from "@/components/ui/button"
import { QueryProvider } from "@/components/providers/query-provider"
import { UserProvider } from "@/contexts/user-context"
import { getClients } from "@/actions/client-actions"
import { getLeadWorkspaceId } from "@/actions/lead-actions"
import type { Channel } from "@/actions/lead-actions"
import { cn } from "@/lib/utils"

const dynamicViewLoadingFallback = () => <div className="flex-1 animate-pulse rounded bg-muted/30" />

const loadInboxView = () => import("@/components/dashboard/inbox-view").then((mod) => mod.InboxView)
const loadFollowUpsView = () => import("@/components/dashboard/follow-ups-view").then((mod) => mod.FollowUpsView)
const loadCRMView = () => import("@/components/dashboard/crm-view").then((mod) => mod.CRMView)
const loadAnalyticsView = () => import("@/components/dashboard/analytics-view").then((mod) => mod.AnalyticsView)
const loadInsightsView = () => import("@/components/dashboard/insights-view").then((mod) => mod.InsightsView)
const loadSettingsView = () => import("@/components/dashboard/settings-view").then((mod) => mod.SettingsView)

const InboxView = dynamic(loadInboxView, { loading: dynamicViewLoadingFallback })
const FollowUpsView = dynamic(loadFollowUpsView, { loading: dynamicViewLoadingFallback })
const CRMView = dynamic(loadCRMView, { loading: dynamicViewLoadingFallback })
const AnalyticsView = dynamic(loadAnalyticsView, { loading: dynamicViewLoadingFallback })
const InsightsView = dynamic(loadInsightsView, { loading: dynamicViewLoadingFallback })
const SettingsView = dynamic(loadSettingsView, { loading: dynamicViewLoadingFallback })

const VIEW_PREFETCH_LOADERS: Record<ViewType, () => Promise<unknown>> = {
  inbox: loadInboxView,
  followups: loadFollowUpsView,
  crm: loadCRMView,
  analytics: loadAnalyticsView,
  insights: loadInsightsView,
  settings: loadSettingsView,
}

const PREFETCH_BY_VIEW: Record<ViewType, ViewType[]> = {
  inbox: ["crm"],
  followups: ["inbox"],
  crm: ["inbox"],
  analytics: ["insights"],
  insights: ["analytics"],
  settings: ["inbox"],
}

function parseViewParam(value: string | null): ViewType | null {
  if (
    value === "inbox" ||
    value === "followups" ||
    value === "crm" ||
    value === "analytics" ||
    value === "insights" ||
    value === "settings"
  ) {
    return value
  }
  return null
}

type SettingsTab = "general" | "integrations" | "ai" | "booking" | "team" | "admin"

function parseSettingsTabParam(value: string | null): SettingsTab | null {
  if (
    value === "general" ||
    value === "integrations" ||
    value === "ai" ||
    value === "booking" ||
    value === "team" ||
    value === "admin"
  ) {
    return value
  }
  return null
}

function coerceSettingsTab(value: string | null): SettingsTab {
  return parseSettingsTabParam(value) ?? "general"
}

interface Client {
  id: string
  name: string
  ghlLocationId: string | null
  hasDefaultCalendarLink?: boolean
  brandName?: string | null
  brandLogoUrl?: string | null
  hasConnectedAccounts?: boolean
  unipileConnectionStatus?: string | null
}

const FollowUpsPane = memo(function FollowUpsPane({
  activeWorkspace,
}: {
  activeWorkspace: string | null
}) {
  return <FollowUpsView activeWorkspace={activeWorkspace} />
})

const CRMPane = memo(function CRMPane({
  activeWorkspace,
  onOpenInInbox,
}: {
  activeWorkspace: string | null
  onOpenInInbox: (leadId: string) => void
}) {
  return <CRMView activeWorkspace={activeWorkspace} onOpenInInbox={onOpenInInbox} />
})

const AnalyticsPane = memo(function AnalyticsPane({
  activeWorkspace,
  isActive,
}: {
  activeWorkspace: string | null
  isActive: boolean
}) {
  return <AnalyticsView activeWorkspace={activeWorkspace} isActive={isActive} />
})

const InsightsPane = memo(function InsightsPane({
  activeWorkspace,
}: {
  activeWorkspace: string | null
}) {
  return <InsightsView activeWorkspace={activeWorkspace} />
})

const SettingsPane = memo(function SettingsPane({
  activeWorkspace,
  settingsTab,
  onSettingsTabChange,
  onWorkspacesChange,
}: {
  activeWorkspace: string | null
  settingsTab: SettingsTab
  onSettingsTabChange: (tab: string) => void
  onWorkspacesChange: (workspaces: Client[]) => void
}) {
  return (
    <SettingsView
      activeWorkspace={activeWorkspace}
      activeTab={settingsTab}
      onTabChange={onSettingsTabChange}
      onWorkspacesChange={onWorkspacesChange}
    />
  )
})

function DashboardPageInner() {
  const searchParams = useSearchParams()
  const viewParam = searchParams.get("view")
  const leadIdParam = searchParams.get("leadId")
  const clientIdParam = searchParams.get("clientId")
  const settingsTabParam = searchParams.get("settingsTab")
  const actionParam = searchParams.get("action")
  const initialView = parseViewParam(viewParam) ?? "inbox"
  const prefetchedViewsRef = useRef<Set<ViewType>>(new Set([initialView]))
  const prefetchingViewsRef = useRef<Set<ViewType>>(new Set())
  const resolvedLeadWorkspaceRef = useRef<string | null>(null)
  const [activeView, setActiveView] = useState<ViewType>(initialView)
  const [activeChannels, setActiveChannels] = useState<Channel[]>([])
  const [activeFilter, setActiveFilter] = useState("")
  // If a deep-link includes clientId, initialize the workspace immediately so the inbox
  // doesn't briefly load "All Workspaces" (which can be slow and can lose lead selection).
  const [workspaceSelectionMode, setWorkspaceSelectionMode] = useState<"auto" | "manual">(() => {
    return searchParams.get("clientId") ? "manual" : "auto"
  })
  const [activeWorkspace, setActiveWorkspace] = useState<string | null>(() => {
    const clientIdParam = searchParams.get("clientId")
    return clientIdParam ? clientIdParam : null
  })
  const workspaceSelectionModeRef = useRef<"auto" | "manual">(workspaceSelectionMode)
  const [workspaces, setWorkspaces] = useState<Client[]>([])
  const [workspacesReady, setWorkspacesReady] = useState(false)
  const [workspaceError, setWorkspaceError] = useState<string | null>(null)
  const [workspaceFetchNonce, setWorkspaceFetchNonce] = useState(0)
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(() => leadIdParam)
  const [settingsTab, setSettingsTab] = useState<SettingsTab>(() =>
    coerceSettingsTab(settingsTabParam)
  )
  const [dismissedUnipileBanner, setDismissedUnipileBanner] = useState<string | null>(null)

  const prefetchView = useCallback((view: ViewType) => {
    if (prefetchedViewsRef.current.has(view)) return
    if (prefetchingViewsRef.current.has(view)) return
    prefetchingViewsRef.current.add(view)
    void VIEW_PREFETCH_LOADERS[view]()
      .then(() => {
        prefetchedViewsRef.current.add(view)
      })
      .catch(() => undefined)
      .finally(() => {
        prefetchingViewsRef.current.delete(view)
      })
  }, [])

  const handleWorkspaceChange = (nextWorkspace: string | null) => {
    setWorkspaceSelectionMode("manual")
    // Manual workspace switches should not "pin" a previously deep-linked lead selection.
    // If a leadId is present in the URL, we keep it; otherwise clear selection so the inbox
    // can pick a valid conversation for the new workspace.
    if (!leadIdParam) {
      setSelectedLeadId(null)
    }
    setActiveWorkspace(nextWorkspace)
  }

  const handleViewChange = useCallback(
    (view: ViewType) => {
      if (view !== activeView) {
        prefetchView(view)
      }
      setActiveView(view)
    },
    [activeView, prefetchView]
  )

  const handleViewIntent = useCallback(
    (view: ViewType) => {
      if (view === activeView) return
      prefetchView(view)
    },
    [activeView, prefetchView]
  )

  useEffect(() => {
    workspaceSelectionModeRef.current = workspaceSelectionMode
  }, [workspaceSelectionMode])

  const syncWorkspaces = useCallback((nextWorkspaces: Client[]) => {
    setWorkspaces(nextWorkspaces)
    setActiveWorkspace((prev) => {
      if (nextWorkspaces.length === 0) return null
      if (workspaceSelectionModeRef.current === "manual" && prev === null) return null
      if (!prev) return nextWorkspaces[0].id
      if (nextWorkspaces.some((w) => w.id === prev)) return prev
      return nextWorkspaces[0].id
    })
  }, [])

  // Handler to open a lead in the Master Inbox from CRM
  const handleOpenInInbox = useCallback((leadId: string) => {
    setSelectedLeadId(leadId)
    setActiveView("inbox")
  }, [])

  const handleSettingsTabChange = useCallback((tab: string) => {
    setSettingsTab(coerceSettingsTab(tab))
  }, [])

  // Handler to clear all filters (channel and sidebar filter)
  // Note: sentiment filter is managed inside InboxView
  const handleClearFilters = () => {
    setActiveChannels([])
    setActiveFilter("")
  }

  // Fetch workspaces on mount
  useEffect(() => {
    async function fetchWorkspaces() {
      setWorkspacesReady(false)
      setWorkspaceError(null)

      try {
        const result = await getClients()
        if (result.success && result.data) {
          syncWorkspaces(result.data as Client[])
        } else {
          setWorkspaceError(result.error || "Failed to load workspaces")
        }
      } catch {
        setWorkspaceError("Failed to load workspaces")
      } finally {
        setWorkspacesReady(true)
      }
    }
    fetchWorkspaces()
  }, [syncWorkspaces, workspaceFetchNonce])

  // Sync view/lead selection from URL params (used by Follow-ups deep links)
  useEffect(() => {
    const parsedView = parseViewParam(viewParam)
    const parsedSettingsTab = parseSettingsTabParam(settingsTabParam)

    if (leadIdParam) {
      // Lead links should always land in inbox
      setActiveView((current) => (current === "inbox" ? current : "inbox"))
      setSelectedLeadId((current) => (current === leadIdParam ? current : leadIdParam))

      // Prefer explicit workspace selection from the deep-link.
      if (clientIdParam) {
        resolvedLeadWorkspaceRef.current = leadIdParam
        setWorkspaceSelectionMode((current) => (current === "manual" ? current : "manual"))
        setActiveWorkspace((current) => (current === clientIdParam ? current : clientIdParam))
      } else {
        if (resolvedLeadWorkspaceRef.current === leadIdParam) return
        resolvedLeadWorkspaceRef.current = leadIdParam
        // Back-compat: resolve the workspace from the leadId.
        // This prevents landing in the wrong workspace for older links.
        getLeadWorkspaceId(leadIdParam)
          .then((result) => {
            if (result.success && result.workspaceId) {
              const resolvedWorkspaceId = result.workspaceId
              setWorkspaceSelectionMode((current) => (current === "manual" ? current : "manual"))
              setActiveWorkspace((current) =>
                current === resolvedWorkspaceId ? current : resolvedWorkspaceId
              )
            }
          })
          .catch(() => undefined)
      }

      return
    }

    resolvedLeadWorkspaceRef.current = null

    if (parsedView) {
      setActiveView((current) => (current === parsedView ? current : parsedView))
    }

    // Only honor URL tab overrides when an explicit settingsTab query param exists.
    // This prevents render churn from repeatedly forcing "general" while users navigate tabs.
    if (parsedView === "settings" && parsedSettingsTab) {
      setSettingsTab((current) => (current === parsedSettingsTab ? current : parsedSettingsTab))
    }
  }, [
    clientIdParam,
    leadIdParam,
    settingsTabParam,
    viewParam,
  ])

  useEffect(() => {
    prefetchedViewsRef.current.add(activeView)
  }, [activeView])

  useEffect(() => {
    const targets = PREFETCH_BY_VIEW[activeView]
    if (!targets || targets.length === 0) return

    const timer = window.setTimeout(() => {
      targets.forEach((view) => prefetchView(view))
    }, 200)

    return () => {
      window.clearTimeout(timer)
    }
  }, [activeView, prefetchView])

  const renderContent = (view: ViewType, isActiveView: boolean) => {
    const workspaceKey = activeWorkspace ?? "all"
    switch (view) {
      case "followups":
        return <FollowUpsPane key={`followups:${workspaceKey}`} activeWorkspace={activeWorkspace} />
      case "crm":
        return (
          <CRMPane
            key={`crm:${workspaceKey}`}
            activeWorkspace={activeWorkspace}
            onOpenInInbox={handleOpenInInbox}
          />
        )
      case "analytics":
        return (
          <AnalyticsPane
            key={`analytics:${workspaceKey}`}
            activeWorkspace={activeWorkspace}
            isActive={isActiveView}
          />
        )
      case "insights":
        return <InsightsPane key={`insights:${workspaceKey}`} activeWorkspace={activeWorkspace} />
      case "settings":
        return (
          <SettingsPane
            key={`settings:${workspaceKey}`}
            activeWorkspace={activeWorkspace}
            settingsTab={settingsTab}
            onSettingsTabChange={handleSettingsTabChange}
            onWorkspacesChange={syncWorkspaces}
          />
        )
      case "inbox":
      default:
        return (
          <InboxView
            key={`inbox:${workspaceKey}`}
            isActive={isActiveView}
            activeChannels={activeChannels}
            activeFilter={activeFilter}
            activeWorkspace={activeWorkspace}
            workspacesReady={workspacesReady}
            hasWorkspaces={workspaces.length > 0}
            workspaceHasConnectedAccounts={Boolean(
              workspaces.find((w) => w.id === activeWorkspace)?.hasConnectedAccounts
            )}
            initialConversationId={selectedLeadId}
            initialCrmOpen={actionParam === "sequence"}
            onClearFilters={handleClearFilters}
          />
        )
    }
  }

  // Check if selected workspace has a disconnected Unipile account
  const selectedWorkspace = workspaces.find((w) => w.id === activeWorkspace)
  const isUnipileDisconnected = selectedWorkspace?.unipileConnectionStatus === "DISCONNECTED"
  const showUnipileBanner = isUnipileDisconnected && dismissedUnipileBanner !== activeWorkspace

  const handleNavigateToIntegrations = () => {
    setActiveView("settings")
    setSettingsTab("integrations")
  }

  return (
    <DashboardErrorBoundary
      scope="DashboardShell"
      context={{
        activeView,
        activeWorkspace,
      }}
    >
      <QueryProvider>
        <UserProvider>
          <div className="flex h-screen bg-background">
            <a
              href="#main-content"
              className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:rounded-md focus:bg-background focus:px-4 focus:py-2 focus:ring-2 focus:ring-ring"
            >
              Skip to main content
            </a>
            <Sidebar
              activeChannels={activeChannels}
              onChannelsChange={setActiveChannels}
              activeFilter={activeFilter}
              onFilterChange={setActiveFilter}
              activeView={activeView}
              onViewChange={handleViewChange}
              onViewIntent={handleViewIntent}
              activeWorkspace={activeWorkspace}
              onWorkspaceChange={handleWorkspaceChange}
              workspaces={workspaces}
            />
            <div className="flex flex-1 flex-col overflow-hidden">
              {workspaceError && (
                <div className="flex items-center gap-3 bg-destructive/10 border-b border-destructive/20 px-4 py-2.5 text-destructive">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  <span className="flex-1 text-sm">{workspaceError}</span>
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-destructive/40 text-destructive hover:bg-destructive/10"
                    onClick={() => setWorkspaceFetchNonce((n) => n + 1)}
                  >
                    Retry
                  </Button>
                  <button
                    onClick={() => setWorkspaceError(null)}
                    className="p-1 hover:bg-destructive/20 rounded"
                    aria-label="Dismiss"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              )}
              {showUnipileBanner && (
                <div className="flex items-center gap-3 bg-amber-500/10 border-b border-amber-500/20 px-4 py-2.5 text-amber-700 dark:text-amber-400">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  <span className="flex-1 text-sm">
                    LinkedIn integration disconnected. Follow-ups via LinkedIn are paused until
                    reconnected.
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-amber-500/50 text-amber-700 hover:bg-amber-500/10 dark:text-amber-400"
                    onClick={handleNavigateToIntegrations}
                  >
                    Reconnect
                  </Button>
                  <button
                    onClick={() => setDismissedUnipileBanner(activeWorkspace)}
                    className="p-1 hover:bg-amber-500/20 rounded"
                    aria-label="Dismiss"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              )}
              <main id="main-content" className="flex flex-1 overflow-hidden">
                <section className={cn("h-full min-h-0 flex-1")}>
                  {renderContent(activeView, true)}
                </section>
              </main>
            </div>
          </div>
        </UserProvider>
      </QueryProvider>
    </DashboardErrorBoundary>
  )
}

export default function DashboardPage() {
  return (
    <Suspense fallback={<div className="flex h-screen bg-background" />}>
      <DashboardPageInner />
    </Suspense>
  )
}
