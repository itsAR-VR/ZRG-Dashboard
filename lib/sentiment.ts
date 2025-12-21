import "@/lib/server-dns";
import { getAIPromptTemplate } from "@/lib/ai/prompt-registry";
import { markAiInteractionError, runResponseWithInteraction } from "@/lib/ai/openai-telemetry";
import { extractJsonObjectFromText, getTrimmedOutputText, summarizeResponseForTelemetry } from "@/lib/ai/response-utils";

// Sentiment tags for classification
export const SENTIMENT_TAGS = [
  "Meeting Requested",
  "Call Requested",
  "Information Requested",
  "Not Interested",
  "Blacklist",
  "Follow Up",
  "Out of Office",
  "Automated Reply",
  "Interested",
  "Neutral",
  "Snoozed", // Temporarily hidden from follow-up list
] as const;

export type SentimentTag = (typeof SENTIMENT_TAGS)[number];

// Map sentiment tags to lead statuses
export const SENTIMENT_TO_STATUS: Record<SentimentTag, string> = {
  "Meeting Requested": "meeting-requested",
  "Call Requested": "qualified",
  "Information Requested": "qualified",
  "Not Interested": "not-interested",
  "Blacklist": "blacklisted",
  "Follow Up": "new",
  "Out of Office": "new",
  "Automated Reply": "new",
  "Interested": "qualified",
  "Neutral": "new",
  "Snoozed": "new",
};

// Positive sentiments that trigger Clay enrichment
// These indicate the lead is engaged and worth enriching for phone/LinkedIn
export const POSITIVE_SENTIMENTS = [
  "Meeting Requested",
  "Call Requested",
  "Information Requested",
  "Interested",
] as const;

export type PositiveSentiment = (typeof POSITIVE_SENTIMENTS)[number];

/**
 * Check if a sentiment tag is positive (triggers enrichment)
 * Used to determine when to auto-trigger Clay enrichment
 */
export function isPositiveSentiment(tag: string | null): tag is PositiveSentiment {
  if (!tag) return false;
  return POSITIVE_SENTIMENTS.includes(tag as PositiveSentiment);
}

// ============================================================================
// REGEX BOUNCE DETECTION
// ============================================================================

/**
 * Regex patterns for detecting email bounces and system messages
 * These should be classified as "Blacklist" without calling AI
 */
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
  /550[\s-]/i,  // SMTP error codes
  /554[\s-]/i,
  /the email account.*does not exist/i,
  /undelivered mail returned to sender/i,
  /message could not be delivered/i,
];

function matchesAnyPattern(patterns: RegExp[], text: string): boolean {
  for (const pattern of patterns) {
    if (pattern.test(text)) return true;
  }
  return false;
}

function extractLeadTextFromTranscript(transcript: string): {
  allLeadText: string;
  lastLeadText: string;
} {
  const lines = transcript
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const leadLines: string[] = [];

  for (const line of lines) {
    const match = line.match(/\b(Lead|Prospect|Contact|Customer)\s*:\s*(.*)$/i);
    if (match) {
      leadLines.push(match[2]?.trim() || "");
    }
  }

  // Many call sites pass a single inbound message body (no "Lead:" prefix).
  // In that case, treat the full transcript as lead text.
  if (leadLines.length === 0) {
    const cleaned = transcript.trim();
    return { allLeadText: cleaned, lastLeadText: cleaned };
  }

  const cleanedLeadLines = leadLines.map((l) => l.trim()).filter(Boolean);
  const allLeadText = cleanedLeadLines.join("\n");
  const lastLeadText = cleanedLeadLines[cleanedLeadLines.length - 1] || allLeadText;

  return { allLeadText, lastLeadText };
}

export type SentimentTranscriptMessage = {
  sentAt: Date | string;
  channel?: string | null;
  direction: "inbound" | "outbound" | string;
  body: string;
  subject?: string | null;
};

function normalizeTranscriptBody(text: string): string {
  return (text || "").replace(/\s+/g, " ").trim();
}

export function buildSentimentTranscriptFromMessages(messages: SentimentTranscriptMessage[]): string {
  return messages
    .filter((m) => normalizeTranscriptBody(m.body).length > 0)
    .map((m) => {
      const sentAt = typeof m.sentAt === "string" ? new Date(m.sentAt) : m.sentAt;
      const ts = sentAt instanceof Date && !isNaN(sentAt.getTime()) ? sentAt.toISOString() : String(m.sentAt);
      const channel = (m.channel || "sms").toString().toLowerCase();
      const direction = m.direction === "inbound" ? "IN" : "OUT";
      const speaker = m.direction === "inbound" ? "Lead" : "Agent";
      const subjectPrefix =
        channel === "email" && m.subject ? `Subject: ${normalizeTranscriptBody(m.subject)} | ` : "";
      return `[${ts}] [${channel} ${direction}] ${speaker}: ${subjectPrefix}${normalizeTranscriptBody(m.body)}`;
    })
    .join("\n");
}

function trimTranscriptForModel(transcript: string, maxLines = 80, maxChars = 12000): string {
  const cleaned = transcript.trim();
  if (!cleaned) return "";

  const lines = cleaned.split(/\r?\n/);
  const tailLines = lines.length > maxLines ? lines.slice(lines.length - maxLines) : lines;
  let tail = tailLines.join("\n").trim();
  if (tail.length > maxChars) {
    tail = tail.slice(tail.length - maxChars);
  }
  return tail;
}

/**
 * Check if any inbound message matches bounce patterns
 * Call this BEFORE classifySentiment to detect bounces without AI
 */
export function detectBounce(messages: { body: string; direction: string; channel?: string | null }[]): boolean {
  // Sentiment can change: only treat it as a bounce if the MOST RECENT inbound message is an email bounce.
  // If the lead later replies normally (SMS/Email/LinkedIn), we should not keep them blacklisted forever.
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.direction !== "inbound") continue;
    if ((msg as any).channel && (msg as any).channel !== "email") return false;
    const body = (msg.body || "").toLowerCase();
    return matchesAnyPattern(BOUNCE_PATTERNS, body);
  }

  return false; // No inbound messages
}

// ============================================================================
// HIGH-CONFIDENCE RULES (NO AI)
// ============================================================================

const PHONE_PATTERN =
  /(?:\+?\d{1,3}[-.\s]?)?(?:\(\d{3}\)|\d{3})[-.\s]?\d{3}[-.\s]?\d{4}\b/;

function splitEmailSubjectPrefix(text: string): { subject: string; body: string; combined: string } {
  const combined = (text || "").trim();
  if (!combined) return { subject: "", body: "", combined: "" };

  // buildSentimentTranscriptFromMessages renders email inbound bodies as:
  // "Subject: <subject> | <body>"
  const match = combined.match(/^\s*Subject:\s*([^|]+)\|\s*(.*)$/i);
  if (!match) return { subject: "", body: combined, combined };

  return {
    subject: (match[1] || "").trim(),
    body: (match[2] || "").trim(),
    combined,
  };
}

function stripCommonPunctuation(text: string): string {
  return (text || "").replace(/^[\s"'`*()\-–—_:;,.!?]+|[\s"'`*()\-–—_:;,.!?]+$/g, "").trim();
}

function stripQuotedEmailThread(text: string): string {
  const combined = (text || "").replace(/\u00a0/g, " ").trim();
  if (!combined) return "";

  const { body } = splitEmailSubjectPrefix(combined);
  const cleaned = body.trim();
  if (!cleaned) return "";

  const markers: RegExp[] = [
    // Classic separators
    /-{5,}\s*original message\s*-{5,}/i,
    /-{5,}\s*forwarded message\s*-{5,}/i,
    /_{5,}/,
    // Quote header blocks often inserted by email clients
    /-{5,}\s*from:\s*/i,
    /\bfrom:\s.+\bsent:\s.+\bto:\s/i,
    /\bon\s.+\bwrote:\s*/i,
    // "From:" blocks without dashes (keep strict: only if it looks like a header set)
    /\bfrom:\s.+\b(sent|to|subject):\s/i,
  ];

  let cutIndex: number | null = null;
  for (const re of markers) {
    const match = re.exec(cleaned);
    if (!match || typeof match.index !== "number") continue;
    if (cutIndex === null || match.index < cutIndex) cutIndex = match.index;
  }

  const withoutThread = cutIndex === null ? cleaned : cleaned.slice(0, cutIndex);
  return stripCommonPunctuation(withoutThread).trim();
}

export function isOptOutText(text: string): boolean {
  const combined = (text || "").replace(/\u00a0/g, " ").trim();
  if (!combined) return false;

  const { subject, body } = splitEmailSubjectPrefix(combined);
  const candidates = [body, subject, combined].filter(Boolean);

  // Normalize to handle cases like: "UNSUBSCRIBE - John Doe"
  const normalizedBody = stripCommonPunctuation(body).toLowerCase();
  const normalizedCombined = stripCommonPunctuation(combined).toLowerCase();

  // Strict single-word opt-outs (common for SMS/email compliance)
  if (["stop", "unsubscribe", "optout", "opt out"].includes(normalizedBody)) return true;
  if (["stop", "unsubscribe", "optout", "opt out"].includes(normalizedCombined)) return true;

  // Strong opt-out triggers (must-win)
  const strongOptOut = /\b(unsubscribe|opt\s*-?\s*out|remove me|remove us|take me off|take us off|stop (emailing|calling|contacting|messaging|texting)|do not (contact|email|call|text)|don['’]?t (contact|email|call|text)|take a hike|stop)\b/i;
  if (candidates.some((t) => strongOptOut.test(t))) {
    // Reduce false positives for "stop" in benign phrases like "stop by"
    if (!/\bstop\b/i.test(body)) return true;
    const stopHasContext = /\bstop\b/i.test(body) && /\b(text|txt|message|messages|messaging|contact|email|calling|call)\b/i.test(body);
    return stopHasContext || normalizedBody === "stop";
  }

  // Short-message unsubscribe (e.g., "UNSUBSCRIBE" + tiny signature)
  if (body.length <= 280 && /\bunsubscribe\b/i.test(body)) return true;
  if (subject && subject.length <= 120 && /\bunsubscribe\b/i.test(subject)) return true;

  return false;
}

function isOutOfOfficeMessage(text: string): boolean {
  const combined = (text || "").replace(/\u00a0/g, " ").trim();
  if (!combined) return false;

  const { subject, body } = splitEmailSubjectPrefix(combined);
  const candidates = [body, subject, combined].filter(Boolean);

  const subjectAutoReply = /\b(automatic reply|auto[-\s]?reply|auto[-\s]?response|out of office|ooo|autoreply)\b/i;

  // Strong "away" signals.
  const awaySignals =
    /\b(out of office|ooo|on leave|on holiday|on vacation|away from (the )?office|away|unavailable|travell?ing|traveling|sabbatical|parental leave|maternity leave|paternity leave)\b/i;

  // Common OOO phrasing that doesn't always include the exact words "out of office".
  const availabilitySignals =
    /\b(limited|intermittent|reduced)\s+(access|availability)\b|\b(have|has)\s+limited\s+access\b|\b(not|won['’]?t)\s+(be\s+)?(checking|monitoring|reading)\s+(my\s+)?(email|emails|inbox)\b|\b(apologies|sorry)\b.*\b(delay(ed)?\s+response|slow\s+to\s+respond)\b/i;

  // Date/return framing commonly found in OOO messages.
  const returnSignals =
    /\b(away|out|off)\s+(until|till)\b|\b(back|return(ing)?|return)\s+(on|at|in)\b|\b(i('|’)?ll|i will)\s+(be\s+)?back\b|\b(resume|resuming)\b.*\b(on|at)\b/i;

  // Routing for urgent matters is a common OOO/auto-reply pattern and should not
  // be treated as "Call Requested".
  const urgentRouting =
    /\b(if|for)\s+(your\s+)?(enquir(y|ies)|inquir(y|ies)|matter|request)\s+is\s+urgent\b|\bfor\s+urgent\s+(matters?|enquir(y|ies)|inquir(y|ies))\b|\burgent(ly)?\b.*\b(contact|call|reach|phone|ring)\b|\bplease\s+contact\b/i;

  const hasSubjectAutoReply = subject ? subjectAutoReply.test(subject) : false;
  const hasAway = candidates.some((t) => awaySignals.test(t));
  const hasAvailability = candidates.some((t) => availabilitySignals.test(t));
  const hasReturnFrame = candidates.some((t) => returnSignals.test(t));
  const hasUrgentRouting = candidates.some((t) => urgentRouting.test(t));

  // Treat as OOO if:
  // - subject screams auto-reply/OOO, OR
  // - the body says they are away, OR
  // - it's framed as limited access/returning + urgent routing language.
  return hasSubjectAutoReply || hasAway || ((hasAvailability || hasReturnFrame) && hasUrgentRouting);
}

function isAutomatedReplyMessage(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  if (!normalized) return false;

  // Avoid labeling obvious out-of-office as generic automated reply
  if (isOutOfOfficeMessage(normalized)) return false;

  // Strong autoresponder signals
  const strongSignals = [
    /\b(this is an automated|auto-?response|autoresponder)\b/i,
    /\b(automatic reply|auto[-\s]?reply|autoreply)\b/i,
    /\b(do not reply|no[-\s]?reply)\b/i,
    /\b(your message has been received|we have received your message|we received your email)\b/i,
    /\b(thank you for contacting|thanks for contacting)\b/i,
    /\b(ticket (number|#))\b/i,
    /\b(case (number|#))\b/i,
    /\b(please be assured|will be dealt with shortly|will be handled shortly|we will deal with)\b/i,
  ];

  if (strongSignals.some((re) => re.test(normalized))) return true;

  // Typical acknowledgment patterns (keep strict)
  const ack =
    /\b(we('|’)ll get back to you|we will get back to you|as soon as possible|within \d+\s+(hours?|days?)|dealt with shortly|handled shortly)\b/i;
  const hasAck = ack.test(normalized);
  const hasDoNotReply = /\b(do not reply|no[-\s]?reply)\b/i.test(normalized);
  const hasThanksContacting = /\b(thank you for (your )?(email|message)|thank you for contacting)\b/i.test(normalized);
  const hasUrgentRouting =
    /\b(if|for)\s+(your\s+)?(enquir(y|ies)|inquir(y|ies)|matter|request)\s+is\s+urgent\b|\burgent(ly)?\b.*\b(call|contact|reach|phone|ring)\b/i.test(
      normalized,
    );

  // Only label automated if it has multiple signals
  return (
    (hasThanksContacting && hasAck) ||
    (hasThanksContacting && hasDoNotReply) ||
    (hasAck && hasDoNotReply) ||
    (hasAck && hasUrgentRouting) ||
    (hasUrgentRouting && hasDoNotReply)
  );
}

function isCallRequestedMessage(text: string): boolean {
  const raw = (text || "").replace(/\u00a0/g, " ").trim();
  if (!raw) return false;

  // Out-of-office auto replies often include "call me on ..." for urgent matters.
  // Those should be categorized as "Out of Office", not "Call Requested".
  if (isOutOfOfficeMessage(raw)) return false;

  const { body } = splitEmailSubjectPrefix(raw);
  const normalized = body.toLowerCase();

  // Explicit "don't call" / "do not call" should not be treated as call requested
  if (/\b(don['’]?t|dont|do not)\s+call\b/i.test(normalized)) return false;

  // Only treat as "Call Requested" if the lead explicitly wants a PHONE call.
  // A phone number in a signature must not trigger this by itself.
  const explicitCallRequest =
    /\b(call|ring|phone)\b/i.test(normalized) && /\b(me|us)\b/i.test(normalized);
  const reachMeAt =
    /\b(reach|call|ring|phone)\b/i.test(normalized) &&
    /\b(me|us)\b/i.test(normalized) &&
    /\b(at|on)\b/i.test(normalized);

  const hasPhone = PHONE_PATTERN.test(normalized);
  const looksLikeSignature =
    /\b(www\.|https?:\/\/|linkedin\.com)\b/i.test(normalized) ||
    /\b(direct|mobile|whats\s*app|whatsapp|tel|telephone|phone|t:|m:|p:|e:)\b/i.test(normalized) ||
    /\b(ltd|limited|llc|inc|corp|company)\b/i.test(normalized);

  if (explicitCallRequest) return true;
  if (reachMeAt && hasPhone) return true;

  // If the message is basically just a phone number (common for SMS/email replies),
  // allow it, but keep it strict to avoid signature false-positives.
  if (hasPhone) {
    const stripped = normalized.replace(PHONE_PATTERN, "").replace(/\s+/g, " ").trim();
    const shortRemainder = stripCommonPunctuation(stripped).length <= 24;
    if (shortRemainder && !looksLikeSignature) return true;
  }

  return false;
}

function isMeetingRequestedMessage(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  if (isOutOfOfficeMessage(normalized)) return false;

  // Detect explicit scheduling language / confirmations
  const hasScheduleIntent =
    /\b(meet|meeting|schedule|calendar|book|set up|setup|sync up|chat|talk|call)\b/i.test(normalized);

  const hasTimeSignal =
    /\b(today|tomorrow|tonight|this (morning|afternoon|evening|week)|next (week|month)|mon(day)?|tue(s(day)?)?|wed(nesday)?|thu(r(s(day)?)?)?|fri(day)?|sat(urday)?|sun(day)?)\b/i.test(
      normalized,
    ) ||
    /\b\d{1,2}(:\d{2})?\s?(am|pm)\b/i.test(normalized) ||
    /\b\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{2,4})?\b/i.test(normalized);

  // Common short confirmations that usually indicate scheduling agreement
  const hasConfirmation =
    /\b(yes|yep|yeah|sure|ok|okay|sounds good|that works|works for me|perfect|great)\b/i.test(normalized);

  // If there's an explicit time/day signal, treat it as meeting requested even if "call" isn't present.
  if (hasTimeSignal && hasConfirmation) return true;

  // Otherwise require some scheduling intent + time/day signal
  return hasScheduleIntent && hasTimeSignal;
}

function isNotInterestedMessage(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  return /\b(not interested|no thanks|no thank you|no thx|wrong number|already have)\b/i.test(normalized);
}

function isInformationRequestedMessage(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  const hasQuestion =
    normalized.includes("?") || /\b(what|how|why|where|who)\b/i.test(normalized);
  const hasOfferKeyword =
    /\b(price|pricing|cost|rate|fee|charge|details|info|information|about|offer|service|product|process)\b/i.test(
      normalized,
    );
  return hasQuestion && hasOfferKeyword;
}

function isFollowUpMessage(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  return /\b(follow up|reach out|check back|circle back|later|not now|busy|in a meeting|another time|next week|next month|in a bit)\b/i.test(
    normalized,
  );
}

// ============================================================================
// RETRY LOGIC
// ============================================================================

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Classify conversation sentiment using OpenAI with retry logic
 * 
 * IMPORTANT: This function should only be called AFTER pre-classification checks:
 * - If lead has never responded → return "Neutral" (don't call this function)
 * - If detectBounce() returns true → return "Blacklist" (don't call this function)
 * 
 * This function analyzes the conversation content when the lead HAS responded.
 * It always uses AI classification regardless of how long ago the lead responded.
 */
export async function classifySentiment(
  transcript: string,
  opts: {
    clientId: string;
    leadId?: string | null;
    maxRetries?: number;
  }
): Promise<SentimentTag> {
  if (!transcript || !process.env.OPENAI_API_KEY) {
    return "Neutral";
  }

  const maxRetries = opts.maxRetries ?? 3;
  const { allLeadText, lastLeadText } = extractLeadTextFromTranscript(transcript);
  const lastLeadPrimary = stripQuotedEmailThread(lastLeadText) || lastLeadText.trim();

  // Fast, high-confidence classification without calling the model.
  // These rules dramatically reduce edge-case misclassifications and cost.
  if (matchesAnyPattern(BOUNCE_PATTERNS, lastLeadText.toLowerCase())) return "Blacklist";
  if (isOptOutText(lastLeadPrimary)) return "Blacklist";
  if (isOutOfOfficeMessage(lastLeadPrimary)) return "Out of Office";
  if (isAutomatedReplyMessage(lastLeadPrimary)) return "Automated Reply";
  // Explicit "no thanks" must override any quoted outbound thread content.
  if (isNotInterestedMessage(lastLeadPrimary)) return "Not Interested";
  if (isMeetingRequestedMessage(lastLeadPrimary)) return "Meeting Requested";
  if (isCallRequestedMessage(lastLeadPrimary)) return "Call Requested";
  if (isInformationRequestedMessage(lastLeadPrimary)) return "Information Requested";
  if (isFollowUpMessage(lastLeadPrimary)) return "Follow Up";

  const promptTemplate = getAIPromptTemplate("sentiment.classify.v1");
  const systemPrompt =
    promptTemplate?.messages.find((m) => m.role === "system")?.content ||
    "You are an expert inbox manager. Classify the reply into ONE category and return only the category name.";

  const recentContext = trimTranscriptForModel(transcript);
  const modelInputPayload = JSON.stringify(
    {
      latest_lead_reply: lastLeadPrimary,
      // Lower-priority context (use only to disambiguate ultra-short confirmations).
      context_transcript_tail: recentContext,
      lead_replies_tail: allLeadText.slice(Math.max(0, allLeadText.length - 3000)),
    },
    null,
    2
  );

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const { response, interactionId } = await runResponseWithInteraction({
        clientId: opts.clientId,
        leadId: opts.leadId,
        featureId: promptTemplate?.featureId || "sentiment.classify",
        promptKey: promptTemplate?.key || "sentiment.classify.v1",
        params: {
          model: "gpt-5-mini",
          instructions: systemPrompt,
          input: [
            {
              role: "user",
              content: modelInputPayload,
            },
          ],
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
                  classification: { type: "string", enum: [...SENTIMENT_TAGS] },
                },
                required: ["classification"],
              },
            },
          },
          reasoning: { effort: "minimal" },
          // `max_output_tokens` includes reasoning tokens; keep headroom so the
          // structured JSON body isn't empty/truncated.
          max_output_tokens: 240,
        },
      });

      const raw = getTrimmedOutputText(response) || "";
      if (!raw) {
        // Retry a couple times before recording a post-process error; empty output
        // is often caused by hitting `max_output_tokens` (which includes reasoning).
        if (attempt < maxRetries) {
          continue;
        }
        if (interactionId) {
          const details = summarizeResponseForTelemetry(response);
          await markAiInteractionError(
            interactionId,
            `Post-process error: empty output_text${details ? ` (${details})` : ""}`
          );
        }
        return "Neutral";
      }

      const jsonText = extractJsonObjectFromText(raw);
      let parsed: { classification?: string } | null = null;
      try {
        parsed = JSON.parse(jsonText) as { classification?: string };
      } catch {
        parsed = null;
      }

      const cleaned = (parsed?.classification || raw)
        .replace(/^[\"'`]+|[\"'`]+$/g, "")
        .replace(/\.$/, "")
        .trim();

      // Exact match (case-insensitive)
      const exact = SENTIMENT_TAGS.find((tag) => tag.toLowerCase() === cleaned.toLowerCase());

      // Sometimes the model returns extra text; try to extract a valid tag.
      const contained = SENTIMENT_TAGS.find((tag) => cleaned.toLowerCase().includes(tag.toLowerCase()));

      const lower = cleaned.toLowerCase();
      let candidate: SentimentTag =
        exact || contained || (lower === "positive" ? "Interested" : "Neutral");

      // Post-classification validators (safety + signature false-positive reduction)
      if (isOptOutText(lastLeadPrimary)) return "Blacklist";
      if (isOutOfOfficeMessage(lastLeadPrimary)) return "Out of Office";
      if (isAutomatedReplyMessage(lastLeadPrimary)) return "Automated Reply";
      if (isNotInterestedMessage(lastLeadPrimary)) return "Not Interested";

      if (candidate === "Call Requested" && !isCallRequestedMessage(lastLeadPrimary)) {
        if (isMeetingRequestedMessage(lastLeadPrimary)) return "Meeting Requested";
        if (isInformationRequestedMessage(lastLeadPrimary)) return "Information Requested";
        if (isFollowUpMessage(lastLeadPrimary)) return "Follow Up";
        candidate = "Interested";
      }

      return candidate;
    } catch (error) {
      const isRetryable = error instanceof Error &&
        (error.message.includes("500") ||
          error.message.includes("503") ||
          error.message.includes("rate") ||
          error.message.includes("timeout"));

      if (isRetryable && attempt < maxRetries) {
        const backoffMs = Math.pow(2, attempt) * 1000; // 2s, 4s, 8s
        console.log(`[Sentiment] Attempt ${attempt} failed, retrying in ${backoffMs / 1000}s...`);
        await sleep(backoffMs);
      } else {
        console.error("[Sentiment] Classification error after retries:", error);
        return "Neutral";
      }
    }
  }

  return "Neutral";
}
