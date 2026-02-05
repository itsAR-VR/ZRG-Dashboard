"use client"

import { InsightsConsole } from "@/components/dashboard/insights-chat-sheet"
import { MessagePerformancePanel } from "@/components/dashboard/message-performance-panel"

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
