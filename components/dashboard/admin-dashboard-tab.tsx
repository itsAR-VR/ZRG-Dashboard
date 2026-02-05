"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Copy, RefreshCcw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getAdminDashboardSnapshot, type AdminDashboardSnapshot } from "@/actions/admin-dashboard-actions";

type Props = {
  clientId: string | null;
  active: boolean;
};

function formatCount(value: number | null | undefined): string {
  if (!Number.isFinite(value)) return "-";
  return String(value);
}

function formatWhen(iso: string | null | undefined): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString();
}

function HealthPill({ status, label }: { status: "ok" | "warn" | "bad"; label: string }) {
  const variant = status === "ok" ? "default" : status === "warn" ? "secondary" : "destructive";
  return (
    <Badge variant={variant} className="whitespace-nowrap">
      {label}
    </Badge>
  );
}

export function AdminDashboardTab({ clientId, active }: Props) {
  const [loading, setLoading] = useState(false);
  const [snapshot, setSnapshot] = useState<AdminDashboardSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!clientId) return;
    setLoading(true);
    setError(null);
    try {
      const result = await getAdminDashboardSnapshot(clientId);
      if (!result.success || !result.data) {
        setSnapshot(null);
        setError(result.error || "Failed to load snapshot");
        return;
      }
      setSnapshot(result.data);
    } catch (e) {
      setSnapshot(null);
      setError(e instanceof Error ? e.message : "Failed to load snapshot");
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => {
    if (!active) return;
    if (!clientId) return;
    void refresh();
  }, [active, clientId, refresh]);

  const overallHealth = useMemo(() => {
    if (!snapshot) return null;
    const issues: string[] = [];
    if (!snapshot.env.cronSecretConfigured) issues.push("CRON_SECRET missing");
    if (!snapshot.env.openAiKeyConfigured) issues.push("OPENAI_API_KEY missing");
    if (snapshot.env.autoSendDisabled) issues.push("AUTO_SEND_DISABLED=1");
    if (snapshot.queues.backgroundJobs.stale) issues.push("Background queue stale");
    if (snapshot.drafts.needsReview.slackMissing > 0) issues.push("Needs-review drafts not Slack-notified");
    if (snapshot.drafts.sendDelayed.missingDelayedJobCount > 0) issues.push("Delayed-send drafts missing jobs");
    if (snapshot.drafts.sendingStaleCount > 0) issues.push("Stale 'sending' drafts");
    return { ok: issues.length === 0, issues };
  }, [snapshot]);

  if (!clientId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Admin Dashboard</CardTitle>
          <CardDescription>Select a workspace to view admin health.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                Admin Dashboard
                {overallHealth ? (
                  overallHealth.ok ? (
                    <span className="inline-flex items-center gap-1 text-sm text-emerald-300">
                      <CheckCircle2 className="h-4 w-4" />
                      Healthy
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-sm text-amber-200">
                      <AlertTriangle className="h-4 w-4" />
                      Attention needed
                    </span>
                  )
                ) : null}
              </CardTitle>
              <CardDescription>
                Quick operational snapshot for this workspace. No secrets are shown (only booleans/counts/timestamps).
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={() => void refresh()} disabled={loading}>
                <RefreshCcw className="h-4 w-4 mr-2" />
                {loading ? "Refreshing..." : "Refresh"}
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  if (!snapshot) return;
                  void navigator.clipboard
                    .writeText(JSON.stringify(snapshot, null, 2))
                    .then(() => toast.success("Snapshot copied"))
                    .catch(() => toast.error("Failed to copy snapshot"));
                }}
                disabled={!snapshot}
              >
                <Copy className="h-4 w-4 mr-2" />
                Copy JSON
              </Button>
            </div>
          </div>

          {error ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          ) : null}

          {snapshot ? (
            <div className="flex flex-wrap gap-2">
              <HealthPill status={snapshot.queues.backgroundJobs.stale ? "bad" : "ok"} label="Background Jobs" />
              <HealthPill
                status={snapshot.env.autoSendDisabled ? "warn" : "ok"}
                label={snapshot.env.autoSendDisabled ? "Auto-send disabled" : "Auto-send enabled"}
              />
              <HealthPill
                status={snapshot.drafts.needsReview.slackMissing > 0 ? "warn" : "ok"}
                label={`Needs-review Slack missing: ${snapshot.drafts.needsReview.slackMissing}`}
              />
              <HealthPill
                status={snapshot.drafts.sendDelayed.missingDelayedJobCount > 0 ? "warn" : "ok"}
                label={`Delayed drafts missing jobs: ${snapshot.drafts.sendDelayed.missingDelayedJobCount}`}
              />
            </div>
          ) : null}
        </CardHeader>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Background Jobs</CardTitle>
            <CardDescription>Work queue health for this workspace.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {snapshot ? (
              <>
                <div className="flex flex-wrap items-center gap-3">
                  <HealthPill
                    status={snapshot.queues.backgroundJobs.stale ? "bad" : "ok"}
                    label={
                      snapshot.queues.backgroundJobs.stale
                        ? `STALE (>= ${snapshot.queues.backgroundJobs.staleQueueAlertMinutes}m)`
                        : "OK"
                    }
                  />
                  <div className="text-sm text-muted-foreground">
                    Due now:{" "}
                    <span className="text-foreground font-medium">
                      {formatCount(snapshot.queues.backgroundJobs.dueNowTotal)}
                    </span>
                    {"  "}Oldest due:{" "}
                    <span className="text-foreground font-medium">
                      {snapshot.queues.backgroundJobs.oldestDueAgeMinutes ?? "-"}m
                    </span>
                  </div>
                </div>

                <Separator />

                <div className="space-y-2">
                  <div className="text-sm font-medium">Due now by type</div>
                  {snapshot.queues.backgroundJobs.dueNowByType.length === 0 ? (
                    <div className="text-sm text-muted-foreground">No due jobs.</div>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Type</TableHead>
                          <TableHead className="text-right">Count</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {snapshot.queues.backgroundJobs.dueNowByType
                          .slice()
                          .sort((a, b) => b.count - a.count)
                          .slice(0, 8)
                          .map((row) => (
                            <TableRow key={row.type}>
                              <TableCell className="font-mono text-xs">{row.type}</TableCell>
                              <TableCell className="text-right">{row.count}</TableCell>
                            </TableRow>
                          ))}
                      </TableBody>
                    </Table>
                  )}
                </div>

                {snapshot.queues.backgroundJobs.recentFailures.length > 0 ? (
                  <>
                    <Separator />
                    <div className="space-y-2">
                      <div className="text-sm font-medium">Recent failures (24h)</div>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Type</TableHead>
                            <TableHead>When</TableHead>
                            <TableHead className="text-right">Attempts</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {snapshot.queues.backgroundJobs.recentFailures.slice(0, 6).map((row) => (
                            <TableRow key={row.id}>
                              <TableCell className="font-mono text-xs">{row.type}</TableCell>
                              <TableCell className="text-xs">{formatWhen(row.finishedAt)}</TableCell>
                              <TableCell className="text-right text-xs">{row.attempts}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                      <div className="text-xs text-muted-foreground">
                        Tip: inspect failures in Vercel logs for stack traces.
                      </div>
                    </div>
                  </>
                ) : null}
              </>
            ) : (
              <div className="text-sm text-muted-foreground">No snapshot loaded yet.</div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>AI Draft Pipeline</CardTitle>
            <CardDescription>Draft inventory + auto-send/review signals.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {snapshot ? (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">Pending: {snapshot.drafts.pendingTotal}</Badge>
                  <Badge variant={snapshot.drafts.needsReview.slackMissing > 0 ? "destructive" : "outline"}>
                    Needs review (Slack missing): {snapshot.drafts.needsReview.slackMissing}
                  </Badge>
                  <Badge variant={snapshot.drafts.sendingStaleCount > 0 ? "destructive" : "outline"}>
                    Stale sending: {snapshot.drafts.sendingStaleCount}
                  </Badge>
                </div>

                <Separator />

                <div className="space-y-2">
                  <div className="text-sm font-medium">Pending by auto-send action</div>
                  {snapshot.drafts.pendingByAutoSendAction.length === 0 ? (
                    <div className="text-sm text-muted-foreground">No pending drafts.</div>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Action</TableHead>
                          <TableHead className="text-right">Count</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {snapshot.drafts.pendingByAutoSendAction
                          .slice()
                          .sort((a, b) => b.count - a.count)
                          .slice(0, 8)
                          .map((row) => (
                            <TableRow key={row.action ?? "null"}>
                              <TableCell className="font-mono text-xs">{row.action ?? "(unevaluated)"}</TableCell>
                              <TableCell className="text-right">{row.count}</TableCell>
                            </TableRow>
                          ))}
                      </TableBody>
                    </Table>
                  )}
                </div>

                <Separator />

                <div className="space-y-2">
                  <div className="text-sm font-medium">Delayed sends</div>
                  <div className="text-sm text-muted-foreground">
                    Pending delayed:{" "}
                    <span className="text-foreground font-medium">{snapshot.drafts.sendDelayed.total}</span>
                    {"  "}Oldest:{" "}
                    <span className="text-foreground font-medium">
                      {snapshot.drafts.sendDelayed.oldestPendingAgeMinutes ?? "-"}m
                    </span>
                    {"  "}Missing jobs (sampled {snapshot.drafts.sendDelayed.sampledDraftsForMissingJobCheck}):{" "}
                    <span className="text-foreground font-medium">
                      {snapshot.drafts.sendDelayed.missingDelayedJobCount}
                    </span>
                  </div>
                  {snapshot.env.autoSendDisabled ? (
                    <div className="text-xs text-amber-200">
                      Auto-send is globally disabled via `AUTO_SEND_DISABLED=1`.
                    </div>
                  ) : null}
                </div>
              </>
            ) : (
              <div className="text-sm text-muted-foreground">No snapshot loaded yet.</div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Messaging</CardTitle>
            <CardDescription>Last message timestamps by direction/channel.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {snapshot ? (
              <>
                <div className="text-sm">
                  <div className="text-muted-foreground">Last inbound</div>
                  <div className="font-medium">{formatWhen(snapshot.messages.lastInboundAt)}</div>
                </div>
                <div className="text-sm">
                  <div className="text-muted-foreground">Last outbound</div>
                  <div className="font-medium">{formatWhen(snapshot.messages.lastOutboundAt)}</div>
                </div>
                <Separator />
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Channel</TableHead>
                      <TableHead>Inbound</TableHead>
                      <TableHead>Outbound</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {snapshot.messages.lastInboundByChannel.map((row) => {
                      const outbound = snapshot.messages.lastOutboundByChannel.find((o) => o.channel === row.channel);
                      return (
                        <TableRow key={row.channel}>
                          <TableCell className="font-mono text-xs">{row.channel}</TableCell>
                          <TableCell className="text-xs">{formatWhen(row.at)}</TableCell>
                          <TableCell className="text-xs">{formatWhen(outbound?.at)}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </>
            ) : (
              <div className="text-sm text-muted-foreground">No snapshot loaded yet.</div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Enrichment</CardTitle>
            <CardDescription>Lead enrichment status counts.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {snapshot ? (
              <>
                <div className="flex flex-wrap gap-2">
                  <Badge variant={snapshot.enrichment.pending > 0 ? "secondary" : "outline"}>
                    Pending: {snapshot.enrichment.pending}
                  </Badge>
                  <Badge variant={snapshot.enrichment.failed > 0 ? "destructive" : "outline"}>
                    Failed: {snapshot.enrichment.failed}
                  </Badge>
                  <Badge variant="outline">Enriched: {snapshot.enrichment.enriched}</Badge>
                </div>
              </>
            ) : (
              <div className="text-sm text-muted-foreground">No snapshot loaded yet.</div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Config</CardTitle>
            <CardDescription>High-signal configuration flags.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {snapshot ? (
              <>
                <div className="flex flex-wrap gap-2">
                  <HealthPill status={snapshot.env.cronSecretConfigured ? "ok" : "bad"} label="CRON_SECRET" />
                  <HealthPill status={snapshot.env.openAiKeyConfigured ? "ok" : "bad"} label="OPENAI_API_KEY" />
                  <HealthPill status={snapshot.client.slackBotConnected ? "ok" : "warn"} label="Slack bot" />
                  <HealthPill status={snapshot.client.resendConnected ? "ok" : "warn"} label="Resend" />
                  <HealthPill status={snapshot.client.calendlyConnected ? "ok" : "warn"} label="Calendly" />
                </div>

                <Separator />

                <div className="space-y-1 text-sm">
                  <div className="text-muted-foreground">Workspace</div>
                  <div className="font-medium">{snapshot.client.name}</div>
                  <div className="text-xs text-muted-foreground">
                    Provider: {snapshot.client.emailProvider ?? "-"}{" "}
                    {"  "}GHL Location: {snapshot.client.ghlLocationId ?? "-"}
                  </div>
                </div>

                {snapshot.workspaceSettings ? (
                  <>
                    <Separator />
                    <div className="space-y-1 text-sm">
                      <div className="text-muted-foreground">Scheduling</div>
                      <div className="text-xs">
                        TZ: <span className="font-mono">{snapshot.workspaceSettings.timezone ?? "-"}</span>
                        {"  "}Work:{" "}
                        <span className="font-mono">
                          {snapshot.workspaceSettings.workStartTime ?? "-"}-{snapshot.workspaceSettings.workEndTime ?? "-"}
                        </span>
                      </div>
                      <div className="text-xs">
                        Follow-ups paused until:{" "}
                        <span className="font-mono">{formatWhen(snapshot.workspaceSettings.followUpsPausedUntil)}</span>
                      </div>
                      <div className="text-xs">
                        Auto-send schedule:{" "}
                        <span className="font-mono">
                          {snapshot.workspaceSettings.autoSendScheduleMode ?? "-"}
                          {snapshot.workspaceSettings.autoSendCustomScheduleConfigured ? " (custom)" : ""}
                        </span>
                      </div>
                      <div className="text-xs">
                        Slack alerts:{" "}
                        <span className="font-mono">
                          {snapshot.workspaceSettings.slackAlertsEnabled ? "on" : "off"} (channels{" "}
                          {snapshot.workspaceSettings.notificationSlackChannelsCount})
                        </span>
                      </div>
                    </div>
                  </>
                ) : null}

                {snapshot.client.unipileConnectionStatus ? (
                  <>
                    <Separator />
                    <div className="space-y-1 text-sm">
                      <div className="text-muted-foreground">Unipile</div>
                      <div className="text-xs">
                        Status: <span className="font-mono">{snapshot.client.unipileConnectionStatus}</span>
                      </div>
                      {snapshot.client.unipileLastErrorAt ? (
                        <div className="text-xs">
                          Last error: <span className="font-mono">{formatWhen(snapshot.client.unipileLastErrorAt)}</span>
                        </div>
                      ) : null}
                    </div>
                  </>
                ) : null}
              </>
            ) : (
              <div className="text-sm text-muted-foreground">No snapshot loaded yet.</div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Webhook Events Queue</CardTitle>
          <CardDescription>Inboxxia/EmailBison durable queue (workspace-scoped by EmailBison workspace id).</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {snapshot ? (
            snapshot.queues.webhookEvents.enabled ? (
              <>
                <div className="flex flex-wrap items-center gap-3">
                  <Badge variant="outline">Workspace ID: {snapshot.queues.webhookEvents.workspaceId ?? "-"}</Badge>
                  <Badge variant="outline">Due now: {formatCount(snapshot.queues.webhookEvents.dueNowTotal)}</Badge>
                  <Badge variant="outline">
                    Oldest due: {snapshot.queues.webhookEvents.oldestDueAgeMinutes ?? "-"}m
                  </Badge>
                </div>

                {snapshot.queues.webhookEvents.dueNowByProviderEventType.length > 0 ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Provider</TableHead>
                        <TableHead>Event</TableHead>
                        <TableHead className="text-right">Count</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {snapshot.queues.webhookEvents.dueNowByProviderEventType
                        .slice()
                        .sort((a, b) => b.count - a.count)
                        .slice(0, 10)
                        .map((row) => (
                          <TableRow key={`${row.provider}:${row.eventType}`}>
                            <TableCell className="font-mono text-xs">{row.provider}</TableCell>
                            <TableCell className="font-mono text-xs">{row.eventType}</TableCell>
                            <TableCell className="text-right">{row.count}</TableCell>
                          </TableRow>
                        ))}
                    </TableBody>
                  </Table>
                ) : (
                  <div className="text-sm text-muted-foreground">No due webhook events.</div>
                )}

                {snapshot.queues.webhookEvents.recentFailures.length > 0 ? (
                  <>
                    <Separator />
                    <div className="space-y-2">
                      <div className="text-sm font-medium">Recent failures (24h)</div>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Provider</TableHead>
                            <TableHead>Event</TableHead>
                            <TableHead>When</TableHead>
                            <TableHead className="text-right">Attempts</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {snapshot.queues.webhookEvents.recentFailures.slice(0, 6).map((row) => (
                            <TableRow key={row.id}>
                              <TableCell className="font-mono text-xs">{row.provider}</TableCell>
                              <TableCell className="font-mono text-xs">{row.eventType}</TableCell>
                              <TableCell className="text-xs">{formatWhen(row.finishedAt)}</TableCell>
                              <TableCell className="text-right text-xs">{row.attempts}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </>
                ) : null}
              </>
            ) : (
              <div className="text-sm text-muted-foreground">
                Not enabled. Configure EmailBison workspace id to scope webhook queue stats.
              </div>
            )
          ) : (
            <div className="text-sm text-muted-foreground">No snapshot loaded yet.</div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

