"use client"

import { useState } from "react"
import { Sidebar, type ViewType } from "@/components/dashboard/sidebar"
import { InboxView } from "@/components/dashboard/inbox-view"
import { FollowUpsView } from "@/components/dashboard/follow-ups-view"
import { CRMView } from "@/components/dashboard/crm-view"
import { AnalyticsView } from "@/components/dashboard/analytics-view"
import { SettingsView } from "@/components/dashboard/settings-view"

export default function DashboardPage() {
  const [activeView, setActiveView] = useState<ViewType>("inbox")
  const [activeChannel, setActiveChannel] = useState("all")
  const [activeFilter, setActiveFilter] = useState("")

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
      />
      <main className="flex flex-1 overflow-hidden">{renderContent()}</main>
    </div>
  )
}
