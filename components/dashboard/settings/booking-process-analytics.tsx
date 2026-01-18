"use client";

/**
 * Booking Process Analytics Component (Phase 36f)
 *
 * Displays booking process effectiveness metrics for A/B testing.
 */

import { useCallback, useEffect, useState } from "react";
import { BarChart3, TrendingUp, Users, RefreshCw, Calendar } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  getBookingProcessMetrics,
  getBookingProcessSummary,
  type BookingProcessMetrics,
} from "@/actions/booking-process-analytics-actions";

interface BookingProcessAnalyticsProps {
  activeWorkspace?: string | null;
}

export function BookingProcessAnalytics({
  activeWorkspace,
}: BookingProcessAnalyticsProps) {
  const [metrics, setMetrics] = useState<BookingProcessMetrics[]>([]);
  const [summary, setSummary] = useState<{
    totalProcesses: number;
    totalLeadsTracked: number;
    totalBooked: number;
    overallBookingRate: number;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [dateRange, setDateRange] = useState<"7d" | "30d" | "90d" | "all">("30d");

  const load = useCallback(async () => {
    if (!activeWorkspace) {
      setMetrics([]);
      setSummary(null);
      return;
    }

    setLoading(true);

    // Calculate date range
    let dateFilter: { start: Date; end: Date } | undefined;
    const now = new Date();
    if (dateRange !== "all") {
      const days = dateRange === "7d" ? 7 : dateRange === "30d" ? 30 : 90;
      dateFilter = {
        start: new Date(now.getTime() - days * 24 * 60 * 60 * 1000),
        end: now,
      };
    }

    const [metricsResult, summaryResult] = await Promise.all([
      getBookingProcessMetrics({
        clientId: activeWorkspace,
        dateRange: dateFilter,
      }),
      getBookingProcessSummary({ clientId: activeWorkspace }),
    ]);

    if (metricsResult.success && metricsResult.data) {
      setMetrics(metricsResult.data);
    } else {
      toast.error(metricsResult.error || "Failed to load metrics");
    }

    if (summaryResult.success && summaryResult.data) {
      setSummary(summaryResult.data);
    }

    setLoading(false);
  }, [activeWorkspace, dateRange]);

  useEffect(() => {
    load();
  }, [load]);

  const formatPercent = (rate: number): string => {
    return `${(rate * 100).toFixed(1)}%`;
  };

  const formatAvg = (avg: number): string => {
    return avg.toFixed(1);
  };

  // Find best performer
  const bestRate =
    metrics.length > 0 && metrics.some((m) => m.leadsProcessed >= 5)
      ? metrics.reduce((best, m) =>
          m.leadsProcessed >= 5 && m.bookingRate > (best?.bookingRate ?? 0)
            ? m
            : best
        )
      : null;

  return (
    <Card className="border-muted/60">
      <CardHeader className="space-y-2">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5" />
              Booking Process Analytics
            </CardTitle>
            <CardDescription>
              Compare booking process effectiveness across campaigns
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Select
              value={dateRange}
              onValueChange={(v) => setDateRange(v as typeof dateRange)}
            >
              <SelectTrigger className="w-[140px]">
                <Calendar className="h-4 w-4 mr-2" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7d">Last 7 days</SelectItem>
                <SelectItem value="30d">Last 30 days</SelectItem>
                <SelectItem value="90d">Last 90 days</SelectItem>
                <SelectItem value="all">All time</SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="sm"
              onClick={load}
              disabled={!activeWorkspace || loading}
            >
              <RefreshCw className="h-4 w-4 mr-1.5" />
              Refresh
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        {!activeWorkspace ? (
          <div className="py-8 text-center text-muted-foreground">
            Select a workspace to view analytics.
          </div>
        ) : loading ? (
          <div className="py-8 text-center text-muted-foreground">
            Loading analytics...
          </div>
        ) : (
          <>
            {/* Summary Cards */}
            {summary && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <Card>
                  <CardContent className="pt-4">
                    <div className="text-2xl font-bold">
                      {summary.totalProcesses}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Booking Processes
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4">
                    <div className="flex items-center gap-2">
                      <Users className="h-5 w-5 text-muted-foreground" />
                      <span className="text-2xl font-bold">
                        {summary.totalLeadsTracked}
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Leads Tracked
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4">
                    <div className="flex items-center gap-2">
                      <Calendar className="h-5 w-5 text-muted-foreground" />
                      <span className="text-2xl font-bold">
                        {summary.totalBooked}
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Meetings Booked
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4">
                    <div className="flex items-center gap-2">
                      <TrendingUp className="h-5 w-5 text-muted-foreground" />
                      <span className="text-2xl font-bold">
                        {formatPercent(summary.overallBookingRate)}
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Overall Booking Rate
                    </p>
                  </CardContent>
                </Card>
              </div>
            )}

            {/* Metrics Table */}
            {metrics.length === 0 ? (
              <div className="py-8 text-center text-muted-foreground">
                No booking process data yet. Assign booking processes to
                campaigns and send outbound messages to start tracking.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Booking Process</TableHead>
                    <TableHead className="text-right">Leads</TableHead>
                    <TableHead className="text-right">Booked</TableHead>
                    <TableHead className="text-right">Booking Rate</TableHead>
                    <TableHead className="text-right">Avg Outbounds</TableHead>
                    <TableHead>Drop-off</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {metrics.map((m) => {
                    const isBest =
                      bestRate?.bookingProcessId === m.bookingProcessId &&
                      m.leadsProcessed >= 5;
                    const dropoffWaves = Object.entries(m.dropoffByWave)
                      .sort(([a], [b]) => Number(a) - Number(b))
                      .slice(0, 3);

                    return (
                      <TableRow
                        key={m.bookingProcessId}
                        className={isBest ? "bg-green-50/50 dark:bg-green-950/20" : undefined}
                      >
                        <TableCell className="font-medium">
                          <div className="flex items-center gap-2">
                            {m.bookingProcessName}
                            {isBest && (
                              <Badge variant="default" className="text-xs">
                                Best
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          {m.leadsProcessed}
                        </TableCell>
                        <TableCell className="text-right">
                          {m.leadsBooked}
                        </TableCell>
                        <TableCell className="text-right">
                          <span
                            className={
                              m.bookingRate > 0.5
                                ? "text-green-600 font-medium"
                                : m.bookingRate > 0.3
                                  ? "text-yellow-600"
                                  : "text-red-600"
                            }
                          >
                            {formatPercent(m.bookingRate)}
                          </span>
                        </TableCell>
                        <TableCell className="text-right">
                          {m.leadsBooked > 0 ? (
                            formatAvg(m.avgOutboundsToBook)
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            {dropoffWaves.length > 0 ? (
                              dropoffWaves.map(([wave, count]) => (
                                <Badge
                                  key={wave}
                                  variant="outline"
                                  className="text-xs"
                                >
                                  W{wave}: {count}
                                </Badge>
                              ))
                            ) : (
                              <span className="text-muted-foreground text-sm">
                                -
                              </span>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}

            {/* Interpretation Help */}
            <div className="rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
              <div className="flex flex-col gap-1">
                <span>
                  <span className="font-medium text-foreground">
                    Booking Rate
                  </span>
                  : % of leads who booked a meeting
                </span>
                <span>
                  <span className="font-medium text-foreground">
                    Avg Outbounds
                  </span>
                  : Average messages sent before booking (lower is more
                  efficient)
                </span>
                <span>
                  <span className="font-medium text-foreground">Drop-off</span>:
                  Wave # where non-booked leads stopped engaging
                </span>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
