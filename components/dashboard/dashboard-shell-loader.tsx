"use client"

import dynamic from "next/dynamic"

const DashboardShell = dynamic(() => import("@/components/dashboard/dashboard-shell"), {
  ssr: false,
  loading: () => <div className="flex h-screen bg-background" />,
})

export function DashboardShellLoader() {
  return <DashboardShell />
}
