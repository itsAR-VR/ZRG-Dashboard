"use client";

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, Bot, CheckCircle2, Clock, Copy, ExternalLink, Loader2, MessageSquareText, Plus, RefreshCcw, Settings2, Shield, Trash2 } from "lucide-react";
import { toast } from "sonner";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";

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
  regenerateInsightsChatFollowupAnswer,
  regenerateInsightsChatSeedAnswer,
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
import type { InsightThreadCitation } from "@/lib/insights-chat/citations";

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
  citations: InsightThreadCitation[] | null;
  createdAt: Date;
  contextPackId: string | null;
};

const EMPTY_CHAT_MESSAGES: ChatMessage[] = [];

type PendingAssistantState =
  | null
  | {
      mode: "answering" | "regenerating" | "building_pack";
      model: InsightsChatModel;
      reasoningEffort: InsightsChatReasoningEffort;
      label: string;
    };

const INSIGHTS_CACHE_PREFIX = "zrg:insights_chat:v1";

function safeLocalStorageGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeLocalStorageSet(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // ignore quota / privacy mode failures
  }
}

function cacheKeySessions(clientId: string, includeDeleted: boolean): string {
  return `${INSIGHTS_CACHE_PREFIX}:client:${clientId}:sessions:${includeDeleted ? "with_deleted" : "active"}`;
}

function cacheKeyMessages(clientId: string, sessionId: string): string {
  return `${INSIGHTS_CACHE_PREFIX}:client:${clientId}:session:${sessionId}:messages`;
}

function cacheKeyPack(clientId: string, sessionId: string): string {
  return `${INSIGHTS_CACHE_PREFIX}:client:${clientId}:session:${sessionId}:pack`;
}

function cacheKeySelectedSession(clientId: string): string {
  return `${INSIGHTS_CACHE_PREFIX}:client:${clientId}:selected_session`;
}

function serializeSessionRow(row: SessionRow) {
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
  };
}

function deserializeSessionRow(raw: any): SessionRow | null {
  if (!raw || typeof raw !== "object") return null;
  if (typeof raw.id !== "string") return null;
  return {
    id: raw.id,
    title: typeof raw.title === "string" ? raw.title : "Insights Session",
    createdAt: new Date(raw.createdAt),
    updatedAt: new Date(raw.updatedAt),
    createdByEmail: typeof raw.createdByEmail === "string" ? raw.createdByEmail : null,
    deletedAt: raw.deletedAt ? new Date(raw.deletedAt) : null,
    lastMessagePreview: typeof raw.lastMessagePreview === "string" ? raw.lastMessagePreview : null,
  };
}

function serializeChatMessage(m: ChatMessage) {
  return { ...m, createdAt: m.createdAt.toISOString() };
}

function deserializeChatMessage(raw: any): ChatMessage | null {
  if (!raw || typeof raw !== "object") return null;
  if (typeof raw.id !== "string") return null;
  if (raw.role !== "user" && raw.role !== "assistant" && raw.role !== "system") return null;
  return {
    id: raw.id,
    role: raw.role,
    content: typeof raw.content === "string" ? raw.content : "",
    citations: Array.isArray(raw.citations) ? (raw.citations as InsightThreadCitation[]) : null,
    createdAt: new Date(raw.createdAt),
    contextPackId: typeof raw.contextPackId === "string" ? raw.contextPackId : null,
  };
}

function serializePack(pack: InsightContextPackPublic) {
  return {
    ...pack,
    windowFrom: new Date(pack.windowFrom).toISOString(),
    windowTo: new Date(pack.windowTo).toISOString(),
    computedAt: pack.computedAt ? new Date(pack.computedAt).toISOString() : null,
    createdAt: new Date(pack.createdAt).toISOString(),
    updatedAt: new Date(pack.updatedAt).toISOString(),
    deletedAt: pack.deletedAt ? new Date(pack.deletedAt).toISOString() : null,
  };
}

function deserializePack(raw: any): InsightContextPackPublic | null {
  if (!raw || typeof raw !== "object") return null;
  if (typeof raw.id !== "string" || typeof raw.sessionId !== "string") return null;
  return {
    ...(raw as InsightContextPackPublic),
    windowFrom: new Date(raw.windowFrom),
    windowTo: new Date(raw.windowTo),
    computedAt: raw.computedAt ? new Date(raw.computedAt) : null,
    createdAt: new Date(raw.createdAt),
    updatedAt: new Date(raw.updatedAt),
    deletedAt: raw.deletedAt ? new Date(raw.deletedAt) : null,
  };
}

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

function PreWithCopy({ children }: { children: React.ReactNode }) {
  const preRef = useRef<HTMLPreElement | null>(null);
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    const text = preRef.current?.innerText || "";
    if (!text.trim()) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      toast.error("Failed to copy");
    }
  }, []);

  return (
    <div className="relative mt-3">
      <button
        type="button"
        onClick={handleCopy}
        className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-md border bg-background/70 px-2 py-1 text-[11px] text-muted-foreground hover:bg-background"
        title="Copy"
      >
        {copied ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        {copied ? "Copied" : "Copy"}
      </button>
      <pre ref={preRef} className="overflow-x-auto rounded-xl border bg-muted/40 p-3 text-xs leading-relaxed">
        {children}
      </pre>
    </div>
  );
}

const assistantMarkdownComponents: Components = {
  h1: ({ children }) => <h1 className="text-base font-semibold tracking-tight">{children}</h1>,
  h2: ({ children }) => <h2 className="text-sm font-semibold tracking-tight">{children}</h2>,
  h3: ({ children }) => <h3 className="text-sm font-semibold tracking-tight">{children}</h3>,
  p: ({ children }) => <p className="whitespace-pre-wrap leading-relaxed [&:not(:first-child)]:mt-3">{children}</p>,
  ul: ({ children }) => <ul className="mt-3 list-disc space-y-1 pl-5 leading-relaxed">{children}</ul>,
  ol: ({ children }) => <ol className="mt-3 list-decimal space-y-1 pl-5 leading-relaxed">{children}</ol>,
  li: ({ children }) => <li className="whitespace-pre-wrap">{children}</li>,
  a: ({ children, href }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-primary underline underline-offset-4 hover:opacity-90"
    >
      {children}
    </a>
  ),
  blockquote: ({ children }) => (
    <blockquote className="mt-3 border-l-2 border-border pl-4 text-muted-foreground">{children}</blockquote>
  ),
  hr: () => <hr className="my-4 border-border" />,
  pre: ({ children }) => <PreWithCopy>{children}</PreWithCopy>,
  code: ({ className, children, node: _node }) => {
    const inline = !(className || "").includes("language-");
    if (inline) {
      return (
        <code className="rounded-md border bg-muted/40 px-1.5 py-0.5 font-mono text-[12px] text-foreground">
          {children}
        </code>
      );
    }
    return <code className="font-mono text-[12px] text-foreground">{children}</code>;
  },
};

const AssistantMarkdown = memo(function AssistantMarkdown({ content }: { content: string }) {
  const cleaned = (content || "").trim();
  if (!cleaned) return null;

  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={assistantMarkdownComponents}>
      {cleaned}
    </ReactMarkdown>
  );
});

function buildInboxThreadHref(leadId: string): string {
  const cleaned = (leadId || "").trim();
  if (!cleaned) return "/?view=inbox";
  return `/?view=inbox&leadId=${encodeURIComponent(cleaned)}`;
}

function CitationsBar({ citations }: { citations: InsightThreadCitation[] }) {
  const top = citations.slice(0, 6);

  return (
    <div className="flex flex-wrap items-center gap-2">
      {top.map((c, idx) => (
        <a
          key={`${c.kind}:${c.leadId}:${c.ref}`}
          href={buildInboxThreadHref(c.leadId)}
          target="_blank"
          rel="noopener noreferrer"
          className={[
            "inline-flex items-center gap-1.5 rounded-full border border-border/50 bg-muted/30 px-3 py-1.5 text-[11px] text-muted-foreground",
            "insights-citation-hover insights-scale-in hover:bg-primary/10 hover:border-primary/30 hover:text-foreground",
            `insights-stagger-${Math.min(idx + 1, 6)}`,
          ].join(" ")}
          title={c.leadLabel || undefined}
        >
          <span className="font-semibold text-foreground">{c.ref}</span>
          {c.outcome ? <span className="text-muted-foreground/80">· {c.outcome}</span> : null}
          <ExternalLink className="h-3 w-3 opacity-60" />
        </a>
      ))}
    </div>
  );
}

function SourcesDialog({ citations }: { citations: InsightThreadCitation[] }) {
  const [open, setOpen] = useState(false);
  const items = citations;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 px-2 text-[11px] text-muted-foreground hover:text-foreground"
        onClick={() => setOpen(true)}
      >
        Sources ({items.length})
      </Button>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-sm">Sources</DialogTitle>
          <DialogDescription className="text-xs">Threads referenced by the assistant for this answer.</DialogDescription>
        </DialogHeader>

        <div className="max-h-[65vh] space-y-2 overflow-auto pr-1">
          {items.map((c) => (
            <div key={`${c.kind}:${c.leadId}:${c.ref}`} className="rounded-xl border bg-background/40 p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full border bg-muted/40 px-2 py-0.5 text-[11px] font-medium text-foreground">
                      {c.ref}
                    </span>
                    {c.outcome ? (
                      <span className="text-[11px] text-muted-foreground">{c.outcome}</span>
                    ) : (
                      <span className="text-[11px] text-muted-foreground">Thread</span>
                    )}
                    {c.campaignName ? (
                      <span className="truncate text-[11px] text-muted-foreground">· {c.campaignName}</span>
                    ) : null}
                  </div>
                  {c.leadLabel ? <div className="mt-1 truncate text-xs text-foreground">{c.leadLabel}</div> : null}
                  {c.note ? <div className="mt-2 text-xs text-muted-foreground">{c.note}</div> : null}
                </div>

                <a
                  href={buildInboxThreadHref(c.leadId)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 rounded-md border bg-background px-2 py-1 text-xs hover:bg-muted/40"
                >
                  Open in Inbox <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

const ChatBubble = memo(function ChatBubble({
  role,
  content,
  citations,
}: {
  role: "user" | "assistant" | "system";
  content: string;
  citations: InsightThreadCitation[] | null;
}) {
  const isUser = role === "user";
  const isSystem = role === "system";
  const hasCitations = role === "assistant" && Array.isArray(citations) && citations.length > 0;

  // Animation class based on message type
  const animationClass = isUser ? "insights-user-message-enter" : "insights-message-enter";

  return (
    <div className={`flex w-full ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={[
          "max-w-[46rem] rounded-2xl px-5 py-4 text-sm leading-relaxed",
          animationClass,
          isSystem
            ? "bg-muted/40 text-muted-foreground border"
            : isUser
              ? "bg-primary text-primary-foreground shadow-lg shadow-primary/20"
              : "bg-card/80 text-foreground border border-border/50 shadow-md",
        ].join(" ")}
      >
        {role === "assistant" ? (
          <>
            <AssistantMarkdown content={content} />
            {hasCitations ? (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-border/30">
                <CitationsBar citations={citations!} />
                <SourcesDialog citations={citations!} />
              </div>
            ) : null}
          </>
        ) : (
          <div className="whitespace-pre-wrap">{content}</div>
        )}
      </div>
    </div>
  );
});

const ThinkingBubble = memo(function ThinkingBubble(props: { label: string; model: InsightsChatModel; effort: InsightsChatReasoningEffort }) {
  return (
    <div className="flex w-full justify-start insights-message-enter">
      <div className="max-w-[46rem] rounded-2xl border border-primary/30 bg-card/80 px-5 py-4 text-sm leading-relaxed shadow-md insights-thinking-pulse">
        {/* Animated thinking indicator bar */}
        <div className="mb-3 h-1 w-24 rounded-full overflow-hidden bg-primary/10">
          <div className="h-full insights-shimmer rounded-full" />
        </div>

        <div className="flex items-center gap-3">
          {/* Animated dots */}
          <div className="insights-thinking-dots flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-primary" />
            <span className="h-2 w-2 rounded-full bg-primary" />
            <span className="h-2 w-2 rounded-full bg-primary" />
          </div>

          <div className="flex items-center gap-2 text-xs">
            <span className="font-semibold text-foreground">{props.label}</span>
            <span className="text-muted-foreground">·</span>
            <span className="text-muted-foreground">{props.model}</span>
            <span className="text-muted-foreground">·</span>
            <span className="text-muted-foreground">{props.effort}</span>
          </div>
        </div>
      </div>
    </div>
  );
});

const SessionItem = memo(function SessionItem({
  session,
  isSelected,
  isBusy,
  isBuilding,
  onSelect,
  index = 0,
}: {
  session: SessionRow;
  isSelected: boolean;
  isBusy: boolean;
  isBuilding: boolean;
  onSelect: (id: string) => void;
  index?: number;
}) {
  // Stagger class for entrance animation (cap at 8)
  const staggerClass = `insights-stagger-${Math.min(index + 1, 8)}`;

  return (
    <button
      className={[
        "w-full rounded-xl border px-4 py-3 text-left insights-session-enter insights-session-hover",
        staggerClass,
        isSelected
          ? "border-primary bg-primary/8 shadow-sm"
          : "border-border/50 hover:border-border hover:bg-muted/40",
        session.deletedAt ? "opacity-50" : "",
        isBusy || isBuilding ? "insights-glow-pulse" : "",
      ].join(" ")}
      onClick={() => onSelect(session.id)}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold leading-snug break-words tracking-tight" title={session.title}>
            {session.title}
          </div>
        </div>
        <div className="shrink-0 pt-0.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
          {formatRelativeTime(session.updatedAt)}
        </div>
      </div>
      {session.createdByEmail ? (
        <div className="mt-1 text-[11px] text-muted-foreground/80">by {session.createdByEmail}</div>
      ) : null}
      {session.lastMessagePreview ? (
        <div
          className="mt-2 text-xs leading-relaxed text-muted-foreground whitespace-pre-wrap break-words line-clamp-2"
          title={session.lastMessagePreview}
        >
          {session.lastMessagePreview}
        </div>
      ) : (
        <div className="mt-2 text-xs text-muted-foreground/60 italic">No messages yet</div>
      )}
      {isBusy ? (
        <div className="mt-2 flex items-center gap-2 text-[11px] font-medium text-primary">
          <div className="insights-thinking-dots flex items-center gap-0.5">
            <span className="h-1.5 w-1.5 rounded-full bg-primary" />
            <span className="h-1.5 w-1.5 rounded-full bg-primary" />
            <span className="h-1.5 w-1.5 rounded-full bg-primary" />
          </div>
          Answering…
        </div>
      ) : isBuilding ? (
        <div className="mt-2 flex items-center gap-2 text-[11px] font-medium text-primary">
          <div className="h-1 w-12 rounded-full overflow-hidden bg-primary/20">
            <div className="h-full insights-shimmer rounded-full" />
          </div>
          Building…
        </div>
      ) : null}
      {session.deletedAt ? (
        <div className="mt-2 inline-flex items-center rounded-full bg-destructive/10 px-2 py-0.5 text-[10px] font-medium text-destructive">
          Deleted
        </div>
      ) : null}
    </button>
  );
});

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
                      <TableHead className="w-[40px]">
                        <span className="sr-only">Select</span>
                      </TableHead>
                      <TableHead>Name</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {campaigns.map((c) => {
                      const checked = props.selectedIds.includes(c.id);
                      const toggleSelection = () => {
                        if (props.allCampaigns) return;
                        props.onSelectedIdsChange(
                          checked ? props.selectedIds.filter((id) => id !== c.id) : [...props.selectedIds, c.id]
                        );
                      };
                      return (
                        <TableRow
                          key={c.id}
                          className={props.allCampaigns ? "opacity-50" : "cursor-pointer"}
                          onClick={toggleSelection}
                        >
                          <TableCell>
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={props.allCampaigns}
                              onChange={toggleSelection}
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

  const [messagesBySession, setMessagesBySession] = useState<Record<string, ChatMessage[]>>({});
  const [messagesLoadingBySession, setMessagesLoadingBySession] = useState<Record<string, boolean>>({});

  const [packBySession, setPackBySession] = useState<Record<string, InsightContextPackPublic | null>>({});
  const [packLoadingBySession, setPackLoadingBySession] = useState<Record<string, boolean>>({});

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
  const [creatingSession, setCreatingSession] = useState(false);
  const [sendingBySession, setSendingBySession] = useState<Record<string, boolean>>({});
  const [pendingAssistantBySession, setPendingAssistantBySession] = useState<Record<string, PendingAssistantState>>({});

  const selectedSessionIdRef = useRef<string | null>(null);
  const activePackBuildsRef = useRef(new Map<string, { cancelled: boolean; sessionId: string }>());
  const stoppedPackIdsRef = useRef(new Set<string>());
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const previousWorkspaceRef = useRef<string | null | undefined>(activeWorkspace);

  useEffect(() => {
    selectedSessionIdRef.current = selectedSessionId;
  }, [selectedSessionId]);

  const messages = useMemo(() => {
    if (!selectedSessionId) return EMPTY_CHAT_MESSAGES;
    return messagesBySession[selectedSessionId] ?? EMPTY_CHAT_MESSAGES;
  }, [messagesBySession, selectedSessionId]);
  const messagesLoading = selectedSessionId ? Boolean(messagesLoadingBySession[selectedSessionId]) : false;
  const pack = selectedSessionId ? packBySession[selectedSessionId] ?? null : null;
  const packLoading = selectedSessionId ? Boolean(packLoadingBySession[selectedSessionId]) : false;
  const sending = selectedSessionId ? Boolean(sendingBySession[selectedSessionId]) : false;
  const pendingAssistant = selectedSessionId ? pendingAssistantBySession[selectedSessionId] ?? null : null;

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
      const includeDeleted = Boolean(opts?.includeDeleted);

      const ensureValidSelection = (nextSessions: SessionRow[]) => {
        setSelectedSessionId((currentSelected) => {
          if (currentSelected && nextSessions.some((s) => s.id === currentSelected)) return currentSelected;
          if (nextSessions.length === 0) return null;

          const cachedSelected = safeLocalStorageGet(cacheKeySelectedSession(activeWorkspace));
          const preferred = cachedSelected && nextSessions.some((s) => s.id === cachedSelected) ? cachedSelected : null;
          return preferred ?? nextSessions[0]!.id;
        });
      };

      const cachedSessionsRaw = safeLocalStorageGet(cacheKeySessions(activeWorkspace, includeDeleted));
      if (cachedSessionsRaw) {
        try {
          const parsed = JSON.parse(cachedSessionsRaw) as { sessions?: any[] };
          const cached = Array.isArray(parsed?.sessions) ? parsed.sessions.map(deserializeSessionRow).filter(Boolean) : [];
          setSessions(cached as SessionRow[]);
          ensureValidSelection(cached as SessionRow[]);
        } catch {
          // ignore
        }
      }

      setSessionsLoading(true);
      try {
        const res = await listInsightChatSessions(activeWorkspace, opts);
        if (!res.success || !res.data) {
          toast.error(res.error || "Failed to load sessions");
          setSessions([]);
          setSelectedSessionId(null);
          return;
        }
        setSessions(res.data.sessions);
        safeLocalStorageSet(
          cacheKeySessions(activeWorkspace, includeDeleted),
          JSON.stringify({ sessions: res.data.sessions.map(serializeSessionRow) })
        );
        ensureValidSelection(res.data.sessions);
      } catch (error) {
        console.error(error);
        toast.error("Failed to load sessions");
      } finally {
        setSessionsLoading(false);
      }
    },
    [activeWorkspace]
  );

  useEffect(() => {
    if (!activeWorkspace) return;
    if (!selectedSessionId) return;
    if (!sessions.some((s) => s.id === selectedSessionId)) return;
    safeLocalStorageSet(cacheKeySelectedSession(activeWorkspace), selectedSessionId);
  }, [activeWorkspace, selectedSessionId, sessions]);

  const loadSession = useCallback(
    async (sessionId: string) => {
      if (!activeWorkspace) return;
      const cachedMsgsRaw = safeLocalStorageGet(cacheKeyMessages(activeWorkspace, sessionId));
      if (cachedMsgsRaw) {
        try {
          const parsed = JSON.parse(cachedMsgsRaw) as { messages?: any[] };
          const cached = Array.isArray(parsed?.messages) ? parsed.messages.map(deserializeChatMessage).filter(Boolean) : [];
          if (cached.length > 0) {
            setMessagesBySession((prev) => ({ ...prev, [sessionId]: cached as ChatMessage[] }));
          }
        } catch {
          // ignore
        }
      }

      const cachedPackRaw = safeLocalStorageGet(cacheKeyPack(activeWorkspace, sessionId));
      if (cachedPackRaw) {
        try {
          const parsed = JSON.parse(cachedPackRaw) as { pack?: any };
          const cached = parsed?.pack ? deserializePack(parsed.pack) : null;
          if (cached) setPackBySession((prev) => ({ ...prev, [sessionId]: cached }));
        } catch {
          // ignore
        }
      }

      setMessagesLoadingBySession((prev) => ({ ...prev, [sessionId]: !cachedMsgsRaw }));
      setPackLoadingBySession((prev) => ({ ...prev, [sessionId]: !cachedPackRaw }));
      try {
        const [msgs, packRes] = await Promise.all([
          getInsightChatMessages(activeWorkspace, sessionId),
          getLatestInsightContextPack(activeWorkspace, sessionId),
        ]);

        if (msgs.success && msgs.data) {
          const next = msgs.data.messages.map((m) => ({
            id: m.id,
            role: m.role,
            content: m.content,
            citations: m.citations ?? null,
            createdAt: m.createdAt,
            contextPackId: m.contextPackId ?? null,
          }));
          setMessagesBySession((prev) => ({ ...prev, [sessionId]: next }));
          safeLocalStorageSet(cacheKeyMessages(activeWorkspace, sessionId), JSON.stringify({ messages: next.map(serializeChatMessage) }));
        } else {
          setMessagesBySession((prev) => ({ ...prev, [sessionId]: [] }));
        }
        setPendingAssistantBySession((prev) => ({ ...prev, [sessionId]: null }));

        if (packRes.success && packRes.data) {
          setPackBySession((prev) => ({ ...prev, [sessionId]: packRes.data!.pack }));
          if (packRes.data.pack) {
            safeLocalStorageSet(cacheKeyPack(activeWorkspace, sessionId), JSON.stringify({ pack: serializePack(packRes.data.pack) }));
          }
          if (packRes.data.pack && selectedSessionIdRef.current === sessionId) {
            const nextModel = coerceInsightsChatModel(packRes.data.pack.model);
            setModel(nextModel);
            setReasoningEffort(
              coerceInsightsChatReasoningEffort({ model: nextModel, storedValue: packRes.data.pack.reasoningEffort }).stored
            );
          }
        } else {
          setPackBySession((prev) => ({ ...prev, [sessionId]: null }));
        }
      } catch (error) {
        console.error(error);
        toast.error("Failed to load session");
      } finally {
        setMessagesLoadingBySession((prev) => ({ ...prev, [sessionId]: false }));
        setPackLoadingBySession((prev) => ({ ...prev, [sessionId]: false }));
      }
    },
    [activeWorkspace]
  );

  useEffect(() => {
    if (!isVisible) return;
    if (messagesLoading) return;
    messagesEndRef.current?.scrollIntoView({ block: "end" });
  }, [isVisible, messagesLoading, selectedSessionId, messages.length]);

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
    if (!sessions.some((s) => s.id === selectedSessionId)) return;
    loadSession(selectedSessionId);
  }, [activeWorkspace, isVisible, loadSession, selectedSessionId, sessions]);

  useEffect(() => {
    const activeBuilds = activePackBuildsRef.current;
    return () => {
      for (const state of activeBuilds.values()) {
        state.cancelled = true;
      }
      activeBuilds.clear();
    };
  }, []);

  useLayoutEffect(() => {
    if (previousWorkspaceRef.current === activeWorkspace) return;
    previousWorkspaceRef.current = activeWorkspace;

    for (const state of activePackBuildsRef.current.values()) {
      state.cancelled = true;
    }
    activePackBuildsRef.current.clear();
    stoppedPackIdsRef.current.clear();

    selectedSessionIdRef.current = null;
    setSelectedSessionId(null);
    setSessions([]);

    setMessagesBySession({});
    setMessagesLoadingBySession({});
    setPackBySession({});
    setPackLoadingBySession({});
    setSendingBySession({});
    setPendingAssistantBySession({});
  }, [activeWorkspace]);

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
      if (activePackBuildsRef.current.has(contextPackId)) return;
      stoppedPackIdsRef.current.delete(contextPackId);
      const cancelState = { cancelled: false, sessionId };
      activePackBuildsRef.current.set(contextPackId, cancelState);
      try {
        let current: InsightContextPackPublic | null = null;
        while (!cancelState.cancelled) {
          const step = await runInsightContextPackStep({
            clientId: activeWorkspace,
            contextPackId,
            maxThreadsToProcess: 3,
          });

          if (!step.success || !step.data) {
            if (selectedSessionIdRef.current === sessionId) {
              toast.error(step.error || "Failed to build context pack");
            }
            break;
          }

          current = step.data.pack;
          setPackBySession((prev) => ({ ...prev, [sessionId]: current }));
          safeLocalStorageSet(cacheKeyPack(activeWorkspace, sessionId), JSON.stringify({ pack: serializePack(current) }));

          // Fast seed answer: once the server creates an initial assistant answer,
          // stop waiting and let background cron finish the full pack.
          if (seedMessageId && current.seedAssistantMessageId) {
            if (selectedSessionIdRef.current === sessionId) {
              toast.success("Fast answer ready — continuing to build full pack in the background.");
            }
            await loadSession(sessionId);
            await loadSessions();
            return;
          }

          if (current.status === "COMPLETE" || current.status === "FAILED") {
            break;
          }

          // Lightweight polling delay (use a bigger backoff when we're in synthesis/error states).
          const inSynthesisStage = current.targetThreadsTotal > 0 && current.processedThreads >= current.targetThreadsTotal;
          const delayMs = current.lastError || inSynthesisStage ? 2500 : 450;
          await new Promise((r) => setTimeout(r, delayMs));
        }

        if (!cancelState.cancelled && current?.status === "COMPLETE" && seedMessageId) {
          const done = await finalizeInsightsChatSeedAnswer({
            clientId: activeWorkspace,
            sessionId,
            contextPackId,
            userMessageId: seedMessageId,
          });
          if (!done.success) {
            if (selectedSessionIdRef.current === sessionId) {
              toast.error(done.error || "Failed to generate answer");
            }
          }
          await loadSession(sessionId);
          await loadSessions();
        } else {
          await loadSession(sessionId);
          await loadSessions();
        }
      } finally {
        const state = activePackBuildsRef.current.get(contextPackId);
        if (state) state.cancelled = true;
        activePackBuildsRef.current.delete(contextPackId);
      }
    },
    [activeWorkspace, loadSession, loadSessions]
  );

  useEffect(() => {
    if (!isVisible) return;
    if (!activeWorkspace) return;
    if (!selectedSessionId) return;
    if (!pack) return;
    if (!["PENDING", "RUNNING"].includes(pack.status)) return;
    if (stoppedPackIdsRef.current.has(pack.id)) return;
    if (activePackBuildsRef.current.has(pack.id)) return;

    const hasAssistantMessage = messages.some((m) => m.role === "assistant");
    const seedUserMessageId = hasAssistantMessage
      ? undefined
      : messages.find((m) => m.role === "user" && m.contextPackId === pack.id)?.id ??
        messages.find((m) => m.role === "user")?.id ??
        undefined;

    void buildContextPackLoop(pack.id, selectedSessionId, seedUserMessageId);
  }, [activeWorkspace, buildContextPackLoop, isVisible, messages, pack, selectedSessionId]);

  const handleNewSession = useCallback(async () => {
    if (!activeWorkspace) return;
    setCreatingSession(true);
    try {
      const created = await createInsightChatSession(activeWorkspace, "Insights Session");
      if (!created.success || !created.data) {
        toast.error(created.error || "Failed to create session");
        return;
      }
      setSelectedSessionId(created.data.sessionId);
      selectedSessionIdRef.current = created.data.sessionId;
      setMessagesBySession((prev) => ({ ...prev, [created.data!.sessionId]: [] }));
      setPackBySession((prev) => ({ ...prev, [created.data!.sessionId]: null }));
      setPendingAssistantBySession((prev) => ({ ...prev, [created.data!.sessionId]: null }));
      await loadSessions();
    } finally {
      setCreatingSession(false);
    }
  }, [activeWorkspace, loadSessions]);

  const handleSeedSend = useCallback(async () => {
    if (!activeWorkspace) return;
    const question = draft.trim();
    if (!question) return;
    if (windowPreset === "CUSTOM") {
      if (!customStart || !customEnd) {
        toast.error("Select both a custom start and end date.");
        return;
      }
      if (customStart >= customEnd) {
        toast.error("Custom end date must be after the start date.");
        return;
      }
    }

    if (selectedSessionId) {
      setSendingBySession((prev) => ({ ...prev, [selectedSessionId]: true }));
    } else {
      setCreatingSession(true);
    }
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
        selectedSessionIdRef.current = res.data.sessionId;
      }
      await loadSessions();
      await loadSession(res.data.sessionId);
      await buildContextPackLoop(res.data.contextPackId, res.data.sessionId, res.data.userMessageId);
    } finally {
      if (selectedSessionId) {
        setSendingBySession((prev) => ({ ...prev, [selectedSessionId]: false }));
      } else {
        setCreatingSession(false);
      }
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
    const optimisticId = `local-user-${Date.now()}`;
    const sessionId = selectedSessionId;
    setDraft("");
    setMessagesBySession((prev) => {
      const existing = prev[sessionId] ?? [];
      return {
        ...prev,
        [sessionId]: [
          ...existing,
          {
            id: optimisticId,
            role: "user",
            content,
            citations: null,
            createdAt: new Date(),
            contextPackId: pack?.id ?? null,
          },
        ],
      };
    });
    setPendingAssistantBySession((prev) => ({ ...prev, [sessionId]: { mode: "answering", model, reasoningEffort, label: "Thinking" } }));
    setSendingBySession((prev) => ({ ...prev, [sessionId]: true }));
    try {
      const res = await sendInsightsChatMessage({
        clientId: activeWorkspace,
        sessionId,
        content,
        model,
        reasoningEffort,
      });
      if (!res.success || !res.data) {
        toast.error(res.error || "Failed to send message");
        setMessagesBySession((prev) => {
          const existing = prev[sessionId] ?? [];
          return { ...prev, [sessionId]: existing.filter((m) => m.id !== optimisticId) };
        });
        setPendingAssistantBySession((prev) => ({ ...prev, [sessionId]: null }));
        return;
      }
      setMessagesBySession((prev) => {
        const existing = prev[sessionId] ?? [];
        const next = existing.map((m) =>
          m.id === optimisticId
            ? {
                ...m,
                id: res.data!.userMessage.id,
                createdAt: new Date(res.data!.userMessage.createdAt),
              }
            : m
        );

        next.push({
          id: res.data!.assistantMessage.id,
          role: "assistant",
          content: res.data!.assistantMessage.content,
          citations: res.data!.assistantMessage.citations ?? null,
          createdAt: new Date(res.data!.assistantMessage.createdAt),
          contextPackId: pack?.id ?? null,
        });
        return { ...prev, [sessionId]: next };
      });
      setPendingAssistantBySession((prev) => ({ ...prev, [sessionId]: null }));
      await loadSessions();
    } finally {
      setSendingBySession((prev) => ({ ...prev, [sessionId]: false }));
    }
  }, [activeWorkspace, draft, loadSessions, model, pack?.id, reasoningEffort, selectedSessionId]);

  const canSendFollowups = Boolean(pack && pack.status === "COMPLETE" && pack.deletedAt == null);
  const isBuildingPack = Boolean(pack && ["PENDING", "RUNNING"].includes(pack.status));
  const canRegenerate = Boolean(selectedSessionId && pack && pack.status === "COMPLETE" && pack.deletedAt == null);

  const packStageLabel = useMemo(() => {
    if (!pack) return "Building";
    if (pack.status === "PENDING") return "Selecting threads";
    if (pack.status === "FAILED") return "Error";
    if (pack.targetThreadsTotal > 0 && pack.processedThreads < pack.targetThreadsTotal) {
      return `Extracting threads (${pack.processedThreads}/${pack.targetThreadsTotal})`;
    }
    if (pack.status === "RUNNING") return "Synthesizing pack";
    return "Building";
  }, [pack]);

  const handleRecomputePack = useCallback(async () => {
    if (!activeWorkspace || !selectedSessionId) return;
    if (windowPreset === "CUSTOM") {
      if (!customStart || !customEnd) {
        toast.error("Select both a custom start and end date.");
        return;
      }
      if (customStart >= customEnd) {
        toast.error("Custom end date must be after the start date.");
        return;
      }
    }
    setPackLoadingBySession((prev) => ({ ...prev, [selectedSessionId]: true }));
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
      setPackLoadingBySession((prev) => ({ ...prev, [selectedSessionId]: false }));
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

  const handleRegenerateSeed = useCallback(async () => {
    if (!activeWorkspace || !selectedSessionId) return;
    setSendingBySession((prev) => ({ ...prev, [selectedSessionId]: true }));
    try {
      const res = await regenerateInsightsChatSeedAnswer({
        clientId: activeWorkspace,
        sessionId: selectedSessionId,
        model,
        reasoningEffort,
      });
      if (!res.success || !res.data) {
        toast.error(res.error || "Failed to regenerate answer");
        return;
      }
      await loadSession(selectedSessionId);
      await loadSessions();
    } finally {
      setSendingBySession((prev) => ({ ...prev, [selectedSessionId]: false }));
    }
  }, [activeWorkspace, loadSession, loadSessions, model, reasoningEffort, selectedSessionId]);

  const handleRegenerateFollowup = useCallback(async () => {
    if (!activeWorkspace || !selectedSessionId) return;
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    if (!lastUser) return;

    setPendingAssistantBySession((prev) => ({
      ...prev,
      [selectedSessionId]: { mode: "regenerating", model, reasoningEffort, label: "Regenerating" },
    }));
    setSendingBySession((prev) => ({ ...prev, [selectedSessionId]: true }));
    try {
      const res = await regenerateInsightsChatFollowupAnswer({
        clientId: activeWorkspace,
        sessionId: selectedSessionId,
        userMessageId: lastUser.id,
        model,
        reasoningEffort,
      });
      if (!res.success || !res.data) {
        toast.error(res.error || "Failed to regenerate answer");
        return;
      }
      setMessagesBySession((prev) => {
        const existing = prev[selectedSessionId] ?? [];
        return {
          ...prev,
          [selectedSessionId]: [
            ...existing,
            {
              id: res.data!.assistantMessage.id,
              role: "assistant",
              content: res.data!.assistantMessage.content,
              citations: res.data!.assistantMessage.citations ?? null,
              createdAt: new Date(res.data!.assistantMessage.createdAt),
              contextPackId: pack?.id ?? null,
            },
          ],
        };
      });
      await loadSessions();
    } finally {
      setPendingAssistantBySession((prev) => ({ ...prev, [selectedSessionId]: null }));
      setSendingBySession((prev) => ({ ...prev, [selectedSessionId]: false }));
    }
  }, [activeWorkspace, loadSessions, messages, model, pack?.id, reasoningEffort, selectedSessionId]);

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
        setPendingAssistantBySession((prev) => ({ ...prev, [sessionId]: null }));
        setSendingBySession((prev) => ({ ...prev, [sessionId]: false }));
        setMessagesBySession((prev) => ({ ...prev, [sessionId]: [] }));
        setPackBySession((prev) => ({ ...prev, [sessionId]: null }));
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
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b px-6 py-5 bg-gradient-to-r from-background to-muted/20">
        <div className="flex items-start justify-between gap-4 insights-fade-in-up">
          <div className="space-y-2">
            <h1 className="flex items-center gap-3 text-2xl font-bold tracking-tight">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Bot className="h-5 w-5" />
              </div>
              <span className="bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text">
                Insights Console
              </span>
            </h1>
            <p className="text-sm text-muted-foreground max-w-md">
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
        <div className="grid flex-1 min-h-0 grid-cols-1 gap-4 overflow-hidden p-4 md:grid-cols-[320px_1fr] lg:grid-cols-[360px_1fr]">
          {/* Sessions sidebar */}
          <div className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-border/50 bg-card/40 shadow-sm insights-fade-in-up">
            <div className="flex items-center justify-between gap-2 border-b border-border/50 p-4">
              <div className="flex items-center gap-2">
                <div className="text-sm font-semibold tracking-tight">Sessions</div>
                {sessionsLoading ? (
                  <div className="insights-thinking-dots flex items-center gap-0.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground" />
                    <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground" />
                    <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground" />
                  </div>
                ) : null}
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={handleNewSession}
                disabled={creatingSession}
                className="insights-btn-hover font-medium"
              >
                <Plus className="h-4 w-4 mr-1.5" />
                New
              </Button>
            </div>

            <ScrollArea className="flex-1 min-h-0">
              <div className="p-2 space-y-2">
                {sessions.length === 0 ? (
                  sessionsLoading ? (
                    <div className="flex items-center gap-2 p-3 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" /> Loading sessions…
                    </div>
                  ) : (
                  <div className="p-3 text-sm text-muted-foreground">No sessions yet. Create one and ask a question.</div>
                  )
                ) : (
                  sessions.map((s, idx) => {
                    const sessionPack = packBySession[s.id] ?? null;
                    return (
                      <SessionItem
                        key={s.id}
                        session={s}
                        isSelected={s.id === selectedSessionId}
                        isBusy={Boolean(sendingBySession[s.id] || pendingAssistantBySession[s.id])}
                        isBuilding={Boolean(sessionPack && ["PENDING", "RUNNING"].includes(sessionPack.status))}
                        onSelect={setSelectedSessionId}
                        index={idx}
                      />
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
          <div className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border bg-card/20">
            {/* Controls */}
            <div className="border-b p-3">
              <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                <div className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
                  <div className="space-y-1">
	                      <Label className="text-xs text-muted-foreground">Window</Label>
	                      <Select
	                        value={windowPreset}
	                        onValueChange={(v) => {
	                          const preset = v as InsightsWindowPreset;
	                          setWindowPreset(preset);
	                          setPrefsSaved(false);
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
	                        className="h-9 w-full min-w-0 justify-between overflow-hidden"
	                        onClick={() => setCampaignPickerOpen(true)}
	                        disabled={false}
	                        title={hasEmailCampaigns ? "Select email campaigns to include in this pack" : "No email campaigns found for this workspace"}
	                      >
	                        <span className="min-w-0 truncate">{campaignScopeLabel}</span>
	                        <Settings2 className="h-4 w-4 opacity-70" />
	                      </Button>
                    </div>

                    <div className="space-y-1 min-w-0">
                      <Label className="text-xs text-muted-foreground">Defaults</Label>
                      <div className="flex flex-col gap-2">
                        <Button
                          variant="outline"
                          className="h-9 justify-start min-w-0"
                          onClick={() => savePreferences()}
                          disabled={prefLoading}
                          title="Save window + cap as defaults"
                        >
                          {prefsSaved ? <CheckCircle2 className="h-4 w-4 mr-2" /> : <Clock className="h-4 w-4 mr-2" />}
                          {prefsSaved ? "Saved" : "Save"}
                        </Button>
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                          <Button
                            variant="outline"
                            className="h-9 w-full min-w-0 justify-start overflow-hidden sm:flex-1 shrink"
                            onClick={handleRecomputePack}
                            disabled={!selectedSessionId || packLoading || sending}
                            title="Recompute context pack for this session (keeps existing answers)"
                          >
                            <RefreshCcw className="h-4 w-4 mr-2" />
                            <span className="truncate">Recompute</span>
                          </Button>
                          <Button
                            variant="outline"
                            className="h-9 w-full min-w-0 justify-start overflow-hidden sm:flex-1 shrink"
                            onClick={handleRegenerateSeed}
                            disabled={!canRegenerate || sending || packLoading}
                            title="Regenerate the seed answer using the latest context pack"
                          >
                            <MessageSquareText className="h-4 w-4 mr-2" />
                            <span className="truncate">Regenerate</span>
                          </Button>
                        </div>
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
	                            setPrefsSaved(false);
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
	                            setPrefsSaved(false);
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
	                    setPrefsSaved(false);
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
              <ScrollArea className="flex-1 min-h-0">
                <div className="mx-auto w-full max-w-3xl px-6 py-8">
                  {messagesLoading ? (
                    <div className="flex items-center gap-3 text-sm text-muted-foreground insights-fade-in-up">
                      <div className="insights-thinking-dots flex items-center gap-1">
                        <span className="h-2 w-2 rounded-full bg-primary" />
                        <span className="h-2 w-2 rounded-full bg-primary" />
                        <span className="h-2 w-2 rounded-full bg-primary" />
                      </div>
                      Loading messages…
                    </div>
                  ) : messages.length === 0 ? (
                    <div className="flex min-h-[55vh] flex-col items-center justify-center gap-8 text-center">
                      <div className="space-y-3 insights-fade-in-up">
                        <h2 className="text-3xl font-bold tracking-tight bg-gradient-to-br from-foreground via-foreground to-muted-foreground bg-clip-text">
                          What are you working on?
                        </h2>
                        <p className="text-sm text-muted-foreground max-w-md mx-auto leading-relaxed">
                          Ask a seed question to build a reusable context pack from representative threads.
                        </p>
                      </div>

                      <div className="grid w-full max-w-2xl grid-cols-1 gap-4 sm:grid-cols-3">
                        <div className="rounded-2xl border border-border/50 bg-card/50 p-4 text-left shadow-sm insights-scale-in insights-stagger-1">
                          <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">Window</div>
                          <div className="mt-2 text-sm font-semibold">{windowSummary}</div>
                        </div>
                        <div className="rounded-2xl border border-border/50 bg-card/50 p-4 text-left shadow-sm insights-scale-in insights-stagger-2">
                          <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">Scope</div>
                          <div className="mt-2 text-sm font-semibold line-clamp-2" title={campaignScopeLabel}>
                            {campaignScopeLabel}
                          </div>
                        </div>
                        <div className="rounded-2xl border border-border/50 bg-card/50 p-4 text-left shadow-sm insights-scale-in insights-stagger-3">
                          <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">Model</div>
                          <div className="mt-2 text-sm font-semibold">
                            {model} · {reasoningEffort}
                          </div>
                        </div>
                      </div>

                      <div className="text-[11px] text-muted-foreground/60 insights-fade-in-up insights-stagger-4">
                        v1 is read-only. Action tools are disabled even if configured in AI Personality settings.
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-5">
                      {messages.map((m) => (
                        <ChatBubble key={m.id} role={m.role} content={m.content} citations={m.citations} />
                      ))}
                      {pendingAssistant ? (
                        <ThinkingBubble label={pendingAssistant.label} model={pendingAssistant.model} effort={pendingAssistant.reasoningEffort} />
                      ) : isBuildingPack && messages.length > 0 && !messages.some((m) => m.role === "assistant") ? (
                        <ThinkingBubble label={packStageLabel} model={model} effort={reasoningEffort} />
                      ) : null}
                      <div ref={messagesEndRef} />
                    </div>
                  )}
                </div>
              </ScrollArea>

              {/* Composer */}
              <div className="border-t bg-gradient-to-t from-background via-background to-transparent p-4">
                <div className="mx-auto w-full max-w-3xl">
                  <div className="relative rounded-2xl border border-border/50 bg-card/60 p-2 shadow-md backdrop-blur-sm insights-input-focus">
                    <Textarea
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      placeholder={messages.length === 0 ? "Ask your seed question…" : "Ask a follow-up question…"}
                      disabled={sending || isBuildingPack || (pack?.status === "FAILED")}
                      className="min-h-[52px] max-h-[180px] resize-none border-0 bg-transparent px-4 py-3 pr-14 text-sm leading-relaxed focus-visible:ring-0 focus-visible:ring-offset-0 placeholder:text-muted-foreground/60"
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          if (sending || isBuildingPack || (pack?.status === "FAILED")) return;
                          if (!draft.trim()) return;
                          if (messages.length > 0 && !canSendFollowups) return;
                          if (messages.length === 0) handleSeedSend();
                          else handleFollowupSend();
                        }
                      }}
                    />

                    <Button
                      size="icon"
                      className={[
                        "absolute bottom-3 right-3 h-10 w-10 rounded-xl shadow-lg",
                        "insights-btn-hover insights-btn-primary-glow",
                        draft.trim() && !sending ? "bg-primary text-primary-foreground" : "",
                      ].join(" ")}
                      onClick={() => {
                        if (messages.length === 0) handleSeedSend();
                        else handleFollowupSend();
                      }}
                      disabled={
                        sending ||
                        isBuildingPack ||
                        (pack?.status === "FAILED") ||
                        !draft.trim() ||
                        (messages.length > 0 && !canSendFollowups)
                      }
                      title={messages.length === 0 ? "Send seed question" : "Send message"}
                    >
                      {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
                    </Button>
                  </div>

                  <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                    <div>
                      {isBuildingPack
                        ? "Building context pack… you can keep this open; it may take a while."
                        : canSendFollowups
                          ? "Pack ready."
                          : "Send a seed question to build the pack."}
                    </div>
                    {isBuildingPack ? (
	                      <Button
	                        variant="ghost"
	                        size="sm"
	                        className="h-7 px-2"
	                        onClick={() => {
	                          if (!pack) return;
	                          const state = activePackBuildsRef.current.get(pack.id);
	                          if (state) state.cancelled = true;
	                          stoppedPackIdsRef.current.add(pack.id);
	                          toast.message("Stopped waiting. You can resume by clicking Recompute or sending later.");
	                        }}
	                        disabled={sending}
	                      >
                        Stop waiting
                      </Button>
                    ) : canSendFollowups && messages.filter((m) => m.role === "user").length > 1 ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2"
                        onClick={handleRegenerateFollowup}
                        disabled={sending || Boolean(pendingAssistant)}
                      >
                        Regenerate
                      </Button>
                    ) : null}
                  </div>
                </div>

                {selectedSessionId && isWorkspaceAdmin ? (
                  <div className="mx-auto mt-4 flex w-full max-w-3xl items-center justify-between gap-2">
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
