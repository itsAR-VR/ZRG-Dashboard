/**
 * Re-run sentiment analysis for leads that are currently tagged "Neutral" or "New"
 * across ALL workspaces, with resumable progress tracking.
 *
 * Why:
 * - "Neutral" and "New" are often "catch-all" states and can become stale.
 * - This script re-evaluates sentiment using the current sentiment prompt template
 *   (`sentiment.classify.v1`) + `lib/sentiment-shared` mappings.
 *
 * Run:
 *   npx tsx scripts/rerun-sentiment-neutral-or-new.ts --dry-run --resume
 *   npx tsx scripts/rerun-sentiment-neutral-or-new.ts --apply --resume
 *   npx tsx scripts/rerun-sentiment-neutral-or-new.ts --apply --client-id <workspaceId> --resume
 *
 * Options:
 *   --tags "Neutral,New"     Override target tags (CSV, case-insensitive)
 *   --include-null           Also include leads with `sentimentTag = null`
 *   --page-size 200          Leads fetched per page (per workspace)
 *   --lead-concurrency 5     Concurrent lead processing (per workspace)
 *   --client-concurrency 1   Concurrent workspace processing
 *   --max-leads 5000         Global cap (across all workspaces)
 *   --state-file <path>      Resume state file path
 *
 * Env:
 *   DATABASE_URL                required
 *   OPENAI_API_KEY              recommended (AI classification)
 *   OPENAI_SENTIMENT_TIMEOUT_MS optional
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

import { PrismaClient, type Lead } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

import OpenAI from "openai";

import { SENTIMENT_CLASSIFY_V1_SYSTEM, SENTIMENT_CLASSIFY_V1_USER_TEMPLATE } from "../lib/ai/prompts/sentiment-classify-v1";
import { isPositiveSentiment, SENTIMENT_TAGS, SENTIMENT_TO_STATUS, type SentimentTag } from "../lib/sentiment-shared";

type Args = {
  clientId?: string;
  dryRun: boolean;
  pageSize: number;
  leadConcurrency: number;
  clientConcurrency: number;
  maxLeads: number;
  resume: boolean;
  stateFile: string;
  tags: SentimentTag[];
  includeNull: boolean;
};

type ScriptState = Record<string, { lastLeadId?: string }>;

function parseArgs(argv: string[]): Args {
  const args: Args = {
    clientId: undefined,
    dryRun: true,
    pageSize: 200,
    leadConcurrency: 5,
    clientConcurrency: 1,
    maxLeads: Number.POSITIVE_INFINITY,
    resume: false,
    stateFile: ".rerun-sentiment-neutral-or-new.state.json",
    tags: ["Neutral", "New"],
    includeNull: false,
  };

  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--clientId" || a === "--client-id") args.clientId = argv[++i];
    else if (a === "--dry-run" || a === "--dryRun") args.dryRun = true;
    else if (a === "--apply") args.dryRun = false;
    else if (a === "--page-size" || a === "--pageSize") args.pageSize = Number(argv[++i] || "0") || args.pageSize;
    else if (a === "--lead-concurrency" || a === "--leadConcurrency") {
      args.leadConcurrency = Number(argv[++i] || "0") || args.leadConcurrency;
    } else if (a === "--client-concurrency" || a === "--clientConcurrency") {
      args.clientConcurrency = Number(argv[++i] || "0") || args.clientConcurrency;
    } else if (a === "--max-leads" || a === "--maxLeads") {
      const parsed = Number(argv[++i] || "");
      if (Number.isFinite(parsed) && parsed > 0) args.maxLeads = parsed;
    } else if (a === "--resume") args.resume = true;
    else if (a === "--state-file" || a === "--stateFile") args.stateFile = argv[++i] || args.stateFile;
    else if (a === "--tags") args.tags = parseTags(argv[++i] || "", args.tags);
    else if (a === "--include-null" || a === "--includeNull") args.includeNull = true;
  }

  args.pageSize = Math.max(1, Math.floor(args.pageSize));
  args.leadConcurrency = Math.max(1, Math.floor(args.leadConcurrency));
  args.clientConcurrency = Math.max(1, Math.floor(args.clientConcurrency));
  return args;
}

function parseTags(raw: string, fallback: SentimentTag[]): SentimentTag[] {
  const parts = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length === 0) return fallback;

  const parsed: SentimentTag[] = [];
  for (const p of parts) {
    const exact = SENTIMENT_TAGS.find((t) => t.toLowerCase() === p.toLowerCase());
    if (!exact) {
      throw new Error(`Unknown sentiment tag in --tags: ${p}`);
    }
    parsed.push(exact);
  }

  return Array.from(new Set(parsed));
}

async function readState(path: string): Promise<ScriptState> {
  try {
    const fs = await import("node:fs/promises");
    const raw = await fs.readFile(path, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as ScriptState;
  } catch {
    return {};
  }
}

async function writeState(path: string, state: ScriptState): Promise<void> {
  const fs = await import("node:fs/promises");
  await fs.writeFile(path, JSON.stringify(state, null, 2));
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, idx: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let idx = 0;

  const workers = new Array(Math.min(concurrency, items.length)).fill(0).map(async () => {
    while (true) {
      const current = idx++;
      if (current >= items.length) return;
      results[current] = await fn(items[current], current);
    }
  });

  await Promise.all(workers);
  return results;
}

function isBounceEmailAddress(email: string | null | undefined): boolean {
  if (!email) return false;
  const lowerEmail = email.toLowerCase();
  return (
    lowerEmail.includes("mailer-daemon") ||
    lowerEmail.includes("postmaster") ||
    lowerEmail.includes("mail-delivery") ||
    lowerEmail.includes("maildelivery") ||
    (lowerEmail.includes("noreply") && lowerEmail.includes("google")) ||
    lowerEmail.startsWith("bounce") ||
    lowerEmail.includes("mail delivery subsystem")
  );
}

function shouldGenerateDraft(sentimentTag: string, email?: string | null): boolean {
  if (isBounceEmailAddress(email)) {
    return false;
  }

  const normalized = sentimentTag === "Positive" ? "Interested" : sentimentTag;
  return normalized === "Follow Up" || isPositiveSentiment(normalized);
}

function preClassifySentiment(messages: { direction: string }[]): SentimentTag | null {
  if (messages.length === 0) return "New";
  const hasInbound = messages.some((m) => m.direction === "inbound");
  if (!hasInbound) return "New";
  return null;
}

// ============================================================================
// Minimal sentiment helpers for scripts (no "@/..." imports)
// ============================================================================

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const BOUNCE_PATTERNS = [
  /mail delivery (failed|failure|subsystem)/i,
  /delivery status notification/i,
  /undeliverable/i,
  /address not found/i,
  /user unknown/i,
  /mailbox (full|unavailable|not found)/i,
  /quota exceeded/i,
  /does not exist/i,
  /rejected/i,
  /access denied/i,
  /blocked/i,
  /spam/i,
  /mailer-daemon/i,
  /postmaster/i,
  /550[\s-]/i,
  /554[\s-]/i,
  /the email account.*does not exist/i,
  /undelivered mail returned to sender/i,
  /message could not be delivered/i,
  /\b(email|mailbox|inbox)\b.*\b(no longer (in use|used|active)|not (in use|used|active)|inactive|not monitored|no longer monitored|unmanned|unattended)\b/i,
  /\b(email address|this address)\b.*\b(no longer (in use|used|active)|inactive|not monitored|no longer monitored)\b/i,
  /\b(this|the)\s+(email|inbox|mailbox)\b.*\b(no longer (exists|in use|used)|not monitored|unmanned|unattended)\b/i,
  /\b(please|kindly)\s+(do not|don['’]?t)\s+(email|reply)\b.*\b(this|the)\b/i,
  /\b(address|account)\b.*\b(no longer (associated|available)|has been (deactivated|disabled))\b/i,
] as const;

function matchesAnyPattern(patterns: readonly RegExp[], text: string): boolean {
  for (const pattern of patterns) {
    if (pattern.test(text)) return true;
  }
  return false;
}

function stripCommonPunctuation(text: string): string {
  return (text || "").replace(/^[\s"'`*()\-–—_:;,.!?]+|[\s"'`*()\-–—_:;,.!?]+$/g, "").trim();
}

function isOptOutText(text: string): boolean {
  const combined = (text || "").replace(/\u00a0/g, " ").trim();
  if (!combined) return false;

  const normalizedCombined = stripCommonPunctuation(combined).toLowerCase();
  if (["stop", "unsubscribe", "optout", "opt out"].includes(normalizedCombined)) return true;

  const strongOptOut =
    /\b(unsubscribe|opt\s*-?\s*out|remove me|remove us|take me off|take us off|stop (emailing|calling|contacting|messaging|texting)|do not (contact|email|call|text)|don['’]?t (contact|email|call|text)|take a hike|stop)\b/i;
  if (!strongOptOut.test(combined)) return false;

  // Reduce false positives for "stop" in benign phrases like "stop by".
  if (!/\bstop\b/i.test(combined)) return true;
  const stopHasContext =
    /\bstop\b/i.test(combined) && /\b(text|txt|message|messages|messaging|contact|email|calling|call)\b/i.test(combined);
  return stopHasContext || normalizedCombined === "stop";
}

function detectBounce(messages: { body: string; direction: string; channel?: string | null }[]): boolean {
  // Only treat it as a bounce if the MOST RECENT inbound message is an email bounce.
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.direction !== "inbound") continue;
    if (msg.channel && msg.channel !== "email") return false;
    const body = (msg.body || "").toLowerCase();
    return matchesAnyPattern(BOUNCE_PATTERNS, body);
  }

  return false;
}

type TranscriptMessage = {
  sentAt: Date | string;
  channel?: string | null;
  direction: "inbound" | "outbound" | string;
  body: string;
  subject?: string | null;
};

function serializeOneLine(text: string): string {
  const raw = (text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  return raw.trim().replace(/\n/g, "\\n");
}

function buildSentimentTranscriptFromMessages(messages: TranscriptMessage[]): string {
  return messages
    .filter((m) => (m.body || "").trim().length > 0)
    .map((m) => {
      const sentAt = typeof m.sentAt === "string" ? new Date(m.sentAt) : m.sentAt;
      const ts = sentAt instanceof Date && !isNaN(sentAt.getTime()) ? sentAt.toISOString() : String(m.sentAt);
      const channel = (m.channel || "sms").toString().toLowerCase();
      const direction = m.direction === "inbound" ? "IN" : "OUT";
      const speaker = m.direction === "inbound" ? "Lead" : "Agent";
      const subjectPrefix = channel === "email" && m.subject ? `Subject: ${serializeOneLine(m.subject)} | ` : "";
      return `[${ts}] [${channel} ${direction}] ${speaker}: ${subjectPrefix}${serializeOneLine(m.body)}`;
    })
    .join("\n");
}

function extractJsonObjectFromText(text: string): string {
  const s = (text || "").trim();
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return s;
  return s.slice(start, end + 1);
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function classifySentimentWithRetry(
  transcript: string,
  opts: { clientId: string; leadId: string; maxRetries?: number }
): Promise<SentimentTag> {
  if (!transcript || !process.env.OPENAI_API_KEY) {
    return "Neutral";
  }

  const systemPrompt = SENTIMENT_CLASSIFY_V1_SYSTEM;
  const userPrompt = SENTIMENT_CLASSIFY_V1_USER_TEMPLATE.replace("{{transcript}}", transcript);

  const enumTags = SENTIMENT_TAGS.filter((t) => t !== "New" && t !== "Snoozed");
  const maxRetries = opts.maxRetries ?? 3;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const timeoutMs = Math.max(
        5_000,
        Number.parseInt(process.env.OPENAI_SENTIMENT_TIMEOUT_MS || "25000", 10) || 25_000
      );

      const response = await openai.responses.create(
        {
          model: "gpt-5-mini",
          instructions: systemPrompt,
          input: userPrompt,
          reasoning: { effort: "low" },
          max_output_tokens: Math.min(600 + (attempt - 1) * 400, 2000),
          text: {
            verbosity: "low",
            format: {
              type: "json_schema",
              name: "sentiment_classification",
              strict: true,
              schema: {
                type: "object",
                additionalProperties: false,
                properties: {
                  classification: { type: "string", enum: enumTags },
                },
                required: ["classification"],
              },
            },
          },
        },
        { timeout: timeoutMs }
      );

      const raw = response.output_text?.trim() || "";
      const jsonText = extractJsonObjectFromText(raw);
      const parsed = JSON.parse(jsonText) as { classification?: string };
      const cleaned = String(parsed?.classification || "").trim();

      const exact = enumTags.find((tag) => tag.toLowerCase() === cleaned.toLowerCase());
      if (exact) return exact;

      if (attempt < maxRetries) continue;
      return "Neutral";
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const isRetryable =
        message.includes("500") || message.includes("503") || message.toLowerCase().includes("rate") || message.toLowerCase().includes("timeout");

      if (isRetryable && attempt < maxRetries) {
        await sleep(Math.pow(2, attempt) * 1000);
        continue;
      }

      return "Neutral";
    }
  }

  return "Neutral";
}

async function computeSentimentFromMessages(
  messages: { body: string; direction: string; channel?: string | null; subject?: string | null; sentAt: Date }[],
  opts: { clientId: string; leadId: string }
): Promise<SentimentTag> {
  const pre = preClassifySentiment(messages);
  if (pre !== null) return pre;

  if (detectBounce(messages)) {
    return "Blacklist";
  }

  const lastInbound = [...messages].reverse().find((m) => m.direction === "inbound");
  if (lastInbound?.body && isOptOutText(lastInbound.body)) {
    return "Blacklist";
  }

  const transcript = buildSentimentTranscriptFromMessages(messages.slice(-80));
  if (!transcript.trim()) return "Neutral";

  return classifySentimentWithRetry(transcript, { clientId: opts.clientId, leadId: opts.leadId });
}

type ClientRow = { id: string; name: string };

type LeadRow = Pick<
  Lead,
  | "id"
  | "clientId"
  | "email"
  | "sentimentTag"
  | "status"
  | "enrichmentStatus"
  | "lastInboundAt"
  | "lastOutboundAt"
  | "lastMessageAt"
  | "lastMessageDirection"
>;

type LeadResult = {
  scanned: number;
  updated: number;
  sentimentChanged: number;
  draftsRejected: number;
  errors: number;
};

async function rerunOneLead(opts: {
  prisma: PrismaClient;
  lead: LeadRow;
  client: ClientRow;
  dryRun: boolean;
}): Promise<{ changed: boolean; sentimentChanged: boolean; draftsRejected: number; error?: string }> {
  const { prisma, lead, client, dryRun } = opts;

  const messages = await prisma.message.findMany({
    where: { leadId: lead.id },
    select: { body: true, direction: true, channel: true, subject: true, sentAt: true },
    orderBy: { sentAt: "asc" },
  });

  const sentimentTag = await computeSentimentFromMessages(messages, { clientId: client.id, leadId: lead.id });
  const status = SENTIMENT_TO_STATUS[sentimentTag] || "new";

  const lastMessage = messages.length > 0 ? messages[messages.length - 1] : null;
  let lastInboundAt: Date | null = null;
  let lastOutboundAt: Date | null = null;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (!lastInboundAt && msg.direction === "inbound") lastInboundAt = msg.sentAt;
    if (!lastOutboundAt && msg.direction === "outbound") lastOutboundAt = msg.sentAt;
    if (lastInboundAt && lastOutboundAt) break;
  }

  const nextLastMessageAt = lastMessage?.sentAt ?? null;
  const nextLastMessageDirection = (lastMessage?.direction as string | undefined) ?? null;

  const sentimentChanged = String(lead.sentimentTag || "") !== sentimentTag;
  const statusChanged = (lead.status || "") !== status;
  const rollupsChanged =
    (lead.lastInboundAt?.getTime() ?? null) !== (lastInboundAt?.getTime() ?? null) ||
    (lead.lastOutboundAt?.getTime() ?? null) !== (lastOutboundAt?.getTime() ?? null) ||
    (lead.lastMessageAt?.getTime() ?? null) !== (nextLastMessageAt?.getTime() ?? null) ||
    (lead.lastMessageDirection || null) !== nextLastMessageDirection;

  const shouldUpdateLead = sentimentChanged || statusChanged || rollupsChanged;

  let draftsRejected = 0;

  if (!dryRun) {
    if (shouldUpdateLead) {
      await prisma.lead.update({
        where: { id: lead.id },
        data: {
          sentimentTag,
          status,
          lastInboundAt,
          lastOutboundAt,
          lastMessageAt: nextLastMessageAt,
          lastMessageDirection: nextLastMessageDirection,
        },
      });
    }

    if (!isPositiveSentiment(sentimentTag)) {
      await prisma.lead.updateMany({
        where: { id: lead.id, enrichmentStatus: "pending" },
        data: { enrichmentStatus: "not_needed" },
      });
    }

    if (!shouldGenerateDraft(sentimentTag, lead.email)) {
      const res = await prisma.aIDraft.updateMany({
        where: { leadId: lead.id, status: "pending" },
        data: { status: "rejected" },
      });
      draftsRejected = res.count || 0;
    }
  }

  if (sentimentChanged || statusChanged) {
    console.log(
      `[Sentiment] [${client.name}] ${lead.id}: ${(lead.sentimentTag || "null").toString()} → ${sentimentTag} (status ${lead.status} → ${status})${dryRun ? " [dry-run]" : ""}`
    );
  }

  if (draftsRejected > 0) {
    console.log(`[Drafts] [${client.name}] ${lead.id}: rejected ${draftsRejected} pending draft(s)`);
  }

  return { changed: shouldUpdateLead, sentimentChanged, draftsRejected };
}

async function main() {
  const args = parseArgs(process.argv);
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required");
  }

  if (!process.env.OPENAI_API_KEY) {
    console.warn("[Sentiment] OPENAI_API_KEY is not set; inbound leads will likely remain Neutral.");
  }

  const adapter = new PrismaPg({ connectionString });
  const prisma = new PrismaClient({ adapter });

  const state = args.resume ? await readState(args.stateFile) : {};
  let stateWriteChain = Promise.resolve();
  const queueWriteState = async () => {
    if (!args.resume) return;
    stateWriteChain = stateWriteChain
      .catch(() => undefined)
      .then(() => writeState(args.stateFile, state))
      .catch(() => undefined);
    await stateWriteChain;
  };

  const clients = await prisma.client.findMany({
    where: args.clientId ? { id: args.clientId } : {},
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  console.log(
    `[Sentiment] Starting (dryRun=${args.dryRun}) for ${clients.length} workspace(s) (tags=${args.tags.join(
      ","
    )}${args.includeNull ? ",(null)" : ""}; pageSize=${args.pageSize}; leadConcurrency=${args.leadConcurrency}; clientConcurrency=${args.clientConcurrency})`
  );

  let remaining = args.maxLeads;
  let remainingChain = Promise.resolve();

  const reserveLeads = async (requested: number): Promise<number> => {
    if (!Number.isFinite(remaining)) return requested;
    const r = Math.max(0, Math.floor(requested));
    const p = remainingChain.then(() => {
      const granted = Math.min(r, remaining);
      remaining -= granted;
      return granted;
    });
    remainingChain = p.then(
      () => undefined,
      () => undefined
    );
    return p;
  };

  const releaseLeads = async (count: number): Promise<void> => {
    if (!Number.isFinite(remaining)) return;
    const r = Math.max(0, Math.floor(count));
    if (!r) return;
    const p = remainingChain.then(() => {
      remaining += r;
    });
    remainingChain = p.then(
      () => undefined,
      () => undefined
    );
    await p;
  };

  const totals: LeadResult = { scanned: 0, updated: 0, sentimentChanged: 0, draftsRejected: 0, errors: 0 };

  await mapWithConcurrency(clients as ClientRow[], args.clientConcurrency, async (client) => {
    const clientState = state[client.id] || {};
    let lastId = args.resume ? clientState.lastLeadId : undefined;

    const clientTotals: LeadResult = { scanned: 0, updated: 0, sentimentChanged: 0, draftsRejected: 0, errors: 0 };
    console.log(`[Sentiment] Workspace ${client.name} (${client.id}) starting${lastId ? ` (resume after ${lastId})` : ""}`);

    while (true) {
      const take = await reserveLeads(args.pageSize);
      if (take <= 0) break;

      const tagFilter = args.includeNull
        ? { OR: [{ sentimentTag: { in: args.tags as any } }, { sentimentTag: null }] }
        : { sentimentTag: { in: args.tags as any } };

      const leads = await prisma.lead.findMany({
        where: {
          clientId: client.id,
          ...(lastId ? { id: { gt: lastId } } : {}),
          ...(tagFilter as any),
        },
        orderBy: { id: "asc" },
        take,
        select: {
          id: true,
          clientId: true,
          email: true,
          sentimentTag: true,
          status: true,
          enrichmentStatus: true,
          lastInboundAt: true,
          lastOutboundAt: true,
          lastMessageAt: true,
          lastMessageDirection: true,
        },
      });

      if (leads.length === 0) {
        await releaseLeads(take);
        break;
      }

      lastId = leads[leads.length - 1].id;
      if (leads.length < take) {
        await releaseLeads(take - leads.length);
      }

      clientTotals.scanned += leads.length;
      totals.scanned += leads.length;

      const results = await mapWithConcurrency(leads as LeadRow[], args.leadConcurrency, async (lead) => {
        try {
          return await rerunOneLead({ prisma, lead, client, dryRun: args.dryRun });
        } catch (error) {
          return { changed: false, sentimentChanged: false, draftsRejected: 0, error: error instanceof Error ? error.message : "Unknown error" };
        }
      });

      for (const r of results) {
        if (r.error) {
          clientTotals.errors++;
          totals.errors++;
          continue;
        }
        if (r.changed) {
          clientTotals.updated++;
          totals.updated++;
        }
        if (r.sentimentChanged) {
          clientTotals.sentimentChanged++;
          totals.sentimentChanged++;
        }
        if (r.draftsRejected > 0) {
          clientTotals.draftsRejected += r.draftsRejected;
          totals.draftsRejected += r.draftsRejected;
        }
      }

      state[client.id] = { lastLeadId: lastId };
      await queueWriteState();

      console.log(
        `[Sentiment] Workspace ${client.name} progress: scanned=${clientTotals.scanned} updated=${clientTotals.updated} sentimentChanged=${clientTotals.sentimentChanged} draftsRejected=${clientTotals.draftsRejected} errors=${clientTotals.errors}`
      );
    }

    console.log(
      `[Sentiment] Workspace ${client.name} done: scanned=${clientTotals.scanned} updated=${clientTotals.updated} sentimentChanged=${clientTotals.sentimentChanged} draftsRejected=${clientTotals.draftsRejected} errors=${clientTotals.errors}`
    );
  });

  console.log(
    `[Sentiment] Done: scanned=${totals.scanned} updated=${totals.updated} sentimentChanged=${totals.sentimentChanged} draftsRejected=${totals.draftsRejected} errors=${totals.errors}`
  );

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("[Sentiment] Fatal:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
