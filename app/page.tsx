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

          // Validate workspace from URL
          if (workspace && !isValidWorkspace(workspace, loadedWorkspaces)) {
            toast.error("Workspace not found", {
              description: "Redirecting to default workspace",
            })
            // Set to first workspace or null
            const defaultWorkspace = loadedWorkspaces.length > 0 ? loadedWorkspaces[0].id : null
            setWorkspace(defaultWorkspace)
          } else if (!workspace && loadedWorkspaces.length > 0) {
            // If no workspace set and we have workspaces, use first one
            setWorkspace(loadedWorkspaces[0].id)
          } else if (leadId) {
            // Validate lead from URL (only if workspace is already valid)
            const leadResult = await getLeadWorkspaceId(leadId)
            if (!leadResult.success) {
              toast.error("Lead not found", {
                description: "The lead may have been deleted",
              })
              setLeadId(null)
            } else if (leadResult.workspaceId && leadResult.workspaceId !== workspace) {
              // Lead belongs to different workspace - auto-switch
              toast.info("Switching workspace", {
                description: "Following lead to its workspace",
              })
              setMultiple({ workspace: leadResult.workspaceId }, { replace: true })
            }
          }
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

  // Handler for workspace changes
  const handleWorkspaceChange = useCallback((newWorkspace: string | null) => {
    // When workspace changes, clear the selected lead but keep the view and tab
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
