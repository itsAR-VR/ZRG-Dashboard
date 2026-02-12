"use client"

import dynamic from "next/dynamic"

const InsightsConsole = dynamic(
  () => import("@/components/dashboard/insights-chat-sheet").then((mod) => mod.InsightsConsole),
  { loading: () => <div className="mx-4 mb-4 flex-1 animate-pulse rounded bg-muted/30" /> }
)

const MessagePerformancePanel = dynamic(
  () => import("@/components/dashboard/message-performance-panel").then((mod) => mod.MessagePerformancePanel),
  { loading: () => <div className="h-28 animate-pulse rounded bg-muted/30" /> }
)

export function InsightsView({ activeWorkspace }: { activeWorkspace?: string | null }) {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="p-4">
        <MessagePerformancePanel activeWorkspace={activeWorkspace} />
      </div>
      <InsightsConsole activeWorkspace={activeWorkspace} />
    </div>
  )
}
