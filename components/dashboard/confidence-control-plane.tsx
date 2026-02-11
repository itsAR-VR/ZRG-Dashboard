"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, RefreshCcw, Shield, Sparkles, XCircle } from "lucide-react";
import { toast } from "sonner";

import { getGlobalAdminStatus } from "@/actions/access-actions";
import {
  getLeadContextBundleRolloutSettings,
  updateLeadContextBundleRolloutSettings,
  type LeadContextBundleRolloutSettings,
} from "@/actions/lead-context-bundle-rollout-actions";
import {
  getAutoSendRevisionRolloutSettings,
  updateAutoSendRevisionRolloutSettings,
  type AutoSendRevisionRolloutSettings,
} from "@/actions/auto-send-revision-rollout-actions";
import {
  getConfidenceCalibrationRun,
  listConfidenceCalibrationRuns,
  runConfidenceCalibrationRun,
  type ConfidenceCalibrationRunRow,
} from "@/actions/confidence-calibration-actions";
import {
  approveConfidencePolicyProposal,
  applyConfidencePolicyProposal,
  getConfidencePolicyRevisions,
  listConfidencePolicyProposals,
  rejectConfidencePolicyProposal,
  rollbackConfidencePolicyRevision,
  type ConfidencePolicyRevisionRecord,
} from "@/actions/confidence-policy-actions";
import { getAiInteraction, listAiInteractions, type AiInteractionListRow } from "@/actions/ai-interaction-inspector-actions";
import {
  approvePendingMemoryEntry,
  getMemoryGovernanceSettings,
  listPendingMemoryEntries,
  rejectPendingMemoryEntry,
  updateMemoryGovernanceSettings,
  type MemoryGovernanceSettings,
  type PendingMemoryEntryRow,
} from "@/actions/memory-governance-actions";
import {
  listAutoSendRevisionLoopSummaries,
  type AutoSendRevisionLoopRow,
} from "@/actions/auto-send-loop-observability-actions";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";

type Props = {
  clientId: string | null;
};

const DEFAULT_EVALUATOR_MODEL_VALUE = "__DEFAULT_MODEL__";
const DEFAULT_EVALUATOR_EFFORT_VALUE = "__DEFAULT_EFFORT__";

type ProposalRow = {
  id: string;
  policyKey: string;
  status: string;
  title: string;
  summary: string | null;
  createdAt: Date;
  approvedAt: Date | null;
  appliedAt: Date | null;
  payload?: unknown;
  evidence?: unknown;
};

function formatWhen(iso: string | null | undefined): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString();
}

function statusPill(status: string): { variant: "default" | "secondary" | "destructive"; label: string } {
  if (status === "COMPLETE" || status === "APPLIED") return { variant: "default", label: status };
  if (status === "FAILED" || status === "REJECTED") return { variant: "destructive", label: status };
  return { variant: "secondary", label: status };
}

export function ConfidenceControlPlane({ clientId }: Props) {
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [loading, setLoading] = useState(false);

  const [rollout, setRollout] = useState<LeadContextBundleRolloutSettings | null>(null);
  const [autoSendRevisionRollout, setAutoSendRevisionRollout] = useState<AutoSendRevisionRolloutSettings | null>(null);
  const [budgetsText, setBudgetsText] = useState("");
  const [savingBudgets, setSavingBudgets] = useState(false);

  const [runs, setRuns] = useState<ConfidenceCalibrationRunRow[]>([]);
  const [runningCalibration, setRunningCalibration] = useState(false);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [selectedRunDetail, setSelectedRunDetail] = useState<any | null>(null);

  const [proposals, setProposals] = useState<ProposalRow[]>([]);
  const [selectedProposal, setSelectedProposal] = useState<ProposalRow | null>(null);
  const [revisions, setRevisions] = useState<ConfidencePolicyRevisionRecord[]>([]);

  const [interactions, setInteractions] = useState<AiInteractionListRow[]>([]);
  const [interactionFilters, setInteractionFilters] = useState<{
    window: "24h" | "7d" | "30d";
    featureId: string;
    status: "success" | "error" | "all";
    limit: string;
  }>({ window: "7d", featureId: "", status: "all", limit: "50" });
  const [selectedInteractionId, setSelectedInteractionId] = useState<string | null>(null);
  const [selectedInteractionDetail, setSelectedInteractionDetail] = useState<any | null>(null);

  const [memorySettings, setMemorySettings] = useState<MemoryGovernanceSettings | null>(null);
  const [memoryAllowlistText, setMemoryAllowlistText] = useState("");
  const [memoryMinConfidenceText, setMemoryMinConfidenceText] = useState("0.7");
  const [memoryMinTtlDaysText, setMemoryMinTtlDaysText] = useState("1");
  const [memoryTtlCapDaysText, setMemoryTtlCapDaysText] = useState("90");
  const [evaluatorModel, setEvaluatorModel] = useState<string>(DEFAULT_EVALUATOR_MODEL_VALUE);
  const [evaluatorEffort, setEvaluatorEffort] = useState<string>(DEFAULT_EVALUATOR_EFFORT_VALUE);
  const [savingMemorySettings, setSavingMemorySettings] = useState(false);

  const [pendingMemoryEntries, setPendingMemoryEntries] = useState<PendingMemoryEntryRow[]>([]);
  const [loopSummaries, setLoopSummaries] = useState<AutoSendRevisionLoopRow[]>([]);

  useEffect(() => {
    if (!clientId) {
      setIsSuperAdmin(false);
      return;
    }

    setLoading(true);
    getGlobalAdminStatus()
      .then((res) => setIsSuperAdmin(res.success && res.isAdmin))
      .finally(() => setLoading(false));
  }, [clientId]);

  const refreshRollout = useCallback(async () => {
    if (!clientId || !isSuperAdmin) return;
    const res = await getLeadContextBundleRolloutSettings(clientId);
    if (res.success && res.data) {
      setRollout(res.data);
      setBudgetsText(res.data.leadContextBundleBudgets ? JSON.stringify(res.data.leadContextBundleBudgets, null, 2) : "");
    }
  }, [clientId, isSuperAdmin]);

  const refreshAutoSendRevisionRollout = useCallback(async () => {
    if (!clientId || !isSuperAdmin) return;
    const res = await getAutoSendRevisionRolloutSettings(clientId);
    if (res.success && res.data) {
      setAutoSendRevisionRollout(res.data);
    }
  }, [clientId, isSuperAdmin]);

  const refreshRuns = useCallback(async () => {
    if (!clientId || !isSuperAdmin) return;
    const res = await listConfidenceCalibrationRuns(clientId);
    if (res.success && res.data) {
      setRuns(res.data.runs);
    }
  }, [clientId, isSuperAdmin]);

  const refreshProposals = useCallback(async () => {
    if (!clientId || !isSuperAdmin) return;
    const res = await listConfidencePolicyProposals(clientId);
    if (res.success && res.data) {
      setProposals(
        res.data.proposals.map((p: any) => ({
          ...p,
          createdAt: new Date(p.createdAt),
          approvedAt: p.approvedAt ? new Date(p.approvedAt) : null,
          appliedAt: p.appliedAt ? new Date(p.appliedAt) : null,
        }))
      );
    }
  }, [clientId, isSuperAdmin]);

  const refreshInteractions = useCallback(async () => {
    if (!clientId || !isSuperAdmin) return;
    const limit = Number.parseInt(interactionFilters.limit || "50", 10);
    const res = await listAiInteractions(clientId, {
      window: interactionFilters.window,
      featureId: interactionFilters.featureId.trim() || undefined,
      status: interactionFilters.status === "all" ? undefined : interactionFilters.status,
      limit: Number.isFinite(limit) ? limit : 50,
    });
    if (res.success && res.data) {
      setInteractions(res.data.interactions);
    } else {
      toast.error("Failed to load AI interactions", { description: res.error || "Unknown error" });
    }
  }, [clientId, isSuperAdmin, interactionFilters]);

  const refreshMemorySettings = useCallback(async () => {
    if (!clientId || !isSuperAdmin) return;
    const res = await getMemoryGovernanceSettings(clientId);
    if (res.success && res.data) {
      setMemorySettings(res.data);
      setMemoryAllowlistText(res.data.allowlistCategories.join("\n"));
      setMemoryMinConfidenceText(String(res.data.minConfidence));
      setMemoryMinTtlDaysText(String(res.data.minTtlDays));
      setMemoryTtlCapDaysText(String(res.data.ttlCapDays));
      setEvaluatorModel(res.data.autoSendEvaluatorModel ?? DEFAULT_EVALUATOR_MODEL_VALUE);
      setEvaluatorEffort(res.data.autoSendEvaluatorReasoningEffort ?? DEFAULT_EVALUATOR_EFFORT_VALUE);
    } else {
      toast.error("Failed to load memory governance", { description: res.error || "Unknown error" });
    }
  }, [clientId, isSuperAdmin]);

  const refreshPendingMemory = useCallback(async () => {
    if (!clientId || !isSuperAdmin) return;
    const res = await listPendingMemoryEntries(clientId, { limit: 50 });
    if (res.success && res.data) {
      setPendingMemoryEntries(res.data.entries);
    } else {
      toast.error("Failed to load pending memory", { description: res.error || "Unknown error" });
    }
  }, [clientId, isSuperAdmin]);

  const refreshLoopSummaries = useCallback(async () => {
    if (!clientId || !isSuperAdmin) return;
    const res = await listAutoSendRevisionLoopSummaries(clientId, { limit: 50 });
    if (res.success && res.data) {
      setLoopSummaries(res.data.rows);
    } else {
      toast.error("Failed to load loop summaries", { description: res.error || "Unknown error" });
    }
  }, [clientId, isSuperAdmin]);

  useEffect(() => {
    if (!clientId || !isSuperAdmin) return;
    void refreshRollout();
    void refreshAutoSendRevisionRollout();
    void refreshRuns();
    void refreshProposals();
    void refreshInteractions();
    void refreshMemorySettings();
    void refreshPendingMemory();
    void refreshLoopSummaries();
  }, [
    clientId,
    isSuperAdmin,
    refreshRollout,
    refreshAutoSendRevisionRollout,
    refreshRuns,
    refreshProposals,
    refreshInteractions,
    refreshMemorySettings,
    refreshPendingMemory,
    refreshLoopSummaries,
  ]);

  const rolloutSummary = useMemo(() => {
    if (!rollout) return null;
    const enabled = rollout.leadContextBundleEnabled && !rollout.globallyDisabled;
    return {
      enabled,
      note: rollout.globallyDisabled ? "Global kill-switch is ON (LEAD_CONTEXT_BUNDLE_DISABLED=1)" : null,
    };
  }, [rollout]);

  const handleToggle = async (field: "leadContextBundleEnabled" | "followupBookingGateEnabled", value: boolean) => {
    if (!clientId) return;
    const res = await updateLeadContextBundleRolloutSettings(clientId, { [field]: value } as any);
    if (res.success) {
      toast.success("Updated rollout settings");
      await refreshRollout();
    } else {
      toast.error("Failed to update", { description: res.error || "Unknown error" });
    }
  };

  const handleAutoSendRevisionToggle = async (value: boolean) => {
    if (!clientId) return;
    const res = await updateAutoSendRevisionRolloutSettings(clientId, { autoSendRevisionEnabled: value });
    if (res.success) {
      toast.success("Updated rollout settings");
      await refreshAutoSendRevisionRollout();
    } else {
      toast.error("Failed to update", { description: res.error || "Unknown error" });
    }
  };

  const handleSaveBudgets = async () => {
    if (!clientId) return;
    setSavingBudgets(true);
    try {
      const raw = budgetsText.trim();
      const parsed = raw ? JSON.parse(raw) : null;
      const res = await updateLeadContextBundleRolloutSettings(clientId, { leadContextBundleBudgets: parsed });
      if (res.success) {
        toast.success("Budgets saved");
        await refreshRollout();
      } else {
        toast.error("Failed to save budgets", { description: res.error || "Unknown error" });
      }
    } catch (error) {
      toast.error("Invalid JSON", { description: error instanceof Error ? error.message : "Failed to parse JSON" });
    } finally {
      setSavingBudgets(false);
    }
  };

  const handleSaveMemoryGovernance = async () => {
    if (!clientId) return;
    setSavingMemorySettings(true);
    try {
      const allowlistCategories = Array.from(
        new Set(
          memoryAllowlistText
            .split("\n")
            .map((l) => l.trim())
            .filter(Boolean)
        )
      );
      const minConfidence = Number.parseFloat(memoryMinConfidenceText.trim());
      const minTtlDays = Number.parseInt(memoryMinTtlDaysText.trim(), 10);
      const ttlCapDays = Number.parseInt(memoryTtlCapDaysText.trim(), 10);

      if (!Number.isFinite(minConfidence) || minConfidence < 0 || minConfidence > 1) {
        toast.error("Invalid min confidence", { description: "Must be a number between 0 and 1." });
        return;
      }
      if (!Number.isFinite(minTtlDays) || minTtlDays < 1) {
        toast.error("Invalid min TTL", { description: "Must be an integer >= 1." });
        return;
      }
      if (!Number.isFinite(ttlCapDays) || ttlCapDays < 1) {
        toast.error("Invalid TTL cap", { description: "Must be an integer >= 1." });
        return;
      }

      const res = await updateMemoryGovernanceSettings(clientId, {
        allowlistCategories,
        minConfidence,
        minTtlDays,
        ttlCapDays,
        autoSendEvaluatorModel:
          evaluatorModel === DEFAULT_EVALUATOR_MODEL_VALUE || !evaluatorModel.trim() ? null : evaluatorModel.trim(),
        autoSendEvaluatorReasoningEffort:
          evaluatorEffort === DEFAULT_EVALUATOR_EFFORT_VALUE || !evaluatorEffort.trim() ? null : evaluatorEffort.trim(),
      });

      if (res.success) {
        toast.success("Memory governance updated");
        await refreshMemorySettings();
      } else {
        toast.error("Failed to update memory governance", { description: res.error || "Unknown error" });
      }
    } finally {
      setSavingMemorySettings(false);
    }
  };

  const handleApplySuggestedAllowlist = async () => {
    if (!clientId || !memorySettings) return;
    setSavingMemorySettings(true);
    try {
      const res = await updateMemoryGovernanceSettings(clientId, {
        allowlistCategories: memorySettings.suggestedAllowlistCategories,
      });
      if (res.success) {
        toast.success("Applied suggested allowlist categories");
        await refreshMemorySettings();
      } else {
        toast.error("Failed to apply suggested allowlist", { description: res.error || "Unknown error" });
      }
    } finally {
      setSavingMemorySettings(false);
    }
  };

  const handleApproveMemory = async (row: PendingMemoryEntryRow) => {
    if (!clientId) return;
    const res = await approvePendingMemoryEntry(clientId, { scope: row.scope, id: row.id });
    if (res.success) {
      toast.success("Approved");
      await refreshPendingMemory();
    } else {
      toast.error("Failed to approve", { description: res.error || "Unknown error" });
    }
  };

  const handleRejectMemory = async (row: PendingMemoryEntryRow) => {
    if (!clientId) return;
    const res = await rejectPendingMemoryEntry(clientId, { scope: row.scope, id: row.id });
    if (res.success) {
      toast.success("Rejected");
      await refreshPendingMemory();
    } else {
      toast.error("Failed to reject", { description: res.error || "Unknown error" });
    }
  };

  const handleRunCalibration = async () => {
    if (!clientId) return;
    setRunningCalibration(true);
    const res = await runConfidenceCalibrationRun(clientId);
    if (res.success) {
      toast.success("Calibration run completed", { description: `${res.proposalsCreated ?? 0} proposal(s) created` });
      await refreshRuns();
      await refreshProposals();
    } else {
      toast.error("Failed to run calibration", { description: res.error || "Unknown error" });
    }
    setRunningCalibration(false);
  };

  const openRunDetail = async (runId: string) => {
    if (!clientId) return;
    setSelectedRunId(runId);
    setSelectedRunDetail(null);
    const res = await getConfidenceCalibrationRun(clientId, runId);
    if (res.success && res.data?.run) {
      setSelectedRunDetail(res.data.run);
    }
  };

  const openProposalDetail = async (proposal: ProposalRow) => {
    if (!clientId) return;
    setSelectedProposal(proposal);
    setRevisions([]);
    const res = await getConfidencePolicyRevisions(clientId, proposal.policyKey);
    if (res.success && res.data) {
      setRevisions(res.data.revisions);
    }
  };

  const handleApprove = async (proposalId: string) => {
    if (!clientId) return;
    const res = await approveConfidencePolicyProposal(clientId, proposalId);
    if (res.success) {
      toast.success("Proposal approved");
      await refreshProposals();
    } else {
      toast.error("Failed to approve", { description: res.error || "Unknown error" });
    }
  };

  const handleReject = async (proposalId: string) => {
    if (!clientId) return;
    const res = await rejectConfidencePolicyProposal(clientId, proposalId);
    if (res.success) {
      toast.success("Proposal rejected");
      await refreshProposals();
    } else {
      toast.error("Failed to reject", { description: res.error || "Unknown error" });
    }
  };

  const handleApply = async (proposalId: string) => {
    if (!clientId) return;
    const res = await applyConfidencePolicyProposal(clientId, proposalId);
    if (res.success) {
      toast.success("Proposal applied");
      await refreshProposals();
      if (selectedProposal) {
        await openProposalDetail(selectedProposal);
      }
    } else {
      toast.error("Failed to apply", { description: res.error || "Unknown error" });
    }
  };

  const handleRollback = async (revisionId: string) => {
    if (!clientId) return;
    const res = await rollbackConfidencePolicyRevision(clientId, revisionId);
    if (res.success) {
      toast.success("Rolled back policy");
      await refreshProposals();
      if (selectedProposal) {
        await openProposalDetail(selectedProposal);
      }
    } else {
      toast.error("Failed to rollback", { description: res.error || "Unknown error" });
    }
  };

  const openInteractionDetail = async (interactionId: string) => {
    if (!clientId) return;
    setSelectedInteractionId(interactionId);
    setSelectedInteractionDetail(null);
    const res = await getAiInteraction(clientId, interactionId);
    if (res.success && res.data?.interaction) {
      setSelectedInteractionDetail(res.data.interaction);
    }
  };

  if (!clientId) return null;
  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Confidence Control Plane</CardTitle>
          <CardDescription>Loading admin status...</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (!isSuperAdmin) return null;

  return (
    <div className="space-y-6">
      <Card className="border-muted/60">
        <CardHeader className="space-y-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Shield className="h-4 w-4" />
            Confidence Control Plane
          </CardTitle>
          <CardDescription>
            Super-admin only. No raw inbound/outbound messages are shown here; inferred memory is scrubbed for emails/phones.
          </CardDescription>
          {rolloutSummary?.note ? (
            <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">
              {rolloutSummary.note}
            </div>
          ) : null}
          {autoSendRevisionRollout?.globallyDisabled ? (
            <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">
              Global kill-switch is ON (AUTO_SEND_REVISION_DISABLED=1)
            </div>
          ) : null}
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-medium">LeadContextBundle</div>
                <div className="text-xs text-muted-foreground">DB toggle (global kill-switch overrides).</div>
              </div>
              <Switch
                checked={Boolean(rollout?.leadContextBundleEnabled)}
                onCheckedChange={(v) => void handleToggle("leadContextBundleEnabled", v)}
              />
            </div>
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-medium">Followup Booking Gate</div>
                <div className="text-xs text-muted-foreground">Requires auto-book + LeadContextBundle enabled.</div>
              </div>
              <Switch
                checked={Boolean(rollout?.followupBookingGateEnabled)}
                onCheckedChange={(v) => void handleToggle("followupBookingGateEnabled", v)}
              />
            </div>
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-medium">Auto-Send Revision</div>
                <div className="text-xs text-muted-foreground">Per-workspace DB toggle (global kill-switch overrides).</div>
              </div>
              <Switch
                checked={Boolean(autoSendRevisionRollout?.autoSendRevisionEnabled)}
                onCheckedChange={(v) => void handleAutoSendRevisionToggle(v)}
              />
            </div>
          </div>

          <Separator />

          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-medium">Bundle Budgets (JSON)</div>
                <div className="text-xs text-muted-foreground">Optional per-profile overrides. Invalid shapes are ignored at runtime.</div>
              </div>
              <Button size="sm" variant="outline" onClick={() => void refreshRollout()} disabled={!clientId}>
                <RefreshCcw className="h-3 w-3 mr-2" />
                Refresh
              </Button>
            </div>
            <Textarea
              value={budgetsText}
              onChange={(e) => setBudgetsText(e.target.value)}
              placeholder='{"draft":{"knowledge":{"maxTokens":4000,"maxAssetTokens":1200},"memory":{"maxTokens":1200,"maxEntryTokens":400}}}'
              className="font-mono text-xs min-h-40"
            />
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={() => void handleSaveBudgets()} disabled={savingBudgets}>
                {savingBudgets ? <RefreshCcw className="h-3 w-3 mr-2 animate-spin" /> : null}
                Save budgets
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setBudgetsText("");
                  void updateLeadContextBundleRolloutSettings(clientId, { leadContextBundleBudgets: null }).then((res) => {
                    if (res.success) toast.success("Budgets cleared");
                    else toast.error("Failed to clear budgets", { description: res.error || "Unknown error" });
                    void refreshRollout();
                  });
                }}
              >
                Clear
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="border-muted/60">
        <CardHeader className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base">Memory Governance</CardTitle>
              <CardDescription>Super-admin policy for inferred durable memory (allowlist + thresholds + approvals).</CardDescription>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                void refreshMemorySettings();
                void refreshPendingMemory();
              }}
              disabled={!clientId}
            >
              <RefreshCcw className="h-3 w-3 mr-2" />
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="space-y-2">
              <div className="text-sm font-medium">Allowlist categories (one per line)</div>
              <Textarea
                value={memoryAllowlistText}
                onChange={(e) => setMemoryAllowlistText(e.target.value)}
                placeholder="timezone_preference\nscheduling_preference\ncommunication_preference\navailability_pattern"
                className="font-mono text-xs min-h-32"
              />
              {memorySettings?.allowlistCategories.length === 0 ? (
                <div className="text-xs text-amber-700">
                  No categories allowlisted; all memory proposals require approval.
                </div>
              ) : (
                <div className="text-xs text-muted-foreground">
                  Auto-approval requires allowlist match and thresholds. Categories longer than 64 chars are ignored.
                </div>
              )}
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void handleApplySuggestedAllowlist()}
                  disabled={!memorySettings || savingMemorySettings}
                >
                  Use suggested defaults
                </Button>
                <div className="text-xs text-muted-foreground">
                  Suggested:{" "}
                  {memorySettings?.suggestedAllowlistCategories?.length
                    ? memorySettings.suggestedAllowlistCategories.join(", ")
                    : "-"}
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <div className="space-y-1">
                  <div className="text-xs text-muted-foreground">Min confidence</div>
                  <Input value={memoryMinConfidenceText} onChange={(e) => setMemoryMinConfidenceText(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <div className="text-xs text-muted-foreground">Min TTL (days)</div>
                  <Input value={memoryMinTtlDaysText} onChange={(e) => setMemoryMinTtlDaysText(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <div className="text-xs text-muted-foreground">TTL cap (days)</div>
                  <Input value={memoryTtlCapDaysText} onChange={(e) => setMemoryTtlCapDaysText(e.target.value)} />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div className="space-y-1">
                  <div className="text-xs text-muted-foreground">Evaluator model</div>
                  <Select value={evaluatorModel} onValueChange={(v) => setEvaluatorModel(v)}>
                    <SelectTrigger>
                      <SelectValue placeholder="Default (env/code)" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={DEFAULT_EVALUATOR_MODEL_VALUE}>Default (env/code)</SelectItem>
                      <SelectItem value="gpt-5-mini">gpt-5-mini</SelectItem>
                      <SelectItem value="gpt-5.1">gpt-5.1</SelectItem>
                      <SelectItem value="gpt-5.2">gpt-5.2</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <div className="text-xs text-muted-foreground">Evaluator reasoning effort</div>
                  <Select value={evaluatorEffort} onValueChange={(v) => setEvaluatorEffort(v)}>
                    <SelectTrigger>
                      <SelectValue placeholder="Default (env/code)" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={DEFAULT_EVALUATOR_EFFORT_VALUE}>Default (env/code)</SelectItem>
                      <SelectItem value="low">low</SelectItem>
                      <SelectItem value="medium">medium</SelectItem>
                      <SelectItem value="high">high</SelectItem>
                      <SelectItem value="extra_high">extra_high</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Button size="sm" onClick={() => void handleSaveMemoryGovernance()} disabled={savingMemorySettings}>
                  {savingMemorySettings ? <RefreshCcw className="h-3 w-3 mr-2 animate-spin" /> : null}
                  Save
                </Button>
                <Button size="sm" variant="outline" onClick={() => void refreshMemorySettings()}>
                  Reload
                </Button>
                {memorySettings ? (
                  <div className="ml-auto text-xs text-muted-foreground">
                    Allowlist: {memorySettings.allowlistCategories.length} · Pending: {pendingMemoryEntries.length}
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          <Separator />

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-medium">Pending Memory</div>
                <div className="text-xs text-muted-foreground">Emails/phones are scrubbed before persistence.</div>
              </div>
              <Button size="sm" variant="outline" onClick={() => void refreshPendingMemory()}>
                <RefreshCcw className="h-3 w-3 mr-2" />
                Refresh list
              </Button>
            </div>

            {pendingMemoryEntries.length === 0 ? (
              <div className="text-sm text-muted-foreground">No pending memory entries.</div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>When</TableHead>
                      <TableHead>Scope</TableHead>
                      <TableHead>Lead</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead>Content</TableHead>
                      <TableHead>Expires</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pendingMemoryEntries.slice(0, 50).map((row) => {
                      const preview = row.content.length > 120 ? `${row.content.slice(0, 117)}...` : row.content;
                      return (
                        <TableRow key={`${row.scope}:${row.id}`}>
                          <TableCell className="text-xs whitespace-nowrap">{formatWhen(row.createdAt)}</TableCell>
                          <TableCell className="text-xs font-mono whitespace-nowrap">{row.scope}</TableCell>
                          <TableCell className="text-xs whitespace-nowrap">{row.leadLabel || (row.leadId ? row.leadId.slice(0, 8) : "-")}</TableCell>
                          <TableCell className="text-xs font-mono whitespace-nowrap">{row.category}</TableCell>
                          <TableCell className="text-xs">{preview}</TableCell>
                          <TableCell className="text-xs whitespace-nowrap">{formatWhen(row.expiresAt)}</TableCell>
                          <TableCell className="text-right whitespace-nowrap">
                            <div className="flex justify-end gap-2">
                              <Button size="sm" variant="outline" onClick={() => void handleApproveMemory(row)}>
                                Approve
                              </Button>
                              <Button size="sm" variant="destructive" onClick={() => void handleRejectMemory(row)}>
                                Reject
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card className="border-muted/60">
        <CardHeader className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base">Auto-Send Revision Loop (Recent)</CardTitle>
              <CardDescription>Stop reasons, iteration deltas, cache hits. Stored on DraftPipelineRun artifacts.</CardDescription>
            </div>
            <Button size="sm" variant="outline" onClick={() => void refreshLoopSummaries()}>
              <RefreshCcw className="h-3 w-3 mr-2" />
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {loopSummaries.length === 0 ? (
            <div className="text-sm text-muted-foreground">No loop summaries yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>When</TableHead>
                    <TableHead>Lead</TableHead>
                    <TableHead>Stop</TableHead>
                    <TableHead className="text-right">Iters</TableHead>
                    <TableHead className="text-right">ΔConf</TableHead>
                    <TableHead className="text-right">Cache</TableHead>
                    <TableHead className="text-right">Elapsed</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loopSummaries.slice(0, 50).map((row) => {
                    const s: any = row.summary && typeof row.summary === "object" ? row.summary : null;
                    const stopReason = s?.stopReason ?? "-";
                    const iters = typeof s?.iterationsUsed === "number" ? s.iterationsUsed : null;
                    const delta = typeof s?.deltaConfidence === "number" ? s.deltaConfidence : null;
                    const cacheHits = typeof s?.cacheHits === "number" ? s.cacheHits : null;
                    const elapsedMs = typeof s?.elapsedMs === "number" ? s.elapsedMs : null;
                    return (
                      <TableRow key={row.id}>
                        <TableCell className="text-xs whitespace-nowrap">{formatWhen(row.createdAt)}</TableCell>
                        <TableCell className="text-xs font-mono whitespace-nowrap">{row.leadId.slice(0, 8)}</TableCell>
                        <TableCell className="text-xs font-mono whitespace-nowrap">{stopReason}</TableCell>
                        <TableCell className="text-right text-xs">{iters ?? "-"}</TableCell>
                        <TableCell className="text-right text-xs">{delta !== null ? delta.toFixed(2) : "-"}</TableCell>
                        <TableCell className="text-right text-xs">{cacheHits ?? "-"}</TableCell>
                        <TableCell className="text-right text-xs">{elapsedMs !== null ? `${Math.round(elapsedMs)}ms` : "-"}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-muted/60">
        <CardHeader className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base">Calibration Runs</CardTitle>
              <CardDescription>Deterministic metrics snapshot + bootstrap proposals (no raw text).</CardDescription>
            </div>
            <Button size="sm" variant="outline" onClick={() => void handleRunCalibration()} disabled={runningCalibration}>
              {runningCalibration ? <Sparkles className="h-3 w-3 mr-2 animate-spin" /> : <Sparkles className="h-3 w-3 mr-2" />}
              Run calibration
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {runs.length === 0 ? (
            <div className="text-sm text-muted-foreground">No calibration runs yet.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Status</TableHead>
                  <TableHead>Window</TableHead>
                  <TableHead className="text-right">Proposals</TableHead>
                  <TableHead>Computed</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.slice(0, 10).map((r) => {
                  const pill = statusPill(r.status);
                  return (
                    <TableRow key={r.id} className="cursor-pointer" onClick={() => void openRunDetail(r.id)}>
                      <TableCell>
                        <Badge variant={pill.variant}>{pill.label}</Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {formatWhen(r.windowFrom)} → {formatWhen(r.windowTo)}
                      </TableCell>
                      <TableCell className="text-right text-xs">{r.proposalsCreated}</TableCell>
                      <TableCell className="text-xs">{formatWhen(r.computedAt)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card className="border-muted/60">
        <CardHeader className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base">Confidence Policy Proposals</CardTitle>
              <CardDescription>Approve (workspace admin) then apply/rollback (super-admin only).</CardDescription>
            </div>
            <Button size="sm" variant="outline" onClick={() => void refreshProposals()}>
              <RefreshCcw className="h-3 w-3 mr-2" />
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {proposals.length === 0 ? (
            <div className="text-sm text-muted-foreground">No proposals yet.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Status</TableHead>
                  <TableHead>Policy</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {proposals.slice(0, 12).map((p) => {
                  const pill = statusPill(p.status);
                  return (
                    <TableRow key={p.id} className="cursor-pointer" onClick={() => void openProposalDetail(p)}>
                      <TableCell>
                        <Badge variant={pill.variant}>{pill.label}</Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{p.policyKey}</TableCell>
                      <TableCell className="text-sm">{p.title}</TableCell>
                      <TableCell className="text-right space-x-2" onClick={(e) => e.stopPropagation()}>
                        {p.status === "PENDING" ? (
                          <>
                            <Button size="sm" variant="outline" onClick={() => void handleApprove(p.id)}>
                              <CheckCircle2 className="h-3 w-3 mr-2" />
                              Approve
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => void handleReject(p.id)}>
                              <XCircle className="h-3 w-3 mr-2" />
                              Reject
                            </Button>
                          </>
                        ) : null}
                        {p.status === "APPROVED" ? (
                          <Button size="sm" onClick={() => void handleApply(p.id)}>
                            Apply
                          </Button>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card className="border-muted/60">
        <CardHeader className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base">AIInteraction Inspector</CardTitle>
              <CardDescription>Per-call metadata only (stats, counts, decisions). No prompts or raw text.</CardDescription>
            </div>
            <Button size="sm" variant="outline" onClick={() => void refreshInteractions()}>
              <RefreshCcw className="h-3 w-3 mr-2" />
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
            <div className="space-y-1">
              <div className="text-xs text-muted-foreground">Window</div>
              <Select
                value={interactionFilters.window}
                onValueChange={(v) => setInteractionFilters((s) => ({ ...s, window: v as any }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="24h">24h</SelectItem>
                  <SelectItem value="7d">7d</SelectItem>
                  <SelectItem value="30d">30d</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <div className="text-xs text-muted-foreground">Feature ID</div>
              <Input
                value={interactionFilters.featureId}
                onChange={(e) => setInteractionFilters((s) => ({ ...s, featureId: e.target.value }))}
                placeholder="followup.parse_proposed_times"
              />
            </div>
            <div className="space-y-1">
              <div className="text-xs text-muted-foreground">Status</div>
              <Select
                value={interactionFilters.status}
                onValueChange={(v) => setInteractionFilters((s) => ({ ...s, status: v as any }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">all</SelectItem>
                  <SelectItem value="success">success</SelectItem>
                  <SelectItem value="error">error</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <div className="text-xs text-muted-foreground">Limit</div>
              <Input
                value={interactionFilters.limit}
                onChange={(e) => setInteractionFilters((s) => ({ ...s, limit: e.target.value }))}
                placeholder="50"
              />
            </div>
          </div>

          {interactions.length === 0 ? (
            <div className="text-sm text-muted-foreground">No interactions in this window.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Feature</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Tokens</TableHead>
                  <TableHead className="text-right">Latency</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {interactions.slice(0, 20).map((i) => (
                  <TableRow key={i.id} className="cursor-pointer" onClick={() => void openInteractionDetail(i.id)}>
                    <TableCell className="text-xs">{formatWhen(i.createdAt)}</TableCell>
                    <TableCell className="font-mono text-xs">{i.featureId}</TableCell>
                    <TableCell className="text-xs">
                      <Badge variant={i.status === "error" ? "destructive" : "secondary"}>{i.status}</Badge>
                    </TableCell>
                    <TableCell className="text-right text-xs">{i.totalTokens ?? "-"}</TableCell>
                    <TableCell className="text-right text-xs">{i.latencyMs ?? "-"}ms</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={Boolean(selectedRunId)} onOpenChange={(open) => (!open ? setSelectedRunId(null) : null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Calibration Run Detail</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="text-xs text-muted-foreground">Run ID: {selectedRunId}</div>
            <Textarea
              readOnly
              value={selectedRunDetail ? JSON.stringify(selectedRunDetail, null, 2) : "Loading..."}
              className="font-mono text-xs min-h-80"
            />
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(selectedProposal)} onOpenChange={(open) => (!open ? setSelectedProposal(null) : null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Proposal Detail</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {selectedProposal ? (
              <>
                <div className="space-y-1">
                  <div className="text-sm font-medium">{selectedProposal.title}</div>
                  <div className="text-xs text-muted-foreground">
                    Policy: <span className="font-mono">{selectedProposal.policyKey}</span>
                  </div>
                </div>
                <Textarea
                  readOnly
                  value={JSON.stringify({ payload: selectedProposal.payload, evidence: selectedProposal.evidence }, null, 2)}
                  className="font-mono text-xs min-h-56"
                />
                <div className="space-y-2">
                  <div className="text-sm font-medium">Revision History</div>
                  {revisions.length === 0 ? (
                    <div className="text-sm text-muted-foreground">No revisions yet.</div>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>When</TableHead>
                          <TableHead>Action</TableHead>
                          <TableHead className="text-right">Rollback</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {revisions.slice(0, 10).map((r) => (
                          <TableRow key={r.id}>
                            <TableCell className="text-xs">{formatWhen(r.createdAt)}</TableCell>
                            <TableCell className="text-xs">{r.action}</TableCell>
                            <TableCell className="text-right">
                              <Button size="sm" variant="outline" onClick={() => void handleRollback(r.id)}>
                                Rollback to this
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </div>
              </>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(selectedInteractionId)} onOpenChange={(open) => (!open ? setSelectedInteractionId(null) : null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>AIInteraction Detail</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="text-xs text-muted-foreground">Interaction ID: {selectedInteractionId}</div>
            <Textarea
              readOnly
              value={selectedInteractionDetail ? JSON.stringify(selectedInteractionDetail, null, 2) : "Loading..."}
              className="font-mono text-xs min-h-80"
            />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
