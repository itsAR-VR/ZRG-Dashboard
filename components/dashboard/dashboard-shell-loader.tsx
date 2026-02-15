"use client"

import dynamic from "next/dynamic"

const DashboardShell = dynamic(() => import("@/components/dashboard/dashboard-shell"), {
  ssr: false,
  loading: () => <div className="flex h-screen bg-background" />,
})

// Give the dynamic wrapper a stable name so production component stacks are actionable.
;(DashboardShell as any).displayName = "DashboardShell"

export function DashboardShellLoader() {
  return <DashboardShell />
}
