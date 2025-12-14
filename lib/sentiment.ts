import "@/lib/server-dns";
import OpenAI from "openai";

// Sentiment tags for classification
export const SENTIMENT_TAGS = [
  "Meeting Requested",
  "Call Requested",
  "Information Requested",
  "Not Interested",
  "Blacklist",
  "Follow Up",
  "Out of Office",
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

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

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

function isOptOutMessage(text: string): boolean {
  const normalized = text.trim().toLowerCase();

  // Strict single-word opt-outs (common for SMS compliance)
  if (["stop", "unsubscribe", "optout", "opt out"].includes(normalized)) return true;

  // Common explicit opt-outs
  if (/\b(remove me|take me off|do not contact|dont contact|don't contact)\b/i.test(normalized)) {
    return true;
  }

  // "stop" with context words (reduces false positives like "stop by")
  if (/\bstop\b/i.test(normalized) && /\b(text|txt|message|messages|messaging|contact|email|calling|call)\b/i.test(normalized)) {
    return true;
  }

  return false;
}

function isOutOfOfficeMessage(text: string): boolean {
  return /\b(out of office|ooo|on vacation|vacation|away until|back on|back in|return(ing)? (on|at)|travell?ing)\b/i.test(
    text,
  );
}

function isCallRequestedMessage(text: string): boolean {
  const normalized = text.trim().toLowerCase();

  // Explicit "don't call" / "do not call" should not be treated as call requested
  if (/\b(don't|dont|do not)\s+call\b/i.test(normalized)) return false;

  if (PHONE_PATTERN.test(normalized)) return true;

  return /\b(call|ring)\b/i.test(normalized) && /\b(me|us)\b/i.test(normalized);
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
  maxRetries: number = 3
): Promise<SentimentTag> {
  if (!transcript || !process.env.OPENAI_API_KEY) {
    return "Neutral";
  }

  const { allLeadText, lastLeadText } = extractLeadTextFromTranscript(transcript);

  // Fast, high-confidence classification without calling the model.
  // These rules dramatically reduce edge-case misclassifications and cost.
  if (matchesAnyPattern(BOUNCE_PATTERNS, lastLeadText.toLowerCase())) return "Blacklist";
  if (isOptOutMessage(lastLeadText)) return "Blacklist";
  if (isOutOfOfficeMessage(lastLeadText)) return "Out of Office";
  if (isCallRequestedMessage(lastLeadText)) return "Call Requested";
  if (isMeetingRequestedMessage(lastLeadText)) return "Meeting Requested";
  if (isNotInterestedMessage(lastLeadText)) return "Not Interested";
  if (isInformationRequestedMessage(lastLeadText)) return "Information Requested";
  if (isFollowUpMessage(lastLeadText)) return "Follow Up";

  const systemPrompt = `You are a sales conversation classifier.

Classify into ONE category based ONLY on the lead's messages (ignore agent/rep messages).
If multiple intents appear, classify based on the MOST RECENT lead reply (the transcript is chronological; newest is at the end).

CATEGORIES:
- "Meeting Requested" - Lead explicitly agrees to or confirms a meeting/call. Examples:
  * "tomorrow works well"
  * "yes, let's do it"
  * "I'm free on Tuesday"
  * "sounds good, when?"
  * "let's set up a call"
  * Any time/date confirmation
- "Call Requested" - Lead provides a phone number or explicitly asks to be called
- "Information Requested" - Lead asks questions or requests details about pricing, what's being offered, process, etc.
- "Not Interested" - Lead explicitly declines or says no
- "Blacklist" - Hostile/abusive messages, opt-out requests, or EMAIL BOUNCES
- "Follow Up" - Lead deferred action ("busy right now", "later", "let me think")
- "Out of Office" - Lead mentions being on vacation or temporarily unavailable
- "Interested" - Lead shows clear interest without specific action ("sounds good", "I'm interested", "tell me more")
- "Neutral" - Lead's response is genuinely ambiguous with no clear intent (RARE)

CRITICAL RULES:
1. SHORT CONFIRMATIONS like "tomorrow works well", "yes", "sounds good, when?", "let's do Tuesday" = "Meeting Requested"
2. Any time/date confirmation or agreement to meet = "Meeting Requested"
3. Phone number provided = "Call Requested"
4. Questions about the offer = "Information Requested"
5. Only use "Neutral" if truly ambiguous (very rare)

Respond with ONLY the category name, nothing else.`;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Transcript (chronological; newest at the end):\n\n${trimTranscriptForModel(transcript)}` }
        ],
        max_tokens: 50,
        temperature: 0,
      });

      const raw = response.choices[0]?.message?.content?.trim() || "";
      const cleaned = raw.replace(/^[\"'`]+|[\"'`]+$/g, "").replace(/\.$/, "").trim();

      // Exact match (case-insensitive)
      const exact = SENTIMENT_TAGS.find((tag) => tag.toLowerCase() === cleaned.toLowerCase());
      if (exact) return exact;

      // Sometimes the model returns extra text; try to extract a valid tag.
      const contained = SENTIMENT_TAGS.find((tag) => cleaned.toLowerCase().includes(tag.toLowerCase()));
      if (contained) return contained;

      const upper = cleaned.toLowerCase();
      if (upper === "positive") return "Interested";

      return "Neutral";
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
