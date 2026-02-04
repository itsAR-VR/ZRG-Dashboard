"use client"

import { useState, useEffect, useMemo } from "react"
import { Users, MessageSquare, Calendar, ArrowUpRight, ArrowDownRight, Loader2, BarChart3, Send, Inbox, Info } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { ChatgptExportControls } from "@/components/dashboard/chatgpt-export-controls"
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { AnalyticsCrmTable } from "@/components/dashboard/analytics-crm-table"
import { BookingProcessAnalytics } from "@/components/dashboard/settings/booking-process-analytics"
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
} from "@/actions/ai-draft-response-analytics-actions"

// Sentiment colors for charts
const SENTIMENT_COLORS: Record<string, string> = {
  "Meeting Requested": "#10B981",
  "Positive": "#22C55E",
  "Neutral": "#6B7280",
  "Not Interested": "#EF4444",
  "Out of Office": "#F59E0B",
  "Follow Up": "#3B82F6",
  "Information Requested": "#8B5CF6",
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

interface AnalyticsViewProps {
  activeWorkspace?: string | null
}

export function AnalyticsView({ activeWorkspace }: AnalyticsViewProps) {
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
  const [datePreset, setDatePreset] = useState<"7d" | "30d" | "90d" | "custom">("30d")
  const [customFrom, setCustomFrom] = useState("")
  const [customTo, setCustomTo] = useState("")

  const windowRange = useMemo(() => {
    if (datePreset === "custom") {
      if (!customFrom || !customTo) return null
      const from = new Date(customFrom)
      const to = new Date(customTo)
      if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime())) return null
      // Make the end date inclusive by adding a day.
      to.setDate(to.getDate() + 1)
      return { from: from.toISOString(), to: to.toISOString() }
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

  useEffect(() => {
    let cancelled = false

    async function fetchAnalytics() {
      setIsLoading(true)
      const result = await getAnalytics(activeWorkspace, { window: windowParams })
      if (!cancelled) {
        if (result.success && result.data) {
          setData(result.data)
        } else {
          setData(null)
        }
        setIsLoading(false)
      }
    }

    async function fetchCampaignAnalytics() {
      setCampaignLoading(true)
      const result = await getEmailCampaignAnalytics(
        windowParams ? { clientId: activeWorkspace, ...windowParams } : { clientId: activeWorkspace }
      )
      if (!cancelled) {
        if (result.success && result.data) {
          setCampaignRows(result.data.campaigns)
        } else {
          setCampaignRows(null)
        }
        setCampaignLoading(false)
      }
    }

    async function fetchWorkflowAnalytics() {
      setWorkflowLoading(true)
      const result = await getWorkflowAttributionAnalytics(
        windowParams ? { clientId: activeWorkspace, ...windowParams } : { clientId: activeWorkspace }
      )
      if (!cancelled) {
        if (result.success && result.data) {
          setWorkflowData(result.data)
        } else {
          setWorkflowData(null)
        }
        setWorkflowLoading(false)
      }
    }

    async function fetchReactivationAnalytics() {
      setReactivationLoading(true)
      const result = await getReactivationCampaignAnalytics(
        windowParams ? { clientId: activeWorkspace, ...windowParams } : { clientId: activeWorkspace }
      )
      if (!cancelled) {
        if (result.success && result.data) {
          setReactivationData(result.data)
        } else {
          setReactivationData(null)
        }
        setReactivationLoading(false)
      }
    }

    async function fetchAiDraftOutcomes() {
      setAiDraftOutcomeLoading(true)
      const result = await getAiDraftResponseOutcomeStats(
        windowParams ? { clientId: activeWorkspace, ...windowParams } : { clientId: activeWorkspace }
      )
      if (!cancelled) {
        if (result.success && result.data) {
          setAiDraftOutcomeStats(result.data)
        } else {
          setAiDraftOutcomeStats(null)
        }
        setAiDraftOutcomeLoading(false)
      }
    }

    fetchAnalytics()
    fetchCampaignAnalytics()
    fetchWorkflowAnalytics()
    fetchReactivationAnalytics()
    fetchAiDraftOutcomes()

    return () => {
      cancelled = true
    }
  }, [activeWorkspace, windowKey, windowParams])

  const kpiCards = [
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
  ]

  const workflowCards = workflowData
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
    : []

  const reactivationSummaryCards = reactivationData
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
    : []

  // Prepare response sentiment breakdown for bar chart
  const sentimentBarData = (() => {
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
  })()

  const sentimentChartHeight = Math.max(250, sentimentBarData.length * 28)

  // Prepare weekly stats for line chart
  const weeklyData = data?.weeklyStats.map((s) => ({
    day: s.day,
    inbound: s.inbound,
    outbound: s.outbound,
  })) || []

  const sortedCampaignRows = (campaignRows || [])
    .slice()
    .sort((a, b) => b.rates.bookedPerPositive - a.rates.bookedPerPositive)

  return (
    <Tabs defaultValue="overview" className="flex flex-col h-full overflow-auto">
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
              <span className="text-sm text-muted-foreground">From</span>
              <Input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">To</span>
              <Input
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
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
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
        </div>
      </TabsContent>

      <TabsContent value="booking" className="flex-1">
        <div className="p-6 space-y-6">
          <BookingProcessAnalytics activeWorkspace={activeWorkspace} />
        </div>
      </TabsContent>

      <TabsContent value="crm" className="flex-1">
        <div className="p-6">
          <AnalyticsCrmTable activeWorkspace={activeWorkspace} />
        </div>
      </TabsContent>
    </Tabs>
  )
}
