"use client"

import React from "react"

type ErrorBoundaryContext = Record<string, unknown>

export class DashboardErrorBoundary extends React.Component<
  {
    children: React.ReactNode
    scope?: string
    context?: ErrorBoundaryContext
  },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    // In production, React minifies stacks. `componentStack` is still useful for pinpointing
    // which component triggered the crash (e.g. render-loops like React error #301).
    const scope = this.props.scope ?? "Dashboard"
    const context = this.props.context ?? {}

    // Avoid logging huge objects; keep it to a small JSON-ish payload.
    console.error(`[${scope}] client crash`, {
      message: error?.message,
      stack: error?.stack,
      componentStack: errorInfo?.componentStack,
      context,
    })
  }

  private handleReload = () => {
    if (typeof window === "undefined") return
    window.location.reload()
  }

  render() {
    if (!this.state.error) return this.props.children

    // Minimal, production-safe fallback. The important part is the console error above.
    return (
      <div className="flex h-screen w-full flex-col items-center justify-center gap-3 bg-background px-6 text-center">
        <div className="text-lg font-semibold text-foreground">Application error</div>
        <div className="max-w-md text-sm text-muted-foreground">
          A client-side exception occurred. Reload the page and try again.
        </div>
        <button
          type="button"
          onClick={this.handleReload}
          className="inline-flex h-11 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground"
        >
          Reload
        </button>
      </div>
    )
  }
}

