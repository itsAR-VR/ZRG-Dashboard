"use client"

import { useState, useEffect } from "react"
import { Users, MessageSquare, Calendar, Clock, ArrowUpRight, ArrowDownRight, Loader2, BarChart3 } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart"
import {
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Legend,
  LineChart,
  Line,
} from "recharts"
import { getAnalytics, type AnalyticsData } from "@/actions/analytics-actions"

// Sentiment colors for the pie chart
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

interface AnalyticsViewProps {
  activeWorkspace?: string | null
}

export function AnalyticsView({ activeWorkspace }: AnalyticsViewProps) {
  const [data, setData] = useState<AnalyticsData | null>(null)
  const [isLoading, setIsLoading] = useState(true)

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

    fetchAnalytics()
  }, [activeWorkspace])

  const kpiCards = [
    { label: "Total Leads", value: data?.overview.totalLeads.toLocaleString() || "0", icon: Users, change: 0, up: true },
    { label: "Outbound Leads Contacted", value: data?.overview.outboundLeadsContacted.toLocaleString() || "0", icon: ArrowUpRight, change: 0, up: true },
    { label: "Responses", value: data?.overview.responses.toLocaleString() || "0", icon: ArrowDownRight, change: 0, up: true },
    { label: "Response Rate", value: `${data?.overview.responseRate || 0}%`, icon: MessageSquare, change: 0, up: true },
    { label: "Meetings Booked", value: data?.overview.meetingsBooked.toString() || "0", icon: Calendar, change: 0, up: true },
    { label: "Avg Response Time", value: data?.overview.avgResponseTime || "—", icon: Clock, change: 0, up: true },
  ]

  // Prepare sentiment breakdown for pie chart
  const sentimentData = data?.sentimentBreakdown.map((s) => ({
    name: s.sentiment,
    value: s.percentage,
    color: SENTIMENT_COLORS[s.sentiment] || SENTIMENT_COLORS["Unknown"],
  })) || []

  // Prepare weekly stats for line chart
  const weeklyData = data?.weeklyStats.map((s) => ({
    day: s.day,
    inbound: s.inbound,
    outbound: s.outbound,
  })) || []

  if (isLoading) {
    return (
      <div className="flex flex-col h-full items-center justify-center">
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
          <Select defaultValue="7d">
            <SelectTrigger className="w-[150px]">
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
          {/* Sentiment Breakdown Pie Chart */}
          <Card>
            <CardHeader>
              <CardTitle>Response Sentiment</CardTitle>
              <CardDescription>Breakdown of lead response sentiment</CardDescription>
            </CardHeader>
            <CardContent>
              {sentimentData.length > 0 ? (
                <ChartContainer
                  config={{
                    interested: { label: "Interested", color: "#10B981" },
                    neutral: { label: "Neutral", color: "#6B7280" },
                    notInterested: { label: "Not Interested", color: "#EF4444" },
                    outOfOffice: { label: "Out of Office", color: "#F59E0B" },
                  }}
                  className="h-[250px]"
                >
                  <PieChart>
                    <Pie
                      data={sentimentData}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={100}
                      paddingAngle={2}
                      dataKey="value"
                      label={({ name, value }) => `${name}: ${value}%`}
                      labelLine={false}
                    >
                      {sentimentData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <ChartTooltip content={<ChartTooltipContent />} />
                  </PieChart>
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
                className="h-[250px]"
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
                      <TableHead className="text-right">Leads</TableHead>
                      <TableHead className="text-right">Replies</TableHead>
                      <TableHead className="text-right">Meetings</TableHead>
                      <TableHead className="text-right">Reply Rate</TableHead>
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
                          <Badge variant={row.responses > 0 ? "default" : "secondary"}>
                            {row.leads > 0 ? Math.round((row.responses / row.leads) * 100) : 0}%
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
    </div>
  )
}
