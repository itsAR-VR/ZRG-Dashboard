"use client"

import { useState, useEffect } from "react"
import { Sidebar, type ViewType } from "@/components/dashboard/sidebar"
import { InboxView } from "@/components/dashboard/inbox-view"
import { FollowUpsView } from "@/components/dashboard/follow-ups-view"
import { CRMView } from "@/components/dashboard/crm-view"
import { AnalyticsView } from "@/components/dashboard/analytics-view"
import { SettingsView } from "@/components/dashboard/settings-view"
import { getClients } from "@/actions/client-actions"

interface Client {
  id: string
  name: string
  ghlLocationId: string
}

export default function DashboardPage() {
  const [activeView, setActiveView] = useState<ViewType>("inbox")
  const [activeChannel, setActiveChannel] = useState("all")
  const [activeFilter, setActiveFilter] = useState("")
  const [activeWorkspace, setActiveWorkspace] = useState<string | null>(null)
  const [workspaces, setWorkspaces] = useState<Client[]>([])

  // Fetch workspaces on mount
  useEffect(() => {
    async function fetchWorkspaces() {
      const result = await getClients()
      if (result.success && result.data) {
        setWorkspaces(result.data as Client[])
        // Don't auto-select - show all by default (null)
      }
    }
    fetchWorkspaces()
  }, [])

  const renderContent = () => {
    switch (activeView) {
      case "followups":
        return <FollowUpsView />
      case "crm":
        return <CRMView />
      case "analytics":
        return <AnalyticsView />
      case "settings":
        return <SettingsView />
      case "inbox":
      default:
        return (
          <InboxView 
            activeChannel={activeChannel}
            activeFilter={activeFilter}
            activeWorkspace={activeWorkspace}
          />
        )
    }
  }

  return (
    <div className="flex h-screen bg-background">
      <Sidebar
        activeChannel={activeChannel}
        onChannelChange={setActiveChannel}
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
