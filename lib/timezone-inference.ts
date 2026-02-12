import "@/lib/server-dns";
import { runStructuredJsonPrompt } from "@/lib/ai/prompt-runner";
import { prisma } from "@/lib/prisma";

const CONFIDENCE_THRESHOLD = 0.95;

const TZ_ABBREVIATION_MAP: Record<string, { iana: string; confidence: number }> = {
  PST: { iana: "America/Los_Angeles", confidence: 0.97 },
  PDT: { iana: "America/Los_Angeles", confidence: 0.97 },
  MST: { iana: "America/Denver", confidence: 0.97 },
  MDT: { iana: "America/Denver", confidence: 0.97 },
  CST: { iana: "America/Chicago", confidence: 0.97 },
  CDT: { iana: "America/Chicago", confidence: 0.97 },
  EST: { iana: "America/New_York", confidence: 0.97 },
  EDT: { iana: "America/New_York", confidence: 0.97 },
  GMT: { iana: "Europe/London", confidence: 0.97 },
  UTC: { iana: "UTC", confidence: 0.97 },
  HST: { iana: "Pacific/Honolulu", confidence: 0.97 },
  AKST: { iana: "America/Anchorage", confidence: 0.97 },
  AKDT: { iana: "America/Anchorage", confidence: 0.97 },
  JST: { iana: "Asia/Tokyo", confidence: 0.97 },
  SGT: { iana: "Asia/Singapore", confidence: 0.97 },
  HKT: { iana: "Asia/Hong_Kong", confidence: 0.97 },
  CET: { iana: "Europe/Paris", confidence: 0.97 },
  CEST: { iana: "Europe/Paris", confidence: 0.97 },
  AEST: { iana: "Australia/Sydney", confidence: 0.97 },
  BST: { iana: "Europe/London", confidence: 0.85 },
  GST: { iana: "Asia/Dubai", confidence: 0.85 },
  AST: { iana: "America/Halifax", confidence: 0.8 },
  IST: { iana: "Asia/Kolkata", confidence: 0.8 },
};

const TZ_ABBREVIATION_PATTERN = Object.keys(TZ_ABBREVIATION_MAP).join("|");
const TZ_WITH_TIME_REGEX = new RegExp(
  `\\b(?:at\\s*)?\\d{1,2}(?::\\d{2})?\\s*(?:am|pm)?\\s*(${TZ_ABBREVIATION_PATTERN})\\b`,
  "gi"
);
const TZ_STANDALONE_REGEX = new RegExp(`\\b(${TZ_ABBREVIATION_PATTERN})\\b`, "gi");
const SCHEDULING_CONTEXT_REGEX =
  /\b(schedule|scheduling|book|booking|meeting|call|availability|available|works?|time|times|today|tomorrow|week|noon|morning|afternoon|evening|am|pm)\b/i;
const IANA_TIMEZONE_REGEX = /\b([A-Za-z_]+\/[A-Za-z_]+(?:\/[A-Za-z_]+)?)\b/g;
const LOCATION_TIMEZONE_HINTS: Array<{ keyword: string; iana: string; confidence: number }> = [
  { keyword: "miami", iana: "America/New_York", confidence: 0.95 },
  { keyword: "seattle", iana: "America/Los_Angeles", confidence: 0.96 },
  { keyword: "dubai", iana: "Asia/Dubai", confidence: 0.95 },
  { keyword: "new york", iana: "America/New_York", confidence: 0.95 },
  { keyword: "london", iana: "Europe/London", confidence: 0.95 },
  { keyword: "los angeles", iana: "America/Los_Angeles", confidence: 0.95 },
  { keyword: "chicago", iana: "America/Chicago", confidence: 0.95 },
  { keyword: "denver", iana: "America/Denver", confidence: 0.95 },
  { keyword: "toronto", iana: "America/Toronto", confidence: 0.95 },
];

export function isValidIanaTimezone(timeZone: string | null | undefined): boolean {
  if (!timeZone) return false;
  try {
    // Throws RangeError on invalid IANA tz names
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function normalizeState(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  // Handle "CA", "California", "CA - ..." etc.
  const upper = trimmed.toUpperCase();
  if (/^[A-Z]{2}$/.test(upper)) return upper;

  const match = upper.match(/\b([A-Z]{2})\b/);
  if (match?.[1]) return match[1];

  return trimmed;
}

function mapUsStateToTimezone(state: string): { timezone: string; confidence: number } | null {
  // Best-effort defaults (some states have multiple timezones; we choose the most common).
  const map: Record<string, string> = {
    AL: "America/Chicago",
    AK: "America/Anchorage",
    AZ: "America/Phoenix",
    AR: "America/Chicago",
    CA: "America/Los_Angeles",
    CO: "America/Denver",
    CT: "America/New_York",
    DE: "America/New_York",
    FL: "America/New_York",
    GA: "America/New_York",
    HI: "Pacific/Honolulu",
    ID: "America/Denver",
    IL: "America/Chicago",
    IN: "America/Indiana/Indianapolis",
    IA: "America/Chicago",
    KS: "America/Chicago",
    KY: "America/New_York",
    LA: "America/Chicago",
    ME: "America/New_York",
    MD: "America/New_York",
    MA: "America/New_York",
    MI: "America/Detroit",
    MN: "America/Chicago",
    MS: "America/Chicago",
    MO: "America/Chicago",
    MT: "America/Denver",
    NE: "America/Chicago",
    NV: "America/Los_Angeles",
    NH: "America/New_York",
    NJ: "America/New_York",
    NM: "America/Denver",
    NY: "America/New_York",
    NC: "America/New_York",
    ND: "America/Chicago",
    OH: "America/New_York",
    OK: "America/Chicago",
    OR: "America/Los_Angeles",
    PA: "America/New_York",
    RI: "America/New_York",
    SC: "America/New_York",
    SD: "America/Chicago",
    TN: "America/Chicago",
    TX: "America/Chicago",
    UT: "America/Denver",
    VT: "America/New_York",
    VA: "America/New_York",
    WA: "America/Los_Angeles",
    WV: "America/New_York",
    WI: "America/Chicago",
    WY: "America/Denver",
  };

  const timezone = map[state.toUpperCase()];
  if (!timezone) return null;
  return { timezone, confidence: 0.98 };
}

function mapKnownRegionSignalsToTimezone(opts: {
  companyState?: string | null;
  phone?: string | null;
  email?: string | null;
  companyWebsite?: string | null;
}): { timezone: string; confidence: number } | null {
  const state = (opts.companyState || "").toLowerCase();
  const email = (opts.email || "").toLowerCase();
  const website = (opts.companyWebsite || "").toLowerCase();
  const phone = (opts.phone || "").replace(/\s+/g, "");

  const looksUk =
    /\b(united kingdom|uk|england|scotland|wales|london|gb)\b/.test(state) ||
    /\.co\.uk\b/.test(email) ||
    /\.co\.uk\b/.test(website) ||
    phone.startsWith("+44");

  if (looksUk) {
    return { timezone: "Europe/London", confidence: 0.98 };
  }

  return null;
}

function extractRegexTimezoneFromConversation(messageText: string): {
  timezone: string;
  confidence: number;
} | null {
  const text = (messageText || "").trim();
  if (!text) return null;

  const candidates: Array<{ timezone: string; confidence: number; index: number }> = [];
  const lower = text.toLowerCase();

  const ianaMatches = text.matchAll(IANA_TIMEZONE_REGEX);
  for (const match of ianaMatches) {
    const raw = (match[1] || "").trim();
    if (!raw || !isValidIanaTimezone(raw)) continue;
    candidates.push({
      timezone: raw,
      confidence: 0.99,
      index: match.index ?? -1,
    });
  }

  const withTimeMatches = text.matchAll(TZ_WITH_TIME_REGEX);
  for (const match of withTimeMatches) {
    const token = (match[1] || "").toUpperCase();
    const mapped = TZ_ABBREVIATION_MAP[token];
    if (!mapped) continue;
    candidates.push({
      timezone: mapped.iana,
      confidence: mapped.confidence,
      index: match.index ?? -1,
    });
  }

  if (SCHEDULING_CONTEXT_REGEX.test(text)) {
    const standaloneMatches = text.matchAll(TZ_STANDALONE_REGEX);
    for (const match of standaloneMatches) {
      const token = (match[1] || "").toUpperCase();
      const mapped = TZ_ABBREVIATION_MAP[token];
      if (!mapped) continue;
      candidates.push({
        timezone: mapped.iana,
        confidence: mapped.confidence,
        index: match.index ?? -1,
      });
    }
  }

  for (const hint of LOCATION_TIMEZONE_HINTS) {
    const index = lower.lastIndexOf(hint.keyword);
    if (index < 0) continue;
    candidates.push({
      timezone: hint.iana,
      confidence: hint.confidence,
      index,
    });
  }

  if (candidates.length === 0) return null;

  const last = candidates.sort((a, b) => a.index - b.index).at(-1);
  if (!last) return null;

  return {
    timezone: last.timezone,
    confidence: last.confidence,
  };
}

export async function extractTimezoneFromConversation(opts: {
  messageText: string;
  clientId: string;
  leadId: string;
}): Promise<{
  timezone: string | null;
  confidence: number;
  source: "regex" | "ai_conversation";
} | null> {
  const regexResult = extractRegexTimezoneFromConversation(opts.messageText);
  if (regexResult?.timezone && isValidIanaTimezone(regexResult.timezone)) {
    return {
      timezone: regexResult.timezone,
      confidence: regexResult.confidence,
      source: "regex",
    };
  }

  if (!process.env.OPENAI_API_KEY) return null;

  try {
    const result = await runStructuredJsonPrompt<{ timezone: string | null; confidence: number }>({
      pattern: "structured_json",
      clientId: opts.clientId,
      leadId: opts.leadId,
      featureId: "timezone.infer_from_conversation",
      promptKey: "timezone.infer_from_conversation.v1",
      model: "gpt-5-nano",
      reasoningEffort: "low",
      systemFallback:
        "Extract the lead timezone from this inbound message. Return a valid IANA timezone when confident, otherwise null.",
      input: opts.messageText,
      schemaName: "timezone_infer_from_conversation",
      strict: true,
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          timezone: { type: ["string", "null"] },
          confidence: { type: "number", minimum: 0, maximum: 1 },
        },
        required: ["timezone", "confidence"],
      },
      budget: {
        min: 240,
        max: 240,
        retryMax: 480,
        overheadTokens: 96,
        outputScale: 0.2,
        preferApiCount: true,
      },
      validate: (value) => {
        const anyValue = value as any;
        if (!anyValue || typeof anyValue !== "object") return { success: false, error: "not an object" };
        const timezone = anyValue.timezone;
        const confidence = anyValue.confidence;
        if (!(typeof timezone === "string" || timezone === null)) return { success: false, error: "timezone must be string|null" };
        if (typeof confidence !== "number" || !Number.isFinite(confidence)) return { success: false, error: "confidence must be number" };
        return { success: true, data: { timezone, confidence } };
      },
    });

    if (!result.success) return null;

    const timezone = result.data.timezone;
    const confidence = Math.max(0, Math.min(1, result.data.confidence));

    if (!timezone || !isValidIanaTimezone(timezone)) {
      return {
        timezone: null,
        confidence,
        source: "ai_conversation",
      };
    }

    return {
      timezone,
      confidence,
      source: "ai_conversation",
    };
  } catch {
    return null;
  }
}

export async function ensureLeadTimezone(
  leadId: string,
  opts?: { conversationText?: string | null; subjectText?: string | null; supplementalText?: string | null }
): Promise<{
  timezone: string | null;
  source: "existing" | "deterministic" | "conversation" | "ai" | "workspace_fallback";
  confidence?: number;
}> {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: {
      id: true,
      clientId: true,
      timezone: true,
      companyState: true,
      phone: true,
      email: true,
      companyName: true,
      companyWebsite: true,
      client: { select: { settings: { select: { timezone: true } } } },
    },
  });

  if (!lead) {
    return { timezone: null, source: "workspace_fallback" };
  }

  // Deterministic: known region signals (e.g., UK).
  const known = mapKnownRegionSignalsToTimezone({
    companyState: lead.companyState,
    phone: lead.phone,
    email: lead.email,
    companyWebsite: lead.companyWebsite,
  });
  if (known?.timezone && isValidIanaTimezone(known.timezone) && known.confidence >= CONFIDENCE_THRESHOLD) {
    if (isValidIanaTimezone(lead.timezone) && lead.timezone === known.timezone) {
      return { timezone: lead.timezone!, source: "existing", confidence: 1 };
    }

    await prisma.lead.update({
      where: { id: leadId },
      data: { timezone: known.timezone },
    });
    return { timezone: known.timezone, source: "deterministic", confidence: known.confidence };
  }

  // Conversation-provided timezone should override stale saved timezone when explicit.
  const conversationText = [opts?.subjectText ? `Subject: ${opts.subjectText}` : "", opts?.conversationText || "", opts?.supplementalText || ""]
    .filter(Boolean)
    .join("\n\n")
    .trim();
  if (conversationText) {
    const conversationInference = await extractTimezoneFromConversation({
      messageText: conversationText,
      clientId: lead.clientId,
      leadId,
    });

    if (
      conversationInference?.timezone &&
      conversationInference.confidence >= CONFIDENCE_THRESHOLD &&
      isValidIanaTimezone(conversationInference.timezone)
    ) {
      if (lead.timezone !== conversationInference.timezone) {
        await prisma.lead.update({
          where: { id: leadId },
          data: { timezone: conversationInference.timezone },
        });
      }
      return {
        timezone: conversationInference.timezone,
        source: "conversation",
        confidence: conversationInference.confidence,
      };
    }
  }

  if (isValidIanaTimezone(lead.timezone)) {
    return { timezone: lead.timezone!, source: "existing", confidence: 1 };
  }

  // Deterministic: if companyState is a US state code, use a best-effort timezone.
  const state = normalizeState(lead.companyState);
  if (state && /^[A-Z]{2}$/.test(state)) {
    const mapped = mapUsStateToTimezone(state);
    if (mapped?.timezone && isValidIanaTimezone(mapped.timezone) && mapped.confidence >= CONFIDENCE_THRESHOLD) {
      await prisma.lead.update({
        where: { id: leadId },
        data: { timezone: mapped.timezone },
      });
      return { timezone: mapped.timezone, source: "deterministic", confidence: mapped.confidence };
    }
  }

  // AI inference (only if configured)
  if (!process.env.OPENAI_API_KEY) {
    const fallback = lead.client.settings?.timezone || null;
    return { timezone: fallback, source: "workspace_fallback" };
  }

  try {
    const systemFallback = "Infer the lead's IANA timezone. Output only JSON.";
    const input = JSON.stringify(
      {
        companyState: lead.companyState,
        phone: lead.phone,
        email: lead.email,
        companyName: lead.companyName,
        companyWebsite: lead.companyWebsite,
        workspaceTimezone: lead.client.settings?.timezone || null,
      },
      null,
      2
    );

    const result = await runStructuredJsonPrompt<{ timezone: string | null; confidence: number }>({
      pattern: "structured_json",
      clientId: lead.clientId,
      leadId,
      featureId: "timezone.infer",
      promptKey: "timezone.infer.v1",
      model: "gpt-5-nano",
      reasoningEffort: "low",
      systemFallback,
      templateVars: { confidenceThreshold: String(CONFIDENCE_THRESHOLD) },
      input,
      schemaName: "timezone_inference",
      strict: true,
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          timezone: { type: ["string", "null"] },
          confidence: { type: "number", minimum: 0, maximum: 1 },
        },
        required: ["timezone", "confidence"],
      },
      budget: {
        min: 240,
        max: 240,
        retryMax: 480,
        overheadTokens: 96,
        outputScale: 0.2,
        preferApiCount: true,
      },
      validate: (value) => {
        const anyValue = value as any;
        if (!anyValue || typeof anyValue !== "object") return { success: false, error: "not an object" };
        const timezone = anyValue.timezone;
        const confidence = anyValue.confidence;
        if (!(typeof timezone === "string" || timezone === null)) return { success: false, error: "timezone must be string|null" };
        if (typeof confidence !== "number" || !Number.isFinite(confidence)) return { success: false, error: "confidence must be number" };
        return { success: true, data: { timezone, confidence } };
      },
    });

    if (!result.success) {
      const fallback = lead.client.settings?.timezone || null;
      return { timezone: fallback, source: "workspace_fallback" };
    }

    const tz = result.data.timezone;
    const conf = result.data.confidence;

    if (tz && conf >= CONFIDENCE_THRESHOLD && isValidIanaTimezone(tz)) {
      await prisma.lead.update({
        where: { id: leadId },
        data: { timezone: tz },
      });
      return { timezone: tz, source: "ai", confidence: conf };
    }

    const fallback = lead.client.settings?.timezone || null;
    return { timezone: fallback, source: "workspace_fallback", confidence: conf };
  } catch {
    const fallback = lead.client.settings?.timezone || null;
    return { timezone: fallback, source: "workspace_fallback" };
  }
}
