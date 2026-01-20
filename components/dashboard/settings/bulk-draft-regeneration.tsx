"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { regenerateAllDrafts, type RegenerateAllDraftsMode, type RegenerateAllDraftsResult } from "@/actions/message-actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type DraftChannel = "sms" | "email" | "linkedin";

type ProgressState = {
  totalEligible: number;
  processedLeads: number;
  regenerated: number;
  skipped: number;
  errors: number;
};

function mergeProgress(prev: ProgressState | null, next: RegenerateAllDraftsResult): ProgressState {
  const base: ProgressState = prev ?? {
    totalEligible: next.totalEligible,
    processedLeads: 0,
    regenerated: 0,
    skipped: 0,
    errors: 0,
  };

  return {
    totalEligible: Math.max(base.totalEligible, next.totalEligible),
    processedLeads: base.processedLeads + next.processedLeads,
    regenerated: base.regenerated + next.regenerated,
    skipped: base.skipped + next.skipped,
    errors: base.errors + next.errors,
  };
}

export function BulkDraftRegenerationCard({ clientId }: { clientId: string }) {
  const [channel, setChannel] = useState<DraftChannel>("email");
  const [mode, setMode] = useState<RegenerateAllDraftsMode>("pending_only");
  const [ackAllEligible, setAckAllEligible] = useState(false);

  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState<ProgressState | null>(null);
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [hasMore, setHasMore] = useState(false);

  const percent = useMemo(() => {
    if (!progress?.totalEligible) return 0;
    return Math.min(100, Math.round((progress.processedLeads / progress.totalEligible) * 100));
  }, [progress]);

  const canStartAllEligible = mode !== "all_eligible" || ackAllEligible;
  const isStartingFresh = !progress && !nextCursor;

  const handleReset = () => {
    setProgress(null);
    setNextCursor(null);
    setHasMore(false);
  };

  const handleRun = async () => {
    if (!clientId) return;
    if (mode === "all_eligible" && isStartingFresh && !ackAllEligible) {
      toast.error("Please confirm you understand the All Eligible mode warning.");
      return;
    }

    setIsRunning(true);

    try {
      const result = await regenerateAllDrafts(clientId, channel, {
        cursor: nextCursor ?? undefined,
        mode,
      });

      if (!result.success) {
        toast.error(result.error ?? "Failed to regenerate drafts");
        return;
      }

      setProgress((prev) => mergeProgress(prev, result));
      setNextCursor(result.nextCursor);
      setHasMore(result.hasMore);

      if (!result.hasMore) {
        toast.success(`Done. Regenerated ${result.regenerated} drafts (${result.skipped} skipped, ${result.errors} errors).`);
      }
    } catch (error) {
      toast.error("An error occurred while regenerating drafts.");
      console.error(error);
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Bulk Regenerate AI Drafts</CardTitle>
        <CardDescription>
          Refresh drafts after updating persona or booking settings. Default mode only regenerates existing pending drafts.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label>Channel</Label>
            <Select
              value={channel}
              onValueChange={(v) => {
                setChannel(v as DraftChannel);
                handleReset();
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="email">Email</SelectItem>
                <SelectItem value="sms">SMS</SelectItem>
                <SelectItem value="linkedin">LinkedIn</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Mode</Label>
            <Select
              value={mode}
              onValueChange={(v) => {
                setMode(v as RegenerateAllDraftsMode);
                setAckAllEligible(false);
                handleReset();
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="pending_only">Pending drafts only (recommended)</SelectItem>
                <SelectItem value="all_eligible">All eligible leads (creates/regenerates broadly)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {mode === "all_eligible" ? (
          <div className="flex items-start gap-2 rounded-lg border bg-muted/30 p-3 text-sm">
            <AlertTriangle className="h-4 w-4 mt-0.5 text-muted-foreground" />
            <div className="space-y-2">
              <p className="text-sm">
                <span className="font-medium">All Eligible</span> can create many new drafts and consume tokens. Eligible leads include
                Interested / Meeting Requested / Call Requested / Information Requested / Follow Up.
              </p>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="ack-all-eligible"
                  checked={ackAllEligible}
                  onCheckedChange={(v) => setAckAllEligible(Boolean(v))}
                />
                <Label htmlFor="ack-all-eligible" className="text-sm">
                  I understand this may create new drafts and incur AI cost.
                </Label>
              </div>
            </div>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={handleRun} disabled={isRunning || (isStartingFresh && !canStartAllEligible)}>
            {isRunning ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Running…
              </>
            ) : hasMore ? (
              "Continue"
            ) : progress ? (
              "Run Again"
            ) : (
              "Start"
            )}
          </Button>
          <Button variant="outline" onClick={handleReset} disabled={isRunning || (!progress && !nextCursor)}>
            Reset
          </Button>
        </div>

        {progress ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span>
                Progress: {Math.min(progress.processedLeads, progress.totalEligible)}/{progress.totalEligible}
              </span>
              <span className="text-muted-foreground">{percent}%</span>
            </div>
            <div className="h-2 w-full rounded bg-muted">
              <div className="h-2 rounded bg-primary" style={{ width: `${percent}%` }} />
            </div>
            <div className="grid grid-cols-2 gap-2 text-sm md:grid-cols-4">
              <div className="rounded border p-2">
                <div className="text-xs text-muted-foreground">Regenerated</div>
                <div className="font-medium">{progress.regenerated}</div>
              </div>
              <div className="rounded border p-2">
                <div className="text-xs text-muted-foreground">Skipped</div>
                <div className="font-medium">{progress.skipped}</div>
              </div>
              <div className="rounded border p-2">
                <div className="text-xs text-muted-foreground">Errors</div>
                <div className="font-medium">{progress.errors}</div>
              </div>
              <div className="rounded border p-2">
                <div className="text-xs text-muted-foreground">Has More</div>
                <div className="font-medium">{hasMore ? "Yes" : "No"}</div>
              </div>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

