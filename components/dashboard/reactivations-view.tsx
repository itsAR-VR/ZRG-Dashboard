"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Plus, Upload, RefreshCw, Play, Settings2, AlertTriangle, CheckCircle2, Clock, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  createReactivationCampaign,
  deleteReactivationCampaign,
  getReactivationCampaigns,
  getReactivationEnrollments,
  importReactivationCsv,
  resetReactivationEnrollment,
  runReactivationNow,
  updateReactivationCampaign,
} from "@/actions/reactivation-actions";
import { getEmailCampaigns } from "@/actions/email-campaign-actions";
import { getFollowUpSequences } from "@/actions/followup-sequence-actions";

type Campaign = NonNullable<Awaited<ReturnType<typeof getReactivationCampaigns>>["data"]>[number];
type EnrollmentRow = NonNullable<Awaited<ReturnType<typeof getReactivationEnrollments>>["data"]>[number];

function statusBadge(status: string) {
  const normalized = (status || "").toLowerCase();
  if (normalized === "sent") return <Badge className="bg-emerald-600 hover:bg-emerald-600">Sent</Badge>;
  if (normalized === "ready") return <Badge variant="secondary">Ready</Badge>;
  if (normalized === "pending_resolution") return <Badge variant="outline">Pending</Badge>;
  if (normalized === "rate_limited") return <Badge variant="outline" className="border-amber-500 text-amber-600">Rate limited</Badge>;
  if (normalized === "needs_review") return <Badge variant="destructive">Needs review</Badge>;
  if (normalized === "failed") return <Badge variant="destructive">Failed</Badge>;
  return <Badge variant="outline">{status || "Unknown"}</Badge>;
}

export function ReactivationsView({ activeWorkspace }: { activeWorkspace: string | null }) {
  const [isPending, startTransition] = useTransition();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null);
  const [enrollments, setEnrollments] = useState<EnrollmentRow[]>([]);
  const [emailCampaigns, setEmailCampaigns] = useState<Array<{ id: string; name: string; bisonCampaignId: string }>>([]);
  const [sequences, setSequences] = useState<Array<{ id: string; name: string; triggerOn: string }>>([]);

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editingCampaign, setEditingCampaign] = useState<Campaign | null>(null);

  const [draftName, setDraftName] = useState("");
  const [draftEmailCampaignId, setDraftEmailCampaignId] = useState<string>("none");
  const [draftFollowUpSequenceId, setDraftFollowUpSequenceId] = useState<string>("none");
  const [draftDailyLimit, setDraftDailyLimit] = useState<number>(5);
  const [draftBumpTemplate, setDraftBumpTemplate] = useState<string>(
    "Hey {firstName} — just bumping this. Is it worth discussing this now, or should I circle back later?"
  );

  const loadCampaigns = useCallback(async () => {
    if (!activeWorkspace) {
      setCampaigns([]);
      setSelectedCampaignId(null);
      return;
    }
    const res = await getReactivationCampaigns(activeWorkspace);
    if (!res.success || !res.data) {
      toast.error(res.error || "Failed to load reactivation campaigns");
      return;
    }
    setCampaigns(res.data as any);
    if (!selectedCampaignId && res.data.length > 0) {
      setSelectedCampaignId(res.data[0]!.id);
    } else if (selectedCampaignId && !res.data.some((c: any) => c.id === selectedCampaignId)) {
      setSelectedCampaignId(res.data[0]?.id ?? null);
    }
  }, [activeWorkspace, selectedCampaignId]);

  const loadAux = useCallback(async () => {
    if (!activeWorkspace) {
      setEmailCampaigns([]);
      setSequences([]);
      return;
    }
    const [ec, seq] = await Promise.all([getEmailCampaigns(activeWorkspace), getFollowUpSequences(activeWorkspace)]);
    if (ec.success && ec.data) {
      setEmailCampaigns(ec.data.map((c) => ({ id: c.id, name: c.name, bisonCampaignId: c.bisonCampaignId })));
    }
    if (seq.success && seq.data) {
      setSequences(seq.data.map((s) => ({ id: s.id, name: s.name, triggerOn: s.triggerOn })));
    }
  }, [activeWorkspace]);

  const loadEnrollments = useCallback(async (campaignId: string | null) => {
    if (!campaignId) {
      setEnrollments([]);
      return;
    }
    const res = await getReactivationEnrollments(campaignId);
    if (!res.success || !res.data) {
      toast.error(res.error || "Failed to load enrollments");
      return;
    }
    setEnrollments(res.data as any);
  }, []);

  useEffect(() => {
    loadCampaigns();
    loadAux();
  }, [loadCampaigns, loadAux]);

  useEffect(() => {
    loadEnrollments(selectedCampaignId);
  }, [selectedCampaignId, loadEnrollments]);

  const selectedCampaign = useMemo(
    () => campaigns.find((c) => c.id === selectedCampaignId) ?? null,
    [campaigns, selectedCampaignId]
  );

  const counts = useMemo(() => {
    const c = { pending: 0, ready: 0, sent: 0, needsReview: 0, failed: 0, rateLimited: 0 };
    for (const e of enrollments) {
      const s = (e.status || "").toLowerCase();
      if (s === "pending_resolution") c.pending++;
      else if (s === "ready") c.ready++;
      else if (s === "sent") c.sent++;
      else if (s === "needs_review") c.needsReview++;
      else if (s === "failed") c.failed++;
      else if (s === "rate_limited") c.rateLimited++;
    }
    return c;
  }, [enrollments]);

  const openCreate = () => {
    setDraftName("");
    setDraftEmailCampaignId("none");
    setDraftFollowUpSequenceId("none");
    setDraftDailyLimit(5);
    setDraftBumpTemplate("Hey {firstName} — just bumping this. Is it worth discussing this now, or should I circle back later?");
    setIsCreateOpen(true);
  };

  const openEdit = () => {
    if (!selectedCampaign) return;
    setEditingCampaign(selectedCampaign);
    setDraftName(selectedCampaign.name);
    setDraftEmailCampaignId(selectedCampaign.emailCampaignId ?? "none");
    setDraftFollowUpSequenceId(selectedCampaign.followUpSequenceId ?? "none");
    setDraftDailyLimit(selectedCampaign.dailyLimitPerSender);
    setDraftBumpTemplate(selectedCampaign.bumpMessageTemplate);
    setIsEditOpen(true);
  };

  const saveCreate = async () => {
    if (!activeWorkspace) return;
    startTransition(async () => {
      const res = await createReactivationCampaign({
        clientId: activeWorkspace,
        name: draftName,
        emailCampaignId: draftEmailCampaignId === "none" ? null : draftEmailCampaignId,
        followUpSequenceId: draftFollowUpSequenceId === "none" ? null : draftFollowUpSequenceId,
        dailyLimitPerSender: draftDailyLimit,
        bumpMessageTemplate: draftBumpTemplate,
      });
      if (!res.success) {
        toast.error(res.error || "Failed to create campaign");
        return;
      }
      toast.success("Reactivation campaign created");
      setIsCreateOpen(false);
      await loadCampaigns();
    });
  };

  const saveEdit = async () => {
    if (!editingCampaign) return;
    startTransition(async () => {
      const res = await updateReactivationCampaign(editingCampaign.id, {
        name: draftName,
        emailCampaignId: draftEmailCampaignId === "none" ? null : draftEmailCampaignId,
        followUpSequenceId: draftFollowUpSequenceId === "none" ? null : draftFollowUpSequenceId,
        dailyLimitPerSender: draftDailyLimit,
        bumpMessageTemplate: draftBumpTemplate,
      });
      if (!res.success) {
        toast.error(res.error || "Failed to update campaign");
        return;
      }
      toast.success("Campaign updated");
      setIsEditOpen(false);
      setEditingCampaign(null);
      await loadCampaigns();
      await loadEnrollments(selectedCampaignId);
    });
  };

  const handleDelete = async () => {
    if (!selectedCampaign) return;
    if (!confirm("Delete this reactivation campaign and all enrollments?")) return;
    startTransition(async () => {
      const res = await deleteReactivationCampaign(selectedCampaign.id);
      if (!res.success) {
        toast.error(res.error || "Failed to delete campaign");
        return;
      }
      toast.success("Campaign deleted");
      setSelectedCampaignId(null);
      await loadCampaigns();
      await loadEnrollments(null);
    });
  };

  const handleUpload = async (file: File) => {
    if (!selectedCampaignId) return;
    const csvText = await file.text();
    startTransition(async () => {
      const res = await importReactivationCsv({ campaignId: selectedCampaignId, csvText });
      if (!res.success) {
        toast.error(res.error || "Failed to import CSV");
        return;
      }
      toast.success(`Imported ${res.imported ?? 0} lead${(res.imported ?? 0) === 1 ? "" : "s"} (${res.deduped ?? 0} deduped)`);
      await loadEnrollments(selectedCampaignId);
    });
  };

  const handleRunNow = async () => {
    if (!activeWorkspace) return;
    startTransition(async () => {
      const res = await runReactivationNow({ clientId: activeWorkspace });
      if (!res.success) {
        toast.error(res.error || "Failed to run reactivation");
        return;
      }
      toast.success("Reactivation run completed");
      await loadEnrollments(selectedCampaignId);
    });
  };

  const handleResetEnrollment = async (id: string) => {
    startTransition(async () => {
      const res = await resetReactivationEnrollment(id);
      if (!res.success) {
        toast.error(res.error || "Failed to reset");
        return;
      }
      toast.success("Enrollment reset");
      await loadEnrollments(selectedCampaignId);
    });
  };

  if (!activeWorkspace) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        Select a workspace to manage reactivations.
      </div>
    );
  }

  return (
    <div className="grid h-full grid-cols-1 gap-4 lg:grid-cols-[360px_1fr]">
      <Card className="overflow-hidden">
        <CardHeader className="space-y-1">
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Settings2 className="h-5 w-5" />
                Reactivation Campaigns
              </CardTitle>
              <CardDescription>CSV → resolve sender/thread → bump → start sequence</CardDescription>
            </div>
            <Button size="sm" onClick={openCreate} disabled={isPending}>
              <Plus className="mr-2 h-4 w-4" />
              New
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {campaigns.length === 0 ? (
            <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
              Create a campaign to start reactivating leads.
            </div>
          ) : (
            <ScrollArea className="h-[calc(100vh-340px)] pr-3">
              <div className="space-y-2">
                {campaigns.map((c) => (
                  <button
                    key={c.id}
                    className={`w-full rounded-lg border p-3 text-left transition-colors ${
                      c.id === selectedCampaignId ? "border-primary bg-primary/5" : "hover:bg-muted/40"
                    }`}
                    onClick={() => setSelectedCampaignId(c.id)}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate font-medium">{c.name}</div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {c.dailyLimitPerSender}/day per sender • {c._count.enrollments} enrollments
                        </div>
                      </div>
                      <Badge variant={c.isActive ? "secondary" : "outline"}>{c.isActive ? "Active" : "Paused"}</Badge>
                    </div>
                  </button>
                ))}
              </div>
            </ScrollArea>
          )}

          {selectedCampaign && (
            <>
              <Separator />
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={openEdit} disabled={isPending}>
                  <Settings2 className="mr-2 h-4 w-4" />
                  Settings
                </Button>
                <Button variant="outline" size="sm" onClick={handleDelete} disabled={isPending}>
                  <XCircle className="mr-2 h-4 w-4" />
                  Delete
                </Button>
                <Button size="sm" onClick={handleRunNow} disabled={isPending}>
                  <Play className="mr-2 h-4 w-4" />
                  Run now
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <div className="flex h-full flex-col gap-4">
        <Card>
          <CardHeader className="space-y-1">
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Upload className="h-5 w-5" />
                  Upload CSV
                </CardTitle>
                <CardDescription>Import leads into this campaign (per workspace)</CardDescription>
              </div>
              <Button variant="outline" size="sm" onClick={() => loadEnrollments(selectedCampaignId)} disabled={isPending}>
                <RefreshCw className="mr-2 h-4 w-4" />
                Refresh
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {!selectedCampaignId ? (
              <div className="text-sm text-muted-foreground">Select a campaign first.</div>
            ) : (
              <>
                <Input
                  type="file"
                  accept=".csv,text/csv"
                  disabled={isPending}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    handleUpload(file).catch((err) => toast.error(err?.message || "Upload failed"));
                    e.currentTarget.value = "";
                  }}
                />
                <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1">
                    <Clock className="h-3 w-3" /> Pending: {counts.pending}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3" /> Sent: {counts.sent}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3" /> Needs review: {counts.needsReview}
                  </span>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card className="flex-1 overflow-hidden">
          <CardHeader className="space-y-1">
            <CardTitle>Enrollments</CardTitle>
            <CardDescription>
              Statuses: pending resolution → ready → sent (or needs review). Dead senders fall back automatically.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <ScrollArea className="h-[calc(100vh-430px)]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Status</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Sender</TableHead>
                    <TableHead>Anchor</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {enrollments.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="py-10 text-center text-sm text-muted-foreground">
                        No enrollments yet.
                      </TableCell>
                    </TableRow>
                  ) : (
                    enrollments.map((e) => {
                      const email = e.lead.email || "—";
                      const sender = e.selectedSenderEmailId || e.originalSenderEmailId || "—";
                      const anchor = e.anchorReplyId ? `#${e.anchorReplyId}` : "—";
                      const showReset = ["needs_review", "failed"].includes((e.status || "").toLowerCase());
                      return (
                        <TableRow key={e.id}>
                          <TableCell className="whitespace-nowrap">{statusBadge(e.status)}</TableCell>
                          <TableCell className="max-w-[320px] truncate">
                            <div className="font-medium">{email}</div>
                            {(e.needsReviewReason || e.lastError) && (
                              <div className="mt-1 line-clamp-1 text-xs text-muted-foreground">
                                {e.needsReviewReason || e.lastError}
                              </div>
                            )}
                          </TableCell>
                          <TableCell className="whitespace-nowrap">
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-xs">{sender}</span>
                              {e.deadOriginalSender && (
                                <Badge variant="outline" className="border-amber-500 text-amber-600">
                                  Fallback
                                </Badge>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="whitespace-nowrap font-mono text-xs">{anchor}</TableCell>
                          <TableCell className="text-right">
                            {showReset ? (
                              <Button variant="outline" size="sm" disabled={isPending} onClick={() => handleResetEnrollment(e.id)}>
                                Retry
                              </Button>
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </ScrollArea>
          </CardContent>
        </Card>
      </div>

      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="sm:max-w-[680px]">
          <DialogHeader>
            <DialogTitle>Create reactivation campaign</DialogTitle>
            <DialogDescription>Defines bump template, limits, and the follow-up sequence to start after bump.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label>Name</Label>
              <Input value={draftName} onChange={(e) => setDraftName(e.target.value)} placeholder="e.g. January Reactivation" />
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label>EmailBison Campaign (optional)</Label>
                <Select value={draftEmailCampaignId} onValueChange={setDraftEmailCampaignId}>
                  <SelectTrigger>
                    <SelectValue placeholder="No filter" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No filter</SelectItem>
                    {emailCampaigns.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>Follow-up Sequence (optional)</Label>
                <Select value={draftFollowUpSequenceId} onValueChange={setDraftFollowUpSequenceId}>
                  <SelectTrigger>
                    <SelectValue placeholder="No sequence" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No sequence</SelectItem>
                    {sequences.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label>Daily limit per sender</Label>
                <Input
                  type="number"
                  min={1}
                  max={50}
                  value={draftDailyLimit}
                  onChange={(e) => setDraftDailyLimit(Number.parseInt(e.target.value || "5", 10))}
                />
              </div>
              <div className="rounded-lg border p-3 text-xs text-muted-foreground">
                <div className="font-medium text-foreground">Limit policy</div>
                <div className="mt-1">Enforced per EmailBison sender email account (sender_email_id) per day.</div>
              </div>
            </div>
            <div className="grid gap-2">
              <Label>Bump message template</Label>
              <Textarea value={draftBumpTemplate} onChange={(e) => setDraftBumpTemplate(e.target.value)} rows={5} />
              <div className="text-xs text-muted-foreground">Variables supported: {"{firstName}"}.</div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCreateOpen(false)} disabled={isPending}>
              Cancel
            </Button>
            <Button onClick={saveCreate} disabled={isPending}>
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent className="sm:max-w-[680px]">
          <DialogHeader>
            <DialogTitle>Edit campaign</DialogTitle>
            <DialogDescription>Adjust limits, templates, and the sequence that runs after the bump.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label>Name</Label>
              <Input value={draftName} onChange={(e) => setDraftName(e.target.value)} />
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label>EmailBison Campaign (optional)</Label>
                <Select value={draftEmailCampaignId} onValueChange={setDraftEmailCampaignId}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No filter</SelectItem>
                    {emailCampaigns.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>Follow-up Sequence (optional)</Label>
                <Select value={draftFollowUpSequenceId} onValueChange={setDraftFollowUpSequenceId}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No sequence</SelectItem>
                    {sequences.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label>Daily limit per sender</Label>
                <Input
                  type="number"
                  min={1}
                  max={50}
                  value={draftDailyLimit}
                  onChange={(e) => setDraftDailyLimit(Number.parseInt(e.target.value || "5", 10))}
                />
              </div>
              <div className="grid gap-2">
                <Label>Status</Label>
                <Select
                  value={editingCampaign?.isActive ? "active" : "paused"}
                  onValueChange={(v) => {
                    setEditingCampaign((prev) => (prev ? ({ ...prev, isActive: v === "active" } as any) : prev));
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="paused">Paused</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-2">
              <Label>Bump message template</Label>
              <Textarea value={draftBumpTemplate} onChange={(e) => setDraftBumpTemplate(e.target.value)} rows={5} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditOpen(false)} disabled={isPending}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                startTransition(async () => {
                  if (!editingCampaign) return;
                  const res = await updateReactivationCampaign(editingCampaign.id, {
                    isActive: editingCampaign.isActive,
                  });
                  if (!res.success) toast.error(res.error || "Failed to update status");
                });
                saveEdit();
              }}
              disabled={isPending}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
