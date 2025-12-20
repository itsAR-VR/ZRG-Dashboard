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
  return /\b(out of office|ooo|on vacation|vacation|away until|back on|back in|return(ing)? (on|at)|travell?ing)\b/i.test(
    text,
  );
}

function isAutomatedReplyMessage(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  if (!normalized) return false;

  // Avoid labeling obvious out-of-office as generic automated reply
  if (isOutOfOfficeMessage(normalized)) return false;

  // Strong autoresponder signals
  const strongSignals = [
    /\b(this is an automated|auto-?response|autoresponder)\b/i,
    /\b(do not reply|no[-\s]?reply)\b/i,
    /\b(your message has been received|we have received your message|we received your email)\b/i,
    /\b(thank you for contacting|thanks for contacting)\b/i,
    /\b(ticket (number|#))\b/i,
    /\b(case (number|#))\b/i,
  ];

  if (strongSignals.some((re) => re.test(normalized))) return true;

  // Typical acknowledgment patterns (keep strict)
  const ack = /\b(we('|’)ll get back to you|we will get back to you|as soon as possible|within \d+\s+(hours?|days?))\b/i;
  const hasAck = ack.test(normalized);
  const hasDoNotReply = /\b(do not reply|no[-\s]?reply)\b/i.test(normalized);
  const hasThanksContacting = /\b(thank you for (your )?(email|message)|thank you for contacting)\b/i.test(normalized);

  // Only label automated if it has multiple signals
  return (hasThanksContacting && hasAck) || (hasThanksContacting && hasDoNotReply) || (hasAck && hasDoNotReply);
}

function isCallRequestedMessage(text: string): boolean {
  const raw = (text || "").replace(/\u00a0/g, " ").trim();
  if (!raw) return false;

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

  // Fast, high-confidence classification without calling the model.
  // These rules dramatically reduce edge-case misclassifications and cost.
  if (matchesAnyPattern(BOUNCE_PATTERNS, lastLeadText.toLowerCase())) return "Blacklist";
  if (isOptOutText(lastLeadText)) return "Blacklist";
  if (isOutOfOfficeMessage(lastLeadText)) return "Out of Office";
  if (isAutomatedReplyMessage(lastLeadText)) return "Automated Reply";
  if (isCallRequestedMessage(lastLeadText)) return "Call Requested";
  if (isMeetingRequestedMessage(lastLeadText)) return "Meeting Requested";
  if (isNotInterestedMessage(lastLeadText)) return "Not Interested";
  if (isInformationRequestedMessage(lastLeadText)) return "Information Requested";
  if (isFollowUpMessage(lastLeadText)) return "Follow Up";

  const promptTemplate = getAIPromptTemplate("sentiment.classify.v1");
  const systemPrompt =
    promptTemplate?.messages.find((m) => m.role === "system")?.content ||
    "You are an expert inbox manager. Classify the reply into ONE category and return only the category name.";

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const { response, interactionId } = await runResponseWithInteraction({
        clientId: opts.clientId,
        leadId: opts.leadId,
        featureId: promptTemplate?.featureId || "sentiment.classify",
        promptKey: promptTemplate?.key || "sentiment.classify.v1",
        params: {
          model: "gpt-5-mini",
          temperature: 0,
          instructions: systemPrompt,
          input: [
            {
              role: "user",
              content: `Transcript (chronological; newest at the end):\n\n${trimTranscriptForModel(transcript)}`,
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
      if (isOptOutText(lastLeadText)) return "Blacklist";
      if (isOutOfOfficeMessage(lastLeadText)) return "Out of Office";
      if (isAutomatedReplyMessage(lastLeadText)) return "Automated Reply";

      if (candidate === "Call Requested" && !isCallRequestedMessage(lastLeadText)) {
        if (isMeetingRequestedMessage(lastLeadText)) return "Meeting Requested";
        if (isInformationRequestedMessage(lastLeadText)) return "Information Requested";
        if (isNotInterestedMessage(lastLeadText)) return "Not Interested";
        if (isFollowUpMessage(lastLeadText)) return "Follow Up";
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
