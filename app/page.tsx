"use client"

import { useState, useEffect } from "react"
import { Sidebar, type ViewType } from "@/components/dashboard/sidebar"
import { InboxView } from "@/components/dashboard/inbox-view"
import { FollowUpsView } from "@/components/dashboard/follow-ups-view"
import { CRMView } from "@/components/dashboard/crm-view"
import { AnalyticsView } from "@/components/dashboard/analytics-view"
import { SettingsView } from "@/components/dashboard/settings-view"
import { getClients } from "@/actions/client-actions"
import type { Channel } from "@/actions/lead-actions"

interface Client {
  id: string
  name: string
  ghlLocationId: string
  hasDefaultCalendarLink?: boolean
}

export default function DashboardPage() {
  const [activeView, setActiveView] = useState<ViewType>("inbox")
  const [activeChannels, setActiveChannels] = useState<Channel[]>([])
  const [activeFilter, setActiveFilter] = useState("")
  const [activeWorkspace, setActiveWorkspace] = useState<string | null>(null)
  const [workspaces, setWorkspaces] = useState<Client[]>([])
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null)
  const [settingsTab, setSettingsTab] = useState("general")

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

  const renderContent = () => {
    switch (activeView) {
      case "followups":
        return <FollowUpsView activeWorkspace={activeWorkspace} />
      case "crm":
        return <CRMView activeWorkspace={activeWorkspace} onOpenInInbox={handleOpenInInbox} />
      case "analytics":
        return <AnalyticsView activeWorkspace={activeWorkspace} />
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
            initialConversationId={selectedLeadId}
            onClearFilters={handleClearFilters}
          />
        )
    }
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
      <main className="flex flex-1 overflow-hidden">{renderContent()}</main>
    </div>
  )
}
