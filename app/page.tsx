"use client"

import { useState } from "react"
import { Sidebar, type ViewType } from "@/components/dashboard/sidebar"
import { ConversationFeed } from "@/components/dashboard/conversation-feed"
import { ActionStation } from "@/components/dashboard/action-station"
import { CrmDrawer } from "@/components/dashboard/crm-drawer"
import { FollowUpsView } from "@/components/dashboard/follow-ups-view"
import { CRMView } from "@/components/dashboard/crm-view"
import { AnalyticsView } from "@/components/dashboard/analytics-view"
import { SettingsView } from "@/components/dashboard/settings-view"
import { mockConversations } from "@/lib/mock-data"

export default function DashboardPage() {
  const [activeView, setActiveView] = useState<ViewType>("inbox")
  const [activeChannel, setActiveChannel] = useState("all")
  const [activeFilter, setActiveFilter] = useState("")
  const [activeConversationId, setActiveConversationId] = useState<string | null>(mockConversations[0]?.id || null)
  const [isCrmOpen, setIsCrmOpen] = useState(false)

  // Filter conversations by channel
  const filteredConversations = mockConversations.filter((conv) => {
    if (activeChannel !== "all" && conv.platform !== activeChannel) return false
    if (activeFilter === "attention" && !conv.requiresAttention) return false
    if (activeFilter === "drafts" && !conv.hasAiDraft) return false
    return true
  })

  const activeConversation = mockConversations.find((conv) => conv.id === activeConversationId) || null

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
          <>
            <ConversationFeed
              conversations={filteredConversations}
              activeConversationId={activeConversationId}
              onSelectConversation={setActiveConversationId}
            />
            <ActionStation
              conversation={activeConversation}
              onToggleCrm={() => setIsCrmOpen(!isCrmOpen)}
              isCrmOpen={isCrmOpen}
            />
            {activeConversation && (
              <CrmDrawer lead={activeConversation.lead} isOpen={isCrmOpen} onClose={() => setIsCrmOpen(false)} />
            )}
          </>
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
