"use client"

import dynamic from "next/dynamic"

const Toaster = dynamic(() => import("sonner").then((mod) => mod.Toaster), {
  ssr: false,
})

const Analytics = dynamic(() => import("@vercel/analytics/next").then((mod) => mod.Analytics), {
  ssr: false,
})

const Agentation = dynamic(() => import("agentation").then((mod) => mod.Agentation), {
  ssr: false,
})

export function PostHydrationEnhancements() {
  const isDevelopment = process.env.NODE_ENV === "development"
  const endpoint = process.env.NEXT_PUBLIC_AGENTATION_ENDPOINT || "http://localhost:4747"

  return (
    <>
      <Toaster richColors position="bottom-right" />
      <Analytics />
      {isDevelopment ? <Agentation endpoint={endpoint} /> : null}
    </>
  )
}
