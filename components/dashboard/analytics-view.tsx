"use client"

import { useState, useEffect } from "react"
import { Users, MessageSquare, Calendar, TrendingUp, Clock, Bot, ArrowUpRight, ArrowDownRight, Loader2 } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart"
import {
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Legend,
  LineChart,
  Line,
} from "recharts"
import { mockAnalytics } from "@/lib/mock-data"
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

export function AnalyticsView() {
  const [data, setData] = useState<AnalyticsData | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [useMockData, setUseMockData] = useState(false)

  useEffect(() => {
    async function fetchAnalytics() {
      setIsLoading(true)
      const result = await getAnalytics()
      
      if (result.success && result.data) {
        // Check if we have real data (at least one lead)
        if (result.data.overview.totalLeads > 0) {
          setData(result.data)
          setUseMockData(false)
        } else {
          setUseMockData(true)
        }
      } else {
        setUseMockData(true)
      }
      
      setIsLoading(false)
    }

    fetchAnalytics()
  }, [])

  // Use real data or fall back to mock
  const kpiCards = useMockData ? [
    { label: "Total Leads", value: mockAnalytics.kpis.totalLeads.toLocaleString(), icon: Users, change: 12.5, up: true },
    { label: "Response Rate", value: `${mockAnalytics.kpis.responseRate}%`, icon: MessageSquare, change: 3.2, up: true },
    { label: "Meetings Booked", value: mockAnalytics.kpis.meetingsBooked.toString(), icon: Calendar, change: 8.1, up: true },
    { label: "Conversion Rate", value: `${mockAnalytics.kpis.conversionRate}%`, icon: TrendingUp, change: 1.4, up: false },
    { label: "Avg Response Time", value: mockAnalytics.kpis.avgResponseTime, icon: Clock, change: 15.3, up: true },
    { label: "AI Accuracy", value: `${mockAnalytics.kpis.aiAccuracy}%`, icon: Bot, change: 0.8, up: true },
  ] : [
    { label: "Total Leads", value: data?.overview.totalLeads.toLocaleString() || "0", icon: Users, change: 0, up: true },
    { label: "Response Rate", value: `${data?.overview.responseRate || 0}%`, icon: MessageSquare, change: 0, up: true },
    { label: "Meetings Booked", value: data?.overview.meetingsBooked.toString() || "0", icon: Calendar, change: 0, up: true },
    { label: "Conversion Rate", value: data ? `${Math.round((data.overview.meetingsBooked / Math.max(data.overview.totalLeads, 1)) * 100)}%` : "0%", icon: TrendingUp, change: 0, up: true },
    { label: "Avg Response Time", value: data?.overview.avgResponseTime || "—", icon: Clock, change: 0, up: true },
    { label: "AI Accuracy", value: "95%", icon: Bot, change: 0, up: true },
  ]

  // Prepare sentiment breakdown for pie chart
  const sentimentData = useMockData 
    ? mockAnalytics.sentimentBreakdown 
    : (data?.sentimentBreakdown.map((s) => ({
        name: s.sentiment,
        value: s.percentage,
        color: SENTIMENT_COLORS[s.sentiment] || SENTIMENT_COLORS["Unknown"],
      })) || [])

  // Prepare weekly stats for line chart
  const weeklyData = useMockData 
    ? mockAnalytics.weeklyActivity 
    : (data?.weeklyStats.map((s) => ({
        day: s.day,
        inbound: s.inbound,
        outbound: s.outbound,
      })) || [])

  if (isLoading) {
    return (
      <div className="flex flex-col h-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full overflow-auto">
      <div className="border-b px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Analytics</h1>
            <p className="text-muted-foreground">
              {useMockData ? "Showing demo data" : "Track your outreach performance"}
            </p>
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
                  {!useMockData ? null : (
                    <div className={`flex items-center text-xs ${kpi.up ? "text-green-500" : "text-red-500"}`}>
                      {kpi.up ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                      {kpi.change}%
                    </div>
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
          {/* Sentiment Breakdown Pie Chart */}
          <Card>
            <CardHeader>
              <CardTitle>Response Sentiment</CardTitle>
              <CardDescription>Breakdown of lead response sentiment</CardDescription>
            </CardHeader>
            <CardContent>
              <ChartContainer
                config={{
                  interested: { label: "Interested", color: "#10B981" },
                  neutral: { label: "Neutral", color: "#6B7280" },
                  notInterested: { label: "Not Interested", color: "#EF4444" },
                  outOfOffice: { label: "Out of Office", color: "#F59E0B" },
                }}
                className="h-[250px]"
              >
                <ResponsiveContainer width="100%" height="100%">
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
                </ResponsiveContainer>
              </ChartContainer>
            </CardContent>
          </Card>

          {/* Channel Performance Bar Chart */}
          <Card>
            <CardHeader>
              <CardTitle>Channel Performance</CardTitle>
              <CardDescription>Outreach metrics by channel</CardDescription>
            </CardHeader>
            <CardContent>
              <ChartContainer
                config={{
                  sent: { label: "Sent", color: "#6B7280" },
                  responses: { label: "Responses", color: "#10B981" },
                  meetings: { label: "Meetings", color: "#3B82F6" },
                }}
                className="h-[250px]"
              >
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={mockAnalytics.channelPerformance} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} />
                    <XAxis type="number" />
                    <YAxis dataKey="channel" type="category" width={70} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Legend />
                    <Bar dataKey="sent" fill="#6B7280" name="Sent" radius={[0, 4, 4, 0]} />
                    <Bar dataKey="responses" fill="#10B981" name="Responses" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartContainer>
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
            <ChartContainer
              config={{
                inbound: { label: "Inbound", color: "#3B82F6" },
                outbound: { label: "Outbound", color: "#10B981" },
              }}
              className="h-[250px]"
            >
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={useMockData ? mockAnalytics.weeklyActivity : weeklyData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="day" />
                  <YAxis />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Legend />
                  {useMockData ? (
                    <>
                      <Line type="monotone" dataKey="emails" stroke="#3B82F6" strokeWidth={2} dot={{ r: 4 }} />
                      <Line type="monotone" dataKey="calls" stroke="#10B981" strokeWidth={2} dot={{ r: 4 }} />
                      <Line type="monotone" dataKey="linkedin" stroke="#0EA5E9" strokeWidth={2} dot={{ r: 4 }} />
                    </>
                  ) : (
                    <>
                      <Line type="monotone" dataKey="inbound" stroke="#3B82F6" strokeWidth={2} dot={{ r: 4 }} name="Inbound" />
                      <Line type="monotone" dataKey="outbound" stroke="#10B981" strokeWidth={2} dot={{ r: 4 }} name="Outbound" />
                    </>
                  )}
                </LineChart>
              </ResponsiveContainer>
            </ChartContainer>
          </CardContent>
        </Card>

        {/* Top Clients / Campaign Leaderboard */}
        <Card>
          <CardHeader>
            <CardTitle>{useMockData ? "Campaign Leaderboard" : "Top Clients"}</CardTitle>
            <CardDescription>
              {useMockData ? "Performance metrics by campaign" : "Clients with most leads and meetings"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{useMockData ? "Campaign" : "Client"}</TableHead>
                  <TableHead className="text-right">{useMockData ? "Sent" : "Leads"}</TableHead>
                  <TableHead className="text-right">{useMockData ? "Responses" : "Meetings"}</TableHead>
                  <TableHead className="text-right">{useMockData ? "Meetings" : "Conv. Rate"}</TableHead>
                  {useMockData && <TableHead className="text-right">Conversion</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {useMockData ? (
                  mockAnalytics.campaignLeaderboard.map((campaign, index) => (
                    <TableRow key={campaign.name}>
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
                          {campaign.name}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">{campaign.sent.toLocaleString()}</TableCell>
                      <TableCell className="text-right">{campaign.responses.toLocaleString()}</TableCell>
                      <TableCell className="text-right">{campaign.meetings}</TableCell>
                      <TableCell className="text-right">
                        <Badge variant={campaign.conversionRate >= 5 ? "default" : "secondary"}>
                          {campaign.conversionRate}%
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  (data?.topClients || []).map((client, index) => (
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
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
