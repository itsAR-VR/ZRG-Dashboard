"use client"

import { Suspense, useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import { AlertTriangle, X } from "lucide-react"
import { Sidebar, type ViewType } from "@/components/dashboard/sidebar"
import { InboxView } from "@/components/dashboard/inbox-view"
import { FollowUpsView } from "@/components/dashboard/follow-ups-view"
import { CRMView } from "@/components/dashboard/crm-view"
import { AnalyticsView } from "@/components/dashboard/analytics-view"
import { InsightsView } from "@/components/dashboard/insights-view"
import { SettingsView } from "@/components/dashboard/settings-view"
import { Button } from "@/components/ui/button"
import { getClients } from "@/actions/client-actions"
import { getLeadWorkspaceId } from "@/actions/lead-actions"
import type { Channel } from "@/actions/lead-actions"

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

function DashboardPageInner() {
  const searchParams = useSearchParams()
  const searchParamsKey = searchParams.toString()
  const [activeView, setActiveView] = useState<ViewType>("inbox")
  const [activeChannels, setActiveChannels] = useState<Channel[]>([])
  const [activeFilter, setActiveFilter] = useState("")
  // If a deep-link includes clientId, initialize the workspace immediately so the inbox
  // doesn't briefly load "All Workspaces" (which can be slow and can lose lead selection).
  const [activeWorkspace, setActiveWorkspace] = useState<string | null>(() => {
    const clientIdParam = searchParams.get("clientId")
    return clientIdParam ? clientIdParam : null
  })
  const [workspaces, setWorkspaces] = useState<Client[]>([])
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null)
  const [settingsTab, setSettingsTab] = useState("general")
  const [dismissedUnipileBanner, setDismissedUnipileBanner] = useState<string | null>(null)

  const syncWorkspaces = (nextWorkspaces: Client[]) => {
    setWorkspaces(nextWorkspaces)
    setActiveWorkspace((prev) => {
      if (nextWorkspaces.length === 0) return null
      if (!prev) return nextWorkspaces[0].id
      if (nextWorkspaces.some((w) => w.id === prev)) return prev
      return nextWorkspaces[0].id
    })
  }

  // Handler to open a lead in the Master Inbox from CRM
  const handleOpenInInbox = (leadId: string) => {
    setSelectedLeadId(leadId)
    setActiveView("inbox")
  }

  // Handler to clear all filters (channel and sidebar filter)
  // Note: sentiment filter is managed inside InboxView
  const handleClearFilters = () => {
    setActiveChannels([])
    setActiveFilter("")
  }

  // Fetch workspaces on mount
  useEffect(() => {
    async function fetchWorkspaces() {
      const result = await getClients()
      if (result.success && result.data) {
        syncWorkspaces(result.data as Client[])
      }
    }
    fetchWorkspaces()
  }, [])

  // Sync view/lead selection from URL params (used by Follow-ups deep links)
  useEffect(() => {
    const params = new URLSearchParams(searchParamsKey)
    const viewParam = params.get("view")
    const leadIdParam = params.get("leadId")
    const clientIdParam = params.get("clientId")
    const settingsTabParam = params.get("settingsTab")

    if (leadIdParam) {
      // Lead links should always land in inbox
      setActiveView("inbox")
      setSelectedLeadId(leadIdParam)

      // Prefer explicit workspace selection from the deep-link.
      if (clientIdParam) {
        setActiveWorkspace(clientIdParam)
      } else {
        // Back-compat: resolve the workspace from the leadId.
        // This prevents landing in the wrong workspace for older links.
        getLeadWorkspaceId(leadIdParam)
          .then((result) => {
            if (result.success && result.workspaceId) {
              setActiveWorkspace(result.workspaceId)
            }
          })
          .catch(() => undefined)
      }

      return
    }

    if (
      viewParam === "inbox" ||
      viewParam === "followups" ||
      viewParam === "crm" ||
      viewParam === "analytics" ||
      viewParam === "insights" ||
      viewParam === "settings"
    ) {
      setActiveView(viewParam)
    }

    if (
      viewParam === "settings" &&
      (settingsTabParam === "general" ||
        settingsTabParam === "integrations" ||
        settingsTabParam === "ai" ||
        settingsTabParam === "team")
    ) {
      setSettingsTab(settingsTabParam)
    }
  }, [searchParamsKey])

  const renderContent = () => {
    switch (activeView) {
      case "followups":
        return <FollowUpsView activeWorkspace={activeWorkspace} />
      case "crm":
        return <CRMView activeWorkspace={activeWorkspace} onOpenInInbox={handleOpenInInbox} />
      case "analytics":
        return <AnalyticsView activeWorkspace={activeWorkspace} />
      case "insights":
        return <InsightsView activeWorkspace={activeWorkspace} />
      case "settings":
        return (
          <SettingsView 
            activeWorkspace={activeWorkspace}
            activeTab={settingsTab}
            onTabChange={setSettingsTab}
            onWorkspacesChange={syncWorkspaces}
          />
        )
      case "inbox":
      default:
        return (
          <InboxView 
            activeChannels={activeChannels}
            activeFilter={activeFilter}
            activeWorkspace={activeWorkspace}
            workspaceHasConnectedAccounts={Boolean(
              workspaces.find((w) => w.id === activeWorkspace)?.hasConnectedAccounts
            )}
            initialConversationId={selectedLeadId}
            initialCrmOpen={searchParams.get("action") === "sequence"}
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
    <div className="flex h-screen bg-background">
      <Sidebar
        activeChannels={activeChannels}
        onChannelsChange={setActiveChannels}
        activeFilter={activeFilter}
        onFilterChange={setActiveFilter}
        activeView={activeView}
        onViewChange={setActiveView}
        activeWorkspace={activeWorkspace}
        onWorkspaceChange={setActiveWorkspace}
        workspaces={workspaces}
      />
      <div className="flex flex-1 flex-col overflow-hidden">
        {showUnipileBanner && (
          <div className="flex items-center gap-3 bg-amber-500/10 border-b border-amber-500/20 px-4 py-2.5 text-amber-700 dark:text-amber-400">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span className="flex-1 text-sm">
              LinkedIn integration disconnected. Follow-ups via LinkedIn are paused until reconnected.
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
        <main className="flex flex-1 overflow-hidden">{renderContent()}</main>
      </div>
    </div>
  )
}

export default function DashboardPage() {
  return (
    <Suspense fallback={<div className="flex h-screen bg-background" />}>
      <DashboardPageInner />
    </Suspense>
  )
}
