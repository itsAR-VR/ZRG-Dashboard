"use client"

import dynamic from "next/dynamic"
import { useState, useEffect, useMemo, useRef } from "react"
import { Users, MessageSquare, Calendar, CalendarClock, ArrowUpRight, ArrowDownRight, Loader2, BarChart3, Send, Inbox, Info } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { ChatgptExportControls } from "@/components/dashboard/chatgpt-export-controls"
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Legend,
  LineChart,
  Line,
  LabelList,
} from "recharts"
import {
  getAnalytics,
  getEmailCampaignAnalytics,
  getWorkflowAttributionAnalytics,
  getReactivationCampaignAnalytics,
  type AnalyticsData,
  type EmailCampaignKpiRow,
  type WorkflowAttributionData,
  type ReactivationAnalyticsData,
} from "@/actions/analytics-actions"
import {
  getAiDraftResponseOutcomeStats,
  type AiDraftResponseOutcomeStats,
  getAiDraftBookingConversionStats,
  type AiDraftBookingConversionStats,
} from "@/actions/ai-draft-response-analytics-actions"
import {
  getResponseTimingAnalytics,
  type ResponseTimingAnalyticsData,
} from "@/actions/response-timing-analytics-actions"

const AnalyticsCrmTable = dynamic(
  () => import("@/components/dashboard/analytics-crm-table").then((mod) => mod.AnalyticsCrmTable),
  { loading: () => <div className="h-64 animate-pulse rounded bg-muted/30" /> }
)

const BookingProcessAnalytics = dynamic(
  () =>
    import("@/components/dashboard/settings/booking-process-analytics").then(
      (mod) => mod.BookingProcessAnalytics
    ),
  { loading: () => <div className="h-64 animate-pulse rounded bg-muted/30" /> }
)

// Sentiment colors for charts
const SENTIMENT_COLORS: Record<string, string> = {
  "Meeting Requested": "#10B981",
  "Positive": "#22C55E",
  "Neutral": "#6B7280",
  "Not Interested": "#EF4444",
  "Out of Office": "#F59E0B",
  "Follow Up": "#3B82F6",
  "Information Requested": "#8B5CF6",
  "Objection": "#F97316",
  "Blacklist": "#DC2626",
  "Unknown": "#9CA3AF",
}

function hashStringToHue(value: string): number {
  let hash = 0
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0
  }
  return hash % 360
}

function getSentimentColor(sentiment: string): string {
  return SENTIMENT_COLORS[sentiment] ?? `hsl(${hashStringToHue(sentiment)}, 70%, 55%)`
}

function truncateLabel(value: string, maxLength: number): string {
  const trimmed = value.trim()
  if (trimmed.length <= maxLength) return trimmed
  return `${trimmed.slice(0, Math.max(0, maxLength - 1))}…`
}

function formatPercent(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0%"
  if (value < 1) return `${value.toFixed(1)}%`
  return `${value.toFixed(0)}%`
}

function formatPct01(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—"
  return `${Math.round(value * 100)}%`
}

function parseDateInputToLocalMidnight(value: string): Date | null {
  const trimmed = value.trim()
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed)
  if (!match) return null

  const year = Number(match[1])
  const monthIndex = Number(match[2]) - 1
  const day = Number(match[3])
  if (!Number.isFinite(year) || !Number.isFinite(monthIndex) || !Number.isFinite(day)) return null

  const date = new Date(year, monthIndex, day)
  if (date.getFullYear() !== year || date.getMonth() !== monthIndex || date.getDate() !== day) return null
  date.setHours(0, 0, 0, 0)
  return date
}

function buildCapacityTooltip(capacity: AnalyticsData["overview"]["capacity"] | undefined): string | undefined {
  if (!capacity) return undefined

  const defaultRow = capacity.breakdown?.find((row) => row.source === "DEFAULT")
  const directRow = capacity.breakdown?.find((row) => row.source === "DIRECT_BOOK")
  const anyStale = capacity.cacheMeta?.some((row) => row.isStale) ?? false
  const firstError = capacity.cacheMeta?.map((row) => row.lastError).find((value) => Boolean(value)) ?? null

  const lines: string[] = [
    `Window: next ${capacity.windowDays} days`,
    `Booked: ${capacity.bookedSlots} | Available: ${capacity.availableSlots} | Total: ${capacity.totalSlots}`,
    defaultRow
      ? `Default: ${formatPct01(defaultRow.bookedPct)} (B ${defaultRow.bookedSlots} / A ${defaultRow.availableSlots})`
      : "Default: —",
    directRow
      ? `Direct Book: ${formatPct01(directRow.bookedPct)} (B ${directRow.bookedSlots} / A ${directRow.availableSlots})`
      : "Direct Book: —",
  ]

  if (capacity.unattributedBookedSlots > 0) {
    lines.push(`Unattributed booked: ${capacity.unattributedBookedSlots}`)
  }
  if (anyStale) {
    lines.push("WARNING: availability cache is stale")
  }
  if (firstError) {
    lines.push(`Cache error: ${firstError}`)
  }

  return lines.join("\n")
}

interface AnalyticsViewProps {
  activeWorkspace?: string | null
  isActive?: boolean
}

type AnalyticsTab = "overview" | "workflows" | "campaigns" | "booking" | "crm" | "response-timing"
const ANALYTICS_CACHE_TTL_MS = 90_000
const USE_ANALYTICS_READ_API = process.env.NEXT_PUBLIC_ANALYTICS_READ_API_V1 === "1"

type AnalyticsOverviewResult = Awaited<ReturnType<typeof getAnalytics>>

async function getAnalyticsOverviewRead(
  clientId: string,
  opts?: { window?: { from: string; to: string } }
): Promise<AnalyticsOverviewResult> {
  if (!USE_ANALYTICS_READ_API) {
    return getAnalytics(clientId, opts)
  }

  const params = new URLSearchParams()
  params.set("clientId", clientId)
  if (opts?.window?.from && opts?.window?.to) {
    params.set("from", opts.window.from)
    params.set("to", opts.window.to)
  }

  const response = await fetch(`/api/analytics/overview?${params.toString()}`, { method: "GET" })
  const json = (await response.json()) as AnalyticsOverviewResult
  if (!response.ok) return json
  return json
}

export function AnalyticsView({ activeWorkspace, isActive = true }: AnalyticsViewProps) {
  const [activeTab, setActiveTab] = useState<AnalyticsTab>("overview")
  const [data, setData] = useState<AnalyticsData | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [campaignRows, setCampaignRows] = useState<EmailCampaignKpiRow[] | null>(null)
  const [campaignLoading, setCampaignLoading] = useState(true)
  const [workflowData, setWorkflowData] = useState<WorkflowAttributionData | null>(null)
  const [workflowLoading, setWorkflowLoading] = useState(true)
  const [reactivationData, setReactivationData] = useState<ReactivationAnalyticsData | null>(null)
  const [reactivationLoading, setReactivationLoading] = useState(true)
  const [aiDraftOutcomeStats, setAiDraftOutcomeStats] = useState<AiDraftResponseOutcomeStats | null>(null)
  const [aiDraftOutcomeLoading, setAiDraftOutcomeLoading] = useState(true)
  const [aiDraftBookingStats, setAiDraftBookingStats] = useState<AiDraftBookingConversionStats | null>(null)
  const [aiDraftBookingLoading, setAiDraftBookingLoading] = useState(true)
  const [responseTimingStats, setResponseTimingStats] = useState<ResponseTimingAnalyticsData | null>(null)
  const [responseTimingLoading, setResponseTimingLoading] = useState(true)
  const [responseTimingChannel, setResponseTimingChannel] = useState<"all" | "email" | "sms" | "linkedin">("all")
  const [responseTimingResponder, setResponseTimingResponder] = useState("all")
  const [datePreset, setDatePreset] = useState<"7d" | "30d" | "90d" | "custom">("30d")
  const [customFrom, setCustomFrom] = useState("")
  const [customTo, setCustomTo] = useState("")
  const overviewFetchKeyRef = useRef<string | null>(null)
  const overviewFetchedAtRef = useRef(0)
  const workflowFetchKeyRef = useRef<string | null>(null)
  const workflowFetchedAtRef = useRef(0)
  const campaignsFetchKeyRef = useRef<string | null>(null)
  const campaignsFetchedAtRef = useRef(0)
  const responseTimingFetchKeyRef = useRef<string | null>(null)
  const responseTimingFetchedAtRef = useRef(0)

  const windowRange = useMemo(() => {
    if (datePreset === "custom") {
      if (!customFrom || !customTo) return null
      const fromDate = parseDateInputToLocalMidnight(customFrom)
      const toDate = parseDateInputToLocalMidnight(customTo)
      if (!fromDate || !toDate) return null
      // Make the end date inclusive by adding a day to the exclusive bound.
      toDate.setDate(toDate.getDate() + 1)
      return { from: fromDate.toISOString(), to: toDate.toISOString() }
    }

    const now = new Date()
    const days = datePreset === "7d" ? 7 : datePreset === "30d" ? 30 : 90
    const from = new Date(now.getTime() - days * 24 * 60 * 60 * 1000)
    return { from: from.toISOString(), to: now.toISOString() }
  }, [datePreset, customFrom, customTo])

  const windowParams = useMemo(
    () => (windowRange ? { from: windowRange.from, to: windowRange.to } : undefined),
    [windowRange]
  )
  const windowKey = windowRange ? `${windowRange.from}:${windowRange.to}` : datePreset
  const windowLabel = useMemo(() => {
    if (datePreset === "custom") {
      return windowRange ? `${customFrom} → ${customTo}` : "Custom range"
    }
    if (datePreset === "7d") return "Last 7 days"
    if (datePreset === "30d") return "Last 30 days"
    if (datePreset === "90d") return "Last 90 days"
    return "Selected window"
  }, [datePreset, customFrom, customTo, windowRange])

  const overviewFetchKey = activeWorkspace ? `${activeWorkspace}:${windowKey}` : null
  const workflowFetchKey = activeWorkspace ? `${activeWorkspace}:${windowKey}` : null
  const campaignsFetchKey = activeWorkspace ? `${activeWorkspace}:${windowKey}` : null
  const responseTimingFetchKey = activeWorkspace
    ? `${activeWorkspace}:${windowKey}:${responseTimingChannel}:${responseTimingResponder}`
    : null

  useEffect(() => {
    if (!isActive || activeTab !== "overview") {
      if (!isActive) setIsLoading(false)
      return
    }
    if (!activeWorkspace) {
      setData(null)
      setIsLoading(false)
      overviewFetchKeyRef.current = null
      overviewFetchedAtRef.current = 0
      return
    }
    const workspaceId = activeWorkspace
    const isOverviewCacheFresh =
      overviewFetchKey &&
      overviewFetchKeyRef.current === overviewFetchKey &&
      Date.now() - overviewFetchedAtRef.current < ANALYTICS_CACHE_TTL_MS

    if (isOverviewCacheFresh) {
      setIsLoading(false)
      return
    }

    let cancelled = false

    async function fetchOverviewAnalytics() {
      setIsLoading(true)
      const result = await getAnalyticsOverviewRead(workspaceId, { window: windowParams })
      if (cancelled) return
      if (result.success && result.data) {
        setData(result.data)
        overviewFetchKeyRef.current = overviewFetchKey
        overviewFetchedAtRef.current = Date.now()
      } else {
        setData(null)
      }
      setIsLoading(false)
    }

    fetchOverviewAnalytics()

    return () => {
      cancelled = true
    }
  }, [activeTab, activeWorkspace, isActive, overviewFetchKey, windowParams])

  useEffect(() => {
    if (!isActive || activeTab !== "workflows") {
      if (!isActive) setWorkflowLoading(false)
      return
    }
    if (!activeWorkspace) {
      setWorkflowData(null)
      setWorkflowLoading(false)
      workflowFetchKeyRef.current = null
      workflowFetchedAtRef.current = 0
      return
    }
    const isWorkflowCacheFresh =
      workflowFetchKey &&
      workflowFetchKeyRef.current === workflowFetchKey &&
      Date.now() - workflowFetchedAtRef.current < ANALYTICS_CACHE_TTL_MS

    if (isWorkflowCacheFresh) {
      setWorkflowLoading(false)
      return
    }

    let cancelled = false

    async function fetchWorkflowAnalytics() {
      setWorkflowLoading(true)
      const result = await getWorkflowAttributionAnalytics(
        windowParams ? { clientId: activeWorkspace, ...windowParams } : { clientId: activeWorkspace }
      )
      if (cancelled) return
      if (result.success && result.data) {
        setWorkflowData(result.data)
        workflowFetchKeyRef.current = workflowFetchKey
        workflowFetchedAtRef.current = Date.now()
      } else {
        setWorkflowData(null)
      }
      setWorkflowLoading(false)
    }

    fetchWorkflowAnalytics()
    return () => {
      cancelled = true
    }
  }, [activeTab, activeWorkspace, isActive, windowParams, workflowFetchKey])

  useEffect(() => {
    if (!isActive || activeTab !== "campaigns") {
      if (!isActive) {
        setCampaignLoading(false)
        setReactivationLoading(false)
        setAiDraftOutcomeLoading(false)
        setAiDraftBookingLoading(false)
      }
      return
    }
    if (!activeWorkspace) {
      setCampaignRows(null)
      setReactivationData(null)
      setAiDraftOutcomeStats(null)
      setAiDraftBookingStats(null)
      setCampaignLoading(false)
      setReactivationLoading(false)
      setAiDraftOutcomeLoading(false)
      setAiDraftBookingLoading(false)
      campaignsFetchKeyRef.current = null
      campaignsFetchedAtRef.current = 0
      return
    }
    const isCampaignsCacheFresh =
      campaignsFetchKey &&
      campaignsFetchKeyRef.current === campaignsFetchKey &&
      Date.now() - campaignsFetchedAtRef.current < ANALYTICS_CACHE_TTL_MS

    if (isCampaignsCacheFresh) {
      setCampaignLoading(false)
      setReactivationLoading(false)
      setAiDraftOutcomeLoading(false)
      setAiDraftBookingLoading(false)
      return
    }

    let cancelled = false

    async function fetchCampaignData() {
      setCampaignLoading(true)
      setReactivationLoading(true)
      setAiDraftOutcomeLoading(true)
      setAiDraftBookingLoading(true)

      const [campaignResult, workflowResult, aiOutcomeResult, aiBookingResult] = await Promise.all([
        getEmailCampaignAnalytics(
          windowParams ? { clientId: activeWorkspace, ...windowParams } : { clientId: activeWorkspace }
        ),
        getReactivationCampaignAnalytics(
          windowParams ? { clientId: activeWorkspace, ...windowParams } : { clientId: activeWorkspace }
        ),
        getAiDraftResponseOutcomeStats(
          windowParams ? { clientId: activeWorkspace, ...windowParams } : { clientId: activeWorkspace }
        ),
        getAiDraftBookingConversionStats(
          windowParams ? { clientId: activeWorkspace, ...windowParams } : { clientId: activeWorkspace }
        ),
      ])

      if (cancelled) return

      if (campaignResult.success && campaignResult.data) {
        setCampaignRows(campaignResult.data.campaigns)
      } else {
        setCampaignRows(null)
      }
      setCampaignLoading(false)

      if (workflowResult.success && workflowResult.data) {
        setReactivationData(workflowResult.data)
      } else {
        setReactivationData(null)
      }
      setReactivationLoading(false)

      if (aiOutcomeResult.success && aiOutcomeResult.data) {
        setAiDraftOutcomeStats(aiOutcomeResult.data)
      } else {
        setAiDraftOutcomeStats(null)
      }
      setAiDraftOutcomeLoading(false)

      if (aiBookingResult.success && aiBookingResult.data) {
        setAiDraftBookingStats(aiBookingResult.data)
      } else {
        setAiDraftBookingStats(null)
      }
      setAiDraftBookingLoading(false)

      const allCampaignCallsSucceeded =
        campaignResult.success &&
        workflowResult.success &&
        aiOutcomeResult.success &&
        aiBookingResult.success

      if (allCampaignCallsSucceeded) {
        campaignsFetchKeyRef.current = campaignsFetchKey
        campaignsFetchedAtRef.current = Date.now()
      }
    }

    fetchCampaignData()
    return () => {
      cancelled = true
    }
  }, [activeTab, activeWorkspace, campaignsFetchKey, isActive, windowParams])

  useEffect(() => {
    if (!isActive || activeTab !== "response-timing") {
      if (!isActive) setResponseTimingLoading(false)
      return
    }
    if (!activeWorkspace) {
      setResponseTimingStats(null)
      setResponseTimingLoading(false)
      responseTimingFetchKeyRef.current = null
      responseTimingFetchedAtRef.current = 0
      return
    }
    const isResponseTimingCacheFresh =
      responseTimingFetchKey &&
      responseTimingFetchKeyRef.current === responseTimingFetchKey &&
      Date.now() - responseTimingFetchedAtRef.current < ANALYTICS_CACHE_TTL_MS

    if (isResponseTimingCacheFresh) {
      setResponseTimingLoading(false)
      return
    }

    let cancelled = false

    async function fetchResponseTimingAnalytics() {
      setResponseTimingLoading(true)
      const payload = windowParams
        ? {
            clientId: activeWorkspace,
            ...windowParams,
            channel: responseTimingChannel === "all" ? null : responseTimingChannel,
            responder: responseTimingResponder,
          }
        : {
            clientId: activeWorkspace,
            channel: responseTimingChannel === "all" ? null : responseTimingChannel,
            responder: responseTimingResponder,
          }

      const result = await getResponseTimingAnalytics(payload)
      if (!cancelled) {
        if (result.success && result.data) {
          setResponseTimingStats(result.data)
          responseTimingFetchKeyRef.current = responseTimingFetchKey
          responseTimingFetchedAtRef.current = Date.now()
        } else {
          setResponseTimingStats(null)
        }
        setResponseTimingLoading(false)
      }
    }

    fetchResponseTimingAnalytics()

    return () => {
      cancelled = true
    }
  }, [
    activeTab,
    activeWorkspace,
    isActive,
    responseTimingChannel,
    responseTimingFetchKey,
    responseTimingResponder,
    windowParams,
  ])

  const kpiCards = useMemo(
    () => [
      { label: "Total Leads", value: data?.overview.totalLeads.toLocaleString() || "0", icon: Users },
      { label: "Outbound Leads Contacted", value: data?.overview.outboundLeadsContacted.toLocaleString() || "0", icon: ArrowUpRight },
      { label: "Responses", value: data?.overview.responses.toLocaleString() || "0", icon: ArrowDownRight },
      { label: "Response Rate", value: `${data?.overview.responseRate || 0}%`, icon: MessageSquare },
      { label: "Meetings Booked", value: data?.overview.meetingsBooked.toString() || "0", icon: Calendar },
      {
        label: "Setter Response",
        value: data?.overview.setterResponseTime || "—",
        icon: Send,
        tooltip: "How fast setters reply to client messages (9am-5pm EST, weekdays)"
      },
      {
        label: "Client Response",
        value: data?.overview.clientResponseTime || "—",
        icon: Inbox,
        tooltip: "How fast clients reply to our messages (9am-5pm EST, weekdays)"
      },
      {
        label: "Capacity (30d)",
        value: data?.overview.capacity?.bookedPct != null ? formatPct01(data.overview.capacity.bookedPct) : "—",
        icon: CalendarClock,
        tooltip: buildCapacityTooltip(data?.overview.capacity),
      },
    ],
    [data]
  )

  const workflowCards = useMemo(
    () =>
      workflowData
        ? [
            { label: "Total Booked", value: workflowData.totalBooked.toLocaleString(), icon: Calendar },
            { label: "Booked from Initial", value: workflowData.bookedFromInitial.toLocaleString(), icon: ArrowDownRight },
            { label: "Booked from Workflow", value: workflowData.bookedFromWorkflow.toLocaleString(), icon: ArrowUpRight },
            {
              label: "Workflow Share",
              value: formatPercent((workflowData.workflowRate || 0) * 100),
              icon: BarChart3,
            },
          ]
        : [],
    [workflowData]
  )

  const reactivationSummaryCards = useMemo(
    () =>
      reactivationData
        ? [
            { label: "Sent", value: reactivationData.totals.totalSent.toLocaleString(), icon: Send },
            { label: "Responded", value: reactivationData.totals.responded.toLocaleString(), icon: MessageSquare },
            {
              label: "Response Rate",
              value: formatPercent((reactivationData.totals.responseRate || 0) * 100),
              icon: ArrowDownRight,
            },
            { label: "Meetings Booked", value: reactivationData.totals.meetingsBooked.toLocaleString(), icon: Calendar },
            {
              label: "Booking Rate",
              value: formatPercent((reactivationData.totals.bookingRate || 0) * 100),
              icon: ArrowUpRight,
            },
          ]
        : [],
    [reactivationData]
  )

  // Prepare response sentiment breakdown for bar chart
  const sentimentBarData = useMemo(() => {
    const breakdown = data?.sentimentBreakdown ?? []
    return breakdown
      .map((row) => {
        const sentiment = row.sentiment?.trim() || "Unknown"
        return {
          sentiment,
          count: row.count,
          percentage: row.percentage,
          fill: getSentimentColor(sentiment),
        }
      })
      .filter((row) => row.count > 0)
      .sort((a, b) => b.count - a.count)
  }, [data?.sentimentBreakdown])

  const sentimentChartHeight = Math.max(250, sentimentBarData.length * 28)

  // Prepare weekly stats for line chart
  const weeklyData = useMemo(
    () =>
      data?.weeklyStats.map((s) => ({
        day: s.day,
        inbound: s.inbound,
        outbound: s.outbound,
      })) || [],
    [data?.weeklyStats]
  )

  const sortedCampaignRows = useMemo(
    () =>
      (campaignRows || [])
        .slice()
        .sort((a, b) => b.rates.bookedPerPositive - a.rates.bookedPerPositive),
    [campaignRows]
  )

  return (
    <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as AnalyticsTab)} className="flex flex-col h-full overflow-auto">
      <div className="border-b px-6 py-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">Analytics</h1>
            <p className="text-muted-foreground">Track your outreach performance</p>
          </div>
          <div className="flex items-center gap-2">
            <ChatgptExportControls activeWorkspace={activeWorkspace} />
            <Select value={datePreset} onValueChange={(value) => setDatePreset(value as typeof datePreset)}>
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder="Select period" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7d">Last 7 days</SelectItem>
                <SelectItem value="30d">Last 30 days</SelectItem>
                <SelectItem value="90d">Last 90 days</SelectItem>
                <SelectItem value="custom">Custom range</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        {datePreset === "custom" && (
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <label htmlFor="analytics-custom-from" className="text-sm text-muted-foreground">From</label>
              <Input
                id="analytics-custom-from"
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
              />
            </div>
            <div className="flex items-center gap-2">
              <label htmlFor="analytics-custom-to" className="text-sm text-muted-foreground">To</label>
              <Input
                id="analytics-custom-to"
                type="date"
                value={customTo}
                min={customFrom || undefined}
                onChange={(e) => setCustomTo(e.target.value)}
              />
            </div>
            {!windowRange && (
              <span className="text-xs text-muted-foreground">Select a start and end date to apply.</span>
            )}
          </div>
        )}
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="workflows">Workflows</TabsTrigger>
          <TabsTrigger value="campaigns">Campaigns</TabsTrigger>
          <TabsTrigger value="booking">Booking</TabsTrigger>
          <TabsTrigger value="crm">CRM</TabsTrigger>
          <TabsTrigger value="response-timing">Response Timing</TabsTrigger>
        </TabsList>
      </div>

      <TabsContent value="overview" className="flex-1">
        {isLoading ? (
          <div className="flex flex-1 flex-col items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : !data || data.overview.totalLeads === 0 ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center space-y-4">
              <div className="p-4 rounded-full bg-muted/50 w-fit mx-auto">
                <BarChart3 className="h-12 w-12 text-muted-foreground" />
              </div>
              <div>
                <h3 className="text-lg font-semibold">No analytics data yet</h3>
                <p className="text-sm text-muted-foreground max-w-sm">
                  {activeWorkspace 
                    ? "This workspace doesn't have enough data to show analytics. Start conversations to see insights."
                    : "Select a workspace or wait for incoming messages to see analytics data."
                  }
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="p-6 space-y-6">
        {/* KPI Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {kpiCards.map((kpi) => (
            <Card key={kpi.label}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <kpi.icon className="h-5 w-5 text-muted-foreground" />
                  {kpi.tooltip && (
                    <span title={kpi.tooltip}>
                      <Info className="h-3.5 w-3.5 text-muted-foreground/50 cursor-help" />
                    </span>
                  )}
                </div>
                <p className="text-2xl font-bold">{kpi.value}</p>
                <p className="text-xs text-muted-foreground">{kpi.label}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Charts Row */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Sentiment Breakdown Bar Chart */}
          <Card>
            <CardHeader>
              <CardTitle>Response Sentiment</CardTitle>
              <CardDescription>Sentiment breakdown by responses (hover for counts)</CardDescription>
            </CardHeader>
            <CardContent>
              {sentimentBarData.length > 0 ? (
                <ChartContainer
                  config={{
                    percentage: { label: "Sentiment", color: "#6B7280" },
                  }}
                  className="aspect-auto"
                  style={{ height: sentimentChartHeight }}
                >
                  <BarChart
                    data={sentimentBarData}
                    layout="vertical"
                    margin={{ top: 0, right: 24, left: 0, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                    <XAxis
                      type="number"
                      domain={[0, 100]}
                      tickFormatter={(value) => `${value}%`}
                    />
                    <YAxis
                      type="category"
                      dataKey="sentiment"
                      width={170}
                      interval={0}
                      tickFormatter={(value: string) => truncateLabel(value, 28)}
                    />
                    <ChartTooltip
                      content={
                        <ChartTooltipContent
                          hideLabel
                          formatter={(_value, _name, _item, _index, payload) => {
                            const row = payload as
                              | { sentiment?: string; count?: number; percentage?: number }
                              | undefined

                            const sentiment = row?.sentiment ?? "Unknown"
                            const count = typeof row?.count === "number" ? row.count : 0
                            const pct = typeof row?.percentage === "number" ? row.percentage : 0

                            return (
                              <div className="flex flex-1 justify-between gap-4">
                                <span className="text-muted-foreground">{sentiment}</span>
                                <span className="text-foreground font-mono font-medium tabular-nums">
                                  {count.toLocaleString()} ({pct.toFixed(1)}%)
                                </span>
                              </div>
                            )
                          }}
                        />
                      }
                    />
                    <Bar dataKey="percentage" radius={[0, 4, 4, 0]}>
                      {sentimentBarData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.fill} />
                      ))}
                      <LabelList
                        dataKey="percentage"
                        position="right"
                        formatter={(value) => formatPercent(typeof value === "number" ? value : Number(value) || 0)}
                      />
                    </Bar>
                  </BarChart>
                </ChartContainer>
              ) : (
                <div className="h-[250px] flex items-center justify-center text-muted-foreground">
                  No sentiment data available
                </div>
              )}
            </CardContent>
          </Card>

          {/* Channel Performance Bar Chart */}
          <Card>
            <CardHeader>
              <CardTitle>Channel Performance</CardTitle>
              <CardDescription>Outreach metrics by channel</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-[250px] flex items-center justify-center text-muted-foreground">
                SMS channel data will appear here
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Weekly Activity Line Chart */}
        <Card>
          <CardHeader>
            <CardTitle>Weekly Activity</CardTitle>
            <CardDescription>Message activity over the past week</CardDescription>
          </CardHeader>
          <CardContent>
            {weeklyData.length > 0 ? (
              <ChartContainer
                config={{
                  inbound: { label: "Inbound", color: "#3B82F6" },
                  outbound: { label: "Outbound", color: "#10B981" },
                }}
                className="h-[250px] aspect-auto"
              >
                <LineChart data={weeklyData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="day" />
                  <YAxis />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Legend />
                  <Line type="monotone" dataKey="inbound" stroke="#3B82F6" strokeWidth={2} dot={{ r: 4 }} name="Inbound" />
                  <Line type="monotone" dataKey="outbound" stroke="#10B981" strokeWidth={2} dot={{ r: 4 }} name="Outbound" />
                </LineChart>
              </ChartContainer>
            ) : (
              <div className="h-[250px] flex items-center justify-center text-muted-foreground">
                No activity data available
              </div>
            )}
          </CardContent>
        </Card>

        {/* Per-Setter Response Times (workspace only) */}
        {activeWorkspace && (
          <Card>
            <CardHeader>
              <CardTitle>Setter Response Times</CardTitle>
              <CardDescription>
                Average response time per setter (9am-5pm EST, {windowLabel})
              </CardDescription>
            </CardHeader>
            <CardContent>
              {data.perSetterResponseTimes && data.perSetterResponseTimes.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Setter</TableHead>
                      <TableHead className="text-right">Avg Response</TableHead>
                      <TableHead className="text-right">Responses</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.perSetterResponseTimes.map((row, index) => {
                      // Color code: < 30m = green, 30m-2h = yellow, > 2h = red
                      const avgMinutes = row.avgResponseTimeMs / (1000 * 60)
                      const badgeVariant = avgMinutes < 30 ? "default" : avgMinutes < 120 ? "secondary" : "destructive"

                      return (
                        <TableRow key={row.userId}>
                          <TableCell className="font-medium">
                            <div className="flex items-center gap-2">
                              <span
                                className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                                  index === 0
                                    ? "bg-yellow-500/20 text-yellow-500"
                                    : index === 1
                                      ? "bg-gray-400/20 text-gray-400"
                                      : index === 2
                                        ? "bg-orange-500/20 text-orange-500"
                                        : "bg-muted text-muted-foreground"
                                }`}
                              >
                                {index + 1}
                              </span>
                              <div className="flex flex-col">
                                <span>{row.email || "Unknown User"}</span>
                                {row.role && (
                                  <span className="text-xs text-muted-foreground">{row.role}</span>
                                )}
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="text-right">
                            <Badge variant={badgeVariant}>
                              {row.avgResponseTimeFormatted}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">{row.responseCount}</TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              ) : (
                <div className="py-8 text-center text-muted-foreground">
                  No setter response data available. Response times are tracked when setters reply to client messages during business hours (9am-5pm EST).
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* SMS Sub-clients (workspace only) */}
        {activeWorkspace ? (
          <Card>
            <CardHeader>
              <CardTitle>SMS Sub-clients</CardTitle>
              <CardDescription>Breakdown by SMS sub-client within this workspace</CardDescription>
            </CardHeader>
            <CardContent>
              {data.smsSubClients && data.smsSubClients.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Sub-client</TableHead>
                      <TableHead className="text-right">Leads (Positive)</TableHead>
                      <TableHead className="text-right">Replies</TableHead>
                      <TableHead className="text-right">Meetings</TableHead>
                      <TableHead className="text-right">Positive Rate</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.smsSubClients.map((row) => (
                      <TableRow key={row.name}>
                        <TableCell className="font-medium">{row.name}</TableCell>
                        <TableCell className="text-right">{row.leads}</TableCell>
                        <TableCell className="text-right">{row.responses}</TableCell>
                        <TableCell className="text-right">{row.meetingsBooked}</TableCell>
                        <TableCell className="text-right">
                          <Badge variant={row.leads > 0 ? "default" : "secondary"}>
                            {row.responses > 0 ? Math.round((row.leads / row.responses) * 100) : 0}%
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <div className="py-8 text-center text-muted-foreground">
                  No sub-client data available
                </div>
              )}
            </CardContent>
          </Card>
        ) : null}

        {/* Top Clients */}
        <Card>
          <CardHeader>
            <CardTitle>Top Clients</CardTitle>
            <CardDescription>Clients with most leads and meetings</CardDescription>
          </CardHeader>
          <CardContent>
            {data.topClients && data.topClients.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Client</TableHead>
                    <TableHead className="text-right">Leads</TableHead>
                    <TableHead className="text-right">Meetings</TableHead>
                    <TableHead className="text-right">Conv. Rate</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.topClients.map((client, index) => (
                    <TableRow key={client.name}>
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2">
                          <span
                            className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                              index === 0
                                ? "bg-yellow-500/20 text-yellow-500"
                                : index === 1
                                  ? "bg-gray-400/20 text-gray-400"
                                  : index === 2
                                    ? "bg-orange-500/20 text-orange-500"
                                    : "bg-muted text-muted-foreground"
                            }`}
                          >
                            {index + 1}
                          </span>
                          {client.name}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">{client.leads}</TableCell>
                      <TableCell className="text-right">{client.meetings}</TableCell>
                      <TableCell className="text-right">
                        <Badge variant={client.meetings > 0 ? "default" : "secondary"}>
                          {client.leads > 0 ? Math.round((client.meetings / client.leads) * 100) : 0}%
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <div className="py-8 text-center text-muted-foreground">
                No client data available
              </div>
            )}
          </CardContent>
        </Card>
          </div>
        )}
      </TabsContent>

      <TabsContent value="workflows" className="flex-1">
        <div className="p-6 space-y-6">
          {workflowLoading ? (
            <div className="flex h-[200px] items-center justify-center text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : !workflowData || workflowData.totalBooked === 0 ? (
            <div className="py-12 text-center text-muted-foreground">
              <BarChart3 className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No workflow attribution data yet</p>
              <p className="text-sm mt-2">Bookings in the selected window will appear here.</p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {workflowCards.map((card) => (
                  <Card key={card.label}>
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between mb-2">
                        <card.icon className="h-5 w-5 text-muted-foreground" />
                      </div>
                      <p className="text-2xl font-bold">{card.value}</p>
                      <p className="text-xs text-muted-foreground">{card.label}</p>
                    </CardContent>
                  </Card>
                ))}
              </div>

              <Card>
                <CardHeader>
                  <CardTitle>Sequence Attribution</CardTitle>
                  <CardDescription>Bookings attributed to the earliest follow-up step ({windowLabel})</CardDescription>
                </CardHeader>
                <CardContent>
                  {workflowData.bySequence.length > 0 ? (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Sequence</TableHead>
                          <TableHead className="text-right">Booked</TableHead>
                          <TableHead className="text-right">Share</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {workflowData.bySequence.map((row) => (
                          <TableRow key={row.sequenceId}>
                            <TableCell className="font-medium">{row.sequenceName}</TableCell>
                            <TableCell className="text-right">{row.bookedCount}</TableCell>
                            <TableCell className="text-right">{formatPercent(row.percentage * 100)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  ) : (
                    <div className="py-6 text-center text-muted-foreground">No sequence attribution yet.</div>
                  )}
                  {workflowData.unattributed > 0 && (
                    <div className="mt-4 text-xs text-muted-foreground">
                      Unattributed bookings: {workflowData.unattributed}
                    </div>
                  )}
                </CardContent>
              </Card>
            </>
          )}
        </div>
      </TabsContent>

      <TabsContent value="campaigns" className="flex-1">
        <div className="p-6 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Reactivation Campaign KPIs</CardTitle>
              <CardDescription>{windowLabel}</CardDescription>
            </CardHeader>
            <CardContent>
              {reactivationLoading ? (
                <div className="h-[120px] flex items-center justify-center text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin" />
                </div>
              ) : reactivationData ? (
                <>
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
                    {reactivationSummaryCards.map((card) => (
                      <Card key={card.label}>
                        <CardContent className="p-4">
                          <div className="flex items-center justify-between mb-2">
                            <card.icon className="h-5 w-5 text-muted-foreground" />
                          </div>
                          <p className="text-2xl font-bold">{card.value}</p>
                          <p className="text-xs text-muted-foreground">{card.label}</p>
                        </CardContent>
                      </Card>
                    ))}
                  </div>

                  {reactivationData.campaigns.length > 0 ? (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Campaign</TableHead>
                          <TableHead className="text-right">Sent</TableHead>
                          <TableHead className="text-right">Responded</TableHead>
                          <TableHead className="text-right">Response Rate</TableHead>
                          <TableHead className="text-right">Booked</TableHead>
                          <TableHead className="text-right">Booking Rate</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {reactivationData.campaigns.map((row) => (
                          <TableRow key={row.campaignId}>
                            <TableCell className="font-medium">{row.campaignName}</TableCell>
                            <TableCell className="text-right">{row.totalSent}</TableCell>
                            <TableCell className="text-right">{row.responded}</TableCell>
                            <TableCell className="text-right">{formatPercent(row.responseRate * 100)}</TableCell>
                            <TableCell className="text-right">{row.meetingsBooked}</TableCell>
                            <TableCell className="text-right">{formatPercent(row.bookingRate * 100)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  ) : (
                    <div className="py-8 text-center text-muted-foreground">No reactivation campaigns yet.</div>
                  )}
                </>
              ) : (
                <div className="py-8 text-center text-muted-foreground">No reactivation data available</div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Email Campaign KPIs</CardTitle>
              <CardDescription>{windowLabel} (positive replies → meetings requested/booked)</CardDescription>
            </CardHeader>
            <CardContent>
              {campaignLoading ? (
                <div className="h-[120px] flex items-center justify-center text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin" />
                </div>
              ) : sortedCampaignRows.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Campaign</TableHead>
                      <TableHead className="text-right">Positive</TableHead>
                      <TableHead className="text-right">Requested</TableHead>
                      <TableHead className="text-right">Booked</TableHead>
                      <TableHead className="text-right">Booked / Positive</TableHead>
                      <TableHead className="text-right">Booked / Requested</TableHead>
                      <TableHead className="text-right">Mode</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedCampaignRows.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell className="font-medium">
                          <div className="flex flex-col">
                            <span>{row.name}</span>
                            <span className="text-xs text-muted-foreground">{row.bisonCampaignId}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-right">{row.positiveReplies}</TableCell>
                        <TableCell className="text-right">{row.meetingsRequested}</TableCell>
                        <TableCell className="text-right">{row.meetingsBooked}</TableCell>
                        <TableCell className="text-right">{Math.round(row.rates.bookedPerPositive * 100)}%</TableCell>
                        <TableCell className="text-right">{Math.round(row.rates.bookedPerRequested * 100)}%</TableCell>
                        <TableCell className="text-right">
                          {row.responseMode === "AI_AUTO_SEND" ? (
                            <Badge variant="default">
                              AI ≥ {Math.round(row.autoSendConfidenceThreshold * 100)}%
                            </Badge>
                          ) : (
                            <Badge variant="secondary">Setter</Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <div className="py-8 text-center text-muted-foreground">
                  No campaign data available
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>AI Draft Response Outcomes</CardTitle>
              <CardDescription>
                {windowLabel} • Email counts are for AI_AUTO_SEND campaigns only
              </CardDescription>
            </CardHeader>
            <CardContent>
              {aiDraftOutcomeLoading ? (
                <div className="h-[120px] flex items-center justify-center text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin" />
                </div>
              ) : !aiDraftOutcomeStats || (aiDraftOutcomeStats.total.tracked ?? 0) === 0 ? (
                <div className="py-8 text-center text-muted-foreground">No tracked outcomes in this window</div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Channel</TableHead>
                      <TableHead className="text-right">Auto‑Sent</TableHead>
                      <TableHead className="text-right">Approved</TableHead>
                      <TableHead className="text-right">Edited</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <TableRow>
                      <TableCell className="font-medium">Email</TableCell>
                      <TableCell className="text-right">{aiDraftOutcomeStats.byChannel.email.AUTO_SENT}</TableCell>
                      <TableCell className="text-right">{aiDraftOutcomeStats.byChannel.email.APPROVED}</TableCell>
                      <TableCell className="text-right">{aiDraftOutcomeStats.byChannel.email.EDITED}</TableCell>
                      <TableCell className="text-right">{aiDraftOutcomeStats.byChannel.email.total}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-medium">SMS</TableCell>
                      <TableCell className="text-right">{aiDraftOutcomeStats.byChannel.sms.AUTO_SENT}</TableCell>
                      <TableCell className="text-right">{aiDraftOutcomeStats.byChannel.sms.APPROVED}</TableCell>
                      <TableCell className="text-right">{aiDraftOutcomeStats.byChannel.sms.EDITED}</TableCell>
                      <TableCell className="text-right">{aiDraftOutcomeStats.byChannel.sms.total}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-medium">LinkedIn</TableCell>
                      <TableCell className="text-right">{aiDraftOutcomeStats.byChannel.linkedin.AUTO_SENT}</TableCell>
                      <TableCell className="text-right">{aiDraftOutcomeStats.byChannel.linkedin.APPROVED}</TableCell>
                      <TableCell className="text-right">{aiDraftOutcomeStats.byChannel.linkedin.EDITED}</TableCell>
                      <TableCell className="text-right">{aiDraftOutcomeStats.byChannel.linkedin.total}</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>AI Draft Booking Conversion</CardTitle>
              <CardDescription>
                {windowLabel} • Email stats are for AI_AUTO_SEND campaigns only • Booked within{" "}
                {aiDraftBookingStats?.attributionWindowDays ?? 30}d of send • Pending excludes last{" "}
                {aiDraftBookingStats?.maturityBufferDays ?? 7}d
              </CardDescription>
            </CardHeader>
            <CardContent>
              {aiDraftBookingLoading ? (
                <div className="h-[120px] flex items-center justify-center text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin" />
                </div>
              ) : !aiDraftBookingStats ||
                aiDraftBookingStats.total.all.booked +
                  aiDraftBookingStats.total.all.notBooked +
                  aiDraftBookingStats.total.all.pending +
                  aiDraftBookingStats.total.all.bookedNoTimestamp ===
                  0 ? (
                <div className="py-8 text-center text-muted-foreground">No tracked sends in this window</div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Channel</TableHead>
                      <TableHead>Disposition</TableHead>
                      <TableHead className="text-right">Eligible</TableHead>
                      <TableHead className="text-right">Booked</TableHead>
                      <TableHead className="text-right">Booking Rate</TableHead>
                      <TableHead className="text-right">Pending</TableHead>
                      <TableHead className="text-right">No Timestamp</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(["email", "sms", "linkedin"] as const).flatMap((channel) =>
                      (["AUTO_SENT", "APPROVED", "EDITED"] as const).map((disposition) => {
                        const bucket = aiDraftBookingStats.byChannel[channel][disposition]
                        const channelLabel = channel === "email" ? "Email" : channel === "sms" ? "SMS" : "LinkedIn"
                        const dispositionLabel =
                          disposition === "AUTO_SENT"
                            ? "Auto‑Sent"
                            : disposition === "APPROVED"
                              ? "Approved"
                              : "Edited"

                        return (
                          <TableRow key={`${channel}-${disposition}`}>
                            <TableCell className="font-medium">{channelLabel}</TableCell>
                            <TableCell>{dispositionLabel}</TableCell>
                            <TableCell className="text-right">{bucket.eligible}</TableCell>
                            <TableCell className="text-right">{bucket.booked}</TableCell>
                            <TableCell className="text-right">
                              {bucket.bookingRate == null ? "—" : formatPercent(bucket.bookingRate * 100)}
                            </TableCell>
                            <TableCell className="text-right">{bucket.pending}</TableCell>
                            <TableCell className="text-right">{bucket.bookedNoTimestamp}</TableCell>
                          </TableRow>
                        )
                      })
                    )}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      </TabsContent>

      <TabsContent value="booking" className="flex-1">
        <div className="p-6 space-y-6">
          <BookingProcessAnalytics activeWorkspace={activeWorkspace} />
        </div>
      </TabsContent>

      <TabsContent value="crm" className="flex-1">
        <div className="p-6">
          <AnalyticsCrmTable activeWorkspace={activeWorkspace} window={windowParams} windowLabel={windowLabel} />
        </div>
      </TabsContent>

      <TabsContent value="response-timing" className="flex-1">
        <div className="p-6 space-y-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <h2 className="text-xl font-semibold">Response Timing</h2>
              <p className="text-sm text-muted-foreground">
                Booking conversion by first response per lead (first responder wins) for {windowLabel}.
              </p>
              {responseTimingStats ? (
                <p className="text-xs text-muted-foreground">
                  Attribution window: {responseTimingStats.attributionWindowDays}d • Maturity buffer:{" "}
                  {responseTimingStats.maturityBufferDays}d
                </p>
              ) : null}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Select
                value={responseTimingChannel}
                onValueChange={(value) => {
                  setResponseTimingChannel(value as typeof responseTimingChannel)
                  setResponseTimingResponder("all")
                }}
              >
                <SelectTrigger className="w-[160px]">
                  <SelectValue placeholder="All channels" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All channels</SelectItem>
                  <SelectItem value="sms">SMS</SelectItem>
                  <SelectItem value="email">Email</SelectItem>
                  <SelectItem value="linkedin">LinkedIn</SelectItem>
                </SelectContent>
              </Select>

              <Select value={responseTimingResponder} onValueChange={setResponseTimingResponder}>
                <SelectTrigger className="w-[220px]">
                  <SelectValue placeholder="All responders" />
                </SelectTrigger>
                <SelectContent>
                  {(responseTimingStats?.responderOptions ?? [{ key: "all", label: "All responders", eligible: 0 }]).map(
                    (option) => (
                      <SelectItem key={option.key} value={option.key}>
                        {option.key === "all" || option.eligible <= 0
                          ? option.label
                          : `${option.label} (${option.eligible})`}
                      </SelectItem>
                    )
                  )}
                </SelectContent>
              </Select>
            </div>
          </div>

          {responseTimingLoading ? (
            <div className="flex flex-1 flex-col items-center justify-center py-10">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : !responseTimingStats ? (
            <div className="text-sm text-muted-foreground">No response timing analytics available for this window.</div>
          ) : (
            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>Responders</CardTitle>
                  <CardDescription>Lead-level: first responder per lead (avg response time + booking rate)</CardDescription>
                </CardHeader>
                <CardContent>
                  {responseTimingStats.responderSummary.length === 0 ? (
                    <div className="text-sm text-muted-foreground">No responders found for this window.</div>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Responder</TableHead>
                          <TableHead className="text-right">Eligible</TableHead>
                          <TableHead className="text-right">Booked</TableHead>
                          <TableHead className="text-right">Rate</TableHead>
                          <TableHead className="text-right">Avg Response</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {responseTimingStats.responderSummary.map((row) => (
                          <TableRow key={row.key}>
                            <TableCell className="font-medium">{row.label}</TableCell>
                            <TableCell className="text-right">{row.stats.eligible}</TableCell>
                            <TableCell className="text-right">{row.stats.booked}</TableCell>
                            <TableCell className="text-right">
                              {row.stats.bookingRate == null ? "—" : formatPercent(row.stats.bookingRate * 100)}
                            </TableCell>
                            <TableCell className="text-right">{row.avgResponseFormatted ?? "—"}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <Card>
                  <CardHeader>
                    <CardTitle>First Response Time</CardTitle>
                    <CardDescription>Lead-level: first response per lead (setter or AI)</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Bucket</TableHead>
                          <TableHead className="text-right">Eligible</TableHead>
                          <TableHead className="text-right">Booked</TableHead>
                          <TableHead className="text-right">Rate</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {responseTimingStats.responseTime.map((row) => (
                          <TableRow key={row.bucket}>
                            <TableCell className="font-medium">{row.bucket}</TableCell>
                            <TableCell className="text-right">{row.stats.eligible}</TableCell>
                            <TableCell className="text-right">{row.stats.booked}</TableCell>
                            <TableCell className="text-right">
                              {row.stats.bookingRate == null ? "—" : formatPercent(row.stats.bookingRate * 100)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>AI Chosen Delay</CardTitle>
                    <CardDescription>AI-only (first responder AI): chosen delay bucket</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Bucket</TableHead>
                          <TableHead className="text-right">Eligible</TableHead>
                          <TableHead className="text-right">Booked</TableHead>
                          <TableHead className="text-right">Rate</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {responseTimingStats.aiChosenDelay.map((row) => (
                          <TableRow key={row.bucket}>
                            <TableCell className="font-medium">{row.bucket}</TableCell>
                            <TableCell className="text-right">{row.stats.eligible}</TableCell>
                            <TableCell className="text-right">{row.stats.booked}</TableCell>
                            <TableCell className="text-right">
                              {row.stats.bookingRate == null ? "—" : formatPercent(row.stats.bookingRate * 100)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>AI Drift</CardTitle>
                    <CardDescription>AI-only (first responder AI): scheduled runAt → actual send</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Bucket</TableHead>
                          <TableHead className="text-right">Eligible</TableHead>
                          <TableHead className="text-right">Booked</TableHead>
                          <TableHead className="text-right">Rate</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {responseTimingStats.aiDrift.map((row) => (
                          <TableRow key={row.bucket}>
                            <TableCell className="font-medium">{row.bucket}</TableCell>
                            <TableCell className="text-right">{row.stats.eligible}</TableCell>
                            <TableCell className="text-right">{row.stats.booked}</TableCell>
                            <TableCell className="text-right">
                              {row.stats.bookingRate == null ? "—" : formatPercent(row.stats.bookingRate * 100)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              </div>
            </div>
          )}
        </div>
      </TabsContent>
    </Tabs>
  )
}
