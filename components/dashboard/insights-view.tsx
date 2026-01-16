"use client"

import { InsightsConsole } from "@/components/dashboard/insights-chat-sheet"

export function InsightsView({ activeWorkspace }: { activeWorkspace?: string | null }) {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <InsightsConsole activeWorkspace={activeWorkspace} />
    </div>
  )
}
