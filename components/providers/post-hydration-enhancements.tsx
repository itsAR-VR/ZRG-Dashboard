"use client"

import dynamic from "next/dynamic"

const Toaster = dynamic(() => import("sonner").then((mod) => mod.Toaster), {
  ssr: false,
})

const Analytics = dynamic(() => import("@vercel/analytics/next").then((mod) => mod.Analytics), {
  ssr: false,
})

export function PostHydrationEnhancements() {
  return (
    <>
      <Toaster richColors position="bottom-right" />
      <Analytics />
    </>
  )
}
