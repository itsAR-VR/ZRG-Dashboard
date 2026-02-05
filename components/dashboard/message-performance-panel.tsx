"use client";

import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Clock, RefreshCcw, Shield, Sparkles } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getGlobalAdminStatus, getWorkspaceAdminStatus } from "@/actions/access-actions";
import {
  getLatestMessagePerformanceReport,
  getMessagePerformanceEvidence,
  runMessagePerformanceReport,
} from "@/actions/message-performance-actions";
import { runMessagePerformanceEval } from "@/actions/message-performance-eval-actions";
import {
  approveMessagePerformanceProposal,
  applyMessagePerformanceProposal,
  listMessagePerformanceProposals,
  rejectMessagePerformanceProposal,
} from "@/actions/message-performance-proposals";
import { toast } from "sonner";

type MetricsSlice = {
  totals: { leads: number; rows: number; booked: number; notBooked: number; pending: number; bookedNoTimestamp: number };
  bySender: Record<string, { booked: number; notBooked: number; pending: number }>;
  byChannel: Record<string, { booked: number; notBooked: number; pending: number }>;
  bookingRateBySender: Record<string, number | null>;
};

type MetricsPayload = {
  crossChannel: MetricsSlice;
  withinChannel: MetricsSlice;
};

type ReportPayload = {
  packId: string;
  metrics: MetricsPayload;
  stats: Record<string, unknown>;
  synthesis: any;
  updatedAt: Date;
};

type ProposalRow = {
  id: string;
  type: string;
  status: string;
  title: string;
  summary: string | null;
  createdAt: Date;
  approvedAt: Date | null;
  appliedAt: Date | null;
  payload?: unknown;
  evidence?: unknown;
};

export function MessagePerformancePanel({ activeWorkspace }: { activeWorkspace?: string | null }) {
  const [report, setReport] = useState<ReportPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [runningReport, setRunningReport] = useState(false);
  const [runningEval, setRunningEval] = useState(false);
  const [evidenceRows, setEvidenceRows] = useState<any[] | null>(null);
  const [proposals, setProposals] = useState<ProposalRow[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [attributionView, setAttributionView] = useState<"cross" | "within">("cross");
  const [selectedProposal, setSelectedProposal] = useState<ProposalRow | null>(null);

  const metrics = useMemo(() => {
    if (!report?.metrics || !("crossChannel" in report.metrics)) return null;
    return attributionView === "cross" ? report.metrics.crossChannel : report.metrics.withinChannel;
  }, [report?.metrics, attributionView]);

  useEffect(() => {
    if (!activeWorkspace) {
      setReport(null);
      return;
    }

    setLoading(true);
    Promise.all([getWorkspaceAdminStatus(activeWorkspace), getGlobalAdminStatus(), getLatestMessagePerformanceReport(activeWorkspace)])
      .then(async ([adminRes, globalRes, reportRes]) => {
        setIsAdmin(adminRes.success && adminRes.isAdmin);
        setIsSuperAdmin(globalRes.success && globalRes.isAdmin);

        if (reportRes.success && reportRes.data) {
          setReport({
            ...reportRes.data,
            updatedAt: new Date(reportRes.data.updatedAt),
          } as ReportPayload);
        } else {
          setReport(null);
        }

        const proposalRes = await listMessagePerformanceProposals(activeWorkspace);
        if (proposalRes.success && proposalRes.data) {
          setProposals(
            proposalRes.data.proposals.map((p) => ({
              ...p,
              createdAt: new Date(p.createdAt),
              approvedAt: p.approvedAt ? new Date(p.approvedAt) : null,
              appliedAt: p.appliedAt ? new Date(p.appliedAt) : null,
            }))
          );
        }
      })
      .finally(() => setLoading(false));
  }, [activeWorkspace]);

  const refreshReport = async () => {
    if (!activeWorkspace) return;
    const reportRes = await getLatestMessagePerformanceReport(activeWorkspace);
    if (reportRes.success && reportRes.data) {
      setReport({
        ...reportRes.data,
        updatedAt: new Date(reportRes.data.updatedAt),
      } as ReportPayload);
    }
  };

  const refreshProposals = async () => {
    if (!activeWorkspace) return;
    const proposalRes = await listMessagePerformanceProposals(activeWorkspace);
    if (proposalRes.success && proposalRes.data) {
      setProposals(
        proposalRes.data.proposals.map((p) => ({
          ...p,
          createdAt: new Date(p.createdAt),
          approvedAt: p.approvedAt ? new Date(p.approvedAt) : null,
          appliedAt: p.appliedAt ? new Date(p.appliedAt) : null,
        }))
      );
    }
  };

  const handleRunReport = async () => {
    if (!activeWorkspace) return;
    setRunningReport(true);
    const res = await runMessagePerformanceReport(activeWorkspace, { includeSynthesis: true });
    if (res.success) {
      toast.success("Report generated");
      await refreshReport();
    } else {
      toast.error("Failed to run report", { description: res.error || "Unknown error" });
    }
    setRunningReport(false);
  };

  const handleRunEval = async () => {
    if (!activeWorkspace) return;
    setRunningEval(true);
    const res = await runMessagePerformanceEval(activeWorkspace);
    if (res.success) {
      toast.success("Eval run completed", { description: `${res.proposalsCreated ?? 0} proposal(s) created` });
      await refreshProposals();
    } else {
      toast.error("Failed to run eval", { description: res.error || "Unknown error" });
    }
    setRunningEval(false);
  };

  const handleLoadEvidence = async () => {
    if (!activeWorkspace || !report?.packId) return;
    const res = await getMessagePerformanceEvidence(activeWorkspace, report.packId);
    if (res.success) {
      setEvidenceRows(Array.isArray(res.rows) ? res.rows : []);
    } else {
      toast.error("Failed to load evidence", { description: res.error || "Unknown error" });
    }
  };

  const handleApprove = async (proposalId: string) => {
    if (!activeWorkspace) return;
    const res = await approveMessagePerformanceProposal(activeWorkspace, proposalId);
    if (res.success) {
      toast.success("Proposal approved");
      await refreshProposals();
    } else {
      toast.error("Failed to approve", { description: res.error || "Unknown error" });
    }
  };

  const handleReject = async (proposalId: string) => {
    if (!activeWorkspace) return;
    const res = await rejectMessagePerformanceProposal(activeWorkspace, proposalId);
    if (res.success) {
      toast.success("Proposal rejected");
      await refreshProposals();
    } else {
      toast.error("Failed to reject", { description: res.error || "Unknown error" });
    }
  };

  const handleApply = async (proposalId: string) => {
    if (!activeWorkspace) return;
    const res = await applyMessagePerformanceProposal(activeWorkspace, proposalId);
    if (res.success) {
      toast.success("Proposal applied");
      await refreshProposals();
    } else {
      toast.error("Failed to apply", { description: res.error || "Unknown error" });
    }
  };

  return (
    <Card className="border-muted/60">
      <CardHeader className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle className="text-base">Message Performance</CardTitle>
            <p className="text-xs text-muted-foreground">
              Compare booked vs not booked outcomes across AI and setter messages.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {isAdmin && (
              <Button size="sm" variant="outline" onClick={handleRunReport} disabled={runningReport}>
                {runningReport ? <RefreshCcw className="h-3 w-3 mr-2 animate-spin" /> : <RefreshCcw className="h-3 w-3 mr-2" />}
                Run report
              </Button>
            )}
            {isAdmin && (
              <Button size="sm" variant="outline" onClick={handleRunEval} disabled={runningEval}>
                {runningEval ? <Sparkles className="h-3 w-3 mr-2 animate-spin" /> : <Sparkles className="h-3 w-3 mr-2" />}
                Run eval
              </Button>
            )}
          </div>
        </div>
        {report?.updatedAt ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Clock className="h-3 w-3" />
            Last updated {report.updatedAt.toLocaleString()}
          </div>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-6">
        {loading ? (
          <div className="text-sm text-muted-foreground">Loading message performance…</div>
        ) : !report || !metrics ? (
          <div className="text-sm text-muted-foreground">No report yet. Run a report to get started.</div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Select value={attributionView} onValueChange={(v) => setAttributionView(v as "cross" | "within")}>
                <SelectTrigger className="w-[190px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cross">Cross-channel attribution</SelectItem>
                  <SelectItem value="within">Within-channel attribution</SelectItem>
                </SelectContent>
              </Select>
              <Badge variant="outline" className="text-xs">
                Leads {metrics.totals.leads}
              </Badge>
              <Badge variant="outline" className="text-xs">
                Booked {metrics.totals.booked}
              </Badge>
              <Badge variant="outline" className="text-xs">
                Not booked {metrics.totals.notBooked}
              </Badge>
              <Badge variant="outline" className="text-xs">
                Pending {metrics.totals.pending}
              </Badge>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-lg border p-3">
                <div className="text-xs font-semibold uppercase text-muted-foreground">Booking rate by sender</div>
                <div className="mt-3 space-y-2 text-sm">
                  {Object.entries(metrics.bookingRateBySender).map(([sender, rate]) => (
                    <div key={sender} className="flex items-center justify-between">
                      <span className="capitalize">{sender}</span>
                      <span>{rate === null ? "—" : `${Math.round(rate * 100)}%`}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="rounded-lg border p-3">
                <div className="text-xs font-semibold uppercase text-muted-foreground">By channel</div>
                <div className="mt-3 space-y-2 text-sm">
                  {Object.entries(metrics.byChannel).map(([channel, values]) => (
                    <div key={channel} className="flex items-center justify-between">
                      <span className="capitalize">{channel}</span>
                      <span>
                        {values.booked} booked · {values.notBooked} not booked
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {report.synthesis?.summary ? (
              <div className="rounded-lg border p-3 space-y-2">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase text-muted-foreground">
                  <Sparkles className="h-3 w-3" />
                  Synthesis
                </div>
                <p className="text-sm">{report.synthesis.summary}</p>
                {Array.isArray(report.synthesis.recommendations) && report.synthesis.recommendations.length > 0 && (
                  <div className="space-y-2">
                    <div className="text-xs font-semibold uppercase text-muted-foreground">Recommendations</div>
                    <ul className="text-sm list-disc pl-4 space-y-1">
                      {report.synthesis.recommendations.slice(0, 4).map((rec: any, idx: number) => (
                        <li key={idx}>{rec.title || rec.summary || "Recommendation"}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ) : null}

            {isAdmin && report.packId ? (
              <Dialog onOpenChange={(open) => (open ? handleLoadEvidence() : setEvidenceRows(null))}>
                <DialogTrigger asChild>
                  <Button variant="outline" size="sm">
                    <Shield className="h-3 w-3 mr-2" />
                    View evidence
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-3xl">
                  <DialogHeader>
                    <DialogTitle>Message Evidence (admin-only)</DialogTitle>
                  </DialogHeader>
                  <div className="max-h-[420px] overflow-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Message</TableHead>
                          <TableHead>Channel</TableHead>
                          <TableHead>Sent By</TableHead>
                          <TableHead>Outcome</TableHead>
                          <TableHead>Attribution</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {(evidenceRows || []).map((row, idx) => (
                          <TableRow key={row.messageId || idx}>
                            <TableCell className="text-xs">{row.messageId}</TableCell>
                            <TableCell className="text-xs capitalize">{row.channel}</TableCell>
                            <TableCell className="text-xs capitalize">{row.sentBy}</TableCell>
                            <TableCell className="text-xs">{row.outcome}</TableCell>
                            <TableCell className="text-xs">{row.attributionType}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                    {!evidenceRows?.length ? <div className="text-xs text-muted-foreground mt-3">No evidence rows.</div> : null}
                  </div>
                </DialogContent>
              </Dialog>
            ) : null}
          </>
        )}

        <div className="rounded-lg border p-3 space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-xs font-semibold uppercase text-muted-foreground">Proposal Queue</div>
            {proposals.length === 0 ? <Badge variant="outline">No proposals</Badge> : null}
          </div>
          {proposals.length > 0 && (
            <div className="space-y-2">
              {proposals.map((proposal) => (
                <div key={proposal.id} className="flex flex-col gap-2 rounded-md border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="text-sm font-medium">{proposal.title}</div>
                      {proposal.summary ? <div className="text-xs text-muted-foreground">{proposal.summary}</div> : null}
                    </div>
                    <Badge variant="outline" className="text-xs">
                      {proposal.status.toLowerCase()}
                    </Badge>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span className="uppercase">{proposal.type.replace("_", " ").toLowerCase()}</span>
                    <span>·</span>
                    <span>{proposal.createdAt.toLocaleDateString()}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {!!proposal.payload && (
                      <Button size="sm" variant="ghost" onClick={() => setSelectedProposal(proposal)}>
                        Details
                      </Button>
                    )}
                    {isAdmin && proposal.status === "PENDING" && (
                      <>
                        <Button size="sm" variant="outline" onClick={() => handleApprove(proposal.id)}>
                          <CheckCircle2 className="h-3 w-3 mr-1" />
                          Approve
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => handleReject(proposal.id)}>
                          Reject
                        </Button>
                      </>
                    )}
                    {isSuperAdmin && proposal.status === "APPROVED" && (
                      <Button size="sm" onClick={() => handleApply(proposal.id)}>
                        Apply (super admin)
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </CardContent>

      <Dialog open={!!selectedProposal} onOpenChange={(open) => (!open ? setSelectedProposal(null) : null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Proposal Details</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-xs">
            <div>
              <div className="font-semibold">Payload</div>
              <pre className="mt-1 rounded-md bg-muted p-2 whitespace-pre-wrap">
                {JSON.stringify(selectedProposal?.payload ?? {}, null, 2)}
              </pre>
            </div>
            <div>
              <div className="font-semibold">Evidence</div>
              <pre className="mt-1 rounded-md bg-muted p-2 whitespace-pre-wrap">
                {JSON.stringify(selectedProposal?.evidence ?? {}, null, 2)}
              </pre>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
