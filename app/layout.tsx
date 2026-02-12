import type React from "react"
import type { Metadata } from "next"
import { PostHydrationEnhancements } from "@/components/providers/post-hydration-enhancements"
import "./globals.css"

export const metadata: Metadata = {
  title: "ZRG Inbox | AI Master Dashboard",
  description: "AI-powered master inbox and CRM dashboard for high-volume sales outreach",
  generator: "v0.app",
  icons: {
    icon: [
      {
        url: "/icon-light-32x32.png",
        media: "(prefers-color-scheme: light)",
      },
      {
        url: "/icon-dark-32x32.png",
        media: "(prefers-color-scheme: dark)",
      },
      {
        url: "/icon.svg",
        type: "image/svg+xml",
      },
    ],
    shortcut: "/icon-dark-32x32.png",
    apple: "/apple-icon.png",
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className="dark">
      <body className={`font-sans antialiased`}>
        {children}
        <PostHydrationEnhancements />
      </body>
    </html>
  )
}
