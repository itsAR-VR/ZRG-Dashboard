"use client"

import { useState, useEffect } from "react"
import { Users, MessageSquare, Calendar, Clock, ArrowUpRight, ArrowDownRight, Loader2, BarChart3, Download } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart"
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
import { getAnalytics, getEmailCampaignAnalytics, type AnalyticsData, type EmailCampaignKpiRow } from "@/actions/analytics-actions"

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

  useEffect(() => {
    async function fetchAnalytics() {
      setIsLoading(true)
      const result = await getAnalytics(activeWorkspace)
      
      if (result.success && result.data) {
        setData(result.data)
      } else {
        setData(null)
      }
      
      setIsLoading(false)
    }

    async function fetchCampaignAnalytics() {
      setCampaignLoading(true)
      const result = await getEmailCampaignAnalytics({ clientId: activeWorkspace })
      if (result.success && result.data) {
        setCampaignRows(result.data.campaigns)
      } else {
        setCampaignRows(null)
      }
      setCampaignLoading(false)
    }

    fetchAnalytics()
    fetchCampaignAnalytics()
  }, [activeWorkspace])

  const kpiCards = [
    { label: "Total Leads", value: data?.overview.totalLeads.toLocaleString() || "0", icon: Users, change: 0, up: true },
    { label: "Outbound Leads Contacted", value: data?.overview.outboundLeadsContacted.toLocaleString() || "0", icon: ArrowUpRight, change: 0, up: true },
    { label: "Responses", value: data?.overview.responses.toLocaleString() || "0", icon: ArrowDownRight, change: 0, up: true },
    { label: "Response Rate", value: `${data?.overview.responseRate || 0}%`, icon: MessageSquare, change: 0, up: true },
    { label: "Meetings Booked", value: data?.overview.meetingsBooked.toString() || "0", icon: Calendar, change: 0, up: true },
    { label: "Avg Response Time", value: data?.overview.avgResponseTime || "—", icon: Clock, change: 0, up: true },
  ]

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

  if (isLoading) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  // Empty state when no data
  if (!data || data.overview.totalLeads === 0) {
    return (
      <div className="flex flex-col h-full">
        <div className="border-b px-6 py-4">
          <h1 className="text-2xl font-bold">Analytics</h1>
          <p className="text-muted-foreground">Track your outreach performance</p>
        </div>
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
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full overflow-auto">
      <div className="border-b px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Analytics</h1>
            <p className="text-muted-foreground">Track your outreach performance</p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              disabled={!activeWorkspace}
              onClick={() => {
                if (!activeWorkspace) return
                window.location.href = `/api/export/chatgpt?clientId=${activeWorkspace}`
              }}
            >
              <Download className="h-4 w-4 mr-2" />
              Download dataset for ChatGPT
            </Button>
            <Select defaultValue="7d">
              <SelectTrigger className="w-[150px]" disabled title="Time range filtering is coming soon">
                <SelectValue placeholder="Select period" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="24h">Last 24 hours</SelectItem>
                <SelectItem value="7d">Last 7 days</SelectItem>
                <SelectItem value="30d">Last 30 days</SelectItem>
                <SelectItem value="90d">Last 90 days</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      <div className="p-6 space-y-6">
        {/* KPI Cards */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          {kpiCards.map((kpi) => (
            <Card key={kpi.label}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <kpi.icon className="h-5 w-5 text-muted-foreground" />
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
                        formatter={(value: number) => formatPercent(value)}
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

        {/* Email Campaign KPIs */}
        <Card>
          <CardHeader>
            <CardTitle>Email Campaign KPIs</CardTitle>
            <CardDescription>Last 7 days (positive replies → meetings requested/booked)</CardDescription>
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
                        <Badge variant="secondary">{row.responseMode}</Badge>
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
    </div>
  )
}
