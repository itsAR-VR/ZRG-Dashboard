"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bot, CheckCircle2, Clock, Loader2, MessageSquareText, Plus, RefreshCcw, Settings2, Shield, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

import { getWorkspaceAdminStatus } from "@/actions/access-actions";
import { getEmailCampaigns } from "@/actions/email-campaign-actions";
import {
  createInsightChatSession,
  deleteInsightChatSession,
  finalizeInsightsChatSeedAnswer,
  getInsightChatMessages,
  getInsightsChatUserPreference,
  getLatestInsightContextPack,
  listInsightChatSessions,
  recomputeInsightContextPack,
  restoreInsightChatSession,
  runInsightContextPackStep,
  sendInsightsChatMessage,
  setInsightsChatUserPreference,
  startInsightsChatSeedQuestion,
  type InsightContextPackPublic,
} from "@/actions/insights-chat-actions";
import type { InsightsWindowPreset } from "@prisma/client";
import {
  INSIGHTS_CHAT_EFFORTS,
  coerceInsightsChatModel,
  coerceInsightsChatReasoningEffort,
  type InsightsChatModel,
  type InsightsChatReasoningEffort,
} from "@/lib/insights-chat/config";

type CampaignOption = { id: string; name: string };

type SessionRow = {
  id: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
  createdByEmail: string | null;
  deletedAt: Date | null;
  lastMessagePreview: string | null;
};

type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: Date;
};

function formatRelativeTime(ts: Date): string {
  const seconds = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function presetLabel(preset: InsightsWindowPreset): string {
  if (preset === "H24") return "Last 24h";
  if (preset === "D30") return "Last 30d";
  if (preset === "CUSTOM") return "Custom";
  return "Last 7d";
}

function packStatusLabel(status: InsightContextPackPublic["status"]): string {
  switch (status) {
    case "PENDING":
      return "Pending";
    case "RUNNING":
      return "Building";
    case "COMPLETE":
      return "Ready";
    case "FAILED":
      return "Error";
    default:
      return String(status);
  }
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function formatDateInputValue(d: Date | null): string {
  if (!d) return "";
  const iso = d.toISOString();
  return iso.slice(0, 10);
}

function parseDateInputValue(value: string): Date | null {
  const trimmed = (value || "").trim();
  if (!trimmed) return null;
  const d = new Date(`${trimmed}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function ChatBubble({ role, content }: { role: "user" | "assistant" | "system"; content: string }) {
  const isUser = role === "user";
  const isSystem = role === "system";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={[
          "max-w-[85%] rounded-2xl px-3 py-2 text-sm leading-relaxed",
          isSystem
            ? "bg-muted/50 text-muted-foreground border"
            : isUser
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-foreground",
        ].join(" ")}
      >
        {content}
      </div>
    </div>
  );
}

function CampaignPickerDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  campaigns: CampaignOption[];
  isLoading: boolean;
  allCampaigns: boolean;
  onAllCampaignsChange: (v: boolean) => void;
  cap: number;
  onCapChange: (v: number) => void;
  selectedIds: string[];
  onSelectedIdsChange: (ids: string[]) => void;
}) {
  const { campaigns } = props;
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings2 className="h-4 w-4" />
            Campaign Scope
          </DialogTitle>
          <DialogDescription>Select campaigns to include in the context pack.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div className="space-y-0.5">
              <Label className="text-sm font-medium">All campaigns</Label>
              <p className="text-xs text-muted-foreground">Uses a cap to avoid overly large packs.</p>
            </div>
            <Switch checked={props.allCampaigns} onCheckedChange={props.onAllCampaignsChange} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-sm">Cap (default 10)</Label>
              <Input
                type="number"
                min={1}
                max={50}
                value={props.cap}
                onChange={(e) => props.onCapChange(clampInt(Number(e.target.value), 1, 50))}
                disabled={!props.allCampaigns}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm">Selected count</Label>
              <div className="rounded-md border px-3 py-2 text-sm text-muted-foreground">
                {props.allCampaigns ? `All (cap ${props.cap})` : `${props.selectedIds.length} selected`}
              </div>
            </div>
          </div>

          <Separator />

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">Campaigns</Label>
              {props.isLoading ? (
                <span className="text-xs text-muted-foreground">Loading…</span>
              ) : (
                <span className="text-xs text-muted-foreground">{campaigns.length} campaigns</span>
              )}
            </div>

            <div className="rounded-lg border">
              <ScrollArea className="h-[320px]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[40px]" />
                      <TableHead>Name</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {campaigns.map((c) => {
                      const checked = props.selectedIds.includes(c.id);
                      return (
                        <TableRow
                          key={c.id}
                          className={props.allCampaigns ? "opacity-50" : "cursor-pointer"}
                          onClick={() => {
                            if (props.allCampaigns) return;
                            props.onSelectedIdsChange(
                              checked ? props.selectedIds.filter((id) => id !== c.id) : [...props.selectedIds, c.id]
                            );
                          }}
                        >
                          <TableCell>
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={props.allCampaigns}
                              readOnly
                              aria-label={`Select ${c.name}`}
                            />
                          </TableCell>
                          <TableCell className="font-medium">{c.name}</TableCell>
                        </TableRow>
                      );
                    })}
                    {!props.isLoading && campaigns.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={2} className="text-sm text-muted-foreground">
                          No EmailBison campaigns found for this workspace.
                        </TableCell>
                      </TableRow>
                    ) : null}
                  </TableBody>
                </Table>
              </ScrollArea>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function InsightsConsoleBody({
  activeWorkspace,
  isVisible,
}: {
  activeWorkspace?: string | null;
  isVisible: boolean;
}) {
  const [isWorkspaceAdmin, setIsWorkspaceAdmin] = useState(false);

  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);

  const [pack, setPack] = useState<InsightContextPackPublic | null>(null);
  const [packLoading, setPackLoading] = useState(false);

  const [prefLoading, setPrefLoading] = useState(false);
  const [windowPreset, setWindowPreset] = useState<InsightsWindowPreset>("D7");
  const [customStart, setCustomStart] = useState<Date | null>(null);
  const [customEnd, setCustomEnd] = useState<Date | null>(null);
  const [campaignCap, setCampaignCap] = useState(10);
  const [prefsSaved, setPrefsSaved] = useState(false);

  const [model, setModel] = useState<InsightsChatModel>("gpt-5-mini");
  const [reasoningEffort, setReasoningEffort] = useState<InsightsChatReasoningEffort>("medium");

  const [campaigns, setCampaigns] = useState<CampaignOption[]>([]);
  const [campaignsLoading, setCampaignsLoading] = useState(false);
  const [campaignPickerOpen, setCampaignPickerOpen] = useState(false);
  const [allCampaigns, setAllCampaigns] = useState(false);
  const [selectedCampaignIds, setSelectedCampaignIds] = useState<string[]>([]);

  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);

  const pollCancelRef = useRef<{ cancelled: boolean }>({ cancelled: false });

  const hasEmailCampaigns = campaigns.length > 0;

  const campaignScopeLabel = useMemo(() => {
    if (!hasEmailCampaigns) return "Workspace";
    if (allCampaigns) return `All campaigns (cap ${campaignCap})`;
    if (selectedCampaignIds.length === 0) return "Workspace (no campaign filter)";
    return `${selectedCampaignIds.length} selected`;
  }, [allCampaigns, campaignCap, hasEmailCampaigns, selectedCampaignIds.length]);

  const windowSummary = useMemo(() => {
    if (windowPreset !== "CUSTOM") return presetLabel(windowPreset);
    const start = customStart ? customStart.toISOString().slice(0, 10) : "—";
    const end = customEnd ? customEnd.toISOString().slice(0, 10) : "—";
    return `Custom (${start} → ${end})`;
  }, [customEnd, customStart, windowPreset]);

  const availableReasoningEfforts = useMemo(() => {
    return (model === "gpt-5.2" ? INSIGHTS_CHAT_EFFORTS : INSIGHTS_CHAT_EFFORTS.filter((v) => v !== "extra_high")) as InsightsChatReasoningEffort[];
  }, [model]);

  const loadWorkspaceMeta = useCallback(async () => {
    if (!activeWorkspace) return;
    setCampaignsLoading(true);
    try {
      const [adminRes, prefRes, campaignRes] = await Promise.all([
        getWorkspaceAdminStatus(activeWorkspace),
        getInsightsChatUserPreference(activeWorkspace),
        getEmailCampaigns(activeWorkspace),
      ]);

      setIsWorkspaceAdmin(Boolean(adminRes.success && adminRes.isAdmin));

      if (prefRes.success && prefRes.data) {
        setWindowPreset(prefRes.data.windowPreset);
        setCustomStart(prefRes.data.customStart);
        setCustomEnd(prefRes.data.customEnd);
        setCampaignCap(prefRes.data.campaignCap);
        setPrefsSaved(prefRes.data.isSaved);
      }

      if (campaignRes.success && campaignRes.data) {
        setCampaigns(campaignRes.data.map((c) => ({ id: c.id, name: c.name })));
      } else {
        setCampaigns([]);
      }
    } catch (error) {
      console.error(error);
      toast.error("Failed to load insights settings");
    } finally {
      setCampaignsLoading(false);
    }
  }, [activeWorkspace]);

  const loadSessions = useCallback(
    async (opts?: { includeDeleted?: boolean }) => {
      if (!activeWorkspace) return;
      setSessionsLoading(true);
      try {
        const res = await listInsightChatSessions(activeWorkspace, opts);
        if (!res.success || !res.data) {
          toast.error(res.error || "Failed to load sessions");
          setSessions([]);
          return;
        }
        setSessions(res.data.sessions);
        if (!selectedSessionId && res.data.sessions.length > 0) {
          setSelectedSessionId(res.data.sessions[0]!.id);
        }
      } catch (error) {
        console.error(error);
        toast.error("Failed to load sessions");
      } finally {
        setSessionsLoading(false);
      }
    },
    [activeWorkspace, selectedSessionId]
  );

  const loadSession = useCallback(
    async (sessionId: string) => {
      if (!activeWorkspace) return;
      setMessagesLoading(true);
      setPackLoading(true);
      try {
        const [msgs, packRes] = await Promise.all([
          getInsightChatMessages(activeWorkspace, sessionId),
          getLatestInsightContextPack(activeWorkspace, sessionId),
        ]);

        if (msgs.success && msgs.data) {
          setMessages(
            msgs.data.messages.map((m) => ({
              id: m.id,
              role: m.role,
              content: m.content,
              createdAt: m.createdAt,
            }))
          );
        } else {
          setMessages([]);
        }

        if (packRes.success && packRes.data) {
          setPack(packRes.data.pack);
          if (packRes.data.pack) {
            const nextModel = coerceInsightsChatModel(packRes.data.pack.model);
            setModel(nextModel);
            setReasoningEffort(
              coerceInsightsChatReasoningEffort({ model: nextModel, storedValue: packRes.data.pack.reasoningEffort }).stored
            );
          }
        } else {
          setPack(null);
        }
      } catch (error) {
        console.error(error);
        toast.error("Failed to load session");
      } finally {
        setMessagesLoading(false);
        setPackLoading(false);
      }
    },
    [activeWorkspace]
  );

  useEffect(() => {
    if (!isVisible) return;
    if (!activeWorkspace) return;

    loadWorkspaceMeta();
    loadSessions();
  }, [activeWorkspace, isVisible, loadSessions, loadWorkspaceMeta]);

  useEffect(() => {
    if (!isVisible) return;
    if (!activeWorkspace) return;
    if (!selectedSessionId) return;
    loadSession(selectedSessionId);
  }, [activeWorkspace, isVisible, loadSession, selectedSessionId]);

  useEffect(() => {
    const cancelToken = pollCancelRef.current;
    cancelToken.cancelled = !isVisible;
    return () => {
      cancelToken.cancelled = true;
    };
  }, [isVisible]);

  const savePreferences = useCallback(
    async (next?: Partial<{ windowPreset: InsightsWindowPreset; customStart: Date | null; customEnd: Date | null; campaignCap: number }>) => {
      if (!activeWorkspace) return;
      setPrefLoading(true);
      try {
        const res = await setInsightsChatUserPreference(activeWorkspace, {
          windowPreset: next?.windowPreset ?? windowPreset,
          customStart: next?.customStart ?? customStart,
          customEnd: next?.customEnd ?? customEnd,
          campaignCap: next?.campaignCap ?? campaignCap,
        });
        if (!res.success) toast.error(res.error || "Failed to save preferences");
        else setPrefsSaved(true);
      } finally {
        setPrefLoading(false);
      }
    },
    [activeWorkspace, campaignCap, customEnd, customStart, windowPreset]
  );

  const buildContextPackLoop = useCallback(
    async (contextPackId: string, sessionId: string, seedMessageId?: string) => {
      if (!activeWorkspace) return;
      pollCancelRef.current.cancelled = false;
      setSending(true);
      setPackLoading(true);
      try {
        let current: InsightContextPackPublic | null = null;
        while (!pollCancelRef.current.cancelled) {
          const step = await runInsightContextPackStep({
            clientId: activeWorkspace,
            contextPackId,
            maxThreadsToProcess: 3,
          });

          if (!step.success || !step.data) {
            toast.error(step.error || "Failed to build context pack");
            break;
          }

          current = step.data.pack;
          setPack(current);

          if (current.status === "COMPLETE" || current.status === "FAILED") {
            break;
          }

          // Lightweight polling delay
          await new Promise((r) => setTimeout(r, 450));
        }

        if (!pollCancelRef.current.cancelled && current?.status === "COMPLETE" && seedMessageId) {
          const done = await finalizeInsightsChatSeedAnswer({
            clientId: activeWorkspace,
            sessionId,
            contextPackId,
            userMessageId: seedMessageId,
          });
          if (!done.success) {
            toast.error(done.error || "Failed to generate answer");
          }
          await loadSession(sessionId);
          await loadSessions();
        } else {
          await loadSession(sessionId);
          await loadSessions();
        }
      } finally {
        setSending(false);
        setPackLoading(false);
      }
    },
    [activeWorkspace, loadSession, loadSessions]
  );

  const handleNewSession = useCallback(async () => {
    if (!activeWorkspace) return;
    setSending(true);
    try {
      const created = await createInsightChatSession(activeWorkspace, "Insights Session");
      if (!created.success || !created.data) {
        toast.error(created.error || "Failed to create session");
        return;
      }
      setSelectedSessionId(created.data.sessionId);
      setMessages([]);
      setPack(null);
      await loadSessions();
    } finally {
      setSending(false);
    }
  }, [activeWorkspace, loadSessions]);

  const handleSeedSend = useCallback(async () => {
    if (!activeWorkspace) return;
    const question = draft.trim();
    if (!question) return;

    setSending(true);
    try {
      const res = await startInsightsChatSeedQuestion({
        clientId: activeWorkspace,
        sessionId: selectedSessionId,
        question,
        model,
        reasoningEffort,
        windowPreset,
        windowFrom: customStart,
        windowTo: customEnd,
        campaignIds: hasEmailCampaigns ? selectedCampaignIds : [],
        allCampaigns: hasEmailCampaigns ? allCampaigns : false,
        campaignCap,
      });
      if (!res.success || !res.data) {
        toast.error(res.error || "Failed to start question");
        return;
      }

      setDraft("");
      if (res.data.sessionId !== selectedSessionId) {
        setSelectedSessionId(res.data.sessionId);
      }
      await loadSessions();
      await loadSession(res.data.sessionId);
      await buildContextPackLoop(res.data.contextPackId, res.data.sessionId, res.data.userMessageId);
    } finally {
      setSending(false);
    }
  }, [
    activeWorkspace,
    allCampaigns,
    buildContextPackLoop,
    campaignCap,
    customEnd,
    customStart,
    draft,
    hasEmailCampaigns,
    loadSession,
    loadSessions,
    model,
    reasoningEffort,
    selectedCampaignIds,
    selectedSessionId,
    windowPreset,
  ]);

  const handleFollowupSend = useCallback(async () => {
    if (!activeWorkspace || !selectedSessionId) return;
    const content = draft.trim();
    if (!content) return;
    setSending(true);
    try {
      const res = await sendInsightsChatMessage({
        clientId: activeWorkspace,
        sessionId: selectedSessionId,
        content,
      });
      if (!res.success || !res.data) {
        toast.error(res.error || "Failed to send message");
        return;
      }
      setDraft("");
      await loadSession(selectedSessionId);
      await loadSessions();
    } finally {
      setSending(false);
    }
  }, [activeWorkspace, draft, loadSession, loadSessions, selectedSessionId]);

  const canSendFollowups = Boolean(pack && pack.status === "COMPLETE" && pack.deletedAt == null);
  const isBuildingPack = Boolean(pack && ["PENDING", "RUNNING"].includes(pack.status));

  const handleRecomputePack = useCallback(async () => {
    if (!activeWorkspace || !selectedSessionId) return;
    setPackLoading(true);
    try {
      const res = await recomputeInsightContextPack({
        clientId: activeWorkspace,
        sessionId: selectedSessionId,
        windowPreset,
        windowFrom: customStart,
        windowTo: customEnd,
        campaignIds: hasEmailCampaigns ? selectedCampaignIds : [],
        allCampaigns: hasEmailCampaigns ? allCampaigns : false,
        campaignCap,
        model,
        reasoningEffort,
      });
      if (!res.success || !res.data) {
        toast.error(res.error || "Failed to start recompute");
        return;
      }
      await buildContextPackLoop(res.data.contextPackId, selectedSessionId);
    } finally {
      setPackLoading(false);
    }
  }, [
    activeWorkspace,
    allCampaigns,
    buildContextPackLoop,
    campaignCap,
    customEnd,
    customStart,
    hasEmailCampaigns,
    model,
    reasoningEffort,
    selectedCampaignIds,
    selectedSessionId,
    windowPreset,
  ]);

  const handleDeleteSession = useCallback(
    async (sessionId: string) => {
      if (!activeWorkspace) return;
      const ok = confirm("Soft delete this session? (Admins can restore later)");
      if (!ok) return;
      const res = await deleteInsightChatSession(activeWorkspace, sessionId);
      if (!res.success) toast.error(res.error || "Failed to delete session");
      await loadSessions({ includeDeleted: isWorkspaceAdmin });
      if (selectedSessionId === sessionId) {
        setSelectedSessionId(null);
        setMessages([]);
        setPack(null);
      }
    },
    [activeWorkspace, isWorkspaceAdmin, loadSessions, selectedSessionId]
  );

  const handleRestoreSession = useCallback(
    async (sessionId: string) => {
      if (!activeWorkspace) return;
      const res = await restoreInsightChatSession(activeWorkspace, sessionId);
      if (!res.success) toast.error(res.error || "Failed to restore session");
      await loadSessions({ includeDeleted: isWorkspaceAdmin });
    },
    [activeWorkspace, isWorkspaceAdmin, loadSessions]
  );

  const showIncludeDeleted = isWorkspaceAdmin;

  return (
    <div className="flex h-full flex-col">
      <div className="border-b px-6 py-4">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <h1 className="flex items-center gap-2 text-xl font-bold">
              <Bot className="h-5 w-5" />
              Insights Console
            </h1>
            <p className="text-sm text-muted-foreground">
              Read-only insights grounded in your analytics and representative threads.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {isWorkspaceAdmin ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Shield className="h-4 w-4" />
                Admin
              </div>
            ) : null}
          </div>
        </div>
      </div>

        {!activeWorkspace ? (
          <div className="p-4 text-sm text-muted-foreground">Select a workspace to use the Insights Console.</div>
        ) : (
          <div className="grid flex-1 min-h-0 grid-cols-1 gap-4 overflow-hidden md:grid-cols-[280px_1fr]">
            {/* Sessions sidebar */}
            <div className="flex flex-col overflow-hidden rounded-lg border">
              <div className="flex items-center justify-between gap-2 border-b p-3">
                <div className="text-sm font-medium">Sessions</div>
                <Button size="sm" variant="outline" onClick={handleNewSession} disabled={sending}>
                  <Plus className="h-4 w-4 mr-2" />
                  New
                </Button>
              </div>

              <ScrollArea className="flex-1">
                <div className="p-2 space-y-2">
                  {sessionsLoading ? (
                    <div className="flex items-center gap-2 p-3 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" /> Loading sessions…
                    </div>
                  ) : sessions.length === 0 ? (
                    <div className="p-3 text-sm text-muted-foreground">No sessions yet. Create one and ask a question.</div>
                  ) : (
                    sessions.map((s) => {
                      const selected = s.id === selectedSessionId;
                      return (
                        <button
                          key={s.id}
                          className={[
                            "w-full rounded-lg border px-3 py-2 text-left transition",
                            selected ? "border-primary bg-primary/5" : "hover:bg-muted/40",
                            s.deletedAt ? "opacity-60" : "",
                          ].join(" ")}
                          onClick={() => setSelectedSessionId(s.id)}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="truncate text-sm font-medium">{s.title}</div>
                            <div className="shrink-0 text-[11px] text-muted-foreground">{formatRelativeTime(s.updatedAt)}</div>
                          </div>
                          {s.createdByEmail ? (
                            <div className="mt-0.5 text-[11px] text-muted-foreground">by {s.createdByEmail}</div>
                          ) : null}
                          {s.lastMessagePreview ? (
                            <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">{s.lastMessagePreview}</div>
                          ) : (
                            <div className="mt-1 text-xs text-muted-foreground">No messages yet</div>
                          )}
                          {s.deletedAt ? <div className="mt-1 text-[11px] text-muted-foreground">Deleted</div> : null}
                        </button>
                      );
                    })
                  )}
                </div>
              </ScrollArea>

              {showIncludeDeleted ? (
                <div className="border-t p-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full justify-start"
                    onClick={() => loadSessions({ includeDeleted: true })}
                  >
                    <RefreshCcw className="h-4 w-4 mr-2" />
                    Refresh (incl. deleted)
                  </Button>
                </div>
              ) : (
                <div className="border-t p-2">
                  <Button variant="ghost" size="sm" className="w-full justify-start" onClick={() => loadSessions()}>
                    <RefreshCcw className="h-4 w-4 mr-2" />
                    Refresh
                  </Button>
                </div>
              )}
            </div>

            {/* Main pane */}
            <div className="flex flex-col overflow-hidden rounded-lg border">
	              {/* Controls */}
	              <div className="border-b p-3">
	                <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
	                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
	                    <div className="space-y-1">
	                      <Label className="text-xs text-muted-foreground">Window</Label>
	                      <Select
	                        value={windowPreset}
                        onValueChange={(v) => {
                          const preset = v as InsightsWindowPreset;
                          setWindowPreset(preset);
                          savePreferences({ windowPreset: preset });
                        }}
                        disabled={prefLoading}
                      >
                        <SelectTrigger className="h-9">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="H24">Last 24 hours</SelectItem>
                          <SelectItem value="D7">Last 7 days</SelectItem>
                          <SelectItem value="D30">Last 30 days</SelectItem>
                          <SelectItem value="CUSTOM">Custom</SelectItem>
	                        </SelectContent>
	                      </Select>
	                    </div>

                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">Model</Label>
                        <Select
                          value={model}
                          onValueChange={(v) => {
                            const nextModel = coerceInsightsChatModel(v);
                            setModel(nextModel);
                            setReasoningEffort(
                              coerceInsightsChatReasoningEffort({ model: nextModel, storedValue: reasoningEffort }).stored
                            );
                          }}
                        >
                          <SelectTrigger className="h-9">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="gpt-5-mini">GPT-5 Mini (default)</SelectItem>
                            <SelectItem value="gpt-5.1">GPT-5.1</SelectItem>
                            <SelectItem value="gpt-5.2">GPT-5.2</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">Reasoning</Label>
                        <Select
                          value={reasoningEffort}
                          onValueChange={(v) => setReasoningEffort(v as InsightsChatReasoningEffort)}
                        >
                          <SelectTrigger className="h-9">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {availableReasoningEfforts.map((effort) => (
                              <SelectItem key={effort} value={effort}>
                                {effort === "extra_high"
                                  ? "Extra high (GPT-5.2 only)"
                                  : effort.charAt(0).toUpperCase() + effort.slice(1)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
	
	                    <div className="space-y-1">
	                      <Label className="text-xs text-muted-foreground">Campaign scope</Label>
	                      <Button
                        variant="outline"
                        className="h-9 w-full justify-between"
                        onClick={() => setCampaignPickerOpen(true)}
                        disabled={!hasEmailCampaigns || campaignsLoading}
                        title={!hasEmailCampaigns ? "No EmailBison campaigns found for this workspace" : undefined}
                      >
                        <span className="truncate">{campaignScopeLabel}</span>
                        <Settings2 className="h-4 w-4 opacity-70" />
                      </Button>
                    </div>

                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Defaults</Label>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          className="h-9 flex-1"
                          onClick={() => savePreferences()}
                          disabled={prefLoading}
                          title="Save window + cap as defaults"
                        >
                          {prefsSaved ? <CheckCircle2 className="h-4 w-4 mr-2" /> : <Clock className="h-4 w-4 mr-2" />}
                          {prefsSaved ? "Saved" : "Save"}
                        </Button>
                        <Button
                          variant="outline"
                          className="h-9"
                          onClick={handleRecomputePack}
                          disabled={!selectedSessionId || packLoading || sending}
                          title="Recompute context pack for this session"
                        >
                          <RefreshCcw className="h-4 w-4 mr-2" />
                          Recompute
                        </Button>
                      </div>
                    </div>
                  </div>

                  {windowPreset === "CUSTOM" ? (
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">Custom start</Label>
                        <Input
                          type="date"
                          value={formatDateInputValue(customStart)}
                          onChange={(e) => {
                            const d = parseDateInputValue(e.target.value);
                            setCustomStart(d);
                            savePreferences({ customStart: d });
                          }}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">Custom end</Label>
                        <Input
                          type="date"
                          value={formatDateInputValue(customEnd)}
                          onChange={(e) => {
                            const d = parseDateInputValue(e.target.value);
                            setCustomEnd(d);
                            savePreferences({ customEnd: d });
                          }}
                        />
                      </div>
                    </div>
                  ) : null}
                </div>

                <CampaignPickerDialog
                  open={campaignPickerOpen}
                  onOpenChange={setCampaignPickerOpen}
                  campaigns={campaigns}
                  isLoading={campaignsLoading}
                  allCampaigns={allCampaigns}
                  onAllCampaignsChange={(v) => setAllCampaigns(v)}
                  cap={campaignCap}
                  onCapChange={(v) => {
                    setCampaignCap(v);
                    savePreferences({ campaignCap: v });
                  }}
                  selectedIds={selectedCampaignIds}
                  onSelectedIdsChange={setSelectedCampaignIds}
                />
              </div>

              {/* Pack status */}
              <div className="border-b px-3 py-2">
                {packLoading ? (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading context pack…
                  </div>
                ) : pack ? (
                  <div className="flex flex-wrap items-center justify-between gap-2">
	                    <div className="text-xs text-muted-foreground">
	                      <span className="font-medium text-foreground">Pack:</span> {packStatusLabel(pack.status)} · {presetLabel(pack.windowPreset)} ·{" "}
                        {pack.model} · {pack.reasoningEffort} ·{" "}
	                      {pack.targetThreadsTotal ? `${pack.processedThreads}/${pack.targetThreadsTotal}` : "—"}
	                    </div>
                    {pack.status === "FAILED" && pack.lastError ? (
                      <div className="text-xs text-destructive">{pack.lastError}</div>
                    ) : null}
                  </div>
                ) : (
                  <div className="text-xs text-muted-foreground">No context pack yet. Ask a seed question to build one.</div>
                )}
              </div>

              {/* Messages */}
              <ScrollArea className="flex-1">
                <div className="p-4 space-y-3">
                  {messagesLoading ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" /> Loading messages…
                    </div>
                  ) : messages.length === 0 ? (
                    <Card className="border-dashed">
                      <CardHeader>
                        <CardTitle className="text-base">Ask a seed question</CardTitle>
                        <CardDescription>
                          The first question builds a reusable context pack by analyzing representative threads. Later follow-ups reuse it.
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="text-sm text-muted-foreground space-y-2">
                        <div>
                          <span className="font-medium text-foreground">Window:</span> {windowSummary}
                        </div>
                        <div>
                          <span className="font-medium text-foreground">Scope:</span> {campaignScopeLabel}
                        </div>
                        <div className="text-xs">
                          Note: v1 is read-only. Action tools are disabled even if configured in AI Personality settings.
                        </div>
                      </CardContent>
                    </Card>
                  ) : (
                    messages.map((m) => <ChatBubble key={m.id} role={m.role} content={m.content} />)
                  )}
                </div>
              </ScrollArea>

              {/* Composer */}
              <div className="border-t p-3">
                <div className="flex items-end gap-2">
                  <div className="flex-1 space-y-1">
                    <Label className="text-xs text-muted-foreground">Message</Label>
                    <Input
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      placeholder={canSendFollowups ? "Ask a follow-up question…" : "Ask your seed question…"}
                      disabled={sending || isBuildingPack || (pack?.status === "FAILED")}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          if (messages.length === 0) handleSeedSend();
                          else handleFollowupSend();
                        }
                      }}
                    />
                    <div className="text-[11px] text-muted-foreground">
                      {isBuildingPack ? "Building context pack… you can keep this open; it may take a while." : canSendFollowups ? "Pack ready." : "Send a seed question to build the pack."}
                    </div>
                  </div>
                  <div className="flex flex-col gap-2">
                    {messages.length === 0 ? (
                      <Button onClick={handleSeedSend} disabled={sending || !draft.trim()}>
                        {sending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <MessageSquareText className="h-4 w-4 mr-2" />}
                        Send
                      </Button>
                    ) : (
                      <Button onClick={handleFollowupSend} disabled={sending || !draft.trim() || !canSendFollowups}>
                        {sending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <MessageSquareText className="h-4 w-4 mr-2" />}
                        Send
                      </Button>
                    )}
                    {isBuildingPack ? (
                      <Button
                        variant="outline"
                        onClick={() => {
                          pollCancelRef.current.cancelled = true;
                          toast.message("Stopped waiting. You can resume by clicking Recompute or sending later.");
                        }}
                        disabled={sending}
                      >
                        Stop waiting
                      </Button>
                    ) : null}
                  </div>
                </div>

                {selectedSessionId && isWorkspaceAdmin ? (
                  <div className="mt-3 flex items-center justify-between gap-2">
                    <div className="text-[11px] text-muted-foreground">Admin controls</div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleDeleteSession(selectedSessionId)}
                        className="text-destructive"
                      >
                        <Trash2 className="h-4 w-4 mr-2" />
                        Delete session
                      </Button>
                      {sessions.find((s) => s.id === selectedSessionId)?.deletedAt ? (
                        <Button variant="outline" size="sm" onClick={() => handleRestoreSession(selectedSessionId)}>
                          Restore
                        </Button>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        )}
    </div>
  );
}

export function InsightsConsole({ activeWorkspace }: { activeWorkspace?: string | null }) {
  return <InsightsConsoleBody activeWorkspace={activeWorkspace} isVisible={true} />;
}

export function InsightsChatSheet({ activeWorkspace }: { activeWorkspace?: string | null }) {
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm" disabled={!activeWorkspace} title={!activeWorkspace ? "Select a workspace first" : undefined}>
          <MessageSquareText className="h-4 w-4 mr-2" />
          Insights Console
        </Button>
      </SheetTrigger>

      <SheetContent side="right" className="w-[95vw] sm:max-w-5xl">
        <InsightsConsoleBody activeWorkspace={activeWorkspace} isVisible={open} />
      </SheetContent>
    </Sheet>
  );
}
