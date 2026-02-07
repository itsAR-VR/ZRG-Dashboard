import "server-only";

import { prisma } from "@/lib/prisma";
import { runStructuredJsonPrompt } from "@/lib/ai/prompt-runner";
import { MESSAGE_PERFORMANCE_SESSION_TITLE } from "@/lib/message-performance-report";
import type { MessagePerformanceSynthesis } from "@/lib/message-performance-synthesis";
import type { InsightContextPackSynthesis } from "@/lib/insights-chat/pack-synthesis";

type ChunkSource = "message_performance" | "insights_pack";

export type AutoSendOptimizationChunk = {
  id: string;
  source: ChunkSource;
  text: string;
  score?: number;
};

export type AutoSendOptimizationSelection = {
  selected_chunk_ids: string[];
  selected_context_markdown: string;
  what_to_apply: string[];
  what_to_avoid: string[];
  missing_info: string[];
  confidence: number;
};

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item === "string") out.push(item);
  }
  return out;
}

function redactCommonPii(text: string): string {
  let out = text || "";

  // Emails
  out = out.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted_email]");

  // URLs
  out = out.replace(/\bhttps?:\/\/[^\s)]+/gi, "[redacted_url]");
  out = out.replace(/\bwww\.[^\s)]+/gi, "[redacted_url]");

  // Phone-ish sequences (very rough; keeps last 2 digits for debugging symmetry)
  out = out.replace(/(\+?\d[\d\s().-]{7,}\d)/g, (match) => {
    const digits = match.replace(/\D/g, "");
    const suffix = digits.slice(-2);
    return `[redacted_phone..${suffix || "xx"}]`;
  });

  return out;
}

function normalizeForTokens(text: string): string {
  return (text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenizeForOverlap(text: string): string[] {
  const raw = normalizeForTokens(text);
  if (!raw) return [];
  const stop = new Set([
    "the",
    "and",
    "for",
    "with",
    "that",
    "this",
    "you",
    "your",
    "are",
    "but",
    "not",
    "can",
    "will",
    "have",
    "has",
    "had",
    "was",
    "were",
    "from",
    "they",
    "them",
    "their",
    "our",
    "we",
    "us",
    "a",
    "an",
    "to",
    "of",
    "in",
    "on",
    "at",
    "as",
    "it",
    "is",
    "be",
    "or",
  ]);
  const tokens = raw
    .split(" ")
    .map((t) => t.trim())
    .filter((t) => t.length >= 3 && !stop.has(t));
  return Array.from(new Set(tokens));
}

function scoreChunk(queryTokens: Set<string>, chunkText: string): number {
  if (queryTokens.size === 0) return 0;
  const chunkTokens = tokenizeForOverlap(chunkText);
  if (chunkTokens.length === 0) return 0;

  let hit = 0;
  for (const t of chunkTokens) {
    if (queryTokens.has(t)) hit += 1;
  }

  // Favor compact, high-signal chunks.
  const lengthPenalty = Math.min(1, chunkText.length / 600);
  return hit / Math.max(1, queryTokens.size) - 0.05 * lengthPenalty;
}

function clipLines(text: string, maxChars: number): string {
  const cleaned = redactCommonPii(String(text || "")).replace(/\s+/g, " ").trim();
  if (cleaned.length <= maxChars) return cleaned;
  return cleaned.slice(0, Math.max(0, maxChars - 1)).trimEnd() + "…";
}

function buildChunksFromMessagePerformance(synth: MessagePerformanceSynthesis | null): AutoSendOptimizationChunk[] {
  if (!synth) return [];

  const chunks: AutoSendOptimizationChunk[] = [];
  const summary = clipLines(synth.summary || "", 320);
  if (summary) {
    chunks.push({
      id: "mp:summary",
      source: "message_performance",
      text: `Message performance summary: ${summary}`,
    });
  }

  const highlights = Array.isArray(synth.highlights) ? synth.highlights : [];
  for (let i = 0; i < highlights.length; i += 1) {
    const item = clipLines(highlights[i] || "", 280);
    if (!item) continue;
    chunks.push({ id: `mp:highlight:${i + 1}`, source: "message_performance", text: `What worked: ${item}` });
  }

  const patterns = Array.isArray(synth.patterns) ? synth.patterns : [];
  for (let i = 0; i < patterns.length; i += 1) {
    const item = clipLines(patterns[i] || "", 280);
    if (!item) continue;
    chunks.push({ id: `mp:pattern:${i + 1}`, source: "message_performance", text: `What worked: ${item}` });
  }

  const anti = Array.isArray(synth.antiPatterns) ? synth.antiPatterns : [];
  for (let i = 0; i < anti.length; i += 1) {
    const item = clipLines(anti[i] || "", 280);
    if (!item) continue;
    chunks.push({ id: `mp:anti:${i + 1}`, source: "message_performance", text: `Avoid: ${item}` });
  }

  const caveats = Array.isArray(synth.caveats) ? synth.caveats : [];
  for (let i = 0; i < caveats.length; i += 1) {
    const item = clipLines(caveats[i] || "", 240);
    if (!item) continue;
    chunks.push({ id: `mp:caveat:${i + 1}`, source: "message_performance", text: `Caveat: ${item}` });
  }

  const recs = Array.isArray(synth.recommendations) ? synth.recommendations : [];
  let recCount = 0;
  for (let i = 0; i < recs.length; i += 1) {
    const rec: any = recs[i];
    const conf = typeof rec?.confidence === "number" ? rec.confidence : null;
    if (typeof conf === "number" && conf < 0.7) continue;
    const title = clipLines(String(rec?.title || ""), 80);
    const rationale = clipLines(String(rec?.rationale || ""), 180);
    const line = [title ? `Experiment: ${title}` : null, rationale ? `Why: ${rationale}` : null]
      .filter((p): p is string => Boolean(p))
      .join(" — ");
    if (!line) continue;
    recCount += 1;
    chunks.push({ id: `mp:rec:${recCount}`, source: "message_performance", text: line });
    if (recCount >= 10) break;
  }

  return chunks.slice(0, 60);
}

function buildChunksFromInsightsPack(synth: InsightContextPackSynthesis | null): AutoSendOptimizationChunk[] {
  if (!synth) return [];

  const chunks: AutoSendOptimizationChunk[] = [];
  const takeaways = Array.isArray((synth as any).key_takeaways) ? (synth as any).key_takeaways : [];
  const experiments = Array.isArray((synth as any).recommended_experiments) ? (synth as any).recommended_experiments : [];
  const gaps = Array.isArray((synth as any).data_gaps) ? (synth as any).data_gaps : [];

  for (let i = 0; i < takeaways.length; i += 1) {
    const item = clipLines(String(takeaways[i] || ""), 260);
    if (!item) continue;
    chunks.push({ id: `ins:takeaway:${i + 1}`, source: "insights_pack", text: `Insight: ${item}` });
  }

  for (let i = 0; i < experiments.length; i += 1) {
    const item = clipLines(String(experiments[i] || ""), 260);
    if (!item) continue;
    chunks.push({ id: `ins:experiment:${i + 1}`, source: "insights_pack", text: `Experiment: ${item}` });
  }

  for (let i = 0; i < gaps.length; i += 1) {
    const item = clipLines(String(gaps[i] || ""), 220);
    if (!item) continue;
    chunks.push({ id: `ins:gap:${i + 1}`, source: "insights_pack", text: `Missing data: ${item}` });
  }

  return chunks.slice(0, 60);
}

export function rankChunksForSelection(opts: {
  chunks: AutoSendOptimizationChunk[];
  queryText: string;
  maxCandidates: number;
}): AutoSendOptimizationChunk[] {
  const tokens = new Set(tokenizeForOverlap(opts.queryText).slice(0, 60));
  const maxCandidates = Math.max(6, Math.min(60, Math.trunc(opts.maxCandidates)));

  const scored = opts.chunks.map((chunk) => ({
    ...chunk,
    score: scoreChunk(tokens, chunk.text),
  }));

  scored.sort((a, b) => {
    const aScore = typeof a.score === "number" ? a.score : 0;
    const bScore = typeof b.score === "number" ? b.score : 0;
    if (aScore !== bScore) return bScore - aScore;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  const out = scored.slice(0, maxCandidates);
  const hasSummary = out.some((c) => c.id === "mp:summary");
  if (!hasSummary) {
    const summary = scored.find((c) => c.id === "mp:summary");
    if (summary) {
      // Ensure a baseline overview is always available if we have message performance data.
      out.pop();
      out.push(summary);
    }
  }

  // Stable order: keep highest score first.
  out.sort((a, b) => {
    const aScore = typeof a.score === "number" ? a.score : 0;
    const bScore = typeof b.score === "number" ? b.score : 0;
    if (aScore !== bScore) return bScore - aScore;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  return out;
}

async function loadLatestMessagePerformanceSynthesis(opts: {
  clientId: string;
  lookbackDays: number;
  db?: typeof prisma;
  now?: () => Date;
}): Promise<MessagePerformanceSynthesis | null> {
  const db = opts.db ?? prisma;
  const now = opts.now ?? (() => new Date());
  const windowStart = new Date(now().getTime() - opts.lookbackDays * 24 * 60 * 60 * 1000);

  const session = await db.insightChatSession.findFirst({
    where: { clientId: opts.clientId, title: MESSAGE_PERFORMANCE_SESSION_TITLE, deletedAt: null },
    select: { id: true },
  });
  if (!session?.id) return null;

  const pack = await db.insightContextPack.findFirst({
    where: {
      clientId: opts.clientId,
      sessionId: session.id,
      status: "COMPLETE",
      deletedAt: null,
      computedAt: { gte: windowStart },
    },
    orderBy: { computedAt: "desc" },
    select: { synthesis: true },
  });

  if (!pack?.synthesis || !isPlainObject(pack.synthesis)) return null;
  const anySynth: any = pack.synthesis;
  const summary = readString(anySynth.summary);
  const confidence = typeof anySynth.confidence === "number" ? anySynth.confidence : null;
  if (!summary || typeof confidence !== "number") return null;

  return {
    summary,
    highlights: readStringArray(anySynth.highlights),
    patterns: readStringArray(anySynth.patterns),
    antiPatterns: readStringArray(anySynth.antiPatterns),
    recommendations: Array.isArray(anySynth.recommendations) ? anySynth.recommendations : [],
    caveats: readStringArray(anySynth.caveats),
    confidence,
  } as MessagePerformanceSynthesis;
}

async function loadLatestInsightsPackSynthesis(opts: {
  clientId: string;
  emailCampaignId?: string | null;
  lookbackDays: number;
  db?: typeof prisma;
  now?: () => Date;
}): Promise<InsightContextPackSynthesis | null> {
  const db = opts.db ?? prisma;
  const now = opts.now ?? (() => new Date());
  const windowStart = new Date(now().getTime() - opts.lookbackDays * 24 * 60 * 60 * 1000);

  const mpSession = await db.insightChatSession.findFirst({
    where: { clientId: opts.clientId, title: MESSAGE_PERFORMANCE_SESSION_TITLE, deletedAt: null },
    select: { id: true },
  });

  const baseWhere = {
    clientId: opts.clientId,
    status: "COMPLETE" as const,
    deletedAt: null as Date | null,
    computedAt: { gte: windowStart },
    ...(mpSession?.id ? { sessionId: { not: mpSession.id } } : {}),
  };

  if (opts.emailCampaignId) {
    const pack = await db.insightContextPack.findFirst({
      where: {
        ...baseWhere,
        effectiveCampaignIds: { has: opts.emailCampaignId },
      },
      orderBy: { computedAt: "desc" },
      select: { synthesis: true },
    });
    if (pack?.synthesis && isPlainObject(pack.synthesis)) return pack.synthesis as any;
  }

  const pack = await db.insightContextPack.findFirst({
    where: baseWhere,
    orderBy: { computedAt: "desc" },
    select: { synthesis: true },
  });
  if (!pack?.synthesis || !isPlainObject(pack.synthesis)) return null;
  return pack.synthesis as any;
}

function validateSelection(value: unknown, candidateIds: Set<string>): AutoSendOptimizationSelection | null {
  if (!isPlainObject(value)) return null;
  const raw = value as Record<string, unknown>;

  const selectedIds = readStringArray(raw.selected_chunk_ids).slice(0, 8).filter((id) => candidateIds.has(id));
  const selectedContext = readString(raw.selected_context_markdown) ?? "";
  const whatToApply = readStringArray(raw.what_to_apply).slice(0, 10);
  const whatToAvoid = readStringArray(raw.what_to_avoid).slice(0, 10);
  const missing = readStringArray(raw.missing_info).slice(0, 6);
  const confidenceRaw = typeof raw.confidence === "number" ? raw.confidence : 0;

  return {
    selected_chunk_ids: selectedIds,
    selected_context_markdown: redactCommonPii(selectedContext).slice(0, 2500),
    what_to_apply: whatToApply.map((s) => redactCommonPii(s).slice(0, 240)),
    what_to_avoid: whatToAvoid.map((s) => redactCommonPii(s).slice(0, 240)),
    missing_info: missing.map((s) => redactCommonPii(s).slice(0, 240)),
    confidence: clamp01(confidenceRaw),
  };
}

export async function selectAutoSendOptimizationContext(opts: {
  clientId: string;
  leadId?: string | null;
  emailCampaignId?: string | null;
  channel: "email" | "sms" | "linkedin";
  subject?: string | null;
  latestInbound: string;
  draft: string;
  evaluatorReason: string;
  timeoutMs?: number;
  model?: string;
  lookbackDays?: number;
}): Promise<{
  selection: AutoSendOptimizationSelection | null;
  telemetry: {
    chunksConsidered: number;
    candidatesSent: number;
    mpPackPresent: boolean;
    insightsPackPresent: boolean;
  };
}> {
  const lookbackDays = Math.max(1, Math.min(90, Math.trunc(opts.lookbackDays ?? 30)));
  const [mpSynth, insightsSynth] = await Promise.all([
    loadLatestMessagePerformanceSynthesis({ clientId: opts.clientId, lookbackDays }),
    loadLatestInsightsPackSynthesis({ clientId: opts.clientId, emailCampaignId: opts.emailCampaignId ?? null, lookbackDays }),
  ]);

  const mpChunks = buildChunksFromMessagePerformance(mpSynth);
  const insightsChunks = buildChunksFromInsightsPack(insightsSynth);
  const chunks = mpChunks.concat(insightsChunks);

  const chunksConsidered = chunks.length;
  if (chunks.length === 0) {
    return {
      selection: null,
      telemetry: { chunksConsidered, candidatesSent: 0, mpPackPresent: false, insightsPackPresent: false },
    };
  }

  const queryText = [
    `channel:${opts.channel}`,
    (opts.subject || "").trim(),
    (opts.latestInbound || "").trim(),
    (opts.draft || "").trim(),
    (opts.evaluatorReason || "").trim(),
  ]
    .filter(Boolean)
    .join("\n\n");

  const candidates = rankChunksForSelection({ chunks, queryText, maxCandidates: 24 });
  const candidatesSent = candidates.length;
  const candidateIds = new Set(candidates.map((c) => c.id));

  const inputJson = JSON.stringify(
    {
      case: {
        channel: opts.channel,
        subject: (opts.subject || "").slice(0, 300),
        latest_inbound: (opts.latestInbound || "").slice(0, 1600),
        draft: (opts.draft || "").slice(0, 1600),
        evaluator_reason: (opts.evaluatorReason || "").slice(0, 400),
      },
      candidate_chunks: candidates.map((c) => ({
        id: c.id,
        source: c.source,
        text: c.text,
      })),
    },
    null,
    2
  );

  const result = await runStructuredJsonPrompt<AutoSendOptimizationSelection>({
    pattern: "structured_json",
    clientId: opts.clientId,
    leadId: opts.leadId ?? null,
    featureId: "auto_send.context_select",
    promptKey: "auto_send.context_select.v1",
    model: opts.model || "gpt-5-mini",
    reasoningEffort: "low",
    temperature: 0,
    systemFallback:
      "Return ONLY valid JSON with keys: selected_chunk_ids, selected_context_markdown, what_to_apply, what_to_avoid, missing_info, confidence.",
    templateVars: { inputJson },
    schemaName: "auto_send_context_select",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        selected_chunk_ids: { type: "array", items: { type: "string" } },
        selected_context_markdown: { type: "string" },
        what_to_apply: { type: "array", items: { type: "string" } },
        what_to_avoid: { type: "array", items: { type: "string" } },
        missing_info: { type: "array", items: { type: "string" } },
        confidence: { type: "number", minimum: 0, maximum: 1 },
      },
      required: [
        "selected_chunk_ids",
        "selected_context_markdown",
        "what_to_apply",
        "what_to_avoid",
        "missing_info",
        "confidence",
      ],
    },
    budget: {
      min: 220,
      max: 900,
      retryMax: 1400,
      overheadTokens: 420,
      outputScale: 0.22,
      preferApiCount: true,
    },
    timeoutMs: typeof opts.timeoutMs === "number" ? Math.max(1_000, Math.trunc(opts.timeoutMs)) : 10_000,
    maxRetries: 0,
    metadata: {
      autoSendRevision: {
        stage: "context_select",
        chunksConsidered,
        candidatesSent,
        mpPackPresent: Boolean(mpSynth),
        insightsPackPresent: Boolean(insightsSynth),
      },
    },
    validate: (value) => {
      const validated = validateSelection(value, candidateIds);
      if (!validated) return { success: false, error: "Invalid selection output" };
      return { success: true, data: validated };
    },
  });

  return {
    selection: result.success ? result.data : null,
    telemetry: {
      chunksConsidered,
      candidatesSent,
      mpPackPresent: Boolean(mpSynth),
      insightsPackPresent: Boolean(insightsSynth),
    },
  };
}

