"use client"

import { useState, useEffect, useCallback, Suspense } from "react"
import { Sidebar, type ViewType } from "@/components/dashboard/sidebar"
import { InboxView } from "@/components/dashboard/inbox-view"
import { FollowUpsView } from "@/components/dashboard/follow-ups-view"
import { CRMView } from "@/components/dashboard/crm-view"
import { AnalyticsView } from "@/components/dashboard/analytics-view"
import { SettingsView } from "@/components/dashboard/settings-view"
import { getClients } from "@/actions/client-actions"
import { getLeadWorkspaceId } from "@/actions/lead-actions"
import { useUrlState, isValidWorkspace } from "@/hooks/use-url-state"
import { toast } from "sonner"
import { Loader2 } from "lucide-react"

interface Client {
  id: string
  name: string
  ghlLocationId: string
}

function DashboardContent() {
  const {
    view,
    workspace,
    channel,
    filter,
    leadId,
    tab,
    fTab,
    setView,
    setWorkspace,
    setChannel,
    setFilter,
    setLeadId,
    setTab,
    setFTab,
    setMultiple,
  } = useUrlState()

  const [workspaces, setWorkspaces] = useState<Client[]>([])
  const [isInitialized, setIsInitialized] = useState(false)

  // Fetch workspaces on mount and validate URL state
  useEffect(() => {
    async function initialize() {
      try {
        const result = await getClients()
        if (result.success && result.data) {
          const loadedWorkspaces = result.data as Client[]
          setWorkspaces(loadedWorkspaces)

          // Edge case: No workspaces - redirect to settings
          if (loadedWorkspaces.length === 0) {
            setView("settings")
            setIsInitialized(true)
            return
          }

          // Track the effective workspace (may be corrected below)
          let effectiveWorkspace = workspace

          // Block 1: Fix invalid workspace
          if (workspace && !isValidWorkspace(workspace, loadedWorkspaces)) {
            toast.error("Workspace not found", {
              description: "Redirecting to default workspace",
            })
            effectiveWorkspace = loadedWorkspaces[0].id
            setWorkspace(effectiveWorkspace)
          }

          // Block 2: Set default workspace if none
          if (!effectiveWorkspace && loadedWorkspaces.length > 0) {
            effectiveWorkspace = loadedWorkspaces[0].id
            setWorkspace(effectiveWorkspace)
          }

          // Block 3: Validate lead (runs independently after workspace corrections)
          if (leadId) {
            const leadResult = await getLeadWorkspaceId(leadId)
            if (!leadResult.success) {
              toast.error("Lead not found", {
                description: "The lead may have been deleted",
              })
              setLeadId(null)
            } else if (leadResult.workspaceId && leadResult.workspaceId !== effectiveWorkspace) {
              // Lead takes priority - switch to lead's workspace
              toast.info("Switching workspace", {
                description: "Following lead to its workspace",
              })
              setMultiple({ workspace: leadResult.workspaceId }, { replace: true })
            }
          }
        } else {
          // API returned error
          toast.error("Failed to load workspaces")
        }
      } catch (error) {
        console.error("Failed to initialize dashboard:", error)
        toast.error("Failed to load workspaces")
      } finally {
        // ALWAYS set initialized to true, even on error
        setIsInitialized(true)
      }
    }

    initialize()
  }, []) // Only run on mount

  // Handler to open a lead in the Master Inbox from CRM
  const handleOpenInInbox = useCallback((openLeadId: string) => {
    setMultiple({ view: "inbox", leadId: openLeadId })
  }, [setMultiple])

  // Handler for view changes
  const handleViewChange = useCallback((newView: ViewType) => {
    setView(newView)
  }, [setView])

  // Handler for workspace changes - clears leadId when switching
  const handleWorkspaceChange = useCallback((newWorkspace: string | null) => {
    setMultiple({ workspace: newWorkspace, leadId: null }, { replace: true })
  }, [setMultiple])

  // Render content based on active view
  const renderContent = () => {
    switch (view as ViewType) {
      case "followups":
        return (
          <FollowUpsView 
            activeWorkspace={workspace}
            activeTab={fTab}
            onTabChange={setFTab}
          />
        )
      case "crm":
        return <CRMView activeWorkspace={workspace} onOpenInInbox={handleOpenInInbox} />
      case "analytics":
        return <AnalyticsView activeWorkspace={workspace} />
      case "settings":
        return (
          <SettingsView 
            activeWorkspace={workspace}
            activeTab={tab}
            onTabChange={setTab}
          />
        )
      case "inbox":
      default:
        return (
          <InboxView 
            activeChannel={channel}
            activeFilter={filter}
            activeWorkspace={workspace}
            initialConversationId={leadId}
            onLeadSelect={setLeadId}
          />
        )
    }
  }

  // Show loading state while initializing
  if (!isInitialized) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="flex h-screen bg-background">
      <Sidebar
        activeChannel={channel}
        onChannelChange={setChannel}
        activeFilter={filter}
        onFilterChange={setFilter}
        activeView={view as ViewType}
        onViewChange={handleViewChange}
        activeWorkspace={workspace}
        onWorkspaceChange={handleWorkspaceChange}
        workspaces={workspaces}
      />
      <main className="flex flex-1 overflow-hidden">{renderContent()}</main>
    </div>
  )
}

// Wrap in Suspense for useSearchParams
export default function DashboardPage() {
  return (
    <Suspense fallback={
      <div className="flex h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    }>
      <DashboardContent />
    </Suspense>
  )
}
