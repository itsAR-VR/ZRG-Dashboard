"use client"

import { InsightsConsole } from "@/components/dashboard/insights-chat-sheet"

export function InsightsView({ activeWorkspace }: { activeWorkspace?: string | null }) {
  return (
    <div className="flex flex-col h-full overflow-auto">
      <InsightsConsole activeWorkspace={activeWorkspace} />
    </div>
  )
}

