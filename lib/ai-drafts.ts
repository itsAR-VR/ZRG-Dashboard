import { getAIPromptTemplate, getPromptWithOverrides } from "@/lib/ai/prompt-registry";
import { markAiInteractionError } from "@/lib/ai/openai-telemetry";
import { runStructuredJsonPrompt, runTextPrompt } from "@/lib/ai/prompt-runner";
import { computeAdaptiveMaxOutputTokens } from "@/lib/ai/token-budget";
import {
  getEffectiveForbiddenTerms,
  DEFAULT_FORBIDDEN_TERMS,
  buildEffectiveEmailLengthRules,
  getEffectiveArchetypeInstructions,
} from "@/lib/ai/prompt-snippets";
import { prisma } from "@/lib/prisma";
import { getWorkspaceAvailabilitySlotsUtc } from "@/lib/availability-cache";
import { ensureLeadTimezone } from "@/lib/timezone-inference";
import { formatAvailabilitySlots } from "@/lib/availability-format";
import { selectDistributedAvailabilitySlots } from "@/lib/availability-distribution";
import { getWorkspaceSlotOfferCountsForRange, incrementWorkspaceSlotOffersBatch } from "@/lib/slot-offer-ledger";
import { isPositiveSentiment } from "@/lib/sentiment";
import {
  coerceDraftGenerationModel,
  coerceDraftGenerationReasoningEffort,
  coerceEmailDraftVerificationModel,
  buildArchetypeSeed,
  selectArchetypeFromSeed,
  getArchetypeById,
  buildArchetypeSelectionGuide,
  EMAIL_DRAFT_STRUCTURE_ARCHETYPES,
  type EmailDraftArchetype,
} from "@/lib/ai-drafts/config";
import { enforceCanonicalBookingLink, replaceEmDashesWithCommaSpace } from "@/lib/ai-drafts/step3-verifier";
import { getBookingProcessInstructions } from "@/lib/booking-process-instructions";
import { resolveBookingLink } from "@/lib/meeting-booking-provider";
import { getLeadQualificationAnswerState } from "@/lib/qualification-answer-extraction";
import { extractImportantEmailSignatureContext, type EmailSignatureContextExtraction } from "@/lib/email-signature-context";
import { emailsMatch, extractFirstName } from "@/lib/email-participants";
import { PRIMARY_WEBSITE_ASSET_NAME, extractPrimaryWebsiteUrlFromAssets } from "@/lib/knowledge-asset-context";
import { getLeadMemoryContext } from "@/lib/lead-memory-context";
import {
  getMeetingOverseerDecision,
  runMeetingOverseerGate,
  shouldRunMeetingOverseer,
  type MeetingOverseerExtractDecision,
} from "@/lib/meeting-overseer";
import type { AvailabilitySource } from "@prisma/client";

type DraftChannel = "sms" | "email" | "linkedin";

interface DraftGenerationResult {
  success: boolean;
  draftId?: string;
  content?: string;
  error?: string;
}

export type DraftGenerationOptions = {
  /**
   * Hard timeout for the OpenAI Responses request (ms).
   * Use a lower timeout in webhook contexts to avoid Vercel timeouts.
   */
  timeoutMs?: number;
  /**
   * Inbound Message.id that triggered this draft (idempotency key).
   * When provided, generateResponseDraft will return an existing draft for
   * (triggerMessageId, channel) instead of creating a duplicate.
   */
  triggerMessageId?: string | null;
  /**
   * Multiplier applied to the adaptive output token budget (min/max/overhead/outputScale).
   * Defaults to `OPENAI_DRAFT_TOKEN_BUDGET_MULTIPLIER` or 3.
   */
  tokenBudgetMultiplier?: number;
  /**
   * If true, attempts to call OpenAI's input-tokens count endpoint to size budgets.
   * Adds an extra request; consider disabling for latency-sensitive contexts.
   */
  preferApiCount?: boolean;
};

// ---------------------------------------------------------------------------
// Draft Output Hardening (Phase 45)
// ---------------------------------------------------------------------------

const BOOKING_LINK_PLACEHOLDER_REGEX =
  /(\{|\[)\s*(?:insert\s+)?(?:your\s+)?(?:booking|calendar|calendly|scheduling)\s+link\s*(\}|\])/i;
const BOOKING_LINK_PLACEHOLDER_GLOBAL_REGEX =
  /(\{|\[)\s*(?:insert\s+)?(?:your\s+)?(?:booking|calendar|calendly|scheduling)\s+link\s*(\}|\])/gi;

// Matches truncated URLs like "https://c" or "https://cal." (but not "https://cal.com/user").
const TRUNCATED_URL_REGEX = /https?:\/\/[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?\.?(?=\s|$)/i;
const TRUNCATED_URL_GLOBAL_REGEX = /https?:\/\/[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?\.?(?=\s|$)/gi;

function isMaxOutputTokensIncomplete(response: any): boolean {
  return response?.status === "incomplete" && response?.incomplete_details?.reason === "max_output_tokens";
}

function getEmailDraftCharBoundsFromEnv(): { minChars: number; maxChars: number } {
  const defaultMin = 220;
  const defaultMax = 1200;

  const parsedMin = Number.parseInt(process.env.OPENAI_EMAIL_DRAFT_MIN_CHARS || "", 10);
  const parsedMax = Number.parseInt(process.env.OPENAI_EMAIL_DRAFT_MAX_CHARS || "", 10);

  const minChars = Number.isFinite(parsedMin) && parsedMin > 0 ? parsedMin : defaultMin;
  const maxChars = Number.isFinite(parsedMax) && parsedMax > 0 ? parsedMax : defaultMax;

  if (maxChars <= minChars) {
    return { minChars: Math.max(1, minChars), maxChars: Math.max(minChars + 200, maxChars) };
  }

  return { minChars, maxChars };
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function parsePositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  const parsed = Number.parseInt(raw || "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.trunc(parsed);
}

function parsePositiveFloatEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  const parsed = Number.parseFloat(raw || "");
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function computeTimeoutSliceMs(opts: {
  totalTimeoutMs: number;
  capEnv: string;
  minEnv: string;
  shareEnv: string;
  defaultCapMs: number;
  defaultMinMs: number;
  defaultShare: number;
}): number {
  const totalMs = Math.max(1_000, Math.trunc(opts.totalTimeoutMs));

  const capRaw = parsePositiveIntEnv(opts.capEnv, opts.defaultCapMs);
  const minRaw = parsePositiveIntEnv(opts.minEnv, opts.defaultMinMs);
  const shareRaw = parsePositiveFloatEnv(opts.shareEnv, opts.defaultShare);

  const share = clampNumber(shareRaw, 0.05, 0.8);
  const minMs = Math.max(1_000, minRaw);
  const capMs = Math.max(1_000, capRaw);

  // Never allocate more than the overall draft timeout. (This also prevents misconfigured mins from exceeding the total.)
  const minEffective = Math.min(minMs, totalMs);
  const capEffective = Math.min(Math.max(minEffective, capMs), totalMs);

  const shareMs = Math.floor(totalMs * share);
  return Math.min(capEffective, Math.max(minEffective, shareMs));
}

function getEmailLengthStatus(
  content: string,
  bounds: { minChars: number; maxChars: number }
): "ok" | "too_short" | "too_long" {
  const trimmed = content.trim();
  if (!trimmed) return "ok"; // opt-outs are allowed to be empty
  if (trimmed.length < bounds.minChars) return "too_short";
  if (trimmed.length > bounds.maxChars) return "too_long";
  return "ok";
}

function detectDraftIssues(content: string): { hasPlaceholders: boolean; hasTruncatedUrl: boolean } {
  return {
    hasPlaceholders: BOOKING_LINK_PLACEHOLDER_REGEX.test(content),
    hasTruncatedUrl: TRUNCATED_URL_REGEX.test(content),
  };
}

export function sanitizeDraftContent(content: string, leadId: string, channel: DraftChannel): string {
  const before = content;
  let result = content;

  const hadPlaceholders = BOOKING_LINK_PLACEHOLDER_REGEX.test(result);
  if (hadPlaceholders) {
    result = result.replace(BOOKING_LINK_PLACEHOLDER_GLOBAL_REGEX, "");
  }

  const hadTruncatedUrl = TRUNCATED_URL_REGEX.test(result);
  if (hadTruncatedUrl) {
    result = result.replace(TRUNCATED_URL_GLOBAL_REGEX, "");
  }

  // Avoid mutating formatting too aggressively (newlines matter for email).
  result = result.replace(/[ \t]{2,}/g, " ").trim();

  if (hadPlaceholders || hadTruncatedUrl) {
    console.warn(`[AI Drafts] Sanitized draft for lead ${leadId} (${channel})`, {
      hadPlaceholders,
      hadTruncatedUrl,
      changed: result !== before,
    });
  }

  return result;
}

// ---------------------------------------------------------------------------
// Step 3 — Email Draft Verification (Phase 49)
// ---------------------------------------------------------------------------

async function getLatestInboundEmailTextForVerifier(opts: {
  leadId: string;
  triggerMessageId: string | null;
}): Promise<string | null> {
  if (opts.triggerMessageId) {
    const trigger = await prisma.message.findUnique({
      where: { id: opts.triggerMessageId },
      select: { leadId: true, direction: true, channel: true, body: true, subject: true },
    });

    if (trigger?.leadId === opts.leadId && trigger.direction === "inbound" && trigger.channel === "email") {
      const subject = trigger.subject ? `Subject: ${trigger.subject}\n\n` : "";
      return `${subject}${trigger.body}`.trim();
    }
  }

  const latest = await prisma.message.findFirst({
    where: { leadId: opts.leadId, direction: "inbound", channel: "email" },
    orderBy: [{ sentAt: "desc" }, { createdAt: "desc" }],
    select: { body: true, subject: true },
  });

  if (!latest?.body) return null;
  const subject = latest.subject ? `Subject: ${latest.subject}\n\n` : "";
  return `${subject}${latest.body}`.trim();
}

function isLikelyRewrite(before: string, after: string): boolean {
  const beforeTrimmed = before.trim();
  const afterTrimmed = after.trim();
  if (!beforeTrimmed || !afterTrimmed) return false;

  const beforeLen = beforeTrimmed.length;
  const afterLen = afterTrimmed.length;
  const delta = Math.abs(afterLen - beforeLen);
  const ratio = delta / Math.max(1, beforeLen);

  // Conservative: allow small edits, but reject large rewrites.
  return (ratio > 0.45 && delta > 250) || delta > 900;
}

async function runEmailDraftVerificationStep3(opts: {
  clientId: string;
  leadId: string;
  triggerMessageId: string | null;
  draft: string;
  availability: string[];
  bookingLink: string | null;
  bookingProcessInstructions: string | null;
  forbiddenTerms: string[];
  serviceDescription: string | null;
  knowledgeContext: string;
  timeoutMs: number;
}): Promise<string | null> {
  const promptKey = "draft.verify.email.step3.v1";
  const latestInbound = await getLatestInboundEmailTextForVerifier({
    leadId: opts.leadId,
    triggerMessageId: opts.triggerMessageId,
  });

  const overrideResult = await getPromptWithOverrides(promptKey, opts.clientId);
  const promptTemplate = overrideResult?.template ?? getAIPromptTemplate(promptKey);
  const overrideVersion = overrideResult?.overrideVersion ?? null;

  if (!promptTemplate) {
    console.warn(`[AI Drafts] Missing verifier prompt template: ${promptKey}`);
    return null;
  }

  const templateVars: Record<string, string> = {
    latestInbound: latestInbound || "None.",
    availability: opts.availability.length ? opts.availability.map((s) => `- ${s}`).join("\n") : "None.",
    bookingLink: (opts.bookingLink || "").trim() || "None.",
    bookingProcessInstructions: (opts.bookingProcessInstructions || "").trim() || "None.",
    serviceDescription: (opts.serviceDescription || "").trim() || "None.",
    knowledgeContext: (opts.knowledgeContext || "").trim() || "None.",
    forbiddenTerms: opts.forbiddenTerms.length ? opts.forbiddenTerms.join("\n") : "None.",
    draft: opts.draft || "",
  };

  const applyTemplateVars = (content: string): string => {
    let next = content;
    for (const [key, value] of Object.entries(templateVars)) {
      next = next.replaceAll(`{{${key}}}`, value);
      next = next.replaceAll(`{${key}}`, value);
    }
    return next;
  };

  const instructions =
    promptTemplate.messages
      .filter((m) => m.role === "system")
      .map((m) => applyTemplateVars(m.content))
      .join("\n\n")
      .trim() || "";

  const inputMessages = promptTemplate.messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role as "user" | "assistant",
      content: applyTemplateVars(m.content),
    }));

  const envVerifierModel = (process.env.OPENAI_EMAIL_VERIFIER_MODEL || "").trim() || null;
  const verifierModel = coerceEmailDraftVerificationModel(
    envVerifierModel ||
      (
        await prisma.workspaceSettings.findUnique({
          where: { clientId: opts.clientId },
          select: { emailDraftVerificationModel: true },
        })
      )?.emailDraftVerificationModel ||
      null
  );
  const verifierReasoningEffort = "low" as const;
  const shouldLogVerifierDetails = process.env.LOG_SLOW_PATHS === "1";

  let interactionId: string | null = null;

  try {
    const promptKeyForTelemetry = (promptTemplate.key || promptKey) + (overrideVersion ? `.${overrideVersion}` : "");
    const result = await runStructuredJsonPrompt<EmailDraftVerificationStep3>({
      pattern: "structured_json",
      clientId: opts.clientId,
      leadId: opts.leadId,
      featureId: promptTemplate.featureId || "draft.verify.email.step3",
      promptKey,
      model: verifierModel,
      reasoningEffort: verifierReasoningEffort,
      temperature: 0,
      systemFallback: instructions,
      input: inputMessages,
      schemaName: "email_draft_verification_step3",
      strict: true,
      schema: EMAIL_DRAFT_VERIFY_STEP3_JSON_SCHEMA,
      attempts: [1400],
      budget: { min: 1400, max: 1400 },
      timeoutMs: Math.max(5000, opts.timeoutMs),
      maxRetries: 0,
      resolved: {
        system: instructions,
        featureId: promptTemplate.featureId || "draft.verify.email.step3",
        promptKeyForTelemetry,
      },
      validate: (value) => {
        if (!value || typeof value !== "object") return { success: false, error: "Expected object" };
        const anyValue = value as any;
        if (typeof anyValue.finalDraft !== "string") return { success: false, error: "Missing finalDraft" };
        if (typeof anyValue.changed !== "boolean") return { success: false, error: "Missing changed" };
        if (!Array.isArray(anyValue.violationsDetected)) return { success: false, error: "Missing violationsDetected" };
        if (!Array.isArray(anyValue.changes)) return { success: false, error: "Missing changes" };
        return { success: true, data: anyValue as EmailDraftVerificationStep3 };
      },
    });

    interactionId = result.telemetry.interactionId;

    if (!result.success) {
      if (shouldLogVerifierDetails) {
        console.warn(`[AI Drafts] Step 3 verifier failed; discarding output`, {
          leadId: opts.leadId,
          category: result.error.category,
          message: result.error.message,
        });
      }

      if (interactionId) {
        const kind =
          result.error.category === "incomplete_output"
            ? "email_step3_truncated"
            : result.error.category === "parse_error" || result.error.category === "schema_violation"
              ? "email_step3_invalid_json"
              : "email_step3_error";
        await markAiInteractionError(interactionId, `${kind}: ${result.error.message.slice(0, 500)}`);
      }

      return null;
    }

    const parsed = result.data;

    const finalDraft = parsed.finalDraft.trim();
    if (!finalDraft) return null;

    if (isLikelyRewrite(opts.draft, finalDraft)) {
      if (shouldLogVerifierDetails) {
        console.warn(`[AI Drafts] Step 3 verifier produced a likely rewrite; discarding output`, {
          leadId: opts.leadId,
          beforeLen: opts.draft.trim().length,
          afterLen: finalDraft.length,
        });
      }
      if (interactionId) {
        await markAiInteractionError(interactionId, "email_step3_rewrite_guardrail");
      }
      return null;
    }

    if (parsed.changed || parsed.violationsDetected.length || parsed.changes.length) {
      if (shouldLogVerifierDetails) {
        console.log(`[AI Drafts] Step 3 verifier applied changes`, {
          leadId: opts.leadId,
          changed: parsed.changed,
          violationsDetected: parsed.violationsDetected.slice(0, 8),
          changes: parsed.changes.slice(0, 8),
        });
      }
    }

    return finalDraft;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (shouldLogVerifierDetails) {
      console.warn("[AI Drafts] Step 3 verifier failed:", message);
    }
    if (interactionId) {
      await markAiInteractionError(interactionId, `email_step3_error: ${message.slice(0, 200)}`);
    }
    return null;
  }
}

// ---------------------------------------------------------------------------
// AI Persona Resolution (Phase 39)
// ---------------------------------------------------------------------------

type ResolvedPersona = {
  personaName: string;
  tone: string;
  greeting: string;
  smsGreeting: string;
  signature: string | null;
  goals: string | null;
  serviceDescription: string | null;
  idealCustomerProfile: string | null;
  source: "campaign" | "default" | "settings";
};

type PersonaData = {
  id: string;
  name: string;
  personaName: string | null;
  tone: string;
  greeting: string | null;
  smsGreeting: string | null;
  signature: string | null;
  goals: string | null;
  serviceDescription: string | null;
  idealCustomerProfile: string | null;
};

type LeadForPersona = {
  client: {
    name: string;
    settings: {
      aiPersonaName: string | null;
      aiTone: string | null;
      aiGreeting: string | null;
      aiSmsGreeting: string | null;
      aiSignature: string | null;
      aiGoals: string | null;
      serviceDescription: string | null;
      idealCustomerProfile: string | null;
    } | null;
    aiPersonas: PersonaData[];
  } | null;
  emailCampaign: {
    id: string;
    aiPersona: PersonaData | null;
  } | null;
};

function resolvePersona(
  lead: LeadForPersona,
  channel: "sms" | "email" | "linkedin"
): ResolvedPersona {
  const settings = lead.client?.settings;
  const campaignPersona = lead.emailCampaign?.aiPersona;
  const defaultPersona = lead.client?.aiPersonas?.[0]; // isDefault: true from query

  // Priority: campaign persona > default persona > settings
  const persona = campaignPersona ?? defaultPersona;

  const defaultGreeting = "Hi {firstName},";

  if (persona) {
    return {
      personaName: persona.personaName || lead.client?.name || "Your Sales Rep",
      tone: persona.tone || "friendly-professional",
      greeting:
        channel === "sms"
          ? persona.smsGreeting?.trim() || persona.greeting?.trim() || defaultGreeting
          : persona.greeting?.trim() || defaultGreeting,
      smsGreeting: persona.smsGreeting?.trim() || persona.greeting?.trim() || defaultGreeting,
      signature: persona.signature?.trim() || null,
      goals: persona.goals?.trim() || null,
      serviceDescription: persona.serviceDescription?.trim() || null,
      idealCustomerProfile: persona.idealCustomerProfile?.trim() || null,
      source: campaignPersona ? "campaign" : "default",
    };
  }

  // Fallback to WorkspaceSettings (backward compatibility)
  return {
    personaName: settings?.aiPersonaName || lead.client?.name || "Your Sales Rep",
    tone: settings?.aiTone || "friendly-professional",
    greeting:
      channel === "sms"
        ? settings?.aiSmsGreeting?.trim() || settings?.aiGreeting?.trim() || defaultGreeting
        : settings?.aiGreeting?.trim() || defaultGreeting,
    smsGreeting: settings?.aiSmsGreeting?.trim() || settings?.aiGreeting?.trim() || defaultGreeting,
    signature: settings?.aiSignature?.trim() || null,
    goals: settings?.aiGoals?.trim() || null,
    serviceDescription: settings?.serviceDescription?.trim() || null,
    idealCustomerProfile: settings?.idealCustomerProfile?.trim() || null,
    source: "settings",
  };
}

function isPrismaUniqueConstraintError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  return "code" in error && (error as { code?: unknown }).code === "P2002";
}

// Email forbidden terms now sourced from prompt-snippets.ts (Phase 47e)
// This reference is kept for backward compatibility in non-async contexts
const EMAIL_FORBIDDEN_TERMS = DEFAULT_FORBIDDEN_TERMS;

function buildSmsPrompt(opts: {
  aiName: string;
  aiTone: string;
  aiGreeting: string;
  firstName: string;
  responseStrategy: string;
  sentimentTag: string;
  aiGoals?: string | null;
  serviceDescription?: string | null;
  qualificationQuestions?: string[];
  knowledgeContext?: string;
  ourWebsiteUrl?: string | null;
  companyName?: string | null;
  targetResult?: string | null;
  availability?: string[];
}) {
  const greeting = opts.aiGreeting.replace("{firstName}", opts.firstName);

  // Build company context section
  const companyContext = opts.companyName
    ? `Company: ${opts.companyName}\n`
    : "";

  // Build value proposition context
  const valueProposition = opts.targetResult
    ? `Value Proposition: We help clients with ${opts.targetResult}\n`
    : "";

  // Build service context section
  const serviceContext = opts.serviceDescription
    ? `\nAbout Our Business:\n${opts.serviceDescription}\n`
    : "";

  // Build qualification guidance
  const qualificationGuidance = opts.qualificationQuestions && opts.qualificationQuestions.length > 0
    ? `\nQualification Questions to naturally weave into conversation when appropriate:\n${opts.qualificationQuestions.map(q => `- ${q}`).join("\n")}\n`
    : "";

  // Build knowledge context
  const knowledgeSection = opts.knowledgeContext
    ? `\nReference Information:\n${opts.knowledgeContext}\n`
    : "";
  const websiteSection = opts.ourWebsiteUrl
    ? `\nOUR WEBSITE (use only when explicitly asked for website/link; do not use for generic "more info" requests):\n${opts.ourWebsiteUrl}\n`
    : "";

  const availabilitySection =
    opts.availability && opts.availability.length > 0
      ? `\nAvailable times (use verbatim if proposing times):\n${opts.availability.map((s) => `- ${s}`).join("\n")}\n`
      : "";

  return `You are ${opts.aiName}, a professional sales representative${opts.companyName ? ` from ${opts.companyName}` : ""}. Generate an SMS response based on the conversation context and sentiment.

OUTPUT FORMAT (strict):
- Prefer a single SMS part (<= 160 characters).
- If you cannot fit the required content in one part, output up to 3 SMS parts, each <= 160 characters.
- Separate parts with a line containing ONLY: ---
- Do NOT number the parts. Do NOT add any other labels or commentary.

${companyContext}${valueProposition}Tone: ${opts.aiTone}
Strategy: ${opts.responseStrategy}
Primary Goal/Strategy: ${opts.aiGoals || "Use good judgment to advance the conversation while respecting user intent."}
${serviceContext}${qualificationGuidance}${knowledgeSection}${websiteSection}${availabilitySection}
Guidelines:
- Keep each SMS part <= 160 characters (hard limit). Total parts max 3.
- Be professional but personable
- Don't use emojis unless the lead used them first
- Only mention the website if an OUR WEBSITE section is provided. Never claim you lack an official link.
- If the lead asks for more info (e.g., "send me more info"), summarize our offer and relevant Reference Information. Do NOT treat "more info" as a website request unless they explicitly asked for a link.
- TIMING AWARENESS: If the lead expressed a timing preference (e.g., "next week", "after the 15th"), ONLY offer times that match their request. Do NOT offer "this week" times if they said "next week". If no available times match their preference, ask what works better instead of offering mismatched times.
- If proposing meeting times and availability is provided, offer 2 options from the list (verbatim) and ask which works. When the lead expressed a timing preference, only offer times that match it. When no timing preference was expressed, prefer sooner options but never offer same-day (today) times unless the lead explicitly asks for today. If no availability is provided, ask for their availability.
- For objections, acknowledge and redirect professionally
- Never be pushy or aggressive
- If appropriate, naturally incorporate a qualification question
- When contextually appropriate, you may mention your company name naturally (don't force it into every message)
- Start with: ${greeting}`;
}

function buildLinkedInPrompt(opts: {
  aiName: string;
  aiTone: string;
  aiGreeting: string;
  firstName: string;
  responseStrategy: string;
  sentimentTag: string;
  aiGoals?: string | null;
  serviceDescription?: string | null;
  qualificationQuestions?: string[];
  knowledgeContext?: string;
  ourWebsiteUrl?: string | null;
  companyName?: string | null;
  targetResult?: string | null;
  availability?: string[];
}) {
  const greeting = opts.aiGreeting.replace("{firstName}", opts.firstName);

  const companyContext = opts.companyName ? `Company: ${opts.companyName}\n` : "";
  const valueProposition = opts.targetResult ? `Value Proposition: We help clients with ${opts.targetResult}\n` : "";
  const serviceContext = opts.serviceDescription ? `\nAbout Our Business:\n${opts.serviceDescription}\n` : "";

  const qualificationGuidance =
    opts.qualificationQuestions && opts.qualificationQuestions.length > 0
      ? `\nQualification Questions to naturally weave into the conversation when appropriate:\n${opts.qualificationQuestions
          .map((q) => `- ${q}`)
          .join("\n")}\n`
      : "";

  const knowledgeSection = opts.knowledgeContext ? `\nReference Information:\n${opts.knowledgeContext}\n` : "";
  const websiteSection = opts.ourWebsiteUrl
    ? `\nOUR WEBSITE (use only when explicitly asked for website/link; do not use for generic "more info" requests):\n${opts.ourWebsiteUrl}\n`
    : "";

  const availabilitySection =
    opts.availability && opts.availability.length > 0
      ? `\nAvailable times (use verbatim if proposing times):\n${opts.availability.map((s) => `- ${s}`).join("\n")}\n`
      : "";

  return `You are ${opts.aiName}, a professional sales representative${opts.companyName ? ` from ${opts.companyName}` : ""}. Generate a concise LinkedIn message reply based on the conversation context and sentiment.

${companyContext}${valueProposition}Tone: ${opts.aiTone}
Strategy: ${opts.responseStrategy}
Primary Goal/Strategy: ${opts.aiGoals || "Use good judgment to advance the conversation while respecting user intent."}
${serviceContext}${qualificationGuidance}${knowledgeSection}${websiteSection}${availabilitySection}

Guidelines:
- Output plain text only (no markdown).
- Keep it concise and natural (1-3 short paragraphs).
- Don't use emojis unless the lead used them first.
- Only mention the website if an OUR WEBSITE section is provided. Never claim you lack an official link.
- If the lead asks for more info (e.g., "send me more info"), summarize our offer and relevant Reference Information. Do NOT treat "more info" as a website request unless they explicitly asked for a link.
- TIMING AWARENESS: If the lead expressed a timing preference (e.g., "next week", "after the 15th"), ONLY offer times that match their request. Do NOT offer "this week" times if they said "next week". If no available times match their preference, ask what works better instead of offering mismatched times.
- If proposing meeting times and availability is provided, offer 2 options from the list (verbatim) and ask which works. When the lead expressed a timing preference, only offer times that match it. When no timing preference was expressed, prefer sooner options but never offer same-day (today) times unless the lead explicitly asks for today. If no availability is provided, ask for their availability.
- For objections, acknowledge and redirect professionally.
- Never be pushy or aggressive.
- Start with: ${greeting}`;
}

function buildEmailPrompt(opts: {
  aiName: string;
  aiTone: string;
  aiGreeting: string;
  firstName: string;
  responseStrategy: string;
  aiGoals?: string | null;
  availability: string[];
  sentimentTag: string;
  signature?: string | null;
  serviceDescription?: string | null;
  qualificationQuestions?: string[];
  knowledgeContext?: string;
  ourWebsiteUrl?: string | null;
  companyName?: string | null;
  targetResult?: string | null;
}) {
  const greeting = opts.aiGreeting.replace("{firstName}", opts.firstName);
  const shouldConsiderScheduling = [
    "Meeting Requested",
    "Call Requested",
    "Interested",
    "Positive",
    "Information Requested",
  ].includes(opts.sentimentTag);

  const availabilityBlock = shouldConsiderScheduling
    ? (opts.availability.length
      ? `If scheduling is the right next step, offer exactly 2 of these options (verbatim, keep in bullets). TIMING AWARENESS: If the lead expressed a timing preference (e.g., "next week", "after the 15th"), only offer times that match. If no times match their preference, ask what works better instead. When no timing preference was expressed, prefer sooner options but never offer same-day (today) times unless the lead explicitly asks for today:\n${opts.availability
        .map((slot) => `- ${slot}`)
        .join("\n")}`
      : "If scheduling is the right next step, propose that you'll send a couple time options (or ask for their availability).")
    : "Keep it short and helpful; only propose times if they asked.";

  const signature = opts.signature ? `\nSignature block to use:\n${opts.signature}` : "";

  // Build company context section
  const companyContext = opts.companyName
    ? `Company: ${opts.companyName}\n`
    : "";

  // Build value proposition context
  const valueProposition = opts.targetResult
    ? `Value Proposition: We help clients with ${opts.targetResult}\n`
    : "";

  // Build service context section
  const serviceContext = opts.serviceDescription
    ? `\nAbout Our Business:\n${opts.serviceDescription}\n`
    : "";

  // Build qualification guidance
  const qualificationGuidance = opts.qualificationQuestions && opts.qualificationQuestions.length > 0
    ? `\nQualification Questions to naturally weave into the email when appropriate:\n${opts.qualificationQuestions.map(q => `- ${q}`).join("\n")}\n`
    : "";

  // Build knowledge context
  const knowledgeSection = opts.knowledgeContext
    ? `\nReference Information (use when relevant to the conversation):\n${opts.knowledgeContext}\n`
    : "";
  const websiteSection = opts.ourWebsiteUrl
    ? `\nOUR WEBSITE (use only when explicitly asked for website/link; do not use for generic "more info" requests):\n${opts.ourWebsiteUrl}\n`
    : "";

  return `You are an inbox manager writing replies for ${opts.aiName}${opts.companyName ? ` (${opts.companyName})` : ""}.

ROLE: inbox_manager
TASK: Reply to inbound lead responses from outreach, keep it focused, and move it toward a booked call when appropriate.

STYLE:
- Tone: ${opts.aiTone}
- Start with: ${greeting}
- Keep it concise and business-appropriate.

OUTPUT RULES:
- Do not include a subject line.
- Output the email reply in Markdown-friendly plain text (paragraphs and "-" bullets allowed).
- Do not use bold, italics, underline, strikethrough, code, or headings.
- Do not invent facts. Use only provided context.
- If the lead opted out/unsubscribed/asked to stop, output an empty reply ("") and nothing else.
- Only mention the website if an OUR WEBSITE section is provided. Never claim you lack an official link.
- If the lead asks for more info (e.g., "send me more info"), summarize our offer and relevant Reference Information. Do NOT treat "more info" as a website request unless they explicitly asked for a link.

SCHEDULING RULES:
${availabilityBlock}
- Never imply a meeting is booked unless the lead explicitly confirmed a specific time or said they booked/accepted an invite.
- A scheduling link in a signature must not affect your response unless the lead explicitly tells you to use it in the body.

COMPANY CONTEXT:
${companyContext}${valueProposition}${websiteSection}

OFFER:
${opts.serviceDescription ? opts.serviceDescription : "No service description provided."}

GOALS/STRATEGY:
${opts.aiGoals || "Use good judgment to advance the conversation while respecting user intent."}

${qualificationGuidance}${knowledgeSection}

${signature ? "- Use the provided signature block below the closing.\n" + signature : ""}`;
}

// ---------------------------------------------------------------------------
// Two-Step Email Draft Generation (Phase 30)
// ---------------------------------------------------------------------------

/**
 * JSON schema for Step 1 strategy output (OpenAI Structured Outputs).
 * All keys are required per OpenAI spec - use null for "not present".
 */
const EMAIL_DRAFT_STRATEGY_JSON_SCHEMA = {
  type: "object",
  properties: {
    personalization_points: {
      type: "array",
      minItems: 0,
      maxItems: 4,
      items: { type: "string", maxLength: 140 },
      description: "2-4 short personalization points specific to this lead (company, industry, previous conversation context)",
    },
    intent_summary: {
      type: "string",
      maxLength: 400,
      description: "One sentence summarizing the lead's intent and what the response should accomplish",
    },
    should_offer_times: {
      type: "boolean",
      description: "Whether to offer specific availability times in the response",
    },
    times_to_offer: {
      type: ["array", "null"],
      maxItems: 6,
      items: { type: "string", maxLength: 80 },
      description: "If should_offer_times is true, which specific times to offer (verbatim from availability list); null otherwise",
    },
    outline: {
      type: "array",
      minItems: 0,
      maxItems: 5,
      items: { type: "string", maxLength: 160 },
      description: "3-5 bullet points describing the structure/flow of the email (what each section should accomplish)",
    },
    must_avoid: {
      type: "array",
      minItems: 0,
      maxItems: 6,
      items: { type: "string", maxLength: 160 },
      description: "Any specific topics, tones, or approaches to avoid based on conversation context",
    },
    recommended_archetype_id: {
      type: ["string", "null"],
      maxLength: 50,
      description: "The archetype ID that best fits this lead/context (e.g., 'A4_direct_scheduling_first'). Set to null if archetype was pre-selected.",
    },
  },
  required: ["personalization_points", "intent_summary", "should_offer_times", "times_to_offer", "outline", "must_avoid", "recommended_archetype_id"],
  additionalProperties: false,
};

// ---------------------------------------------------------------------------
// Email Draft Verification (Step 3) (Phase 49)
// ---------------------------------------------------------------------------

const EMAIL_DRAFT_VERIFY_STEP3_JSON_SCHEMA = {
  type: "object",
  properties: {
    finalDraft: {
      type: "string",
      maxLength: 6000,
      description: "The minimally corrected final email draft (plain text).",
    },
    changed: {
      type: "boolean",
      description: "True if any changes were made to the draft.",
    },
    violationsDetected: {
      type: "array",
      minItems: 0,
      maxItems: 30,
      items: { type: "string", maxLength: 120 },
      description: "Short list of violations detected (e.g. wrong_link, em_dash, pricing_mismatch).",
    },
    changes: {
      type: "array",
      minItems: 0,
      maxItems: 30,
      items: { type: "string", maxLength: 180 },
      description: "Short list of changes applied (human-readable).",
    },
  },
  required: ["finalDraft", "changed", "violationsDetected", "changes"],
  additionalProperties: false,
};

type EmailDraftVerificationStep3 = {
  finalDraft: string;
  changed: boolean;
  violationsDetected: string[];
  changes: string[];
};

interface EmailDraftStrategy {
  personalization_points: string[];
  intent_summary: string;
  should_offer_times: boolean;
  times_to_offer: string[] | null;
  outline: string[];
  must_avoid: string[];
  /** AI-recommended archetype ID based on context analysis (null when archetype pre-selected) */
  recommended_archetype_id: string | null;
}

function formatEmailSignatureContextForPrompt(ctx: EmailSignatureContextExtraction): string {
  const lines: string[] = [];

  if (ctx.importantLines.length > 0) {
    lines.push(...ctx.importantLines.slice(0, 10));
  }

  const kv: string[] = [];
  if (ctx.name) kv.push(`Name: ${ctx.name}`);
  if (ctx.title) kv.push(`Title: ${ctx.title}`);
  if (ctx.company) kv.push(`Company: ${ctx.company}`);
  if (ctx.email) kv.push(`Email: ${ctx.email}`);
  if (ctx.phone) kv.push(`Phone: ${ctx.phone}`);
  if (ctx.linkedinUrl) kv.push(`LinkedIn: ${ctx.linkedinUrl}`);

  if (kv.length > 0) {
    if (lines.length > 0) lines.push("");
    lines.push(...kv);
  }

  if (ctx.schedulingLinks.length > 0) {
    if (lines.length > 0) lines.push("");
    lines.push("Scheduling links:");
    lines.push(...ctx.schedulingLinks.slice(0, 5).map((u) => `- ${u}`));
  }

  if (ctx.otherLinks.length > 0) {
    if (lines.length > 0) lines.push("");
    lines.push("Other links:");
    lines.push(...ctx.otherLinks.slice(0, 10).map((u) => `- ${u}`));
  }

  return lines.join("\n").trim();
}

/**
 * Build the Step 1 (Strategy) system instructions.
 * Analyzes lead context and outputs a structured strategy JSON.
 *
 * When shouldSelectArchetype is true (initial drafts), the AI analyzes context
 * and recommends the best-fit archetype using psychology principles.
 * When false (regeneration), the archetype is pre-selected and AI plans around it.
 */
function buildEmailDraftStrategyInstructions(opts: {
  aiName: string;
  aiTone: string;
  firstName: string;
  lastName: string | null;
  leadEmail: string | null;
  currentReplierName: string | null;
  currentReplierEmail: string | null;
  leadCompanyName: string | null;
  leadCompanyWebsite: string | null;
  leadCompanyState: string | null;
  leadIndustry: string | null;
  leadEmployeeHeadcount: string | null;
  leadLinkedinUrl: string | null;
  ourCompanyName: string | null;
  sentimentTag: string;
  responseStrategy: string;
  aiGoals: string | null;
  serviceDescription: string | null;
  qualificationQuestions: string[];
  knowledgeContext: string;
  ourWebsiteUrl: string | null;
  availability: string[];
  /** Pre-selected archetype (for regeneration) or null (for AI selection) */
  archetype: EmailDraftArchetype | null;
  /** When true, AI should select the best archetype based on context */
  shouldSelectArchetype: boolean;
  /** Important signature/footer context extracted from the trigger email (optional) */
  signatureContext: string | null;
  /** Lead explicitly provided their own scheduling link (optional) */
  leadSchedulerLink: string | null;
}): string {
  const leadContext = [
    opts.firstName && `First Name: ${opts.firstName}`,
    opts.lastName && `Last Name: ${opts.lastName}`,
    opts.leadEmail && `Email: ${opts.leadEmail}`,
    (opts.currentReplierEmail || opts.currentReplierName) &&
      `Current Replier: ${opts.currentReplierName ? `${opts.currentReplierName} <${opts.currentReplierEmail || "unknown"}>` : opts.currentReplierEmail}`,
    opts.leadCompanyName && `Lead's Company: ${opts.leadCompanyName}`,
    opts.leadCompanyWebsite && `Website: ${opts.leadCompanyWebsite}`,
    opts.leadCompanyState && `State: ${opts.leadCompanyState}`,
    opts.leadIndustry && `Industry: ${opts.leadIndustry}`,
    opts.leadEmployeeHeadcount && `Company Size: ${opts.leadEmployeeHeadcount}`,
    opts.leadLinkedinUrl && `LinkedIn: ${opts.leadLinkedinUrl}`,
  ].filter(Boolean).join("\n");

  const signatureContextSection = opts.signatureContext
    ? `\nTRIGGER EMAIL SIGNATURE/FOOTER (EXTRACTED — IMPORTANT CONTEXT):\n${opts.signatureContext}\nIMPORTANT: If a scheduling link is present above, do NOT claim it "didn't come through" or "wasn't received".`
    : "";

  const leadSchedulerLinkSection = opts.leadSchedulerLink
    ? `\nLEAD-PROVIDED SCHEDULING LINK (EXPLICITLY SHARED BY LEAD):\n${opts.leadSchedulerLink}\nIMPORTANT: Do NOT offer our availability times or our booking link. Instead, acknowledge their link and express willingness to book via their scheduler.`
    : "";

  const availabilitySection = opts.availability.length > 0
    ? `\nAVAILABLE TIMES (use verbatim if scheduling):\n${opts.availability.map(s => `- ${s}`).join("\n")}`
    : "\nNo specific availability times provided.";

  const qualificationSection = opts.qualificationQuestions.length > 0
    ? `\nQUALIFICATION QUESTIONS to consider weaving in:\n${opts.qualificationQuestions.map(q => `- ${q}`).join("\n")}`
    : "";

  const knowledgeSection = opts.knowledgeContext
    ? `\nREFERENCE INFORMATION:\n${opts.knowledgeContext}`
    : "";
  const websiteSection = opts.ourWebsiteUrl
    ? `\nOUR WEBSITE (use only when explicitly asked for website/link; do not use for generic "more info" requests):\n${opts.ourWebsiteUrl}`
    : "";

  // Build archetype section based on whether AI should select or use pre-selected
  let archetypeSection: string;
  let archetypeTask: string;

  if (opts.shouldSelectArchetype) {
    // AI should analyze context and select the best archetype
    archetypeSection = buildArchetypeSelectionGuide();
    archetypeTask = `6. Select the best email structure archetype (recommended_archetype_id) - analyze the lead's communication style, sentiment, and context to pick the archetype that will resonate most effectively using the psychology principles above`;
  } else if (opts.archetype) {
    // Archetype is pre-selected (regeneration case)
    archetypeSection = `TARGET STRUCTURE ARCHETYPE: "${opts.archetype.name}"
${opts.archetype.instructions}`;
    archetypeTask = `Note: Archetype is pre-selected. Set recommended_archetype_id to null in your response.`;
  } else {
    // Fallback - shouldn't happen but handle gracefully
    archetypeSection = "";
    archetypeTask = `Note: Set recommended_archetype_id to null.`;
  }

  return `You are analyzing a sales conversation to create a personalized response strategy.

CONTEXT:
- Responding as: ${opts.aiName}${opts.ourCompanyName ? ` (${opts.ourCompanyName})` : ""}
- Tone: ${opts.aiTone}
- Lead sentiment: ${opts.sentimentTag}
- Response approach: ${opts.responseStrategy}

LEAD INFORMATION:
${leadContext || "No additional lead information available."}

${signatureContextSection}
${leadSchedulerLinkSection}

${opts.serviceDescription ? `OUR OFFER:\n${opts.serviceDescription}\n` : ""}
${opts.aiGoals ? `GOALS/STRATEGY:\n${opts.aiGoals}\n` : ""}
${qualificationSection}${knowledgeSection}${websiteSection}${availabilitySection}

${archetypeSection}

TASK:
Analyze this lead and conversation to produce a strategy for writing a personalized email response.
Output a JSON object with your analysis. Focus on:
1. What makes this lead unique (personalization_points)
2. What the response should achieve (intent_summary)
3. Whether to offer scheduling times (should_offer_times, times_to_offer) — TIMING AWARENESS: If the lead expressed a timing preference (e.g., "next week", "after the 15th", "this month"), ONLY select times from the list that match their request. Do NOT offer "this week" times if they said "next week". When no timing preference is expressed, prefer sooner options. If no available times match their stated preference, set should_offer_times to false and plan to ask what works better.
   - LEAD SCHEDULER: If a lead-provided scheduling link is present above, set should_offer_times to false (times_to_offer = null) and plan to acknowledge their link instead of proposing our times.
4. The email structure (outline) - aligned with ${opts.shouldSelectArchetype ? "your selected archetype" : "the archetype above"}
5. What to avoid (must_avoid)
${archetypeTask}

If the lead asks for more info, ensure the strategy includes concrete details from OUR OFFER and REFERENCE INFORMATION in the intent_summary/outline. Do not treat "more info" as a website request unless the lead explicitly asked for a link.

Be specific and actionable. The strategy will be used to generate the actual email.`;
}

/**
 * Build the Step 2 (Generation) system instructions.
 * Uses strategy + archetype to generate varied email text.
 */
function buildEmailDraftGenerationInstructions(opts: {
  aiName: string;
  aiTone: string;
  aiGreeting: string;
  firstName: string;
  signature: string | null;
  /** Important signature/footer context extracted from the trigger email (optional) */
  signatureContext: string | null;
  /** Lead explicitly provided their own scheduling link (optional) */
  leadSchedulerLink: string | null;
  ourCompanyName: string | null;
  sentimentTag: string;
  strategy: EmailDraftStrategy;
  archetype: EmailDraftArchetype;
  forbiddenTerms?: string[]; // Phase 47e: workspace-specific forbidden terms
}): string {
  const greeting = opts.aiGreeting.replace("{firstName}", opts.firstName);

  const strategySection = `
PERSONALIZATION POINTS (use at least 2):
${opts.strategy.personalization_points.map(p => `- ${p}`).join("\n")}

INTENT: ${opts.strategy.intent_summary}

EMAIL STRUCTURE (follow this outline):
${opts.strategy.outline.map((o, i) => `${i + 1}. ${o}`).join("\n")}

${opts.strategy.should_offer_times && opts.strategy.times_to_offer?.length
    ? `OFFER THESE TIMES (verbatim):\n${opts.strategy.times_to_offer.map(t => `- ${t}`).join("\n")}`
    : opts.strategy.should_offer_times
      ? "SCHEDULING: Ask for their availability or propose to send times."
      : "SCHEDULING: Do not push for scheduling unless they specifically asked."}

MUST AVOID:
${opts.strategy.must_avoid.length > 0 ? opts.strategy.must_avoid.map(a => `- ${a}`).join("\n") : "- No specific avoidances identified."}`;

  const signatureContextSection = opts.signatureContext
    ? `\nTRIGGER EMAIL SIGNATURE/FOOTER (EXTRACTED — IMPORTANT CONTEXT):\n${opts.signatureContext}\nIMPORTANT: If a scheduling link is present above, do NOT claim it "didn't come through" or "wasn't received".`
    : "";

  const leadSchedulerLinkSection = opts.leadSchedulerLink
    ? `\nLEAD-PROVIDED SCHEDULING LINK (EXPLICITLY SHARED BY LEAD):\n${opts.leadSchedulerLink}\nIMPORTANT: Do NOT offer our availability times or our booking link. Instead, acknowledge their link and express willingness to book via their scheduler (no need to repeat the full URL).`
    : "";

  // Use workspace-specific forbidden terms if provided, otherwise default (Phase 47e)
  const forbiddenTermsList = opts.forbiddenTerms ?? EMAIL_FORBIDDEN_TERMS;
  const forbiddenTerms = forbiddenTermsList.slice(0, 30).join(", ");

  return `You are an inbox manager writing a reply for ${opts.aiName}${opts.ourCompanyName ? ` (${opts.ourCompanyName})` : ""}.

ROLE: inbox_manager
TASK: Write an email response following the provided strategy and structure.

STYLE:
- Tone: ${opts.aiTone}
- Start with: ${greeting}
- Keep it concise and business-appropriate.

STRUCTURE ARCHETYPE: "${opts.archetype.name}"
${opts.archetype.instructions}

${strategySection}

${signatureContextSection}
${leadSchedulerLinkSection}

OUTPUT RULES:
- Do not include a subject line.
- Output the email reply in Markdown-friendly plain text (paragraphs and "-" bullets allowed).
- Do not use bold, italics, underline, strikethrough, code, or headings.
- Do not invent facts. Use only provided context.
- If the lead opted out/unsubscribed/asked to stop, output an empty reply ("") and nothing else.
- NEVER imply a meeting is booked unless the lead explicitly confirmed.
- If the lead asked for more info, include the concrete details from the strategy. Do not add a website or link unless it appears in the strategy or conversation.

FORBIDDEN TERMS (never use):
${forbiddenTerms}

${opts.signature ? `SIGNATURE (include at end):\n${opts.signature}` : ""}

Write the email now, following the strategy and archetype structure exactly.`;
}

function buildDeterministicFallbackDraft(opts: {
  channel: DraftChannel;
  aiName: string;
  aiGreeting: string;
  firstName: string;
  signature: string | null;
  sentimentTag: string;
  availability: string[];
}): string {
  const safeFirstName = opts.firstName || "there";
  const greetingTemplate = opts.aiGreeting || "Hi {firstName},";
  const greeting = greetingTemplate.replace("{firstName}", safeFirstName);
  const hasAvailability = Array.isArray(opts.availability) && opts.availability.length > 0;

  const normalizedSentiment = opts.sentimentTag === "Positive" ? "Interested" : opts.sentimentTag;

  const askLine =
    normalizedSentiment === "Follow Up"
      ? "What timeline are you thinking—this quarter, later this year, or further out?"
      : normalizedSentiment === "Information Requested"
        ? "What would be most helpful to start—pricing, examples, or a quick overview of next steps?"
        : hasAvailability
          ? "If a quick call helps, I can share a few times that work, or you can send a couple options on your end."
          : "If a quick call helps, what times work best on your end?";

	  if (opts.channel === "email") {
	    const body = `${greeting}

	Thanks for reaching out — happy to help.

	${askLine}

	What would you like to focus on first? If it helps, I can send a quick overview and suggested next steps.`;

	    const closing = opts.signature ? `\n\n${opts.signature.trim()}` : `\n\nBest,\n${opts.aiName}`;
	    return body + closing;
	  }

  // SMS / LinkedIn: keep it short (draft is human-reviewed).
  return `${greeting} Thanks for reaching out — happy to help. What would you like to focus on first?`;
}

/**
 * Generate an AI response draft based on conversation context and sentiment
 */
export async function generateResponseDraft(
  leadId: string,
  conversationTranscript: string,
  sentimentTag: string,
  channel: DraftChannel = "sms",
  opts: DraftGenerationOptions = {}
): Promise<DraftGenerationResult> {
  try {
    const triggerMessageId = typeof opts.triggerMessageId === "string" ? opts.triggerMessageId.trim() : null;

    if (triggerMessageId) {
      const existing = await prisma.aIDraft.findFirst({
        where: { triggerMessageId, channel },
        select: { id: true, content: true, leadId: true },
      });

      if (existing) {
        if (existing.leadId !== leadId) {
          console.warn(
            `[AI Drafts] triggerMessageId ${triggerMessageId} belongs to lead ${existing.leadId}, not ${leadId}`
          );
        }

        return { success: true, draftId: existing.id, content: existing.content };
      }
    }

    let triggerMessageRecord: { body: string; rawText: string | null; rawHtml: string | null } | null = null;
    if (triggerMessageId) {
      try {
        triggerMessageRecord = await prisma.message.findFirst({
          where: { id: triggerMessageId, leadId },
          select: { body: true, rawText: true, rawHtml: true },
        });
      } catch (error) {
        console.warn("[AI Drafts] Failed to load trigger message:", error);
      }
    }

    // Capture timestamp at start for archetype seed (stable within this request)
    const draftRequestStartedAtMs = Date.now();

    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        currentReplierEmail: true,
        currentReplierName: true,
        currentReplierSince: true,
        companyName: true,
        companyWebsite: true,
        companyState: true,
        industry: true,
        employeeHeadcount: true,
        linkedinUrl: true,
        clientId: true,
        offeredSlots: true,
        externalSchedulingLink: true,
        snoozedUntil: true,
        client: {
          select: {
            name: true,
            settings: {
              include: {
                knowledgeAssets: {
                  orderBy: { updatedAt: "desc" },
                  take: 5,
                  select: {
                    name: true,
                    type: true,
                    fileUrl: true,
                    textContent: true,
                    updatedAt: true,
                  },
                },
              },
            },
            // Fetch default AI persona for fallback (Phase 39)
            aiPersonas: {
              where: { isDefault: true },
              take: 1,
              select: {
                id: true,
                name: true,
                personaName: true,
                tone: true,
                greeting: true,
                smsGreeting: true,
                signature: true,
                goals: true,
                serviceDescription: true,
                idealCustomerProfile: true,
              },
            },
          },
        },
        // Fetch campaign-assigned AI persona (Phase 39)
        emailCampaign: {
          select: {
            id: true,
            aiPersona: {
              select: {
                id: true,
                name: true,
                personaName: true,
                tone: true,
                greeting: true,
                smsGreeting: true,
                signature: true,
                goals: true,
                serviceDescription: true,
                idealCustomerProfile: true,
              },
            },
          },
        },
      },
    });

    if (!lead) {
      return { success: false, error: "Lead not found" };
    }

    const settings = lead?.client?.settings;

    // ---------------------------------------------------------------------------
    // Resolve AI Persona (Phase 39)
    // Priority: campaign persona > default persona > workspace settings
    // ---------------------------------------------------------------------------
    const persona = resolvePersona(lead as LeadForPersona, channel);
    const aiTone = persona.tone;
    const aiName = persona.personaName;
    const aiGreeting = persona.greeting;
    const aiGoals = persona.goals;
    const aiSignature = persona.signature;
    const serviceDescription = persona.serviceDescription;

    // Log persona source for debugging (can be removed once stable)
    console.log(
      `[AI Drafts] Lead ${leadId} using persona source: ${persona.source}` +
        (lead.emailCampaign?.aiPersona ? ` (campaign: ${lead.emailCampaign.aiPersona.name})` : "") +
        (persona.source === "default" && lead.client?.aiPersonas?.[0] ? ` (${lead.client.aiPersonas[0].name})` : "")
    );
    // Company context - fallback to workspace name if not set
    const companyName = settings?.companyName?.trim() || lead?.client?.name || null;
    const targetResult = settings?.targetResult?.trim() || null;

    // Parse qualification questions from JSON
    let qualificationQuestions: string[] = [];
    if (settings?.qualificationQuestions) {
      try {
        const parsed = JSON.parse(settings.qualificationQuestions);
        qualificationQuestions = parsed.map((q: { question: string }) => q.question);
      } catch {
        // Ignore parse errors
      }
    }

    const knowledgeAssets = settings?.knowledgeAssets ?? [];
    const primaryWebsiteUrl = extractPrimaryWebsiteUrlFromAssets(knowledgeAssets);

    // Build knowledge context from assets (limit to avoid token overflow)
    let knowledgeContext = "";
    if (knowledgeAssets.length > 0) {
      const assetSnippets = knowledgeAssets
        .filter(a => a.textContent && a.name !== PRIMARY_WEBSITE_ASSET_NAME)
        .map(a => `[${a.name}]: ${a.textContent!.slice(0, 1000)}${a.textContent!.length > 1000 ? "..." : ""}`);

      if (assetSnippets.length > 0) {
        knowledgeContext = assetSnippets.join("\n\n");
      }
    }

    const leadMemoryMaxTokens = parsePositiveIntEnv("LEAD_MEMORY_CONTEXT_MAX_TOKENS", 1200);
    const leadMemoryMaxEntryTokens = parsePositiveIntEnv("LEAD_MEMORY_CONTEXT_MAX_ENTRY_TOKENS", 400);
    const leadMemoryResult = await getLeadMemoryContext({
      leadId,
      clientId: lead.clientId,
      maxTokens: leadMemoryMaxTokens,
      maxEntryTokens: leadMemoryMaxEntryTokens,
    });
    const memoryContext = leadMemoryResult.context.trim();
    if (memoryContext) {
      knowledgeContext = [knowledgeContext, `LEAD MEMORY:\n${memoryContext}`].filter(Boolean).join("\n\n");
    }

    const primaryFirstName = lead?.firstName || "there";
    const hasCcReplier =
      channel === "email" &&
      !!lead.currentReplierEmail &&
      !emailsMatch(lead.currentReplierEmail, lead.email);
    const replierFirstName = extractFirstName(lead.currentReplierName);
    const firstName = hasCcReplier ? (replierFirstName || "there") : primaryFirstName;
    const currentReplierEmail = hasCcReplier ? lead.currentReplierEmail : null;
    const currentReplierName = hasCcReplier ? lead.currentReplierName : null;
    const responseStrategy = getResponseStrategy(sentimentTag);

    const leadSchedulerLink = (lead.externalSchedulingLink || "").trim() || null;
    const leadHasSchedulerLink = Boolean(leadSchedulerLink);

    const shouldConsiderScheduling = [
      "Meeting Requested",
      "Call Requested",
      "Interested",
      "Positive",
      "Information Requested",
    ].includes(sentimentTag) && !leadHasSchedulerLink;

    let availability: string[] = [];

    if (shouldConsiderScheduling && lead?.clientId) {
      try {
        const answerState = await getLeadQualificationAnswerState({ leadId, clientId: lead.clientId });
        const requestedAvailabilitySource: AvailabilitySource =
          answerState.requiredQuestionIds.length > 0 && !answerState.hasAllRequiredAnswers
            ? "DIRECT_BOOK"
            : "DEFAULT";

        const slots = await getWorkspaceAvailabilitySlotsUtc(lead.clientId, {
          refreshIfStale: true,
          availabilitySource: requestedAvailabilitySource,
        });
        if (slots.slotsUtc.length > 0) {
          const offeredAtIso = new Date().toISOString();
          const offeredAt = new Date(offeredAtIso);
          const tzResult = await ensureLeadTimezone(leadId);
          const timeZone = tzResult.timezone || settings?.timezone || "UTC";
          const mode = "explicit_tz"; // Always show explicit timezone (e.g., "EST", "PST")

          const existingOffered = new Set<string>();
          if (lead.offeredSlots) {
            try {
              const parsed = JSON.parse(lead.offeredSlots) as Array<{ datetime?: string }>;
              for (const s of parsed) {
                if (!s?.datetime) continue;
                const d = new Date(s.datetime);
                if (!Number.isNaN(d.getTime())) {
                  existingOffered.add(d.toISOString());
                }
              }
            } catch {
              // ignore parse errors
            }
          }

          const startAfterUtc =
            lead.snoozedUntil && lead.snoozedUntil > new Date() ? lead.snoozedUntil : null;

          const anchor = startAfterUtc && startAfterUtc > offeredAt ? startAfterUtc : offeredAt;
          const rangeEnd = new Date(anchor.getTime() + 30 * 24 * 60 * 60 * 1000);
          const offerCounts = await getWorkspaceSlotOfferCountsForRange(lead.clientId, anchor, rangeEnd, {
            availabilitySource: slots.availabilitySource,
          });

          const selectedUtcIso = selectDistributedAvailabilitySlots({
            slotsUtcIso: slots.slotsUtc,
            offeredCountBySlotUtcIso: offerCounts,
            timeZone,
            excludeUtcIso: existingOffered,
            startAfterUtc,
            preferWithinDays: 5,
            now: offeredAt,
          });

          const formatted = formatAvailabilitySlots({
            slotsUtcIso: selectedUtcIso,
            timeZone,
            mode,
            limit: selectedUtcIso.length,
          });

          availability = formatted.map((s) => s.label);

          if (formatted.length > 0) {
            await prisma.lead.update({
              where: { id: leadId },
              data: {
                offeredSlots: JSON.stringify(
                  formatted.map((s) => ({
                    datetime: s.datetime,
                    label: s.label,
                    offeredAt: offeredAtIso,
                    availabilitySource: slots.availabilitySource,
                  }))
                ),
              },
            });

            await incrementWorkspaceSlotOffersBatch({
              clientId: lead.clientId,
              slotUtcIsoList: formatted.map((s) => s.datetime),
              offeredAt,
              availabilitySource: slots.availabilitySource,
            });
          }
        }
      } catch (error) {
        console.error("[AI Drafts] Failed to load live availability:", error);
      }
    }

    // ---------------------------------------------------------------------------
    // Booking Process Instructions (Phase 36)
    // ---------------------------------------------------------------------------
    let bookingProcessInstructions: string | null = null;

    try {
      const bookingResult = await getBookingProcessInstructions({
        leadId,
        channel,
        workspaceSettings: settings,
        clientId: lead.clientId,
        availableSlots: availability, // Pass the already-loaded availability
      });

      if (bookingResult.requiresHumanReview) {
        console.log(
          `[AI Drafts] Lead ${leadId} requires human review: ${bookingResult.escalationReason}`
        );
        return {
          success: false,
          error: `Human review required: ${bookingResult.escalationReason}`,
        };
      }

      bookingProcessInstructions = bookingResult.instructions;

      if (bookingProcessInstructions) {
        console.log(
          `[AI Drafts] Using booking process stage ${bookingResult.stageNumber} (wave ${bookingResult.waveNumber}) for ${channel}`
        );
      }
    } catch (error) {
      console.error("[AI Drafts] Failed to get booking process instructions:", error);
      // Continue without booking instructions on error
    }

    // ---------------------------------------------------------------------------
    // Shared config
    // ---------------------------------------------------------------------------
    const envTimeoutMs = Number.parseInt(process.env.OPENAI_DRAFT_TIMEOUT_MS || "120000", 10) || 120_000;
    const timeoutMs = Math.max(5_000, opts.timeoutMs ?? envTimeoutMs);

    // Phase 94: Keep verifier/signature-context timeouts proportional to the overall draft timeout,
    // but remove the hard ~20s / ~4.5s cliffs that cause deterministic timeouts under load.
    const signatureContextTimeoutMs = computeTimeoutSliceMs({
      totalTimeoutMs: timeoutMs,
      capEnv: "OPENAI_SIGNATURE_CONTEXT_TIMEOUT_MS_CAP",
      minEnv: "OPENAI_SIGNATURE_CONTEXT_TIMEOUT_MS_MIN",
      shareEnv: "OPENAI_SIGNATURE_CONTEXT_TIMEOUT_SHARE",
      defaultCapMs: 10_000,
      defaultMinMs: 3_000,
      defaultShare: 0.2,
    });

    const emailVerifierTimeoutMs = computeTimeoutSliceMs({
      totalTimeoutMs: timeoutMs,
      capEnv: "OPENAI_EMAIL_VERIFIER_TIMEOUT_MS_CAP",
      minEnv: "OPENAI_EMAIL_VERIFIER_TIMEOUT_MS_MIN",
      shareEnv: "OPENAI_EMAIL_VERIFIER_TIMEOUT_SHARE",
      defaultCapMs: 45_000,
      defaultMinMs: 8_000,
      defaultShare: 0.35,
    });

    const envMultiplier = Number.parseFloat(process.env.OPENAI_DRAFT_TOKEN_BUDGET_MULTIPLIER || "3");
    const tokenBudgetMultiplier = Number.isFinite(opts.tokenBudgetMultiplier)
      ? Math.max(1, Math.min(10, opts.tokenBudgetMultiplier!))
      : Number.isFinite(envMultiplier)
        ? Math.max(1, Math.min(10, envMultiplier))
        : 3;

	    const preferApiCount =
	      typeof opts.preferApiCount === "boolean"
	        ? opts.preferApiCount
	        : (process.env.OPENAI_DRAFT_PREFER_API_TOKEN_COUNT ?? "false").toLowerCase() === "true";

	    const maxOutputTokensCap = Math.max(
	      1500,
	      Number.parseInt(process.env.OPENAI_DRAFT_MAX_OUTPUT_TOKENS_CAP || "12000", 10) || 12_000
    );

    let draftContent: string | null = null;
    let emailVerifierForbiddenTerms: string[] | null = null;
    let emailLengthBoundsForClamp: { minChars: number; maxChars: number } | null = null;

    // ---------------------------------------------------------------------------
    // Email: Two-Step Pipeline (Phase 30)
    // ---------------------------------------------------------------------------
    if (channel === "email") {
      // Fetch effective overrides in parallel (Phase 47e/47g: workspace overrides)
      const [
        { terms: effectiveForbiddenTerms },
        { rules: emailLengthRules, bounds: emailLengthBounds },
      ] = await Promise.all([
        getEffectiveForbiddenTerms(lead.clientId),
        buildEffectiveEmailLengthRules(lead.clientId),
      ]);
      emailVerifierForbiddenTerms = effectiveForbiddenTerms;
      emailLengthBoundsForClamp = emailLengthBounds;

      // Coerce model/reasoning from workspace settings
      const draftModel = coerceDraftGenerationModel(settings?.draftGenerationModel);
      const { api: strategyReasoningApi } = coerceDraftGenerationReasoningEffort({
        model: draftModel,
        storedValue: settings?.draftGenerationReasoningEffort,
      });

      // Archetype selection strategy:
      // - Initial drafts (triggerMessageId present): AI analyzes context and selects best archetype
      // - Regeneration (no triggerMessageId): Random archetype selection for variety
      const isInitialDraft = !!triggerMessageId;
      const shouldSelectArchetype = isInitialDraft;

      // For regeneration, pre-select archetype randomly using timestamp seed
      let preSelectedArchetype: EmailDraftArchetype | null = null;
      if (!shouldSelectArchetype) {
        const archetypeSeed = buildArchetypeSeed({
          leadId,
          triggerMessageId: null,
          draftRequestStartedAtMs,
        });
        const baseArchetype = selectArchetypeFromSeed(archetypeSeed);
        const { instructions: effectiveArchetypeInstructions } = await getEffectiveArchetypeInstructions(
          baseArchetype.id,
          lead.clientId
        );
        preSelectedArchetype = { ...baseArchetype, instructions: effectiveArchetypeInstructions };
      }

      // Track the final archetype (will be set after strategy for initial drafts)
      let archetype: EmailDraftArchetype | null = preSelectedArchetype;

      // ---------------------------------------------------------------------------
      // Trigger email signature/footer context (Phase 76)
      // ---------------------------------------------------------------------------
      let signatureContextForPrompt: string | null = null;
      if (triggerMessageId) {
        try {
          const expectedSignatureName = currentReplierName || [lead.firstName, lead.lastName].filter(Boolean).join(" ") || null;
          const expectedSignatureEmail = currentReplierEmail || lead.email || null;

          const signatureContext = await extractImportantEmailSignatureContext({
            clientId: lead.clientId,
            leadId,
            leadName: expectedSignatureName,
            leadEmail: expectedSignatureEmail,
            rawText: triggerMessageRecord?.rawText ?? null,
            rawHtml: triggerMessageRecord?.rawHtml ?? null,
            timeoutMs: signatureContextTimeoutMs,
          });

          signatureContextForPrompt = signatureContext ? formatEmailSignatureContextForPrompt(signatureContext) : null;
        } catch (error) {
          console.warn("[AI Drafts] Failed to extract signature/footer context for prompt:", error);
        }
      }

	      // Split timeout: ~40% for strategy, ~60% for generation
	      const strategyTimeoutMs = Math.max(3000, Math.floor(timeoutMs * 0.4));
	      const generationTimeoutMs = Math.max(3000, timeoutMs - strategyTimeoutMs);

      // Step 1: Strategy
      let strategy: EmailDraftStrategy | null = null;
      let strategyInteractionId: string | null = null;

      let strategyInstructions = buildEmailDraftStrategyInstructions({
        aiName,
        aiTone,
        firstName,
        lastName: lead.lastName,
        leadEmail: lead.email,
        currentReplierName,
        currentReplierEmail,
        leadCompanyName: lead.companyName,
        leadCompanyWebsite: lead.companyWebsite,
        leadCompanyState: lead.companyState,
        leadIndustry: lead.industry,
        leadEmployeeHeadcount: lead.employeeHeadcount,
        leadLinkedinUrl: lead.linkedinUrl,
        ourCompanyName: companyName,
        sentimentTag,
        responseStrategy,
        aiGoals: aiGoals || null,
        serviceDescription: serviceDescription || null,
        qualificationQuestions,
        knowledgeContext,
        ourWebsiteUrl: primaryWebsiteUrl,
        availability,
        archetype: preSelectedArchetype,
        shouldSelectArchetype,
        signatureContext: signatureContextForPrompt,
        leadSchedulerLink,
      });

      // Append booking process instructions if available (Phase 36)
      if (bookingProcessInstructions) {
        strategyInstructions += bookingProcessInstructions;
      }

      // Lead-scheduler-link override (Phase 79): prevent booking-process templates from suggesting our times/link
      // when the lead explicitly provided their own scheduling link.
      if (leadSchedulerLink) {
        strategyInstructions +=
          "\nLEAD SCHEDULER LINK OVERRIDE:\nThe lead explicitly provided their own scheduling link.\nIMPORTANT: Do NOT offer our availability times or our booking link. Acknowledge their link and express willingness to book via their scheduler (no need to repeat the full URL).";
      }

      const strategyInput = `<conversation_transcript>
${conversationTranscript}
</conversation_transcript>

<lead_sentiment>${sentimentTag}</lead_sentiment>

<task>
Analyze this conversation and produce a JSON strategy for writing a personalized email response.
</task>`;

      const strategyMaxAttempts = Math.max(
        1,
        Math.min(5, Number.parseInt(process.env.OPENAI_EMAIL_STRATEGY_MAX_ATTEMPTS || "3", 10) || 3)
      );
      const strategyBaseMaxOutputTokens = Math.max(
        500,
        Number.parseInt(process.env.OPENAI_EMAIL_STRATEGY_BASE_MAX_OUTPUT_TOKENS || "5000", 10) || 5000
      );
      const strategyMaxOutputTokensCap = Math.max(
        strategyBaseMaxOutputTokens,
        Number.parseInt(process.env.OPENAI_EMAIL_STRATEGY_MAX_OUTPUT_TOKENS || "5000", 10) || 5000
      );
      const strategyTokenIncrement = Math.max(
        0,
        Number.parseInt(process.env.OPENAI_EMAIL_STRATEGY_TOKEN_INCREMENT || "1500", 10) || 1500
      );

      const strategyBasePromptKey = shouldSelectArchetype
        ? `draft.generate.email.strategy.v1.ai_select`
        : `draft.generate.email.strategy.v1.arch_${archetype?.id || "unknown"}`;
      const strategyStartMs = Date.now();

      for (let attempt = 1; attempt <= strategyMaxAttempts; attempt++) {
        const elapsedMs = Date.now() - strategyStartMs;
        const remainingMs = strategyTimeoutMs - elapsedMs;
        if (attempt > 1 && remainingMs < 2500) break;

        const attemptTimeoutMs = Math.max(2500, Math.min(strategyTimeoutMs, remainingMs));
        const attemptMaxTokens = Math.min(
          strategyMaxOutputTokensCap,
          strategyBaseMaxOutputTokens + (attempt - 1) * strategyTokenIncrement
        );

        const attemptPromptKey = attempt === 1 ? strategyBasePromptKey : `${strategyBasePromptKey}.retry${attempt}`;
        const strategyResult = await runStructuredJsonPrompt<EmailDraftStrategy>({
          pattern: "structured_json",
          clientId: lead.clientId,
          leadId,
          featureId: "draft.generate.email.strategy",
          promptKey: attemptPromptKey,
          model: draftModel,
          reasoningEffort:
            strategyReasoningApi === "none" ? undefined : strategyReasoningApi === "xhigh" ? "high" : strategyReasoningApi,
          systemFallback: strategyInstructions,
          input: [{ role: "user" as const, content: strategyInput }],
          schemaName: "email_draft_strategy",
          strict: true,
          schema: EMAIL_DRAFT_STRATEGY_JSON_SCHEMA,
          attempts: [attemptMaxTokens],
          budget: { min: attemptMaxTokens, max: attemptMaxTokens },
          timeoutMs: attemptTimeoutMs,
          maxRetries: 0,
          resolved: {
            system: strategyInstructions,
            featureId: "draft.generate.email.strategy",
            promptKeyForTelemetry: attemptPromptKey,
          },
        });

        strategyInteractionId = strategyResult.telemetry.interactionId;

        if (strategyResult.success) {
          strategy = strategyResult.data;

          // If AI selected an archetype, resolve it and apply workspace overrides
          if (shouldSelectArchetype && strategy.recommended_archetype_id) {
            const aiSelectedArchetype = getArchetypeById(strategy.recommended_archetype_id);
            if (aiSelectedArchetype) {
              const { instructions: effectiveArchetypeInstructions } = await getEffectiveArchetypeInstructions(
                aiSelectedArchetype.id,
                lead.clientId
              );
              archetype = { ...aiSelectedArchetype, instructions: effectiveArchetypeInstructions };
              console.log(`[AI Drafts] AI selected archetype: ${archetype.id} (${archetype.name})`);
            } else {
              // Fallback to default if AI returned invalid ID
              console.warn(`[AI Drafts] AI returned invalid archetype ID: ${strategy.recommended_archetype_id}, using default`);
              const defaultArchetype = EMAIL_DRAFT_STRUCTURE_ARCHETYPES[0];
              const { instructions: effectiveArchetypeInstructions } = await getEffectiveArchetypeInstructions(
                defaultArchetype.id,
                lead.clientId
              );
              archetype = { ...defaultArchetype, instructions: effectiveArchetypeInstructions };
            }
          }

          break;
        }

        if (strategyResult.error.category === "rate_limit") {
          await new Promise((r) => setTimeout(r, 250));
        }

        if (attempt < strategyMaxAttempts) {
          console.warn(`[AI Drafts] Strategy step failed (attempt ${attempt}/${strategyMaxAttempts}); retrying`, {
            leadId,
            category: strategyResult.error.category,
          });
          continue;
        }

        if (strategyInteractionId) {
          const sample = (strategyResult.error.raw || strategyResult.rawOutput || "")
            .replace(/\s+/g, " ")
            .slice(0, 500);
          const sampleSuffix = sample ? ` | sample=${sample}` : "";
          await markAiInteractionError(
            strategyInteractionId,
            `strategy_failed: category=${strategyResult.error.category} attempt=${attempt}/${strategyMaxAttempts} max_output_tokens=${attemptMaxTokens}${sampleSuffix}`
          );

          console.error("[AI Drafts] Strategy step failed; falling back to single-step.", {
            leadId,
            interactionId: strategyInteractionId,
            category: strategyResult.error.category,
            attempt,
            maxAttempts: strategyMaxAttempts,
            maxOutputTokens: attemptMaxTokens,
          });
        }

        break;
      }

	      // Step 2: Generation (if strategy succeeded and archetype is resolved)
	      if (strategy) {
          // Ensure archetype is set (fallback if AI selection failed or wasn't requested)
          if (!archetype) {
            console.warn("[AI Drafts] No archetype set after strategy, using default");
            const defaultArchetype = EMAIL_DRAFT_STRUCTURE_ARCHETYPES[0];
            const { instructions: effectiveArchetypeInstructions } = await getEffectiveArchetypeInstructions(
              defaultArchetype.id,
              lead.clientId
            );
            archetype = { ...defaultArchetype, instructions: effectiveArchetypeInstructions };
          }

          // At this point archetype is guaranteed to be set
          const resolvedArchetype = archetype;

	        const generationInstructions = buildEmailDraftGenerationInstructions({
	          aiName,
	          aiTone,
	          aiGreeting,
	          firstName,
	          signature: aiSignature || null,
	          signatureContext: signatureContextForPrompt,
	          leadSchedulerLink,
	          ourCompanyName: companyName,
	          sentimentTag,
	          strategy,
	          archetype: resolvedArchetype,
	          forbiddenTerms: effectiveForbiddenTerms, // Phase 47e
	        }) + emailLengthRules;

        const generationInput = `<conversation_transcript>
${conversationTranscript}
</conversation_transcript>

<task>
Write the email response now, following the strategy and structure archetype.
</task>`;

	        const generationBudget = await computeAdaptiveMaxOutputTokens({
	          model: draftModel,
	          instructions: generationInstructions,
	          input: [{ role: "user" as const, content: generationInput }],
	          min: Math.max(1, Math.floor(900 * tokenBudgetMultiplier)),
	          max: Math.max(1, Math.floor(3200 * tokenBudgetMultiplier)),
	          overheadTokens: 256 * tokenBudgetMultiplier,
	          outputScale: 0.2 * tokenBudgetMultiplier,
	          preferApiCount,
	        });

	        const generationMaxAttempts = Math.max(
	          1,
	          Math.min(3, Number.parseInt(process.env.OPENAI_EMAIL_GENERATION_MAX_ATTEMPTS || "2", 10) || 2)
	        );
	        const generationTokenIncrement = Math.max(
	          0,
	          Number.parseInt(process.env.OPENAI_EMAIL_GENERATION_TOKEN_INCREMENT || "2000", 10) || 2000
	        );
	        const generationBasePromptKey = `draft.generate.email.generation.v1.arch_${resolvedArchetype.id}`;
	        const generationBaseMaxOutputTokens = Math.max(800, generationBudget.maxOutputTokens);
	        const clientIdForAi = lead.clientId;

	          async function rewriteEmailDraftToLength(
	          originalDraft: string,
	          reason: "too_short" | "too_long",
	          attempt: number
	        ): Promise<string | null> {
	          const rewriteInstructions =
	            `You are an inbox manager. Rewrite the email reply below to satisfy all rules.\n\n` +
	            `OUTPUT RULES:\n` +
	            `- Output the rewritten email only (no preface).\n` +
	            `- Do not include a subject line.\n` +
	            `- Keep Markdown-friendly plain text (paragraphs and "-" bullets allowed).\n` +
	            `- Do not use bold/italics/headings.\n` +
	            `- Preserve meaning, intent, and CTA.\n` +
	            `- Preserve any full URLs exactly as-is.\n` +
	            `- Do NOT add booking links or placeholders like "{insert booking link}".\n` +
	            `- If the original includes a signature block, keep it; otherwise do not add one.\n\n` +
	            `TARGET:\n- The rewrite is ${reason.replace("_", " ")}.` +
	            emailLengthRules;

		          try {
                const rewritePromptKey = `${generationBasePromptKey}.len_${reason}.rewrite${attempt}`;
		            const rewriteResult = await runTextPrompt({
                  pattern: "text",
                  clientId: clientIdForAi,
                  leadId,
                  featureId: "draft.generate.email.length_rewrite",
                  promptKey: rewritePromptKey,
                  model: draftModel,
                  systemFallback: rewriteInstructions,
                  input: [
                    {
                      role: "user" as const,
                      content: `<draft>\n${originalDraft}\n</draft>`,
                    },
                  ],
                  temperature: 0.2,
                  maxOutputTokens: Math.min(maxOutputTokensCap, 2000 + (attempt - 1) * 1000),
                  timeoutMs: generationTimeoutMs,
                  maxRetries: 0,
                  resolved: {
                    system: rewriteInstructions,
                    featureId: "draft.generate.email.length_rewrite",
                    promptKeyForTelemetry: rewritePromptKey,
                  },
                });

                if (!rewriteResult.success && rewriteResult.error.category === "incomplete_output") {
	              console.warn(
	                `[AI Drafts] Email length rewrite hit max_output_tokens (attempt ${attempt}); discarding partial rewrite`
	              );
	              return null;
	            }

                if (!rewriteResult.success) {
                  console.error("[AI Drafts] Email length rewrite failed:", rewriteResult.error.message);
                  return null;
                }

	            return rewriteResult.data.trim() || null;
	          } catch (error) {
	            console.error("[AI Drafts] Email length rewrite failed:", error);
	            return null;
	          }
	        }

	        for (let attempt = 1; attempt <= generationMaxAttempts; attempt++) {
	          const attemptMaxOutputTokens = Math.min(
	            maxOutputTokensCap,
	            generationBaseMaxOutputTokens + (attempt - 1) * generationTokenIncrement
	          );

	          try {
              const generationPromptKey = attempt === 1 ? generationBasePromptKey : `${generationBasePromptKey}.retry${attempt}`;
	            const generationResult = await runTextPrompt({
                pattern: "text",
                clientId: lead.clientId,
                leadId,
                featureId: "draft.generate.email.generation",
                promptKey: generationPromptKey,
                model: draftModel,
                systemFallback: generationInstructions,
                input: [{ role: "user" as const, content: generationInput }],
                temperature: 0.8, // Balanced variation with better instruction adherence
                // No reasoning for generation step - just output text
                maxOutputTokens: attemptMaxOutputTokens,
                timeoutMs: generationTimeoutMs,
                maxRetries: 0,
                resolved: {
                  system: generationInstructions,
                  featureId: "draft.generate.email.generation",
                  promptKeyForTelemetry: generationPromptKey,
                },
              });

              if (!generationResult.success) {
                if (
                  generationResult.error.category === "incomplete_output" &&
                  generationResult.error.message.includes("max_output_tokens") &&
                  attempt < generationMaxAttempts
                ) {
                  console.warn(
                    `[AI Drafts] Email generation hit max_output_tokens with partial output (attempt ${attempt}/${generationMaxAttempts}); retrying`
                  );
                  continue;
                }

                if (generationResult.error.category === "incomplete_output") {
                  console.warn(
                    `[AI Drafts] Email generation produced empty output (attempt ${attempt}/${generationMaxAttempts}); stopping`
                  );
                  break;
                }

                console.error(
                  `[AI Drafts] Step 2 (Generation) failed (attempt ${attempt}):`,
                  generationResult.error.message
                );
                continue;
              }

	            const text = generationResult.data.trim() || null;
              if (!text) break;

	            const issues = detectDraftIssues(text);
	            if ((issues.hasTruncatedUrl || issues.hasPlaceholders) && attempt < generationMaxAttempts) {
	              console.warn(
	                `[AI Drafts] Email generation produced suspicious output (placeholders=${issues.hasPlaceholders} truncatedUrl=${issues.hasTruncatedUrl}) (attempt ${attempt}/${generationMaxAttempts}); retrying`
	              );
	              continue;
	            }

	            let candidate = text;
	            const lengthStatus = getEmailLengthStatus(candidate, emailLengthBounds);
	            if (lengthStatus !== "ok") {
	              const rewritten = await rewriteEmailDraftToLength(
	                candidate,
	                lengthStatus === "too_long" ? "too_long" : "too_short",
	                attempt
	              );
	              if (rewritten) {
	                candidate = rewritten;
	              }
	            }

	            // Last-resort clamp to enforce strict max length.
	            const finalLengthStatus = getEmailLengthStatus(candidate, emailLengthBounds);
	            if (finalLengthStatus === "too_long") {
	              console.warn(
	                `[AI Drafts] Email draft exceeded max chars (${emailLengthBounds.maxChars}); clamping`,
	                { leadId, channel, length: candidate.trim().length }
	              );
	              candidate = candidate.trim().slice(0, emailLengthBounds.maxChars).trimEnd();
	            }

	            draftContent = candidate;
	            break;
	          } catch (error) {
	            console.error(`[AI Drafts] Step 2 (Generation) failed (attempt ${attempt}):`, error);
	          }
	        }
	      }

      // Fallback: Single-step with archetype + high temperature (if two-step failed)
      if (!draftContent) {
        console.log("[AI Drafts] Two-step failed, falling back to single-step with archetype");

        // Ensure archetype is set for fallback
        if (!archetype) {
          const fallbackArchetypeSeed = buildArchetypeSeed({ leadId, triggerMessageId: null, draftRequestStartedAtMs });
          const fallbackBaseArchetype = selectArchetypeFromSeed(fallbackArchetypeSeed);
          const { instructions: effectiveArchetypeInstructions } = await getEffectiveArchetypeInstructions(
            fallbackBaseArchetype.id,
            lead.clientId
          );
          archetype = { ...fallbackBaseArchetype, instructions: effectiveArchetypeInstructions };
        }

        // At this point archetype is guaranteed to be set
        const fallbackArchetype = archetype;

	        let fallbackSystemPrompt = buildEmailPrompt({
	          aiName,
	          aiTone,
	          aiGreeting,
	          firstName,
	          responseStrategy,
	          aiGoals,
	          availability,
	          sentimentTag,
	          signature: aiSignature,
	          serviceDescription,
	          qualificationQuestions,
	          knowledgeContext,
	          ourWebsiteUrl: primaryWebsiteUrl,
	          companyName,
	          targetResult,
	        }) + emailLengthRules + `\n\nSTRUCTURE REQUIREMENT: "${fallbackArchetype.name}"\n${fallbackArchetype.instructions}`;

        // Append booking process instructions if available (Phase 36)
        if (bookingProcessInstructions) {
          fallbackSystemPrompt += bookingProcessInstructions;
        }

        // Lead-scheduler-link override (Phase 79): prevent fallback prompt from suggesting our times/link
        // when the lead explicitly provided their own scheduling link.
        if (leadSchedulerLink) {
          fallbackSystemPrompt +=
            "\nLEAD SCHEDULER LINK OVERRIDE:\nThe lead explicitly provided their own scheduling link.\nIMPORTANT: Do NOT offer our availability times or our booking link. Acknowledge their link and express willingness to book via their scheduler (no need to repeat the full URL).";
        }

        const fallbackInputMessages = [
          {
            role: "assistant" as const,
            content: `Completely avoid the usage of these words/phrases/tones:\n\n${effectiveForbiddenTerms.join("\n")}`,
          },
          {
            role: "user" as const,
            content: `<conversation_transcript>
${conversationTranscript}
</conversation_transcript>

<lead_sentiment>${sentimentTag}</lead_sentiment>

<task>
Generate an appropriate email response following the guidelines and structure archetype above.
</task>`,
          },
        ];

        const fallbackBudget = await computeAdaptiveMaxOutputTokens({
          model: draftModel,
          instructions: fallbackSystemPrompt,
          input: fallbackInputMessages,
          min: Math.max(1, Math.floor(900 * tokenBudgetMultiplier)),
          max: Math.max(1, Math.floor(3200 * tokenBudgetMultiplier)),
          overheadTokens: 256 * tokenBudgetMultiplier,
          outputScale: 0.18 * tokenBudgetMultiplier,
          preferApiCount,
        });

	        const fallbackBasePromptKey = `draft.generate.email.v1.fallback.arch_${fallbackArchetype.id}`;
	        const fallbackMaxAttempts = Math.max(
	          1,
	          Math.min(4, Number.parseInt(process.env.OPENAI_EMAIL_FALLBACK_MAX_ATTEMPTS || "2", 10) || 2)
	        );

	        for (let attempt = 1; attempt <= fallbackMaxAttempts; attempt++) {
	          const attemptMaxOutputTokens = Math.min(
	            maxOutputTokensCap,
	            Math.max(800, fallbackBudget.maxOutputTokens) + (attempt - 1) * 2000
	          );

            const attemptPromptKey = attempt === 1 ? fallbackBasePromptKey : `${fallbackBasePromptKey}.retry${attempt}`;
            const fallbackResult = await runTextPrompt({
              pattern: "text",
              clientId: lead.clientId,
              leadId,
              featureId: "draft.generate.email",
              promptKey: attemptPromptKey,
              model: draftModel,
              reasoningEffort:
                strategyReasoningApi === "none"
                  ? undefined
                  : strategyReasoningApi === "xhigh"
                    ? "high"
                    : strategyReasoningApi,
              systemFallback: fallbackSystemPrompt,
              input: fallbackInputMessages,
              temperature: 0.8, // Balanced variation with better instruction adherence
              maxOutputTokens: attemptMaxOutputTokens,
              timeoutMs: timeoutMs,
              maxRetries: 1,
              resolved: {
                system: fallbackSystemPrompt,
                featureId: "draft.generate.email",
                promptKeyForTelemetry: attemptPromptKey,
              },
            });

            const interactionId = fallbackResult.telemetry.interactionId;

            if (!fallbackResult.success) {
              if (fallbackResult.error.category === "rate_limit") {
                await new Promise((r) => setTimeout(r, 250));
              }

              // Don't persist partial output; retry with a higher budget (or fall back deterministically).
              if (
                fallbackResult.error.category === "incomplete_output" &&
                fallbackResult.error.message.includes("max_output_tokens")
              ) {
                console.warn(
                  `[AI Drafts] Email single-step fallback hit max_output_tokens (attempt ${attempt}/${fallbackMaxAttempts}); retrying`
                );

                if (attempt === fallbackMaxAttempts && interactionId) {
                  await markAiInteractionError(
                    interactionId,
                    `email_fallback_truncated: attempt=${attempt}/${fallbackMaxAttempts} max_output_tokens=${attemptMaxOutputTokens}`
                  );
                }

                if (attempt < fallbackMaxAttempts) continue;
                break;
              }

              if (fallbackResult.error.category === "incomplete_output") {
                console.warn(
                  `[AI Drafts] Email single-step fallback produced empty output (attempt ${attempt}/${fallbackMaxAttempts}); retrying`
                );

                if (attempt === fallbackMaxAttempts && interactionId) {
                  await markAiInteractionError(
                    interactionId,
                    `email_fallback_empty: attempt=${attempt}/${fallbackMaxAttempts} max_output_tokens=${attemptMaxOutputTokens}`
                  );
                  console.warn("[AI Drafts] Email single-step fallback exhausted attempts (empty output).", {
                    leadId,
                    interactionId,
                    attempt,
                    maxAttempts: fallbackMaxAttempts,
                    maxOutputTokens: attemptMaxOutputTokens,
                  });
                  break;
                }

                continue;
              }

              if (fallbackResult.error.retryable && attempt < fallbackMaxAttempts) {
                console.warn(
                  `[AI Drafts] Email single-step fallback retryable error (attempt ${attempt}/${fallbackMaxAttempts}): ${fallbackResult.error.message}`
                );
                continue;
              }

              console.warn(`[AI Drafts] Email single-step fallback failed (attempt ${attempt}):`, fallbackResult.error.message);
              break;
            }

            const text = fallbackResult.data.trim() || null;
            if (text) {
              const issues = detectDraftIssues(text);
              if ((issues.hasPlaceholders || issues.hasTruncatedUrl) && attempt < fallbackMaxAttempts) {
                console.warn(
                  `[AI Drafts] Email single-step fallback produced suspicious output (placeholders=${issues.hasPlaceholders} truncatedUrl=${issues.hasTruncatedUrl}) (attempt ${attempt}/${fallbackMaxAttempts}); retrying`
                );
                continue;
              }

              const lengthStatus = getEmailLengthStatus(text, emailLengthBounds);
              const candidate =
                lengthStatus === "too_long" ? text.trim().slice(0, emailLengthBounds.maxChars).trimEnd() : text;

              draftContent = candidate;
              break;
            }
	        }
      }
    }
    // ---------------------------------------------------------------------------
    // SMS / LinkedIn: Single-step
    // ---------------------------------------------------------------------------
    else {
      const promptKey = channel === "linkedin" ? "draft.generate.linkedin.v1" : "draft.generate.sms.v1";
      // Use override-aware prompt lookup (Phase 47i)
      const overrideResult = await getPromptWithOverrides(promptKey, lead.clientId);
      const promptTemplate = overrideResult?.template ?? getAIPromptTemplate(promptKey);
      const overrideVersion = overrideResult?.overrideVersion ?? null;

      const greeting = aiGreeting.replace("{firstName}", firstName);
      const safeCompanyName = companyName && companyName.trim() ? companyName : "the company";
      const safeTargetResult = targetResult && targetResult.trim() ? targetResult : "their growth goals";
      const safeGoals =
        aiGoals?.trim() || "Use good judgment to advance the conversation while respecting user intent.";

      const templateVars: Record<string, string> = {
        aiName,
        aiTone,
        responseStrategy,
        aiGoals: safeGoals,
        greeting,
        companyName: safeCompanyName,
        targetResult: safeTargetResult,
        serviceDescription: serviceDescription?.trim() || "None.",
        knowledgeContext: knowledgeContext?.trim() || "None.",
        ourWebsiteUrl: primaryWebsiteUrl?.trim() || "None.",
        qualificationQuestions: qualificationQuestions.length
          ? qualificationQuestions.map((q) => `- ${q}`).join("\n")
          : "None.",
        availability: availability.length ? availability.map((s) => `- ${s}`).join("\n") : "None.",
        conversationTranscript: conversationTranscript || "",
        sentimentTag: sentimentTag || "",
      };

      const applyTemplateVars = (content: string): string => {
        let next = content;
        for (const [key, value] of Object.entries(templateVars)) {
          next = next.replaceAll(`{{${key}}}`, value);
          next = next.replaceAll(`{${key}}`, value);
        }
        return next;
      };

      const fallbackSystemPrompt =
        channel === "linkedin"
          ? buildLinkedInPrompt({
              aiName,
              aiTone,
              aiGreeting,
              firstName,
              responseStrategy,
              sentimentTag,
              aiGoals: safeGoals,
              serviceDescription,
              qualificationQuestions,
              knowledgeContext,
              ourWebsiteUrl: primaryWebsiteUrl,
              companyName,
              targetResult,
              availability,
            })
          : buildSmsPrompt({
              aiName,
              aiTone,
              aiGreeting,
              firstName,
              responseStrategy,
              sentimentTag,
              aiGoals: safeGoals,
              serviceDescription,
              qualificationQuestions,
              knowledgeContext,
              ourWebsiteUrl: primaryWebsiteUrl,
              companyName,
              targetResult,
              availability,
            });

      let instructions =
        promptTemplate?.messages.filter((m) => m.role === "system").map((m) => applyTemplateVars(m.content)).join("\n\n").trim() ||
        fallbackSystemPrompt;

      // Append booking process instructions if available (Phase 36)
      if (bookingProcessInstructions) {
        instructions += bookingProcessInstructions;
      }

      // Lead-scheduler-link override (Phase 79): prevent SMS/LinkedIn drafts from suggesting our times/link
      // when the lead explicitly provided their own scheduling link.
      if (leadSchedulerLink) {
        instructions +=
          "\nLEAD SCHEDULER LINK OVERRIDE:\nThe lead explicitly provided their own scheduling link.\nIMPORTANT: Do NOT offer our availability times or our booking link. Acknowledge their link and indicate you'll book via their scheduler (no need to repeat the full URL).";
      }

      const templatedInput = promptTemplate?.messages
        .filter((m) => m.role !== "system")
        .map((m) => ({
          role: m.role as "user" | "assistant",
          content: applyTemplateVars(m.content),
        }));

      const inputMessages: Array<{ role: "user" | "assistant"; content: string }> =
        templatedInput && templatedInput.length > 0
          ? templatedInput
          : [
              {
                role: "user",
                content: `<conversation_transcript>
${conversationTranscript}
</conversation_transcript>

<lead_sentiment>${sentimentTag}</lead_sentiment>

<task>
Generate an appropriate ${channel} response following the guidelines above.
</task>`,
              },
            ];

	      const primaryModel = "gpt-5-mini";
	      const reasoningEffort = "low" as const;

	      const primaryBudgetMin = 320 * tokenBudgetMultiplier;
	      const primaryBudgetMax = 1600 * tokenBudgetMultiplier;

      const budget = await computeAdaptiveMaxOutputTokens({
        model: primaryModel,
        instructions,
        input: inputMessages,
        min: Math.max(1, Math.floor(primaryBudgetMin)),
        max: Math.max(1, Math.floor(primaryBudgetMax)),
        overheadTokens: 256 * tokenBudgetMultiplier,
        outputScale: 0.2 * tokenBudgetMultiplier,
        preferApiCount,
      });

      const promptKeyForTelemetry = (promptTemplate?.key || promptKey) + (overrideVersion ? `.${overrideVersion}` : "");
      const base = Math.max(800, budget.maxOutputTokens);
      const primaryAttempts = [
        Math.min(maxOutputTokensCap, base),
        Math.min(maxOutputTokensCap, Math.max(base + 1500, Math.floor(base * 2))),
        Math.min(maxOutputTokensCap, Math.max(base + 3500, Math.floor(base * 3))),
      ];

      const primaryResult = await runTextPrompt({
        pattern: "text",
        clientId: lead.clientId,
        leadId,
        featureId: promptTemplate?.featureId || `draft.generate.${channel}`,
        promptKey: promptTemplate?.key || promptKey,
        model: primaryModel,
        reasoningEffort,
        retryReasoningEffort: "minimal",
        systemFallback: instructions,
        input: inputMessages,
        verbosity: "low",
        attempts: primaryAttempts,
        timeoutMs: timeoutMs,
        maxRetries: 0,
        resolved: {
          system: instructions,
          featureId: promptTemplate?.featureId || `draft.generate.${channel}`,
          promptKeyForTelemetry,
        },
      });

      if (primaryResult.success) {
        draftContent = primaryResult.data.trim() || null;
      }

      // Fallback: same model, spend more tokens
	      if (!draftContent) {
	        const fallbackBudgetMin = 480 * tokenBudgetMultiplier;
	        const fallbackBudgetMax = 2400 * tokenBudgetMultiplier;

        const fallbackBudget = await computeAdaptiveMaxOutputTokens({
          model: primaryModel,
          instructions,
          input: inputMessages,
          min: Math.max(1, Math.floor(fallbackBudgetMin)),
          max: Math.max(1, Math.floor(fallbackBudgetMax)),
          overheadTokens: 256 * tokenBudgetMultiplier,
          outputScale: 0.18 * tokenBudgetMultiplier,
          preferApiCount,
        });

          const fallbackPromptKeyForTelemetry = `${promptKeyForTelemetry}.fallback`;
          const fallbackResult = await runTextPrompt({
            pattern: "text",
            clientId: lead.clientId,
            leadId,
            featureId: promptTemplate?.featureId || `draft.generate.${channel}`,
            promptKey: promptTemplate?.key || promptKey,
            model: primaryModel,
            reasoningEffort,
            retryReasoningEffort: "minimal",
            systemFallback: instructions,
            input: inputMessages,
            verbosity: "low",
            attempts: [
              Math.min(maxOutputTokensCap, Math.max(800, fallbackBudget.maxOutputTokens)),
              Math.min(
                maxOutputTokensCap,
                Math.max(Math.max(800, fallbackBudget.maxOutputTokens) + 1500, Math.floor(Math.max(800, fallbackBudget.maxOutputTokens) * 2))
              ),
            ],
            timeoutMs: timeoutMs,
            maxRetries: 0,
            resolved: {
              system: instructions,
              featureId: promptTemplate?.featureId || `draft.generate.${channel}`,
              promptKeyForTelemetry: fallbackPromptKeyForTelemetry,
            },
          });

          if (!fallbackResult.success) {
            console.warn(`[AI Drafts] ${channel} generation failed after retries:`, fallbackResult.error.message);
          } else {
            const fallbackText = fallbackResult.data.trim() || null;
            if (fallbackText) {
              draftContent = fallbackText;
            }
          }
	    }
    }

    if (!draftContent) {
      console.warn("[AI Drafts] OpenAI draft generation failed; using deterministic fallback draft.", {
        leadId,
        channel,
        sentimentTag,
      });

      draftContent = buildDeterministicFallbackDraft({
        channel,
        aiName,
        aiGreeting,
        firstName,
        signature: aiSignature || null,
        sentimentTag,
        availability,
      });
    }

    let bookingLink: string | null = null;
    let hasPublicBookingLinkOverride = false;
    try {
      const resolved = await resolveBookingLink(lead.clientId, settings);
      bookingLink = resolved.bookingLink;
      hasPublicBookingLinkOverride = resolved.hasPublicOverride;
    } catch (error) {
      console.error("[AI Drafts] Failed to resolve canonical booking link:", error);
    }

      if (channel === "email" && draftContent) {
        // Prevent verifier truncations by keeping the draft within our configured bounds.
        const preBounds = emailLengthBoundsForClamp ?? getEmailDraftCharBoundsFromEnv();
        if (draftContent.trim().length > preBounds.maxChars) {
          draftContent = draftContent.trim().slice(0, preBounds.maxChars).trimEnd();
        }

        try {
          const verified = await runEmailDraftVerificationStep3({
            clientId: lead.clientId,
            leadId,
            triggerMessageId,
            draft: draftContent,
            availability,
            bookingLink,
            bookingProcessInstructions,
            forbiddenTerms: emailVerifierForbiddenTerms ?? DEFAULT_FORBIDDEN_TERMS,
            serviceDescription,
            knowledgeContext,
            timeoutMs: emailVerifierTimeoutMs,
          });

          if (verified) {
            draftContent = verified;
          }
        } catch (error) {
          console.error("[AI Drafts] Step 3 verifier threw unexpectedly:", error);
        }

      }

    if (draftContent && triggerMessageId) {
      const latestInboundText = triggerMessageRecord?.body?.trim() ?? "";

      if (!latestInboundText) {
        console.warn("[AI Drafts] Missing trigger message body; skipping meeting overseer gate.", {
          leadId,
          triggerMessageId,
        });
      } else {
        const shouldGate = shouldRunMeetingOverseer({
          messageText: latestInboundText,
          sentimentTag,
          offeredSlotsCount: availability.length,
        });

        if (shouldGate) {
          const extraction = await getMeetingOverseerDecision(triggerMessageId, "extract");
          const extractionDecision =
            extraction && typeof extraction === "object" && "is_scheduling_related" in extraction
              ? (extraction as MeetingOverseerExtractDecision)
              : null;
          const gateDraft = await runMeetingOverseerGate({
            clientId: lead.clientId,
            leadId,
            messageId: triggerMessageId,
            channel,
            latestInbound: latestInboundText,
            draft: draftContent,
            availability,
            bookingLink,
            extraction: extractionDecision,
            memoryContext: memoryContext || null,
            leadSchedulerLink,
            timeoutMs: emailVerifierTimeoutMs,
          });

          if (gateDraft) {
            draftContent = gateDraft;
          }
        }
      }
    }

    if (channel === "email" && draftContent) {
      // Hard post-pass enforcement (even if verifier or gate fails).
      draftContent = enforceCanonicalBookingLink(draftContent, bookingLink, {
        replaceAllUrls: hasPublicBookingLinkOverride,
      });
      draftContent = replaceEmDashesWithCommaSpace(draftContent);
    }

    draftContent = sanitizeDraftContent(draftContent, leadId, channel);

    if (channel === "email") {
      const bounds = emailLengthBoundsForClamp ?? getEmailDraftCharBoundsFromEnv();
      const status = getEmailLengthStatus(draftContent, bounds);
      if (status === "too_long") {
        console.warn(`[AI Drafts] Email draft exceeded max chars (${bounds.maxChars}); clamping`, {
          leadId,
          length: draftContent.trim().length,
        });
        draftContent = draftContent.trim().slice(0, bounds.maxChars).trimEnd();
      }
    }

    try {
      const draft = await prisma.aIDraft.create({
        data: {
          leadId,
          triggerMessageId: triggerMessageId || undefined,
          content: draftContent,
          status: "pending",
          channel,
        },
      });

      return {
        success: true,
        draftId: draft.id,
        content: draftContent,
      };
    } catch (error) {
      // If multiple workers raced, return the already-created draft instead of failing.
      if (triggerMessageId && isPrismaUniqueConstraintError(error)) {
        const existing = await prisma.aIDraft.findFirst({
          where: { triggerMessageId, channel },
          select: { id: true, content: true },
        });
        if (existing) {
          return { success: true, draftId: existing.id, content: existing.content };
        }
      }

      throw error;
    }
  } catch (error) {
    console.error("Failed to generate AI draft:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

function getResponseStrategy(sentimentTag: string): string {
  const strategies: Record<string, string> = {
    "Meeting Requested": "Confirm interest and propose specific meeting times. Be enthusiastic but professional.",
    "Call Requested": "Acknowledge their request for a call. Confirm the best number to reach them and propose specific call times.",
    "Not Interested": "Acknowledge their decision respectfully. Ask if they'd like to be contacted in the future or if there's anything specific they're looking for.",
    "Information Requested":
      "Provide the requested information clearly and concisely using the service description and relevant knowledge assets. Offer to schedule a call for more details. Do not treat 'send me more info' as a website request unless they explicitly asked for a link.",
    "Follow Up":
      "Acknowledge the timing and keep it low-pressure. Ask a single timeline question (e.g., 6–12 months, 1–2 years, later) and if it’s okay to check back then. Don’t push for a meeting.",
    "Out of Office": "Acknowledge and ask when would be a good time to reconnect. Be understanding.",
    "Automated Reply": "DO NOT GENERATE A RESPONSE - This is an automated acknowledgement.",
    "Interested": "Build on the positive momentum. Move towards scheduling a conversation or next steps.",
    "Positive": "Build on the positive momentum. Move towards scheduling a conversation or next steps.", // Legacy fallback
    "Blacklist": "DO NOT GENERATE A RESPONSE - This contact has opted out.",
  };

  return strategies[sentimentTag] || "Respond professionally and try to move the conversation forward.";
}

/**
 * Check if an email address is a bounce notification sender
 * (mailer-daemon, postmaster, etc.) - should never get AI drafts
 */
export function isBounceEmailAddress(email: string | null | undefined): boolean {
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

/**
 * Determine if an AI draft should be generated for a lead.
 * Uses a whitelist approach - only generate drafts for leads who have engaged.
 * 
 * Includes: positive intents + Follow Up deferrals
 */
export function shouldGenerateDraft(sentimentTag: string, email?: string | null): boolean {
  // Never generate drafts for bounce email addresses
  if (isBounceEmailAddress(email)) {
    return false;
  }

  // Generate drafts for positive intents, plus "Follow Up" (deferrals / not-now timing).
  // (Legacy: "Positive" is treated as "Interested".)
  const normalized = sentimentTag === "Positive" ? "Interested" : sentimentTag;
  if (normalized === "Meeting Booked") {
    return true;
  }
  return normalized === "Follow Up" || isPositiveSentiment(normalized);
}
