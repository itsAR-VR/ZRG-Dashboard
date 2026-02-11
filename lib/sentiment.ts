import "server-only";

import "@/lib/server-dns";
import { resolvePromptTemplate, runStructuredJsonPrompt } from "@/lib/ai/prompt-runner";
import { substituteTemplateVars } from "@/lib/ai/prompt-runner/template";
import { computeAdaptiveMaxOutputTokens } from "@/lib/ai/token-budget";
import {
  isAutoBookingBlockedSentiment,
  AUTO_BOOKING_BLOCKED_SENTIMENTS,
  isPositiveSentiment,
  POSITIVE_SENTIMENTS,
  SENTIMENT_TAGS,
  SENTIMENT_TO_STATUS,
  type AutoBookingBlockedSentiment,
  type PositiveSentiment,
  type SentimentTag,
} from "@/lib/sentiment-shared";

export {
  isAutoBookingBlockedSentiment,
  AUTO_BOOKING_BLOCKED_SENTIMENTS,
  isPositiveSentiment,
  POSITIVE_SENTIMENTS,
  SENTIMENT_TAGS,
  SENTIMENT_TO_STATUS,
  type AutoBookingBlockedSentiment,
  type PositiveSentiment,
  type SentimentTag,
};

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
  /550[\s-]/i, // SMTP error codes
  /554[\s-]/i,
  /the email account.*does not exist/i,
  /undelivered mail returned to sender/i,
  /message could not be delivered/i,
  // "Inbox not monitored / no longer in use" system-style replies (treat like invalid channel)
  /\b(email|mailbox|inbox)\b.*\b(no longer (in use|used|active)|not (in use|used|active)|inactive|not monitored|no longer monitored|unmanned|unattended)\b/i,
  /\b(email address|this address)\b.*\b(no longer (in use|used|active)|inactive|not monitored|no longer monitored)\b/i,
  /\b(this|the)\s+(email|inbox|mailbox)\b.*\b(no longer (exists|in use|used)|not monitored|unmanned|unattended)\b/i,
  /\b(please|kindly)\s+(do not|don['’]?t)\s+(email|reply)\b.*\b(this|the)\b/i,
  /\b(address|account)\b.*\b(no longer (associated|available)|has been (deactivated|disabled))\b/i,
];

function matchesAnyPattern(patterns: RegExp[], text: string): boolean {
  for (const pattern of patterns) {
    if (pattern.test(text)) return true;
  }
  return false;
}

// ============================================================================
// TRANSCRIPT BUILDING (MINIMAL NORMALIZATION)
// ============================================================================

export type SentimentTranscriptMessage = {
  sentAt: Date | string;
  channel?: string | null;
  direction: "inbound" | "outbound" | string;
  body: string;
  subject?: string | null;
};

function serializeOneLine(text: string): string {
  const raw = (text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  // Keep whitespace as-is; only make newlines explicit so the transcript remains parseable.
  return raw.trim().replace(/\n/g, "\\n");
}

export function buildSentimentTranscriptFromMessages(messages: SentimentTranscriptMessage[]): string {
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
  //
  // IMPORTANT: If we see agent markers but no lead markers, the lead hasn't
  // responded; do not treat the agent's outbound as lead text.
  if (leadLines.length === 0) {
    const hasAgentMarkers = /\bAgent\s*:\s*/i.test(transcript);
    if (hasAgentMarkers) {
      return { allLeadText: "", lastLeadText: "" };
    }

    const cleaned = transcript.trim();
    return { allLeadText: cleaned, lastLeadText: cleaned };
  }

  const cleanedLeadLines = leadLines.map((l) => l.trim()).filter(Boolean);
  const allLeadText = cleanedLeadLines.join("\n");
  const lastLeadText = cleanedLeadLines[cleanedLeadLines.length - 1] || allLeadText;

  return { allLeadText, lastLeadText };
}

function truncateVeryLargeText(text: string, maxChars: number): string {
  const cleaned = (text || "").trim();
  if (cleaned.length <= maxChars) return cleaned;
  return `${cleaned.slice(0, 40_000)}\n\n...[TRUNCATED ${cleaned.length - 80_000} chars]...\n\n${cleaned.slice(
    cleaned.length - 40_000
  )}`;
}

// ============================================================================
// FAST PRE-CHECKS (MINIMAL)
// ============================================================================

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
  const strongOptOut =
    /\b(unsubscribe|opt\s*-?\s*out|remove me|remove us|take me off|take us off|stop (emailing|calling|contacting|messaging|texting)|do not (contact|email|call|text)|don['’]?t (contact|email|call|text)|take a hike|stop)\b/i;
  if (candidates.some((t) => strongOptOut.test(t))) {
    // Reduce false positives for "stop" in benign phrases like "stop by"
    if (!/\bstop\b/i.test(body)) return true;
    const stopHasContext =
      /\bstop\b/i.test(body) && /\b(text|txt|message|messages|messaging|contact|email|calling|call)\b/i.test(body);
    return stopHasContext || normalizedBody === "stop";
  }

  // Short-message unsubscribe (e.g., "UNSUBSCRIBE" + tiny signature)
  if (body.length <= 280 && /\bunsubscribe\b/i.test(body)) return true;
  if (subject && subject.length <= 120 && /\bunsubscribe\b/i.test(subject)) return true;

  return false;
}

// ============================================================================
// EMAIL INBOX ANALYSIS (PROMPT-ONLY)
// ============================================================================

function normalizeNewlines(text: string): string {
  return (text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\u0000/g, "");
}

function removeQuotedEmailLines(text: string): string {
  const lines = normalizeNewlines(text).split("\n");
  const kept = lines.filter((line) => !/^\s*>/.test(line));
  return kept.join("\n");
}

function cutAtFirstQuotedThreadMarker(text: string): string {
  const cleaned = normalizeNewlines(text);
  if (!cleaned.trim()) return "";

  const markers: RegExp[] = [
    // Very common separators
    /^-{2,}\s*Original Message\s*-{2,}\s*$/im,
    /^-{2,}\s*Forwarded message\s*-{2,}\s*$/im,
    /^-----\s*Original Message\s*-----$/im,
    /^-----\s*Forwarded message\s*-----$/im,
    /^_{5,}\s*$/m,

    // Gmail/clients: "On ... wrote:"
    /^\s*On\s+.+\s+wrote:\s*$/im,

    // Header blocks from quoted replies (only match when it looks like a header set)
    /(^|\n)\s*From:\s.+\n\s*(Sent|Date):\s.+\n\s*To:\s.+/i,
    /(^|\n)\s*From:\s.+\n\s*(Sent|Date):\s.+\n\s*Subject:\s.+/i,
    /(^|\n)\s*From:\s.+\n\s*To:\s.+\n\s*Subject:\s.+/i,
    /(^|\n)\s*From:\s.+\n\s*Subject:\s.+/i,
  ];

  let cutIndex: number | null = null;
  for (const re of markers) {
    const match = re.exec(cleaned);
    if (!match || typeof match.index !== "number") continue;
    if (cutIndex === null || match.index < cutIndex) cutIndex = match.index;
  }

  const out = cutIndex === null ? cleaned : cleaned.slice(0, cutIndex);
  return out.trim();
}

function extractLatestEmailReplyBlockPlaintextGuess(opts: {
  subject?: string | null;
  bodyText?: string | null;
  providerCleanedText?: string | null;
}): string {
  // Prefer the raw provider text body if available.
  const base = (opts.bodyText || opts.providerCleanedText || "").trim();
  if (!base) return "";

  // 1) Drop clearly-quoted lines, 2) cut at thread markers, 3) trim.
  const noQuotedLines = removeQuotedEmailLines(base);
  const topBlock = cutAtFirstQuotedThreadMarker(noQuotedLines);

  // If the body is empty/signature-only, the subject can still carry meaning,
  // but keep it separate so we don't pollute the "latest block".
  return topBlock.trim();
}

export type EmailInboxClassification =
  | "Meeting Booked"
  | "Meeting Requested"
  | "Call Requested"
  | "Information Requested"
  | "Follow Up"
  | "Not Interested"
  | "Objection"
  | "Automated Reply"
  | "Out Of Office"
  | "Blacklist";

export type EmailInboxAnalysis = {
  classification: EmailInboxClassification;
  cleaned_response: string;
  is_newsletter: boolean;
  mobile_number?: string;
  direct_phone?: string;
  scheduling_link?: string;
};

const EMAIL_INBOX_MANAGER_SYSTEM = `Output your response in the following strict JSON format:
{
  "classification": "One of: Meeting Booked, Meeting Requested, Call Requested, Information Requested, Follow Up, Not Interested, Objection, Automated Reply, Out Of Office, Blacklist",
  "cleaned_response": "Plain-text body including at most a short closing + name/job title. If the scheduling link is not in the signature and is in the main part of the email body do not omit it from the cleaned email body.",
  "mobile_number": "E.164 formatted string or null. It MUST be in E.164 format when present",
  "direct_phone": "E.164 formatted string or null. It MUST be in E.164 format when present",
  "scheduling_link": "String (URL) or null",
  "is_newsletter": "Boolean, true if this appears to be a newsletter or marketing email rather than a genuine reply"
}

Rules for cleaned_response:
- Include the body text only.
- Identify and keep only the latest reply block (remove quoted replies/forwards and markers like "On Mon, ... wrote:", "From:", "-----Original Message-----").
- Strip branded HTML signatures, logos, banners, and long disclaimers.
- Retain natural signature closings of up to 2 lines (e.g., "Best," + name, optionally job title).
- If the scheduling link is not in the signature and is in the main part of the email body, do not omit it from cleaned_response.

Primary weighting (avoid common misreads):
- Treat message.latest_reply_block_plaintext_guess as the highest-signal input for BOTH cleaning and classification.
- Use the subject line as a high-signal cue for "Out Of Office" / "Automatic Reply" variants.
- Use conversation history only to disambiguate ultra-short confirmations; never let quoted outbound text drive intent.
- Urgent-routing boilerplate (e.g., "if urgent, call ...") in auto-replies must NOT be treated as "Call Requested".

Rules for signature fields:
- Extract only mobile_number, direct_phone, and scheduling_link.
- Normalize phone numbers to E.164 format where possible. If no country code is present, leave in original format (do NOT guess).
- Use null for these keys if not present.
- Do not include extracted values inside cleaned_response.

Meeting Booked classification notes:
- Choose "Meeting Booked" ONLY if: an explicit date/time is accepted, OR the message confirms a booking/invite acceptance, OR the body explicitly instructs to book via THEIR scheduling link ("use my Calendly", "book via my link").
- Do NOT choose "Meeting Booked" if there is only a generic request for availability, or if a link exists only in a signature without explicit instruction.
- If they request a meeting but no time is confirmed → "Meeting Requested".
- If they request a phone call but no time is confirmed → "Call Requested" (only if explicitly a phone call).

Automated Reply vs Out Of Office:
- Use "Automated Reply" for generic auto-acknowledgements (e.g., "we received your message", "thank you for contacting us").
- Use "Out Of Office" specifically for absence/vacation/leave notifications.

Blacklist classification notes:
- Use "Blacklist" for explicit unsubscribe/removal requests, hostile opt-out language, spam complaints, bounces, or "inbox not monitored / no longer in use".

Follow Up classification notes:
- Use "Follow Up" when the lead is not ready / not right now but leaves the door open (timing deferral).
- Examples: "not ready to sell", "not looking to sell right now", "maybe next year", "in a couple of years", "reach back out in 6 months".

Objection classification notes:
- Use "Objection" when the lead raises a concern/constraint that blocks the next step without a hard decline (e.g., price/budget, already using a provider, skeptical, doesn't apply, capacity constraints).
- If they clearly say "not interested" / "no thanks" with no openness, prefer "Not Interested" over "Objection".

Newsletter / marketing detection notes:
- is_newsletter = true ONLY if you are very certain this is a marketing/newsletter blast (unsubscribe footer, digest/promotional template, broad marketing content, no reference to the outreach).
- is_newsletter = false for genuine human replies, auto-replies, or transactional emails.

Always output valid JSON. Always include classification, cleaned_response, is_newsletter, and set signature fields to null when not present.`;

function defaultAvailabilityText(clientName?: string | null): string {
  return `Here is the current availability for ${clientName || "the client"}:\n\nNO TIMES AVAILABLE - ASSUME THE TIME IS AVAILABLE AND CATEGORIZE AS 'Meeting Booked' IF A TIME HAS BEEN AGREED`;
}

export async function analyzeInboundEmailReply(opts: {
  clientId: string;
  leadId?: string | null;
  clientName?: string | null;
  lead?: {
    first_name?: string | null;
    last_name?: string | null;
    email?: string | null;
    time_received?: string | null;
  } | null;
  subject?: string | null;
  body_text?: string | null;
  provider_cleaned_text?: string | null;
  entire_conversation_thread_html?: string | null;
  automated_reply?: boolean | null;
  conversation_transcript?: string | null;
  availability_text?: string | null;
  maxRetries?: number;
}): Promise<EmailInboxAnalysis | null> {
  if (!process.env.OPENAI_API_KEY) return null;

  const maxRetries = opts.maxRetries ?? 2;
  const resolved = await resolvePromptTemplate({
    promptKey: "sentiment.email_inbox_analyze.v1",
    clientId: opts.clientId,
    systemFallback: EMAIL_INBOX_MANAGER_SYSTEM,
  });

  const systemPrompt = resolved.system;

  const latestReplyGuess = extractLatestEmailReplyBlockPlaintextGuess({
    subject: opts.subject,
    bodyText: opts.body_text ?? null,
    providerCleanedText: opts.provider_cleaned_text ?? null,
  });

  const userPayload = {
    role: "expert_inbox_manager",
    task: {
      description: `Categorize and clean up email responses from leads replying to cold email campaigns for ${opts.clientName || "the client"}.`,
      actions: [
        {
          name: "categorization",
          description: "Classify the reply into exactly one of the allowed categories.",
          allowed_categories: [
            "Meeting Booked",
            "Meeting Requested",
            "Call Requested",
            "Information Requested",
            "Follow Up",
            "Not Interested",
            "Objection",
            "Automated Reply",
            "Out Of Office",
            "Blacklist",
          ],
          thread_handling: {
            primary_focus:
              "Classify based on the latest human-written message (the topmost unquoted block) after cleaning, while also considering the subject line and the entire conversation history if they contain relevant classification cues.",
            use_history_to_disambiguate: [
              "If the latest message references a previously suggested time, verify that a specific date/time was explicitly accepted.",
              "If the latest message is a bare confirmation with no explicit time, check the immediately preceding turn for a specific time. If none is explicitly accepted, do NOT classify as 'Meeting Booked'.",
              "If the latest message asks for more details while prior turn discussed features, choose 'Information Requested'.",
            ],
          },
          signature_link_handling: {
            rule: "The mere presence of a scheduling link in a signature MUST NOT influence classification.",
            when_to_use_for_classification: [
              "Treat as 'Meeting Booked' if the body text explicitly instructs scheduling using their link (e.g., 'book via my calendar', 'use my link below').",
              "Treat as 'Meeting Booked' if the body confirms the meeting is already booked (e.g., 'I booked Wednesday 2pm via your link', 'invite accepted').",
              "Treat as 'Meeting Requested' ONLY if the body generally asks to arrange a meeting time without a booking link or confirmed acceptance.",
              "Treat as 'Call Requested' ONLY if the body asks to arrange a phone call without a confirmed time (explicitly a phone call).",
            ],
          },
          meeting_booked_guardrails: {
            require_one_of: [
              "An explicit date/time expression in the latest message indicating acceptance.",
              "An explicit acceptance or calendar confirmation referencing a concrete time.",
              "An explicit instruction to book directly on their calendar link.",
            ],
            not_meeting_booked_if: [
              "Generic confirmations without a time AND no explicit date/time is present or accepted.",
              "A signature shows a scheduling link without explicit instruction or booking confirmation in the body.",
            ],
          },
          decision_rules: [
            "Blacklist: Recipient explicitly requests removal/unsubscribe OR the subject line contains an explicit opt-out keyword.",
            "Automated Reply: Autoresponder message that is not an Out Of Office.",
            "Out Of Office: Autoresponder or manual note indicating absence/vacation/leave.",
            "Meeting Booked: ONLY if guardrails are satisfied.",
            "Meeting Requested: Recipient asks to arrange a meeting/demo but no confirmed time and no instruction to self-book.",
            "Call Requested: Recipient asks to arrange a phone call but no confirmed time (explicit phone call).",
            "Information Requested: Asks for details/clarifications/pricing/more information.",
            "Follow Up: Defers timing / not right now but leaves the door open (e.g., 'not ready', 'maybe next year', 'reach out in 6 months').",
            "Not Interested: Clear hard decline with no future openness and no explicit unsubscribe request.",
            "Objection: Raises a concern/constraint that blocks the next step without a hard decline (e.g., price/budget, already using a provider, skeptical, doesn't apply).",
          ],
        },
        {
          name: "cleaning",
          description:
            "Convert the email body to plain text, removing past threads, headers, and branded HTML signatures.",
          steps: [
            "Identify and keep only the latest reply block: remove quoted replies/forwards and markers like 'On Mon, ... wrote:'.",
            "Remove HTML artifacts, logos, banners, disclaimers, tracking pixels.",
            "Normalize whitespace and line breaks.",
            "Preserve a short natural closing up to 2 lines: a closing phrase + sender name and at most job title.",
            "If the scheduling link is not in the signature and is in the main part of the email body do not omit it from the cleaned email body.",
          ],
          signature_extraction: {
            fields_to_extract: ["mobile_number", "direct_phone", "scheduling_link"],
            rules: [
              "Detect and extract only if clearly present (including within HTML signatures).",
              "Normalize phone numbers to E.164 format when a country code is present; if no country code, leave as-is (do NOT guess).",
              "Scheduling link = any URL matching known schedulers or obvious 'schedule/book/calendar' patterns.",
              "Do not include extracted fields in the cleaned body.",
            ],
          },
        },
      ],
    },
    context: {
      company: opts.lead?.email ? String(opts.lead.email).split("@")[1] : null,
      lead: {
        first_name: opts.lead?.first_name ?? null,
        last_name: opts.lead?.last_name ?? null,
        email: opts.lead?.email ?? null,
        time_received: opts.lead?.time_received ?? null,
      },
      message: {
        subject: opts.subject ?? null,
        latest_reply_block_plaintext_guess: latestReplyGuess || null,
        body_text: opts.body_text ?? null,
        provider_cleaned_text: opts.provider_cleaned_text ?? null,
        entire_conversation_thread: truncateVeryLargeText(opts.entire_conversation_thread_html || "", 160_000) || null,
        automated_reply: opts.automated_reply ?? null,
        conversation_history_transcript: truncateVeryLargeText(opts.conversation_transcript || "", 200_000) || null,
      },
    },
    constraints: [
      "Always choose exactly one category from allowed list.",
      "Meeting Booked MUST satisfy the guardrails; otherwise use Meeting Requested / Call Requested / other best fit.",
      "If multiple cues exist, apply decision_rules priority order: Blacklist > Automated Reply > Out Of Office > Meeting Booked > Meeting Requested > Call Requested > Information Requested > Follow Up > Not Interested > Objection.",
      "Signature data must be excluded from cleaned_response and only output under the correct JSON keys.",
      "Use null for signature keys if not present.",
      "Do NOT use scheduling links found only in signatures to decide classification unless the body explicitly references using that link.",
      "Use the 'automated_reply' field from context to help identify Automated Reply vs Out Of Office classifications.",
    ],
  };

  const availability = (opts.availability_text || "").trim() || defaultAvailabilityText(opts.clientName);
  const userPrompt = `${JSON.stringify(userPayload, null, 2)}\n\n${availability}`;
  const model = "gpt-5-mini";
  const baseBudget = await computeAdaptiveMaxOutputTokens({
    model,
    instructions: systemPrompt,
    input: [{ role: "user", content: userPrompt }] as const,
    min: 1200,
    max: 2400,
    overheadTokens: 384,
    outputScale: 0.15,
    preferApiCount: true,
  });

  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      classification: {
        type: "string",
        enum: [
          "Meeting Booked",
          "Meeting Requested",
          "Call Requested",
          "Information Requested",
          "Follow Up",
          "Not Interested",
          "Automated Reply",
          "Out Of Office",
          "Blacklist",
        ],
      },
      cleaned_response: { type: "string" },
      mobile_number: { type: ["string", "null"] },
      direct_phone: { type: ["string", "null"] },
      scheduling_link: { type: ["string", "null"] },
      is_newsletter: { type: "boolean" },
    },
    // NOTE: OpenAI Structured Outputs requires `required` to include every key
    // in `properties` (no optional keys). Use `null` for "not present".
    required: ["classification", "cleaned_response", "mobile_number", "direct_phone", "scheduling_link", "is_newsletter"],
  } as const;

  const attempts = Array.from({ length: Math.max(1, maxRetries) }, (_, attemptIndex) =>
    Math.min(baseBudget.maxOutputTokens + attemptIndex * 600, 4000)
  );

  const result = await runStructuredJsonPrompt<EmailInboxAnalysis>({
    pattern: "structured_json",
    clientId: opts.clientId,
    leadId: opts.leadId,
    promptKey: "sentiment.email_inbox_analyze.v1",
    model,
    reasoningEffort: "low",
    systemFallback: EMAIL_INBOX_MANAGER_SYSTEM,
    resolved: {
      system: resolved.system,
      featureId: resolved.featureId,
      promptKeyForTelemetry: resolved.promptKeyForTelemetry,
    },
    input: [{ role: "user", content: userPrompt }] as const,
    schemaName: "email_inbox_analysis",
    strict: true,
    schema,
    attempts,
    budget: {
      min: 1200,
      max: 2400,
    },
    validate: (value) => {
      const anyValue = value as any;
      if (!anyValue || typeof anyValue !== "object") return { success: false, error: "not an object" };
      if (typeof anyValue.classification !== "string") return { success: false, error: "classification must be string" };
      if (typeof anyValue.cleaned_response !== "string") return { success: false, error: "cleaned_response must be string" };
      if (typeof anyValue.is_newsletter !== "boolean") return { success: false, error: "is_newsletter must be boolean" };

      const allowed: EmailInboxClassification[] = [
        "Meeting Booked",
        "Meeting Requested",
        "Call Requested",
        "Information Requested",
        "Follow Up",
        "Not Interested",
        "Automated Reply",
        "Out Of Office",
        "Blacklist",
      ];
      const classification = allowed.find((c) => c === anyValue.classification);
      if (!classification) return { success: false, error: "invalid classification" };

      const normalizeOptString = (raw: unknown): string | undefined => {
        if (typeof raw !== "string") return undefined;
        const trimmed = raw.trim();
        return trimmed ? trimmed : undefined;
      };

      const mobileNumber = normalizeOptString(anyValue.mobile_number);
      const directPhone = normalizeOptString(anyValue.direct_phone);
      const schedulingLink = normalizeOptString(anyValue.scheduling_link);

      return {
        success: true,
        data: {
          classification,
          cleaned_response: anyValue.cleaned_response,
          is_newsletter: anyValue.is_newsletter,
          ...(mobileNumber ? { mobile_number: mobileNumber } : {}),
          ...(directPhone ? { direct_phone: directPhone } : {}),
          ...(schedulingLink ? { scheduling_link: schedulingLink } : {}),
        },
      };
    },
  });

  return result.success ? result.data : null;
}

// ============================================================================
// SENTIMENT CLASSIFICATION (PROMPT-ONLY)
// ============================================================================

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
  const { lastLeadText } = extractLeadTextFromTranscript(transcript);
  if (!lastLeadText.trim()) {
    // No lead reply found; never classify based on agent outbound-only context.
    return "New";
  }

  const lastLeadCombined = (lastLeadText || "").replace(/\u00a0/g, " ").trim();
  const lastLeadLower = lastLeadCombined.toLowerCase();
  if (matchesAnyPattern(BOUNCE_PATTERNS, lastLeadLower)) return "Blacklist";
  if (isOptOutText(lastLeadCombined)) return "Blacklist";

  // Fast-path: avoid AI calls for very common, unambiguous replies.
  // This prevents webhook/runtime timeouts when OpenAI is slow.
  if (
    matchesAnyPattern(
      [
        /\bnot interested\b/i,
        /\bno thanks\b/i,
        /\bno thank you\b/i,
        /\bnot a fit\b/i,
        /\bnot for me\b/i,
        /\bnot at this time\b/i,
      ],
      lastLeadCombined
    )
  ) {
    return "Not Interested";
  }
  if (matchesAnyPattern([/\bout of office\b/i, /\bOOO\b/i, /\breturning\b.*\b(on|at)\b/i], lastLeadCombined)) {
    return "Out of Office";
  }

  const resolved = await resolvePromptTemplate({
    promptKey: "sentiment.classify.v1",
    clientId: opts.clientId,
    systemFallback:
      "You are an expert inbox manager. Classify the reply into ONE category and return only JSON {\"classification\": \"...\"}.",
  });

  const systemPrompt = resolved.system;

  const safeTranscript = truncateVeryLargeText(transcript, 240_000);
  const userTemplate = resolved.template?.messages.find((m) => m.role === "user")?.content || "";
  const userPrompt =
    (userTemplate ? substituteTemplateVars(userTemplate, { transcript: safeTranscript }) : "").trim() ||
    `Transcript (chronological; newest at the end):\n\n${safeTranscript}`;

  const enumTags = SENTIMENT_TAGS.filter((t) => t !== "New" && t !== "Snoozed");

  const model = "gpt-5-mini";
  const baseBudget = await computeAdaptiveMaxOutputTokens({
    model,
    instructions: systemPrompt,
    input: [{ role: "user", content: userPrompt }] as const,
    min: 256,
    max: 900,
    overheadTokens: 256,
    outputScale: 0.15,
    preferApiCount: true,
  });

  const timeoutMs = Math.max(5_000, Number.parseInt(process.env.OPENAI_SENTIMENT_TIMEOUT_MS || "25000", 10) || 25_000);
  const attempts = Array.from({ length: Math.max(1, maxRetries) }, (_, attemptIndex) =>
    Math.min(baseBudget.maxOutputTokens + attemptIndex * 400, 2000)
  );

  const result = await runStructuredJsonPrompt<{ classification: string }>({
    pattern: "structured_json",
    clientId: opts.clientId,
    leadId: opts.leadId,
    promptKey: "sentiment.classify.v1",
    model,
    reasoningEffort: "low",
    systemFallback: systemPrompt,
    resolved: {
      system: resolved.system,
      featureId: resolved.featureId,
      promptKeyForTelemetry: resolved.promptKeyForTelemetry,
    },
    input: [{ role: "user", content: userPrompt }] as const,
    schemaName: "sentiment_classification",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        classification: { type: "string", enum: enumTags },
      },
      required: ["classification"],
    },
    attempts,
    budget: {
      min: 256,
      max: 900,
    },
    timeoutMs,
    maxRetries: 0,
    validate: (value) => {
      const anyValue = value as any;
      if (!anyValue || typeof anyValue !== "object") return { success: false, error: "not an object" };
      if (typeof anyValue.classification !== "string") return { success: false, error: "classification must be string" };
      return { success: true, data: { classification: anyValue.classification } };
    },
  });

  if (!result.success) {
    return "Neutral";
  }

  const cleaned = String(result.data.classification || "").trim();
  const exact = enumTags.find((tag) => tag.toLowerCase() === cleaned.toLowerCase());
  return exact ?? "Neutral";
}
