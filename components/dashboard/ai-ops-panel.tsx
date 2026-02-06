"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCcw } from "lucide-react";

import { listAiOpsEvents, type AiOpsEvent } from "@/actions/ai-ops-feed-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type Props = {
  clientId: string;
  active?: boolean;
};

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

function truncId(value: string | null): string {
  if (!value) return "-";
  return value.length <= 10 ? value : `${value.slice(0, 6)}…${value.slice(-4)}`;
}

function DecisionBadge({ decision, status }: { decision: AiOpsEvent["decision"]; status: AiOpsEvent["status"] }) {
  if (decision) {
    const variant =
      decision === "approve"
        ? "default"
        : decision === "needs_clarification"
          ? "secondary"
          : decision === "deny"
            ? "destructive"
            : "outline";
    return (
      <Badge variant={variant} className="whitespace-nowrap">
        {decision}
      </Badge>
    );
  }

  if (status) {
    const variant = status === "error" ? "destructive" : "outline";
    return (
      <Badge variant={variant} className="whitespace-nowrap">
        {status}
      </Badge>
    );
  }

  return (
    <Badge variant="outline" className="whitespace-nowrap">
      -
    </Badge>
  );
}

type EventTypeOption =
  | { key: "all"; label: string }
  | { key: `feature:${string}`; label: string }
  | { key: `stage:${string}`; label: string };

const EVENT_TYPE_OPTIONS: EventTypeOption[] = [
  { key: "all", label: "All events" },
  { key: "feature:followup.booking.gate", label: "AI: followup.booking.gate" },
  { key: "feature:followup.parse_proposed_times", label: "AI: followup.parse_proposed_times" },
  { key: "feature:auto_send.evaluate", label: "AI: auto_send.evaluate" },
  { key: "feature:meeting.overseer.extract", label: "AI: meeting.overseer.extract" },
  { key: "feature:meeting.overseer.gate", label: "AI: meeting.overseer.gate" },
  { key: "stage:extract", label: "Decision: extract" },
  { key: "stage:gate", label: "Decision: gate" },
  { key: "stage:booking_gate", label: "Decision: booking_gate" },
];

type DecisionFilterKey = "all" | "approve" | "needs_clarification" | "deny" | "revise";

const DECISION_OPTIONS: Array<{ key: DecisionFilterKey; label: string }> = [
  { key: "all", label: "All" },
  { key: "approve", label: "approve" },
  { key: "needs_clarification", label: "needs_clarification" },
  { key: "deny", label: "deny" },
  { key: "revise", label: "revise" },
];

export function AiOpsPanel({ clientId, active = true }: Props) {
  const [loading, setLoading] = useState(false);
  const [events, setEvents] = useState<AiOpsEvent[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [eventTypeKey, setEventTypeKey] = useState<EventTypeOption["key"]>("all");
  const [decisionKey, setDecisionKey] = useState<DecisionFilterKey>("all");
  const [leadId, setLeadId] = useState("");

  const { featureIdFilter, stageFilter } = useMemo(() => {
    if (eventTypeKey === "all") return { featureIdFilter: undefined, stageFilter: undefined };
    if (eventTypeKey.startsWith("feature:")) return { featureIdFilter: eventTypeKey.slice("feature:".length), stageFilter: undefined };
    if (eventTypeKey.startsWith("stage:")) return { featureIdFilter: undefined, stageFilter: eventTypeKey.slice("stage:".length) };
    return { featureIdFilter: undefined, stageFilter: undefined };
  }, [eventTypeKey]);

  const decisionFilter: Exclude<DecisionFilterKey, "all"> | undefined = decisionKey === "all" ? undefined : decisionKey;
  const leadIdFilter = leadId.trim() ? leadId.trim() : undefined;

  const load = useCallback(
    async (opts?: { cursor?: string | null; append?: boolean }) => {
      setLoading(true);
      setError(null);
      try {
        const result = await listAiOpsEvents(clientId, {
          limit: 50,
          cursor: opts?.cursor ?? null,
          leadId: leadIdFilter,
          featureId: featureIdFilter,
          stage: stageFilter,
          decision: decisionFilter,
        });

        if (!result.success || !result.data) {
          setError(result.error || "Failed to load AI ops events");
          if (!opts?.append) setEvents([]);
          setNextCursor(null);
          return;
        }

        setEvents((prev) => (opts?.append ? prev.concat(result.data!.events) : result.data!.events));
        setNextCursor(result.data.nextCursor);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load AI ops events");
        if (!opts?.append) setEvents([]);
        setNextCursor(null);
      } finally {
        setLoading(false);
      }
    },
    [clientId, decisionFilter, featureIdFilter, leadIdFilter, stageFilter]
  );

  useEffect(() => {
    if (!active) return;
    void load({ cursor: null, append: false });
  }, [active, load]);

  return (
    <Card>
      <CardHeader className="space-y-2">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>AI Ops (Last 3 Days)</CardTitle>
            <CardDescription>Recent AI/automation events (no raw message text; safe summaries only).</CardDescription>
          </div>
          <Button variant="outline" onClick={() => void load({ cursor: null, append: false })} disabled={loading}>
            <RefreshCcw className="h-4 w-4 mr-2" />
            {loading ? "Refreshing..." : "Refresh"}
          </Button>
        </div>

        {error ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        ) : null}

        <Separator />

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="aiops-event-type">Event type</Label>
            <select
              id="aiops-event-type"
              className="h-9 w-full rounded-md border bg-background px-3 text-sm"
              value={eventTypeKey}
              onChange={(e) => setEventTypeKey(e.target.value as any)}
              disabled={loading}
            >
              {EVENT_TYPE_OPTIONS.map((opt) => (
                <option key={opt.key} value={opt.key}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="aiops-decision">Decision</Label>
            <select
              id="aiops-decision"
              className="h-9 w-full rounded-md border bg-background px-3 text-sm"
              value={decisionKey}
              onChange={(e) => setDecisionKey(e.target.value as any)}
              disabled={loading}
            >
              {DECISION_OPTIONS.map((opt) => (
                <option key={opt.key} value={opt.key}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="aiops-lead-id">Lead ID</Label>
            <Input
              id="aiops-lead-id"
              value={leadId}
              onChange={(e) => setLeadId(e.target.value)}
              placeholder="Optional"
              disabled={loading}
            />
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {events.length === 0 && !loading ? (
          <div className="text-sm text-muted-foreground">No AI events in the last 3 days (or no access).</div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Lead</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Status / Decision</TableHead>
                  <TableHead className="text-right">Conf</TableHead>
                  <TableHead className="text-right">Issues</TableHead>
                  <TableHead className="text-right">Latency</TableHead>
                  <TableHead className="text-right">Tokens</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {events.map((evt) => (
                  <TableRow key={evt.id}>
                    <TableCell className="text-xs whitespace-nowrap">{formatWhen(evt.createdAt)}</TableCell>
                    <TableCell className="font-mono text-xs whitespace-nowrap">{truncId(evt.leadId)}</TableCell>
                    <TableCell className="text-xs whitespace-nowrap">{evt.source}</TableCell>
                    <TableCell className="font-mono text-xs whitespace-nowrap">{evt.eventType}</TableCell>
                    <TableCell className="text-xs whitespace-nowrap">
                      <DecisionBadge decision={evt.decision} status={evt.status} />
                    </TableCell>
                    <TableCell className="text-right text-xs">{typeof evt.confidence === "number" ? evt.confidence.toFixed(2) : "-"}</TableCell>
                    <TableCell className="text-right text-xs">{typeof evt.issuesCount === "number" ? evt.issuesCount : "-"}</TableCell>
                    <TableCell className="text-right text-xs">{typeof evt.latencyMs === "number" ? `${evt.latencyMs}ms` : "-"}</TableCell>
                    <TableCell className="text-right text-xs">{typeof evt.totalTokens === "number" ? evt.totalTokens : "-"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        <div className="flex items-center justify-between">
          <div className="text-xs text-muted-foreground">
            Showing {events.length} event{events.length === 1 ? "" : "s"}
            {nextCursor ? " (more available)" : ""}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void load({ cursor: nextCursor, append: true })}
            disabled={loading || !nextCursor}
          >
            Load more
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
