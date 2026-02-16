import "server-only";

import { prisma, isPrismaUniqueConstraintError } from "@/lib/prisma";
import { extractSchedulerLinkFromText } from "@/lib/scheduling-link";
import { isPositiveSentiment } from "@/lib/sentiment-shared";
import { slackPostMessage } from "@/lib/slack-bot";
import { getPublicAppUrl } from "@/lib/app-url";
import { runStructuredJsonPrompt } from "@/lib/ai/prompt-runner";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ActionSignalType = "call_requested" | "book_on_external_calendar";

export type ActionSignal = {
  type: ActionSignalType;
  confidence: "high" | "medium";
  evidence: string;
};

export type ActionSignalChannel =
  | "email"
  | "sms"
  | "linkedin"
  | "smartlead"
  | "instantly"
  | "emailbison"
  | "ghl"
  | "unipile"
  | "unknown";

export type BookingProcessId = 1 | 2 | 3 | 4 | 5;

export type BookingProcessRoute = {
  processId: BookingProcessId;
  confidence: number;
  rationale: string;
  uncertain: boolean;
};

export type ActionSignalDetectionResult = {
  signals: ActionSignal[];
  hasCallSignal: boolean;
  hasExternalCalendarSignal: boolean;
  route: BookingProcessRoute | null;
};

type SignatureDisambiguationResult = { intentional: boolean; evidence: string };
type SignatureDisambiguationFn = (opts: {
  strippedText: string;
  fullText: string;
  clientId: string;
  leadId?: string | null;
}) => Promise<SignatureDisambiguationResult | null>;

type BookingProcessRoutingFn = (opts: {
  strippedText: string;
  fullText: string;
  sentimentTag: string | null;
  workspaceBookingLink: string | null;
  clientId: string;
  leadId?: string | null;
  hasCallSignal: boolean;
  hasExternalCalendarSignal: boolean;
  channel?: ActionSignalChannel;
  provider?: string | null;
}) => Promise<BookingProcessRoute | null>;

type BookingProcessRoutingOutcome = {
  route: BookingProcessRoute | null;
  reason:
    | "routed"
    | "disabled_by_workspace_settings"
    | "non_positive_sentiment"
    | "router_parse_error"
    | "router_schema_violation"
    | "router_timeout"
    | "router_rate_limit"
    | "router_api_error"
    | "router_unknown";
};

export const EMPTY_ACTION_SIGNAL_RESULT: ActionSignalDetectionResult = {
  signals: [],
  hasCallSignal: false,
  hasExternalCalendarSignal: false,
  route: null,
};

export function hasActionSignal(
  result: ActionSignalDetectionResult | null | undefined,
  type: "call_requested" | "book_on_external_calendar"
): boolean {
  return Boolean(result?.signals?.some((signal) => signal.type === type));
}

export function hasActionSignalOrRoute(result: ActionSignalDetectionResult | null | undefined): boolean {
  return Boolean(result?.signals?.length || result?.route);
}

export function buildActionSignalsGateSummary(result: ActionSignalDetectionResult | null | undefined): string | null {
  if (!hasActionSignalOrRoute(result)) return null;
  if (!result) return null;

  const evidence = result.signals
    .map((signal) => `${signal.type}:${signal.evidence}`)
    .slice(0, 3)
    .join(" | ");

  return [
    `call_requested: ${hasActionSignal(result, "call_requested") ? "true" : "false"}`,
    `book_on_external_calendar: ${hasActionSignal(result, "book_on_external_calendar") ? "true" : "false"}`,
    result.route ? `route_process: ${result.route.processId}` : null,
    result.route ? `route_confidence: ${result.route.confidence}` : null,
    result.route ? `route_uncertain: ${result.route.uncertain ? "true" : "false"}` : null,
    result.route?.rationale ? `route_rationale: ${result.route.rationale}` : null,
    evidence ? `evidence: ${evidence}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

// ---------------------------------------------------------------------------
// Tier 1: Call signal heuristic (pure — no I/O)
// ---------------------------------------------------------------------------

const CALL_KEYWORD_PATTERNS = [
  /\bcall\s+me\b/i,
  /\bgive\s+me\s+a\s+(ring|call|buzz)\b/i,
  /\bcan\s+you\s+call\b/i,
  /\bhop\s+on\s+a\s+call\b/i,
  /\bprefer\s+a\s+call\b/i,
  /\bspeak\s+on\s+the\s+phone\b/i,
  /\bphone\s+(call|conversation)\b/i,
  /\breach\s+me\s+at\s+\(?\d{3}\)?\s*[-.]?\s*\d{3}\b/i,
];

export function detectCallSignalHeuristic(
  strippedText: string,
  sentimentTag: string | null,
): ActionSignal | null {
  if (sentimentTag === "Call Requested") {
    return { type: "call_requested", confidence: "high", evidence: "Sentiment classified as Call Requested" };
  }

  const text = (strippedText || "").trim();
  if (!text) return null;

  for (const pattern of CALL_KEYWORD_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      return { type: "call_requested", confidence: "medium", evidence: `Keyword match: "${match[0]}"` };
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Tier 1: External calendar heuristic (pure — no I/O)
// ---------------------------------------------------------------------------

const EXTERNAL_CALENDAR_PHRASE_PATTERNS = [
  /\bbook\s+on\s+(my|their)\s+calendar\b/i,
  /\buse\s+(my|their)\s+calendly\b/i,
  /\bhere(?:'s| is)\s+my\s+(scheduling|calendly|calendar)\s+link\b/i,
  /\bbook\s+with\s+my\s+(colleague|manager|director)\b/i,
  /\bschedule\s+with\s+my\s+(colleague|manager|director)\b/i,
];

function normalizeBookingLink(link: string | null): string | null {
  if (!link) return null;
  try {
    const url = new URL(link);
    return url.origin + url.pathname.replace(/\/+$/, "").toLowerCase();
  } catch {
    return link.toLowerCase().replace(/\/+$/, "");
  }
}

export function detectExternalCalendarHeuristic(
  strippedText: string,
  workspaceBookingLink: string | null,
): ActionSignal | null {
  const text = (strippedText || "").trim();
  if (!text) return null;

  // Check for an actual scheduling URL in body text (already stripped of signature)
  const bodyLink = extractSchedulerLinkFromText(text);
  if (bodyLink) {
    const normalizedBody = normalizeBookingLink(bodyLink);
    const normalizedWorkspace = normalizeBookingLink(workspaceBookingLink);
    if (normalizedBody !== normalizedWorkspace) {
      return { type: "book_on_external_calendar", confidence: "high", evidence: `Scheduling link in body: ${bodyLink}` };
    }
    // Link matches workspace's own link — not external
    return null;
  }

  // Check phrase patterns
  for (const pattern of EXTERNAL_CALENDAR_PHRASE_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      return { type: "book_on_external_calendar", confidence: "medium", evidence: `Phrase match: "${match[0]}"` };
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Tier 2: AI disambiguation for signature links (gpt-5-nano)
// ---------------------------------------------------------------------------

const SCHEDULING_LANGUAGE_PRE_FILTER =
  /\b(book|schedule|calendar|meeting|availability|slot|time)\b/i;
const DISAMBIGUATION_INPUT_MAX_CHARS = 4000;
const BOOKING_PROCESS_ROUTER_INPUT_MAX_CHARS = 6000;
const BOOKING_PROCESS_ROUTER_TIMEOUT_MS = 4_000;

const ACTION_SIGNAL_ROUTE_BOOKING_PROCESS_SYSTEM = `Classify the inbound message into exactly one booking process ID.

Return JSON only with:
- processId: integer 1..5
- confidence: number 0..1
- rationale: short reason
- uncertain: boolean

Process taxonomy:
1 = Link + Qualification (lead needs qualification/context before final booking).
2 = Initial Email Times / Offered Slots (lead is responding to offered availability windows).
3 = Lead Proposes Times (lead suggests a specific time/day for scheduling).
4 = Call Requested (lead wants a phone call).
5 = Lead-Provided Scheduler Link (lead asks us to use their own calendar link).

Rules:
- Pick exactly one process ID.
- Use process 4 for explicit call intent.
- Use process 5 when lead explicitly directs to their own scheduling link.
- If intent is ambiguous between 1/2/3, choose the best fit and set uncertain=true when needed.`;

const ACTION_SIGNAL_DETECT_SYSTEM = `You are analyzing an email reply to determine if the sender is actively directing us to book a meeting via a specific scheduling link found in their email signature, or if the link is just passive contact information.

Analyze the email body text. Consider:
1. Does the body text reference scheduling, booking, or meeting?
2. Is there language that directs the recipient to use a link (even if the link itself is in the signature)?
3. Is the email just a generic reply that happens to have a scheduling link in the signature?

Return JSON only.`;

export async function disambiguateSignatureSchedulerLink(opts: {
  strippedText: string;
  fullText: string;
  clientId: string;
  leadId?: string | null;
}): Promise<SignatureDisambiguationResult | null> {
  const strippedText = opts.strippedText.slice(0, DISAMBIGUATION_INPUT_MAX_CHARS);
  const fullText = opts.fullText.slice(0, DISAMBIGUATION_INPUT_MAX_CHARS);
  try {
    const result = await runStructuredJsonPrompt<SignatureDisambiguationResult>({
      pattern: "structured_json",
      clientId: opts.clientId,
      leadId: opts.leadId ?? null,
      featureId: "action_signal.detect",
      promptKey: "action_signal.detect.v1",
      model: "gpt-5-nano",
      reasoningEffort: "minimal",
      systemFallback: ACTION_SIGNAL_DETECT_SYSTEM,
      input: `Email body (signature stripped):\n${strippedText}\n\nFull email (includes signature):\n${fullText}`,
      schemaName: "action_signal_disambiguation",
      strict: true,
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          intentional: { type: "boolean" },
          evidence: { type: "string" },
        },
        required: ["intentional", "evidence"],
      },
      budget: { min: 100, max: 300 },
      maxAttempts: 1,
    });

    if (!result.success) return null;
    return result.data;
  } catch {
    return null; // Fail-safe: never block pipeline
  }
}

export function shouldRunSignatureLinkDisambiguation(strippedText: string, fullText: string): boolean {
  const fullTextLink = extractSchedulerLinkFromText(fullText || "");
  if (!fullTextLink) return false;

  const strippedTextLink = extractSchedulerLinkFromText(strippedText || "");
  if (strippedTextLink) return false;

  return SCHEDULING_LANGUAGE_PRE_FILTER.test(strippedText || "");
}

function isBookingProcessId(value: unknown): value is BookingProcessId {
  return value === 1 || value === 2 || value === 3 || value === 4 || value === 5;
}

function clampConfidence(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function normalizeBookingProcessRoute(value: unknown): BookingProcessRoute | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (!isBookingProcessId(candidate.processId)) return null;
  const rationaleRaw = typeof candidate.rationale === "string" ? candidate.rationale.trim() : "";
  const rationale = rationaleRaw.slice(0, 300) || "No rationale provided";
  return {
    processId: candidate.processId,
    confidence: clampConfidence(candidate.confidence),
    rationale,
    uncertain: Boolean(candidate.uncertain),
  };
}

async function recordBookingProcessRouteOutcome(opts: {
  clientId: string;
  leadId: string;
  sentimentTag: string | null;
  channel?: ActionSignalChannel;
  provider?: string | null;
  reason: BookingProcessRoutingOutcome["reason"];
  route: BookingProcessRoute | null;
  hasCallSignal: boolean;
  hasExternalCalendarSignal: boolean;
}): Promise<void> {
  if (
    process.env.NODE_ENV === "test" ||
    process.env.OPENAI_API_KEY === "test" ||
    process.env.ACTION_SIGNAL_ROUTE_OUTCOME_TELEMETRY_ENABLED === "false"
  ) {
    return;
  }
  try {
    await prisma.aIInteraction.create({
      data: {
        clientId: opts.clientId,
        leadId: opts.leadId,
        source: "action:action_signal_detector",
        featureId: "action_signal.route_booking_process",
        promptKey: "action_signal.route_booking_process.outcome.v1",
        model: "system",
        apiType: "responses",
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        latencyMs: 0,
        status: "success",
        metadata: {
          routeOutcome: {
            reason: opts.reason,
            sentimentTag: opts.sentimentTag,
            channel: opts.channel ?? null,
            provider: opts.provider ?? null,
            hasCallSignal: opts.hasCallSignal,
            hasExternalCalendarSignal: opts.hasExternalCalendarSignal,
            processId: opts.route?.processId ?? null,
            confidence: opts.route?.confidence ?? null,
            uncertain: opts.route?.uncertain ?? null,
          },
        },
      },
    });
  } catch (error) {
    console.warn("[ActionSignalDetector] Failed to record route outcome telemetry:", error);
  }
}

export async function routeBookingProcessWithAi(opts: {
  strippedText: string;
  fullText: string;
  sentimentTag: string | null;
  workspaceBookingLink: string | null;
  clientId: string;
  leadId?: string | null;
  hasCallSignal: boolean;
  hasExternalCalendarSignal: boolean;
  channel?: ActionSignalChannel;
  provider?: string | null;
}): Promise<BookingProcessRoutingOutcome> {
  try {
    const payloadLines = [
      `Channel: ${opts.channel ?? "unknown"}`,
      `Provider: ${opts.provider ?? "unknown"}`,
      `Sentiment: ${opts.sentimentTag ?? "unknown"}`,
    ];

    if (opts.hasCallSignal) {
      payloadLines.push("Has call signal: true");
    }
    if (opts.hasExternalCalendarSignal) {
      payloadLines.push("Has external calendar signal: true");
    }

    payloadLines.push(
      `Workspace booking link: ${opts.workspaceBookingLink ?? "none"}`,
      "Message body (signature stripped):",
      opts.strippedText.slice(0, BOOKING_PROCESS_ROUTER_INPUT_MAX_CHARS),
      "",
      "Full message (may include signature/footer):",
      opts.fullText.slice(0, BOOKING_PROCESS_ROUTER_INPUT_MAX_CHARS)
    );

    const payload = payloadLines.join("\n");

    const result = await runStructuredJsonPrompt<BookingProcessRoute>({
      pattern: "structured_json",
      clientId: opts.clientId,
      leadId: opts.leadId ?? null,
      featureId: "action_signal.route_booking_process",
      promptKey: "action_signal.route_booking_process.v1",
      model: "gpt-5-mini",
      reasoningEffort: "minimal",
      timeoutMs: BOOKING_PROCESS_ROUTER_TIMEOUT_MS,
      systemFallback: ACTION_SIGNAL_ROUTE_BOOKING_PROCESS_SYSTEM,
      input: payload,
      schemaName: "action_signal_route_booking_process",
      strict: true,
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          processId: { type: "integer", enum: [1, 2, 3, 4, 5] },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          rationale: { type: "string" },
          uncertain: { type: "boolean" },
        },
        required: ["processId", "confidence", "rationale", "uncertain"],
      },
      budget: { min: 120, max: 200 },
      maxAttempts: 1,
    });

    if (!result.success) {
      if (result.error.category === "timeout") return { route: null, reason: "router_timeout" };
      if (result.error.category === "rate_limit") return { route: null, reason: "router_rate_limit" };
      if (result.error.category === "api_error") return { route: null, reason: "router_api_error" };
      if (result.error.category === "parse_error") return { route: null, reason: "router_parse_error" };
      if (result.error.category === "schema_violation") return { route: null, reason: "router_schema_violation" };
      return { route: null, reason: "router_unknown" };
    }

    const route = normalizeBookingProcessRoute(result.data);
    if (!route) return { route: null, reason: "router_schema_violation" };
    return { route, reason: "routed" };
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : "";
    if (message.includes("timeout")) return { route: null, reason: "router_timeout" };
    return { route: null, reason: "router_unknown" };
  }
}

// ---------------------------------------------------------------------------
// Main detection function
// ---------------------------------------------------------------------------

export async function detectActionSignals(opts: {
  strippedText: string;
  fullText: string;
  sentimentTag: string | null;
  workspaceBookingLink: string | null;
  clientId: string;
  leadId: string;
  channel?: ActionSignalChannel;
  provider?: string | null;
  aiRouteBookingProcessEnabled?: boolean;
  disambiguate?: SignatureDisambiguationFn;
  routeBookingProcess?: BookingProcessRoutingFn;
}): Promise<ActionSignalDetectionResult> {
  // Gate: positive sentiments only
  if (!isPositiveSentiment(opts.sentimentTag)) {
    await recordBookingProcessRouteOutcome({
      clientId: opts.clientId,
      leadId: opts.leadId,
      sentimentTag: opts.sentimentTag,
      channel: opts.channel,
      provider: opts.provider,
      reason: "non_positive_sentiment",
      route: null,
      hasCallSignal: false,
      hasExternalCalendarSignal: false,
    });
    return { ...EMPTY_ACTION_SIGNAL_RESULT };
  }

  const signals: ActionSignal[] = [];
  const disambiguate = opts.disambiguate ?? disambiguateSignatureSchedulerLink;
  const routeEnabled = opts.aiRouteBookingProcessEnabled ?? true;

  // Tier 1: Call signal
  const callSignal = detectCallSignalHeuristic(opts.strippedText, opts.sentimentTag);
  if (callSignal) signals.push(callSignal);

  // Tier 1: External calendar
  const calendarSignal = detectExternalCalendarHeuristic(opts.strippedText, opts.workspaceBookingLink);
  if (calendarSignal) signals.push(calendarSignal);

  // Tier 2: AI disambiguation — only if no calendar signal from Tier 1
  if (!calendarSignal && shouldRunSignatureLinkDisambiguation(opts.strippedText, opts.fullText)) {
    const disambiguation = await disambiguate({
      strippedText: opts.strippedText,
      fullText: opts.fullText,
      clientId: opts.clientId,
      leadId: opts.leadId,
    });

    if (disambiguation?.intentional) {
      signals.push({
        type: "book_on_external_calendar",
        confidence: "high",
        evidence: `AI disambiguation: ${disambiguation.evidence}`,
      });
    }
  }

  const hasCallSignalBeforeRoute = signals.some((s) => s.type === "call_requested");
  const hasExternalCalendarSignalBeforeRoute = signals.some((s) => s.type === "book_on_external_calendar");
  let route: BookingProcessRoute | null = null;
  let routeReason: BookingProcessRoutingOutcome["reason"] = "disabled_by_workspace_settings";

  if (routeEnabled) {
    if (opts.routeBookingProcess) {
      try {
        route = await opts.routeBookingProcess({
          strippedText: opts.strippedText,
          fullText: opts.fullText,
          sentimentTag: opts.sentimentTag,
          workspaceBookingLink: opts.workspaceBookingLink,
          clientId: opts.clientId,
          leadId: opts.leadId,
          hasCallSignal: hasCallSignalBeforeRoute,
          hasExternalCalendarSignal: hasExternalCalendarSignalBeforeRoute,
          channel: opts.channel,
          provider: opts.provider,
        });
        routeReason = route ? "routed" : "router_unknown";
      } catch {
        route = null;
        routeReason = "router_unknown";
      }
    } else {
      const routeOutcome = await routeBookingProcessWithAi({
        strippedText: opts.strippedText,
        fullText: opts.fullText,
        sentimentTag: opts.sentimentTag,
        workspaceBookingLink: opts.workspaceBookingLink,
        clientId: opts.clientId,
        leadId: opts.leadId,
        hasCallSignal: hasCallSignalBeforeRoute,
        hasExternalCalendarSignal: hasExternalCalendarSignalBeforeRoute,
        channel: opts.channel,
        provider: opts.provider,
      });
      route = routeOutcome.route;
      routeReason = routeOutcome.reason;
    }
  }

  if (!hasCallSignalBeforeRoute && route?.processId === 4) {
    const evidence = route.rationale
      ? `Booking process router rationale: ${route.rationale}`
      : "Booking process router classified this reply as a call request";
    const confidence = route.confidence >= 0.8 ? "high" : "medium";
    signals.push({
      type: "call_requested",
      confidence,
      evidence,
    });
  }

  const hasCallSignal = signals.some((s) => s.type === "call_requested");
  const hasExternalCalendarSignal = signals.some((s) => s.type === "book_on_external_calendar");

  await recordBookingProcessRouteOutcome({
    clientId: opts.clientId,
    leadId: opts.leadId,
    sentimentTag: opts.sentimentTag,
    channel: opts.channel,
    provider: opts.provider,
    reason: routeReason,
    route,
    hasCallSignal,
    hasExternalCalendarSignal,
  });

  return {
    signals,
    hasCallSignal,
    hasExternalCalendarSignal,
    route,
  };
}

// ---------------------------------------------------------------------------
// Slack notification
// ---------------------------------------------------------------------------

function buildLeadUrl(leadId: string): string {
  const base = getPublicAppUrl();
  return `${base}/?view=inbox&leadId=${encodeURIComponent(leadId)}`;
}

export async function notifyActionSignals(opts: {
  clientId: string;
  leadId: string;
  messageId: string;
  signals: ActionSignal[];
  latestInboundText: string;
  route?: BookingProcessRoute | null;
}): Promise<void> {
  if (opts.signals.length === 0) return;

  const [client, lead, settings] = await Promise.all([
    prisma.client.findUnique({
      where: { id: opts.clientId },
      select: { id: true, name: true, slackBotToken: true },
    }),
    prisma.lead.findUnique({
      where: { id: opts.leadId },
      select: { id: true, clientId: true, firstName: true, lastName: true, email: true, phone: true },
    }),
    prisma.workspaceSettings.findUnique({
      where: { clientId: opts.clientId },
      select: {
        slackAlerts: true,
        notificationSlackChannelIds: true,
      },
    }),
  ]);

  if (!client || !lead || !settings) return;
  if (lead.clientId !== opts.clientId) return;
  if (settings.slackAlerts === false) return;
  if (!client.slackBotToken || settings.notificationSlackChannelIds.length === 0) return;

  const leadName = [lead.firstName, lead.lastName].filter(Boolean).join(" ").trim() || lead.email || "Lead";
  const leadUrl = buildLeadUrl(lead.id);
  const snippetRaw = (opts.latestInboundText || "").trim();
  const snippet = snippetRaw.length > 200 ? `${snippetRaw.slice(0, 200)}…` : snippetRaw;

  for (const signal of opts.signals) {
    const emoji = signal.type === "call_requested" ? "📞" : "📅";
    const label = signal.type === "call_requested" ? "Call Requested" : "External Calendar Booking";

    for (const channelId of settings.notificationSlackChannelIds) {
      const trimmed = (channelId || "").trim();
      if (!trimmed) continue;

      // Dedupe via NotificationSendLog
      const dedupeKey = `action_signal:${opts.clientId}:${opts.leadId}:${opts.messageId}:${signal.type}:slack:${trimmed}`;
      try {
        await prisma.notificationSendLog.create({
          data: {
            clientId: opts.clientId,
            leadId: opts.leadId,
            kind: "action_signal",
            destination: "slack",
            dedupeKey,
          },
        });
      } catch (error) {
        if (isPrismaUniqueConstraintError(error)) continue; // Already sent
        // Log but don't block
        console.warn("[ActionSignalDetector] Dedupe check failed:", error);
        continue;
      }

      const text = [
        `${emoji} *Action Signal: ${label}*`,
        `Lead: ${leadName}`,
        `Workspace: ${client.name}`,
        opts.route ? `Process Route: ${opts.route.processId}${opts.route.uncertain ? " (uncertain)" : ""}` : null,
        opts.route ? `Route Confidence: ${Math.round(opts.route.confidence * 100)}%` : null,
        opts.route?.rationale ? `Route Rationale: ${opts.route.rationale}` : null,
        `Confidence: ${signal.confidence}`,
        `Evidence: ${signal.evidence}`,
        lead.phone ? `Phone: ${lead.phone}` : null,
        snippet ? `Message: ${snippet}` : null,
        `<${leadUrl}|View in Dashboard>`,
      ]
        .filter(Boolean)
        .join("\n");

      const sent = await slackPostMessage({
        token: client.slackBotToken,
        channelId: trimmed,
        text,
      });

      if (!sent.success) {
        await prisma.notificationSendLog.deleteMany({
          where: { dedupeKey },
        }).catch(() => undefined);
        console.warn("[ActionSignalDetector] Slack post failed:", sent.error);
      }
    }
  }
}
