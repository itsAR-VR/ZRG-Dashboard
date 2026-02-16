"use client"

import React from "react"

type ErrorBoundaryContext = Record<string, unknown>

export class DashboardErrorBoundary extends React.Component<
  {
    children: React.ReactNode
    scope?: string
    context?: ErrorBoundaryContext
  },
  { error: Error | null; componentStack: string | null }
> {
  state: { error: Error | null; componentStack: string | null } = { error: null, componentStack: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    // In production, React minifies stacks. `componentStack` is still useful for pinpointing
    // which component triggered the crash (e.g. render-loops like React error #301).
    const scope = this.props.scope ?? "Dashboard"
    const context = this.props.context ?? {}

    // Avoid logging huge objects; keep it to a small JSON-ish payload.
    const payload = {
      message: error?.message,
      stack: error?.stack,
      componentStack: errorInfo?.componentStack,
      context,
    }
    console.error(`[${scope}] client crash`, payload)
    // Also log important fields as plain strings so they can be copy-pasted without expanding objects.
    if (payload.componentStack) {
      console.error(`[${scope}] componentStack:\n${payload.componentStack}`)
    }
    console.error(`[${scope}] context`, context)

    this.setState({ componentStack: payload.componentStack ?? null })
  }

  private handleReload = () => {
    if (typeof window === "undefined") return
    window.location.reload()
  }

  render() {
    if (!this.state.error) return this.props.children

    const showDebugDetails =
      typeof window !== "undefined" && new URLSearchParams(window.location.search).get("debug") === "1"

    // Minimal, production-safe fallback. The important part is the console error above.
    return (
      <div
        className="flex h-screen w-full flex-col items-center justify-center gap-3 bg-background px-6 text-center"
        data-testid="dashboard-error-boundary"
      >
        <div className="text-lg font-semibold text-foreground">Application error</div>
        <div className="max-w-md text-sm text-muted-foreground">
          A client-side exception occurred. Reload the page and try again.
        </div>
        {showDebugDetails ? (
          <div className="mt-3 w-full max-w-2xl text-left">
            <div className="text-xs font-semibold text-muted-foreground">Debug details (?debug=1)</div>
            <pre className="mt-2 max-h-80 overflow-auto rounded-md bg-muted p-3 text-xs text-foreground">
              {this.state.error.message}
              {"\n\n"}
              {this.state.error.stack || "(no stack)"}
              {"\n\n"}
              {this.state.componentStack ?? "(no componentStack)"}
              {"\n\n"}
              {JSON.stringify(this.props.context ?? {}, null, 2)}
            </pre>
          </div>
        ) : null}
        <button
          type="button"
          onClick={this.handleReload}
          className="inline-flex h-11 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground"
          data-testid="dashboard-error-boundary-reload"
        >
          Reload
        </button>
      </div>
    )
  }
}
