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
import { enforceCanonicalBookingLink, removeForbiddenTerms, replaceEmDashesWithCommaSpace } from "@/lib/ai-drafts/step3-verifier";
import { evaluateStep3RewriteGuardrail, normalizeDraftForCompare } from "@/lib/ai-drafts/step3-guardrail";
import { getBookingProcessInstructions } from "@/lib/booking-process-instructions";
import { shouldEscalateForMaxWaves } from "@/lib/booking-progress";
import type { OfferedSlot } from "@/lib/booking";
import { resolveBookingLink } from "@/lib/meeting-booking-provider";
import { getLeadQualificationAnswerState } from "@/lib/qualification-answer-extraction";
import { extractImportantEmailSignatureContext, type EmailSignatureContextExtraction } from "@/lib/email-signature-context";
import { extractSchedulerLinkFromText, hasExplicitSchedulerLinkInstruction } from "@/lib/scheduling-link";
import { emailsMatch, extractFirstName } from "@/lib/email-participants";
import {
  buildLeadContextBundle,
  buildLeadContextBundleTelemetryMetadata,
  isLeadContextBundleGloballyDisabled,
} from "@/lib/lead-context-bundle";
import {
  PRIMARY_WEBSITE_ASSET_NAME,
  extractPrimaryWebsiteUrlFromAssets,
  resolveKnowledgeAssetContextSource,
  type KnowledgeAssetForContext,
} from "@/lib/knowledge-asset-context";
import { markInboxCountsDirtyByLeadId } from "@/lib/inbox-counts-dirty";
import { getLeadMemoryContext } from "@/lib/lead-memory-context";
import { recordAiRouteSkip } from "@/lib/ai/route-skip-observability";
import {
  getMeetingOverseerDecision,
  repairShouldBookNowAgainstOfferedSlots,
  runMeetingOverseerExtraction,
  runMeetingOverseerGateDecision,
  shouldRunMeetingOverseer,
  type MeetingOverseerExtractDecision,
} from "@/lib/meeting-overseer";
import { resolveWorkspacePolicyProfile } from "@/lib/workspace-policy-profile";
import { buildActionSignalsGateSummary, hasActionSignal, hasActionSignalOrRoute } from "@/lib/action-signal-detector";
import type { ActionSignalDetectionResult } from "@/lib/action-signal-detector";
import type { AutoBookingContext } from "@/lib/followup-engine";
import { DRAFT_PIPELINE_STAGES, type DraftPipelineStage } from "@/lib/draft-pipeline/types";
import { validateArtifactPayload } from "@/lib/draft-pipeline/validate-payload";
import type { AvailabilitySource } from "@prisma/client";

type DraftChannel = "sms" | "email" | "linkedin";
type DraftRouteSkip =
  | "draft_generation"
  | "draft_generation_step2"
  | "draft_verification_step3"
  | "meeting_overseer";

interface DraftGenerationResult {
  success: boolean;
  draftId?: string;
  content?: string;
  runId?: string | null;
  offeredSlots?: OfferedSlot[];
  availability?: string[];
  bookingEscalationReason?: string | null;
  reusedExistingDraft?: boolean;
  skippedRoutes?: DraftRouteSkip[];
  blockedBySetting?: "draftGenerationEnabled";
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
   * Controls whether an existing draft for (triggerMessageId, channel) should
   * be reused. Defaults to true.
   *
   * Replay/backfill flows should set this to false to force a fresh generation
   * pass against current prompt/pipeline behavior.
   */
  reuseExistingDraft?: boolean;
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
  /**
   * Auto-booking context from inbound processing. Used to keep scheduling drafts coherent
   * (e.g., avoid contradictory "we'll call" language when scheduling intent was already detected).
   */
  autoBookingContext?: AutoBookingContext | null;
  /**
   * Optional action-signal payload supplied by inbound post-processing.
   * Reserved for signal-aware prompt augmentation.
   */
  actionSignals?: ActionSignalDetectionResult | null;
  /**
   * Optional lead-provided scheduler link override for replay/backfill contexts
   * where the link exists in raw message content but is not yet persisted on Lead.
   */
  leadSchedulerLinkOverride?: string | null;
  /**
   * Controls whether meeting overseer decisions should be reused from persisted
   * message-level cache (`persisted`) or recomputed fresh for this run (`fresh`).
   */
  meetingOverseerMode?: "persisted" | "fresh";
  /**
   * When running with `meetingOverseerMode: "fresh"`, controls whether new
   * overseer decisions should be persisted to `MeetingOverseerDecision`.
   * Defaults to true.
   */
  persistMeetingOverseerDecisions?: boolean;
};

function escapeRegExpSimple(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const BOOKING_LINK_CTA_LINE_REGEX =
  /\b(you can grab a time here|grab a time here|book here|schedule here|schedule a meeting|calendar)\b/i;
const BOOKING_LINK_CTA_ONLY_LINE_REGEX =
  /^\s*(?:you\s+can\s+grab\s+a\s+time\s+here|grab\s+a\s+time\s+here|you\s+can\s+book\s+here|book\s+here|schedule\s+here|schedule\s+a\s+meeting)\s*:?\s*$/i;

function normalizeBookingLinkPlacement(draft: string, bookingLink: string | null): { draft: string; changed: boolean } {
  const text = (draft || "").trim();
  const link = (bookingLink || "").trim();
  if (!text || !link) return { draft: text, changed: false };

  const linkRegexGlobal = new RegExp(escapeRegExpSimple(link), "gi");
  const occurrences = text.match(linkRegexGlobal) || [];

  const linkLower = link.toLowerCase();
  const lineContainsLink = (line: string) => line.toLowerCase().includes(linkLower);

  const lines = text.split("\n");
  let changed = false;

  // If a draft includes an orphan CTA line ("You can grab a time here:") but omitted the URL,
  // attach the resolved link to that line.
  if (occurrences.length === 0) {
    const ctaOnlyIndex = lines.findIndex((line) => {
      const trimmed = (line || "").trim();
      if (!trimmed) return false;
      if (/https?:\/\//i.test(trimmed)) return false;
      return BOOKING_LINK_CTA_ONLY_LINE_REGEX.test(trimmed);
    });

    if (ctaOnlyIndex >= 0) {
      const trimmed = (lines[ctaOnlyIndex] || "").trimEnd();
      const glue = trimmed.endsWith(":") ? " " : ": ";
      lines[ctaOnlyIndex] = `${trimmed}${glue}${link}`;
      const nextDraft = lines
        .join("\n")
        .replace(/[ \t]+\n/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
      return nextDraft && nextDraft !== text ? { draft: nextDraft, changed: true } : { draft: text, changed: false };
    }

    return { draft: text, changed: false };
  }

  // Deduplicate: keep first line containing the link, drop subsequent lines that contain the same link.
  let keptFirstLink = false;
  const deduped = lines.filter((rawLine) => {
    if (!lineContainsLink(rawLine)) return true;
    if (!keptFirstLink) {
      keptFirstLink = true;
      return true;
    }
    changed = true;
    return false;
  });

  let nextLines = deduped;
  const standaloneLinkIndexes = nextLines
    .map((line, idx) => ({ line: line.trim(), idx }))
    .filter((entry) => entry.line === link)
    .map((entry) => entry.idx);

  const ctaIndex = nextLines.findIndex((line) => {
    if (!BOOKING_LINK_CTA_LINE_REGEX.test(line)) return false;
    if (/https?:\/\//i.test(line)) return false;
    return true;
  });

  // If we have a CTA line referencing "grab a time/book here" without the link, but the link exists as a standalone line,
  // merge the link into the CTA and remove the standalone line for cleanliness.
  if (ctaIndex >= 0 && standaloneLinkIndexes.length > 0) {
    const ctaLine = nextLines[ctaIndex] || "";
    if (!lineContainsLink(ctaLine)) {
      const trimmed = ctaLine.trimEnd();
      const glue = trimmed.endsWith(":") ? " " : ": ";
      nextLines[ctaIndex] = `${trimmed}${glue}${link}`;
      changed = true;
    }

    const remove = new Set(standaloneLinkIndexes);
    nextLines = nextLines.filter((_line, idx) => !remove.has(idx));
    changed = true;
  }

  // If the link exists anywhere in the draft, drop any leftover CTA-only line that still doesn't include a URL.
  // (This typically shows up as an editing artifact like "You can grab a time here:" after an earlier CTA already included the link.)
  if (nextLines.some((line) => lineContainsLink(line))) {
    const beforeLen = nextLines.length;
    nextLines = nextLines.filter((line) => {
      const trimmed = (line || "").trim();
      if (!trimmed) return true;
      if (/https?:\/\//i.test(trimmed)) return true;
      if (BOOKING_LINK_CTA_ONLY_LINE_REGEX.test(trimmed)) return false;
      return true;
    });
    if (nextLines.length !== beforeLen) changed = true;
  }

  const nextDraft = nextLines
    .join("\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (!nextDraft || nextDraft === text) return { draft: text, changed: false };
  return { draft: nextDraft, changed: true };
}

function buildBookedConfirmationDraft(params: {
  channel: DraftChannel;
  firstName: string | null;
  aiName: string;
  slotLabel: string;
  acknowledgement?: string | null;
}): string {
  const slotLabel = params.slotLabel.trim();
  if (params.channel === "sms") {
    return `Booked for ${slotLabel}.`;
  }
  if (params.channel === "linkedin") {
    return `You're booked for ${slotLabel}.`;
  }

  const acknowledgement =
    typeof params.acknowledgement === "string" && params.acknowledgement.trim()
      ? params.acknowledgement.trim()
      : null;
  const greeting = params.firstName ? `Hi ${params.firstName},\n\n` : "Hi,\n\n";
  const middle = acknowledgement ? `\n\n${acknowledgement}` : "";
  return `${greeting}You're booked for ${slotLabel}.${middle}\n\nBest,\n${params.aiName}`;
}

function buildFoundersClubBookingAcknowledgement(params: {
  latestInboundText: string | null | undefined;
  extraction: MeetingOverseerExtractDecision | null;
}): string | null {
  const inbound = (params.latestInboundText || "").trim();
  if (!inbound) return null;
  const normalized = inbound.toLowerCase();
  const hasOpenPointSignals =
    /\b(founder|co-?founded|founding member|partner|entrepreneur|revenue|arr|context|background)\b/i.test(inbound) ||
    /\b(fee|pricing|frequency|attend|attendance|community|include|included|location|venue)\b/i.test(inbound);
  if (!hasOpenPointSignals) return null;

  const contract = params.extraction?.decision_contract_v1 ?? null;
  const asksLogisticsFollowUps =
    contract?.needsPricingAnswer === "yes" ||
    contract?.needsCommunityDetails === "yes" ||
    /\b(fee|pricing|frequency|attend|attendance|community|location|venue)\b/i.test(normalized);

  if (asksLogisticsFollowUps) {
    return "Thanks for sharing those details and questions as well, we can cover them on the call.";
  }

  return "Thanks for sharing that extra context as well.";
}

export function applyShouldBookNowConfirmationIfNeeded(params: {
  draft: string;
  channel: DraftChannel;
  firstName: string | null;
  aiName: string;
  extraction: MeetingOverseerExtractDecision | null;
  availability: string[];
  clientId?: string | null;
  latestInboundText?: string | null;
}): string {
  const draft = (params.draft || "").trim();
  const contract = params.extraction?.decision_contract_v1;
  if (!draft || !contract || contract.shouldBookNow !== "yes") return draft;
  if (!Array.isArray(params.availability) || params.availability.length === 0) return draft;

  const matchedSlot = params.availability.find((slot) => slot && draft.includes(slot)) || null;
  const bookedConfirmationRegex =
    /\b(you're\s+booked|you\s+are\s+booked|booked\s+for|i\s*['’]?\s*ve\s+booked|i\s+have\s+booked|i\s+booked\s+you|scheduled\s+you|we\s*['’]?\s*ve\s+booked|we\s+have\s+booked)\b/i;
  const looksLikeConfirmation = bookedConfirmationRegex.test(draft);

  // If we already reference a concrete offered slot and it reads like a booked confirmation, keep it.
  if (matchedSlot && looksLikeConfirmation) return draft;

  const acceptedIndex = typeof params.extraction?.accepted_slot_index === "number" ? params.extraction.accepted_slot_index : null;
  const acceptedSlot =
    acceptedIndex && acceptedIndex > 0 && acceptedIndex <= params.availability.length
      ? params.availability[acceptedIndex - 1]!
      : null;
  const selectedSlot = matchedSlot ?? acceptedSlot;
  // If we can't map to a concrete offered slot, let the overseer/generator keep the lead's own wording.
  if (!selectedSlot) return draft;

  const workspacePolicyProfile = resolveWorkspacePolicyProfile(params.clientId || null);
  const acknowledgement =
    workspacePolicyProfile === "founders_club" && params.channel === "email"
      ? buildFoundersClubBookingAcknowledgement({
          latestInboundText: params.latestInboundText || null,
          extraction: params.extraction,
        })
      : null;

  return buildBookedConfirmationDraft({
    channel: params.channel,
    firstName: params.firstName,
    aiName: params.aiName,
    slotLabel: selectedSlot,
    acknowledgement,
  });
}

export function applySchedulingConfirmationWordingGuard(params: {
  draft: string;
}): { draft: string; changed: boolean } {
  const draft = (params.draft || "").trim();
  if (!draft) return { draft, changed: false };

  // "Locked for" reads like internal ops language and can imply a booking without explicit confirmation.
  // Normalize to "Confirmed for" which is clearer and matches our scheduling playbook.
  const next = draft.replace(/\blocked\s+for\b/gi, "Confirmed for");
  if (next === draft) return { draft, changed: false };
  return { draft: next, changed: true };
}

const BOOKING_ONLY_CONFIRMATION_WORKS_LINE_REGEX = /^\s*(?:thanks[,!]\s*)?(.+?)\s+works(?:\s+for\s+me)?\.?\s*$/i;
const BOOKING_ONLY_CONFIRMATION_TIME_HINT_REGEX =
  /\b(mon(day)?|tue(s(day)?)?|wed(nesday)?|thu(r(s(day)?)?)?|fri(day)?|sat(urday)?|sun(day)?)\b|\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b|\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\b|\b(pst|pdt|pt|mst|mdt|mt|cst|cdt|ct|est|edt|et|utc|gmt)\b/i;
const BOOKING_ONLY_MONTHLY_EQUIVALENT_SENTENCE_REGEX =
  /(\bIt\s+(?:works\s+out\s+to|equates\s+to)\s+\$\s*\d[\d,]*(?:\.\d{1,2})?\s*(?:per\s+month|\/\s?(?:mo|month))\b)[^.]*\./i;
const BOOKING_ONLY_COMMUNITY_PREFIX_REGEX = /^\s*on\s+local\s+founders\s*:\s*/i;

function shortenBookingOnlyPricingParagraph(paragraph: string): string {
  let out = (paragraph || "").trim();
  if (!out) return "";

  // Remove trailing justification clauses after the monthly-equivalent amount.
  out = out.replace(BOOKING_ONLY_MONTHLY_EQUIVALENT_SENTENCE_REGEX, "$1.");

  // Avoid overly long paragraphs when booking_only; keep at most 2 sentences.
  const sentences = out
    .split(/(?<=\.)\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (sentences.length > 2) {
    out = `${sentences[0]} ${sentences[1]}`.trim();
  }

  return out.replace(/\s+/g, " ").trim();
}

function shortenBookingOnlyCommunityParagraph(paragraph: string): string {
  let out = (paragraph || "").trim();
  if (!out) return "";

  out = out.replace(BOOKING_ONLY_COMMUNITY_PREFIX_REGEX, "");
  // Drop verbose asides like "(roles, stage, ...)".
  out = out.replace(/\([^)]*\)/g, "");
  out = out.replace(/\s+/g, " ").trim();
  if (out && /^[a-z]/.test(out)) out = out[0]!.toUpperCase() + out.slice(1);
  return out;
}

function rewriteBookingOnlyWorksParagraph(paragraph: string): { paragraph: string; changed: boolean } {
  const trimmed = (paragraph || "").trim();
  if (!trimmed) return { paragraph: trimmed, changed: false };
  const match = trimmed.match(BOOKING_ONLY_CONFIRMATION_WORKS_LINE_REGEX);
  if (!match?.[1]) return { paragraph: trimmed, changed: false };
  const core = match[1].trim();
  if (!core) return { paragraph: trimmed, changed: false };
  if (!BOOKING_ONLY_CONFIRMATION_TIME_HINT_REGEX.test(core)) return { paragraph: trimmed, changed: false };
  const next = `Confirmed for ${core}.`;
  if (next === trimmed) return { paragraph: trimmed, changed: false };
  return { paragraph: next, changed: true };
}

export function applyBookingOnlyConcisionGuard(params: {
  draft: string;
  extraction: MeetingOverseerExtractDecision | null;
  channel: DraftChannel;
}): { draft: string; changed: boolean } {
  const draft = (params.draft || "").trim();
  if (!draft) return { draft, changed: false };
  if (params.channel !== "email") return { draft, changed: false };
  if (draft.includes("?")) return { draft, changed: false };

  const extraction = params.extraction;
  const contract = extraction?.decision_contract_v1;
  if (!contract) return { draft, changed: false };
  if (contract.responseMode !== "booking_only") return { draft, changed: false };

  const needsPricingAnswer = contract.needsPricingAnswer === "yes";
  const needsCommunityDetails = contract.needsCommunityDetails === "yes";
  if (!needsPricingAnswer && !needsCommunityDetails) return { draft, changed: false };

  const paragraphs = draft
    .split(/\n{2,}/)
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (paragraphs.length < 3) return { draft, changed: false };

  const greeting = paragraphs[0] || "";
  const signOff = paragraphs[paragraphs.length - 1] || "";
  const body = paragraphs.slice(1, -1);
  if (body.length === 0) return { draft, changed: false };

  const nextBody: string[] = [];
  let changed = false;

  // Booking confirmation comes first; prefer rewriting a simple "X works." line to "Confirmed for X."
  const confirmation = rewriteBookingOnlyWorksParagraph(body[0] || "");
  if (confirmation.changed) changed = true;
  nextBody.push(confirmation.paragraph || body[0] || "");

  const pricingParagraph =
    needsPricingAnswer
      ? body.find((p, idx) => idx !== 0 && /\$\s*\d/.test(p))
      : null;
  const communityParagraph =
    needsCommunityDetails
      ? body.find(
          (p, idx) =>
            idx !== 0 &&
            p !== pricingParagraph &&
            /\b(founder|founders|member|members|roster|chapter|circle|local)\b/i.test(p)
        )
      : null;

  const pricingShort = needsPricingAnswer && pricingParagraph ? shortenBookingOnlyPricingParagraph(pricingParagraph) : "";
  const communityShort = needsCommunityDetails && communityParagraph ? shortenBookingOnlyCommunityParagraph(communityParagraph) : "";

  const infoSentence = [pricingShort, communityShort].filter(Boolean).join(" ").trim();
  if (infoSentence) {
    nextBody.push(infoSentence);
    if (pricingParagraph && pricingShort !== pricingParagraph.trim()) changed = true;
    if (communityParagraph && communityShort !== communityParagraph.trim()) changed = true;
  }

  const nextDraft = [greeting, ...nextBody, signOff]
    .filter(Boolean)
    .join("\n\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (!nextDraft || nextDraft === draft) return { draft, changed: false };
  return { draft: nextDraft, changed: true };
}

const CONTACT_UPDATE_EMAIL_REGEX = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const CONTACT_UPDATE_CUE_REGEX =
  /\b(please use|use\s+[^.\n]{0,40}\bemail\b|do not regularly receive|not monitored|no longer with|reach me personally|email me directly|please contact)\b/i;
const CONTACT_UPDATE_SCHEDULING_CUE_REGEX =
  /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|am|pm|schedule|scheduling|book|booking|call|meeting|availability|slot|time)\b/i;
const CONTACT_UPDATE_DRAFT_SCHEDULING_CUE_REGEX =
  /\b(schedule|scheduling|book|booking|call|meeting|availability|slot)\b/i;

function extractEmailsFromText(text: string): string[] {
  const raw = text || "";
  const matches = raw.match(CONTACT_UPDATE_EMAIL_REGEX) || [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const match of matches) {
    const email = (match || "").trim();
    if (!email) continue;
    const key = email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(email);
  }
  return result;
}

export function applyContactUpdateNoSchedulingGuard(params: {
  draft: string;
  latestInboundText: string | null;
  channel: DraftChannel;
  firstName: string | null;
  aiName: string;
}): { draft: string; changed: boolean } {
  const draft = (params.draft || "").trim();
  const inbound = (params.latestInboundText || "").trim();
  if (!draft || !inbound) return { draft, changed: false };
  if (!CONTACT_UPDATE_CUE_REGEX.test(inbound)) return { draft, changed: false };
  // If the inbound is explicitly scheduling-related, don't suppress scheduling in the draft.
  if (CONTACT_UPDATE_SCHEDULING_CUE_REGEX.test(inbound)) return { draft, changed: false };

  const emails = extractEmailsFromText(inbound);
  if (emails.length === 0) return { draft, changed: false };

  const draftMentionsScheduling =
    CONTACT_UPDATE_DRAFT_SCHEDULING_CUE_REGEX.test(draft) ||
    /https?:\/\/\S+/i.test(draft) ||
    /\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/i.test(draft);
  if (!draftMentionsScheduling) return { draft, changed: false };

  const greeting = params.channel === "email" ? (params.firstName ? `Hi ${params.firstName},\n\n` : "Hi,\n\n") : "";
  const signOff = params.channel === "email" ? `\n\nBest,\n${params.aiName}` : "";

  const contactLineMatch = inbound.match(/contact[^\n]{0,160}?\b([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})\b/i);
  const personalLineMatch = inbound.match(/(?:reach me|email me)[^\n]{0,160}?\b([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})\b/i);
  const businessEmail = (contactLineMatch?.[1] || "").trim() || null;
  const personalEmail = (personalLineMatch?.[1] || "").trim() || null;

  const sentence =
    businessEmail && personalEmail && businessEmail.toLowerCase() !== personalEmail.toLowerCase()
      ? `Got it, thanks for the update. We'll use ${businessEmail} for business matters, and ${personalEmail} to reach you directly.`
      : `Got it, we'll use ${emails[0]} going forward.`;

  const nextDraft = `${greeting}${sentence}${signOff}`.trim();
  if (!nextDraft || nextDraft === draft) return { draft, changed: false };
  return { draft: nextDraft, changed: true };
}

const PRICING_MODE_SCHEDULING_PARAGRAPH_REGEX =
  /\b(schedule|scheduling|book|booking|calendar|availability|slot|slots|time options?|which works|does .* work|15[- ]?minute|30[- ]?minute)\b/i;
const PRICING_MODE_TIME_TOKEN_REGEX = /\b([01]?\d(?::[0-5]\d)?\s?(?:am|pm)|\d{1,2}:\d{2})\b/i;
const PRICING_MODE_MEETING_ASK_REGEX = /\b(call|meeting)\b/i;
const PRICING_MODE_ACTION_VERB_REGEX = /\b(does|would|can|could|works?)\b/i;
const PRICING_MODE_BOOKING_URL_REGEX = /https?:\/\/\S+/i;

export function applyPricingAnswerNoSchedulingGuard(params: {
  draft: string;
  extraction: MeetingOverseerExtractDecision | null;
  bookingLink?: string | null;
  leadSchedulerLink?: string | null;
}): { draft: string; changed: boolean } {
  const draft = (params.draft || "").trim();
  if (!draft) return { draft, changed: false };

  const contract = params.extraction?.decision_contract_v1;
  if (!contract) return { draft, changed: false };
  if (contract.needsPricingAnswer !== "yes") return { draft, changed: false };
  if (contract.shouldBookNow === "yes" || contract.hasBookingIntent === "yes") {
    return { draft, changed: false };
  }

  const safeBookingLink =
    params.leadSchedulerLink && params.leadSchedulerLink.trim()
      ? null
      : (params.bookingLink || "").trim() || null;
  const nextStepSentence = safeBookingLink
    ? `If helpful, we can walk through details on a quick 15-minute call. You can grab a time here: ${safeBookingLink}`
    : PRICING_MODE_NEXT_STEP_SENTENCE;

  const paragraphs = draft
    .split(/\n{2,}/)
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (paragraphs.length === 0) return { draft, changed: false };

  let changed = false;
  const kept = paragraphs.filter((paragraph) => {
    const hasSchedulingCue = PRICING_MODE_SCHEDULING_PARAGRAPH_REGEX.test(paragraph);
    if (!hasSchedulingCue) return true;

    const hasTimeToken = PRICING_MODE_TIME_TOKEN_REGEX.test(paragraph);
    const hasMeetingAsk =
      PRICING_MODE_MEETING_ASK_REGEX.test(paragraph) && PRICING_MODE_ACTION_VERB_REGEX.test(paragraph);
    const hasBookingUrl =
      PRICING_MODE_BOOKING_URL_REGEX.test(paragraph) &&
      /\b(calendly|calendar|book|schedule)\b/i.test(paragraph);

    if (hasTimeToken || hasMeetingAsk || hasBookingUrl) {
      changed = true;
      return false;
    }

    return true;
  });

  if (!changed || kept.length === 0) return { draft, changed: false };

  return {
    draft: kept.join("\n\n").trim(),
    changed: true,
  };
}

const PRICING_MODE_ALT_QUALIFIER_REGEX = /\?\s*(?:if not|if you'?re not|or if not)[^?]*\?/gi;
const PRICING_MODE_INLINE_ALT_CRITERIA_REGEX = /\s*\((?:or|and\/or)[^)]+\)/gi;
const PRICING_MODE_QUALIFIER_PARAGRAPH_HINT_REGEX = /\b(annual revenue|\$\s*1\s*m|\$\s*1,?000,?000|qualified|fit)\b/i;
const PRICING_MODE_NEXT_STEP_SENTENCE =
  "If helpful, we can walk through details on a quick 15-minute call.";

export function applyPricingAnswerQualificationGuard(params: {
  draft: string;
  extraction: MeetingOverseerExtractDecision | null;
  bookingLink?: string | null;
  leadSchedulerLink?: string | null;
}): { draft: string; changed: boolean } {
  const draft = (params.draft || "").trim();
  if (!draft) return { draft, changed: false };

  const contract = params.extraction?.decision_contract_v1;
  if (!contract) return { draft, changed: false };
  if (contract.needsPricingAnswer !== "yes") return { draft, changed: false };
  if (contract.shouldBookNow === "yes" || contract.hasBookingIntent === "yes") {
    return { draft, changed: false };
  }

  const safeBookingLink =
    params.leadSchedulerLink && params.leadSchedulerLink.trim()
      ? null
      : (params.bookingLink || "").trim() || null;
  const nextStepSentence = safeBookingLink
    ? `If helpful, we can walk through details on a quick 15-minute call. You can grab a time here: ${safeBookingLink}`
    : PRICING_MODE_NEXT_STEP_SENTENCE;

  const paragraphs = draft
    .split(/\n{2,}/)
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (paragraphs.length === 0) return { draft, changed: false };

  let changed = false;
  const normalizedParagraphs = paragraphs.map((paragraph) => {
    if (!PRICING_MODE_QUALIFIER_PARAGRAPH_HINT_REGEX.test(paragraph)) return paragraph;

    let next = paragraph.replace(PRICING_MODE_INLINE_ALT_CRITERIA_REGEX, "");
    next = next.replace(PRICING_MODE_ALT_QUALIFIER_REGEX, "?");

    const firstQuestionMark = next.indexOf("?");
    if (firstQuestionMark >= 0) {
      next = next.slice(0, firstQuestionMark + 1);
    }

    next = next.replace(/\s{2,}/g, " ").trim();
    if (!next) return paragraph;

    if (next !== paragraph) {
      changed = true;
    }

    return next;
  });

  let nextDraft = normalizedParagraphs.join("\n\n").trim();

  if (contract.responseMode === "info_then_booking") {
    const hasNextStep = /\b(15[- ]?minute call|quick call|walk through details)\b/i.test(nextDraft);
    if (!hasNextStep) {
      const signOffMatch = nextDraft.match(/\n\n(?:best|thanks|regards|sincerely|cheers),\n/i);
      if (signOffMatch && typeof signOffMatch.index === "number") {
        nextDraft =
          `${nextDraft.slice(0, signOffMatch.index).trim()}\n\n${nextStepSentence}\n\n${nextDraft
            .slice(signOffMatch.index + 2)
            .trim()}`;
      } else {
        nextDraft = `${nextDraft}\n\n${nextStepSentence}`;
      }
      changed = true;
    }
  }

  if (!changed) return { draft, changed: false };

  return {
    draft: nextDraft
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
    changed: true,
  };
}

const NEEDS_CLARIFICATION_SCHEDULING_HINT_REGEX =
  /\b(time|start time|which|when|works?|after|before|am|pm|pt|pst|pdt|et|est|edt|utc|mon|tue|wed|thu|fri|sat|sun|tomorrow|today|schedule|scheduling|book|booking|calendar|availability|slot|slots)\b/i;
const NEEDS_CLARIFICATION_QUALIFICATION_HINT_REGEX =
  /\b(annual revenue|revenue|qualified|unqualified|fit|exit|raised|raise|sold|\$\s*1\s*m|\$\s*1,?000,?000|\$\s*2\.5\s*m|\$\s*2,?500,?000)\b/i;
const NEEDS_CLARIFICATION_COMPOUND_OR_CLAUSE_REGEX =
  /\bor\s+(?:is|are|was|were|do|does|did|can|could|would|will|have|has|had|should|may|might)\b/i;

export function applyNeedsClarificationSingleQuestionGuard(params: {
  draft: string;
  extraction: MeetingOverseerExtractDecision | null;
}): { draft: string; changed: boolean } {
  const draft = (params.draft || "").trim();
  if (!draft) return { draft, changed: false };
  const extraction = params.extraction;
  if (!extraction) return { draft, changed: false };
  const contract = extraction.decision_contract_v1;
  if (!contract) return { draft, changed: false };

  const shouldEnforceSingleQuestion = extraction.needs_clarification === true || contract.responseMode === "clarify_only";
  const shouldTrimCompoundOrClause = shouldEnforceSingleQuestion || contract.hasBookingIntent !== "yes";
  if (!shouldEnforceSingleQuestion && !shouldTrimCompoundOrClause) return { draft, changed: false };

  const questionCount = (draft.match(/\?/g) || []).length;
  const paragraphs = draft
    .split(/\n{2,}/)
    .map((entry) => entry.trim())
    .filter(Boolean);

  const questionParagraphs = paragraphs
    .map((text, idx) => ({ text, idx }))
    .filter((entry) => entry.text.includes("?"));

  if (questionCount <= 1) {
    if (!shouldTrimCompoundOrClause) return { draft, changed: false };
    const onlyQuestion = questionParagraphs.length === 1 ? questionParagraphs[0] : null;
    if (!onlyQuestion) return { draft, changed: false };

    const questionMarkIndex = onlyQuestion.text.indexOf("?");
    if (questionMarkIndex < 0) return { draft, changed: false };

    const questionSentence = onlyQuestion.text.slice(0, questionMarkIndex + 1);
    const compoundMatch = questionSentence.match(NEEDS_CLARIFICATION_COMPOUND_OR_CLAUSE_REGEX);
    if (!compoundMatch || typeof compoundMatch.index !== "number") return { draft, changed: false };

    const beforeOr = questionSentence
      .slice(0, compoundMatch.index)
      .replace(/[\s,;:()]+$/g, "")
      .trim();
    if (!beforeOr) return { draft, changed: false };

    const simplifiedQuestion = `${beforeOr.replace(/[?.,;:]+$/g, "").trim()}?`;
    const remainder = onlyQuestion.text.slice(questionMarkIndex + 1).trimStart();
    const nextParagraph = remainder ? `${simplifiedQuestion} ${remainder}` : simplifiedQuestion;
    if (nextParagraph === onlyQuestion.text) return { draft, changed: false };

    const nextParagraphs = paragraphs.slice();
    nextParagraphs[onlyQuestion.idx] = nextParagraph;
    return { draft: nextParagraphs.join("\n\n").trim(), changed: true };
  }

  if (!shouldEnforceSingleQuestion) return { draft, changed: false };
  if (paragraphs.length <= 1) return { draft, changed: false };
  if (questionParagraphs.length <= 1) return { draft, changed: false };

  const ranked = questionParagraphs
    .map((entry) => {
      const hasSchedulingHint = NEEDS_CLARIFICATION_SCHEDULING_HINT_REGEX.test(entry.text);
      const hasQualificationHint = NEEDS_CLARIFICATION_QUALIFICATION_HINT_REGEX.test(entry.text);
      const score = (hasSchedulingHint ? 10 : 0) + (hasQualificationHint ? -4 : 0) + entry.idx * 0.01;
      return { ...entry, score };
    })
    .sort((a, b) => b.score - a.score);

  const keep = ranked[0];
  if (!keep) return { draft, changed: false };

  const nextParagraphs = paragraphs.filter((paragraph, idx) => {
    if (!paragraph.includes("?")) return true;
    return idx === keep.idx;
  });

  const nextDraft = nextParagraphs.join("\n\n").trim();
  if (!nextDraft || nextDraft === draft) return { draft, changed: false };

  return { draft: nextDraft, changed: true };
}

const RELATIVE_WEEKDAY_NEXT_REGEX =
  /\b(?:next\s+)?(mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\b(?!\.[a-z])/i;
const RELATIVE_WEEKDAY_NEXT_PREFIX_ONLY_REGEX =
  /\bnext\s+(mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\b/i;
const RELATIVE_WEEKDAY_HAS_EXPLICIT_DATE_REGEX =
  /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2}(?:st|nd|rd|th)?\b|\b\d{1,2}[\/-]\d{1,2}(?:[\/-]\d{2,4})?\b/i;
const CLARIFY_ONLY_WEEKDAY_WORKS_START_TIME_REGEX =
  /\b(?:next\s+)?(mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\b(?!\.[a-z])([^?]{0,80}?)\bworks\.?\s+What\s+(?:exact\s+)?(?:start\s+)?time\s+should\s+we\s+use\s*\?/i;

function leadRequestedNextWeekday(opts: {
  extraction: MeetingOverseerExtractDecision;
  weekdayToken: string;
}): boolean {
  const details: string[] = [];
  const rawDetail = typeof opts.extraction.relative_preference_detail === "string" ? opts.extraction.relative_preference_detail.trim() : "";
  if (rawDetail) details.push(rawDetail);

  const windows = opts.extraction.decision_contract_v1?.leadProposedWindows;
  if (Array.isArray(windows)) {
    for (const window of windows) {
      if (!window || typeof window !== "object") continue;
      if (window.type !== "relative") continue;
      if (typeof window.detail === "string" && window.detail.trim()) {
        details.push(window.detail.trim());
      }
    }
  }

  for (const detail of details) {
    const match = detail.match(RELATIVE_WEEKDAY_NEXT_PREFIX_ONLY_REGEX);
    if (!match?.[1]) continue;
    const token = normalizeWeekdayToken(match[1]);
    if (token && token === opts.weekdayToken) return true;
  }

  return false;
}

export function applyRelativeWeekdayDateDisambiguationGuard(params: {
  draft: string;
  extraction: MeetingOverseerExtractDecision | null;
  timeZone: string;
  referenceDate?: Date | null;
}): { draft: string; changed: boolean } {
  const draft = (params.draft || "").trim();
  if (!draft) return { draft, changed: false };
  if (!draft.includes("?")) return { draft, changed: false };
  if (RELATIVE_WEEKDAY_HAS_EXPLICIT_DATE_REGEX.test(draft)) return { draft, changed: false };

  const extraction = params.extraction;
  const contract = extraction?.decision_contract_v1;
  if (!contract) return { draft, changed: false };

  const shouldApply =
    extraction?.needs_clarification === true ||
    contract.responseMode === "clarify_only";
  if (!shouldApply) return { draft, changed: false };

  const match = draft.match(RELATIVE_WEEKDAY_NEXT_REGEX);
  if (!match) return { draft, changed: false };
  const weekdayToken = normalizeWeekdayToken(match[1] || "");
  if (!weekdayToken) return { draft, changed: false };

  const wantsNextPrefix = extraction ? leadRequestedNextWeekday({ extraction, weekdayToken }) : false;

  // Special-case: when the model writes "Monday afternoon ... works. What start time should we use?"
  // it can read like an implicit acceptance + a separate question. Collapse into a single
  // time-pinning question and preserve the lead's "next Monday" phrasing when present.
  if (contract.responseMode === "clarify_only") {
    const mergeMatch = draft.match(CLARIFY_ONLY_WEEKDAY_WORKS_START_TIME_REGEX);
    if (mergeMatch) {
      const suffix = (mergeMatch[2] || "").trim().replace(/\s+/g, " ").replace(/^[,;:.-]+/, "").trim();
      const weekdayRaw = (mergeMatch[1] || "").trim();
      const weekdayDisplay = weekdayRaw && /^[a-z]/.test(weekdayRaw) ? weekdayRaw[0]!.toUpperCase() + weekdayRaw.slice(1) : weekdayRaw;
      const fullMatch = mergeMatch[0] || "";
      const hasNextAlready = /\bnext\b/i.test(fullMatch);
      const prefix = hasNextAlready || wantsNextPrefix ? "next " : "";
      const question = `What start time ${prefix}${weekdayDisplay}${suffix ? ` ${suffix}` : ""} should we use?`;
      const merged = draft.replace(CLARIFY_ONLY_WEEKDAY_WORKS_START_TIME_REGEX, question);
      if (merged && merged !== draft) return { draft: merged, changed: true };
    }
  }

  if (!wantsNextPrefix) return { draft, changed: false };

  const next = draft.replace(RELATIVE_WEEKDAY_NEXT_REGEX, (full, weekday) => {
    if (/\bnext\b/i.test(full)) return full;
    const rawWeekday = typeof weekday === "string" ? weekday.trim() : "";
    if (!rawWeekday) return full;
    return `next ${rawWeekday}`;
  });
  if (next === draft) return { draft, changed: false };
  return { draft: next, changed: true };
}

const CLARIFY_ONLY_THAT_DAY_REGEX = /\bthat\s+day\b/i;
const CLARIFY_ONLY_WEEKDAY_WORD_REGEX =
  /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i;

export function applyClarifyOnlyThatDayDisambiguationGuard(params: {
  draft: string;
  extraction: MeetingOverseerExtractDecision | null;
}): { draft: string; changed: boolean } {
  const draft = (params.draft || "").trim();
  if (!draft) return { draft, changed: false };
  if (!draft.includes("?")) return { draft, changed: false };
  if (!CLARIFY_ONLY_THAT_DAY_REGEX.test(draft)) return { draft, changed: false };

  const contract = params.extraction?.decision_contract_v1;
  if (!contract) return { draft, changed: false };
  if (contract.responseMode !== "clarify_only") return { draft, changed: false };

  const lower = draft.toLowerCase();
  const idx = lower.indexOf("that day");
  if (idx < 0) return { draft, changed: false };

  const prior = draft.slice(0, idx);
  const matches = Array.from(prior.matchAll(new RegExp(CLARIFY_ONLY_WEEKDAY_WORD_REGEX.source, "gi")));
  const last = matches.length > 0 ? matches[matches.length - 1] : null;
  const weekday = last?.[1] ? last[1].trim() : "";
  if (!weekday) return { draft, changed: false };

  const next = draft.replace(/\bthat\s+day\b/gi, `on that ${weekday}`);
  if (next === draft) return { draft, changed: false };
  return { draft: next, changed: true };
}

const CLARIFY_ONLY_WINDOW_EVIDENCE_REGEX =
  /\b(after|before)\s+([01]?\d(?::[0-5]\d)?\s*(?:am|pm))\b/i;
const CLARIFY_ONLY_TIME_TOKEN_REGEX = /\b([01]?\d(?::[0-5]\d)?\s*(?:am|pm)|\d{1,2}:\d{2})\b/i;
const CLARIFY_ONLY_TIMEZONE_WORD_REGEX =
  /\b(pacific|pt|pst|pdt|mountain|mt|mst|mdt|central|ct|cst|cdt|eastern|et|est|edt|utc|gmt)\b/i;
const CLARIFY_ONLY_TIME_QUESTION_DAY_PART_REGEX =
  /\b(?:does|would|is)\s+([^?]+?)\s+(?:at\s+)?([01]?\d(?::[0-5]\d)?\s*(?:am|pm)|\d{1,2}:\d{2})\b/i;

export function applyClarifyOnlyWindowStartTimeGuard(params: {
  draft: string;
  extraction: MeetingOverseerExtractDecision | null;
}): { draft: string; changed: boolean } {
  const draft = (params.draft || "").trim();
  const extraction = params.extraction;
  if (!draft || !extraction) return { draft, changed: false };

  const contract = extraction.decision_contract_v1;
  if (!contract) return { draft, changed: false };
  if (contract.responseMode !== "clarify_only") return { draft, changed: false };
  if (contract.hasBookingIntent !== "yes") return { draft, changed: false };

  const evidence = Array.isArray(extraction.evidence) ? extraction.evidence : [];
  let windowPhrase: string | null = null;
  for (const item of evidence) {
    if (typeof item !== "string") continue;
    const match = item.match(CLARIFY_ONLY_WINDOW_EVIDENCE_REGEX);
    if (!match) continue;
    windowPhrase = `${match[1]} ${match[2]}`.replace(/\s+/g, " ").trim();
    if (windowPhrase) break;
  }
  if (!windowPhrase) return { draft, changed: false };

  const paragraphs = draft
    .split(/\n{2,}/)
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (paragraphs.length === 0) return { draft, changed: false };

  const questionIndex = (() => {
    for (let i = paragraphs.length - 1; i >= 0; i -= 1) {
      if (paragraphs[i]?.includes("?")) return i;
    }
    return -1;
  })();
  if (questionIndex < 0) return { draft, changed: false };

  const question = paragraphs[questionIndex] || "";
  if (!CLARIFY_ONLY_TIME_TOKEN_REGEX.test(question)) return { draft, changed: false };

  const dayPartMatch = question.match(CLARIFY_ONLY_TIME_QUESTION_DAY_PART_REGEX);
  if (!dayPartMatch?.[1]) return { draft, changed: false };

  const dayPart = dayPartMatch[1].trim().replace(/[,.\s]+$/g, "").trim();
  if (!dayPart) return { draft, changed: false };

  const tzMatch = question.match(CLARIFY_ONLY_TIMEZONE_WORD_REGEX);
  const tzWord = tzMatch?.[1] ? tzMatch[1].trim() : "";
  const parenthetical = (() => {
    if (!tzWord) return windowPhrase;
    if (windowPhrase.toLowerCase().includes(tzWord.toLowerCase())) return windowPhrase;
    return `${windowPhrase} ${tzWord}`.replace(/\s+/g, " ").trim();
  })();

  const nextQuestion = `What exact start time on ${dayPart} (${parenthetical}) should we lock in for a 15-minute chat?`;
  if (!nextQuestion || nextQuestion === question) return { draft, changed: false };

  const nextParagraphs = [...paragraphs];
  nextParagraphs[questionIndex] = nextQuestion;

  const nextDraft = nextParagraphs.join("\n\n").trim();
  if (!nextDraft || nextDraft === draft) return { draft, changed: false };
  return { draft: nextDraft, changed: true };
}

const TIMEZONE_QUESTION_REGEX =
  /\b(what|which)\s+time\s*zone\b|\btime\s*zone\s+should\s+we\b|\btimezone\s+should\s+we\b/i;
const NON_TIMEZONE_TIME_REQUEST_HINT_REGEX =
  /\b(what|which)\s+(?:start\s+time|time)(?!\s*zone)\b|\bwhen\b/i;

function extractLeadTimezone(extraction: MeetingOverseerExtractDecision | null): string | null {
  const contractTz = extraction?.decision_contract_v1?.leadTimezone;
  if (typeof contractTz === "string" && contractTz.trim()) return contractTz.trim();
  const detected = extraction?.detected_timezone;
  if (typeof detected === "string" && detected.trim()) return detected.trim();
  return null;
}

export function applyTimezoneQuestionSuppressionGuard(params: {
  draft: string;
  extraction: MeetingOverseerExtractDecision | null;
}): { draft: string; changed: boolean } {
  const draft = (params.draft || "").trim();
  if (!draft) return { draft, changed: false };

  const leadTimezone = extractLeadTimezone(params.extraction);
  if (!leadTimezone) return { draft, changed: false };

  let next = draft;
  const lines = next.split("\n");
  let changed = false;

  // Remove standalone timezone question lines (common failure mode in clarify_only).
  const filteredLines = lines.filter((rawLine) => {
    const line = rawLine.trim();
    if (!line) return true;
    if (!line.includes("?")) return true;
    if (!TIMEZONE_QUESTION_REGEX.test(line)) return true;
    if (NON_TIMEZONE_TIME_REQUEST_HINT_REGEX.test(line)) return true;
    changed = true;
    return false;
  });
  next = filteredLines.join("\n");

  // Remove inline timezone add-ons inside a broader question (for example: "(and what timezone should we use)?").
  next = next.replace(/\(\s*and\s+what\s+time\s*zone[^)]*\)\s*\?/gi, "?");
  next = next.replace(/\s+and\s+what\s+time\s*zone[^?]*\?/gi, "?");
  next = next.replace(/\s+and\s+which\s+time\s*zone[^?]*\?/gi, "?");
  next = next.replace(/\s+what\s+time\s*zone\s+should\s+we\s+use[^?]*\?/gi, "?");
  next = next.replace(/\s+what\s+time\s*zone\s+should\s+we\s+book\s+in[^?]*\?/gi, "?");

  const cleaned = next
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();

  if (cleaned !== draft) changed = true;
  if (!changed || !cleaned) return { draft, changed: false };
  return { draft: cleaned, changed: true };
}

const INFO_THEN_BOOKING_TIME_REQUEST_REGEX =
  /\b(what\s+(?:2|two|3|three)\s*(?:-|–|—)?\s*(?:3|three)?\s*times?|what\s+times\b|what\s+time\b|which\s+time\s+works?|does\s+(?:either|one|that)\s+work|two\s+options?\b|options?\s+are\b|option\s+\d\b)\b/i;
const INFO_THEN_BOOKING_DAY_OR_DATE_TOKEN_REGEX =
  /\b(mon|tue|wed|thu|fri|sat|sun)\b|\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t)?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b|\b\d{1,2}(?:st|nd|rd|th)?\b/i;
const INFO_THEN_BOOKING_EXPLICIT_TIME_TOKEN_REGEX =
  /\b([01]?\d(?::[0-5]\d)?\s*(?:am|pm)|\d{1,2}:\d{2})\b/i;

export function applyInfoThenBookingNoTimeRequestGuard(params: {
  draft: string;
  extraction: MeetingOverseerExtractDecision | null;
}): { draft: string; changed: boolean } {
  const draft = (params.draft || "").trim();
  if (!draft) return { draft, changed: false };

  const contract = params.extraction?.decision_contract_v1;
  if (!contract) return { draft, changed: false };
  if (contract.responseMode !== "info_then_booking") return { draft, changed: false };
  if (contract.hasBookingIntent !== "no") return { draft, changed: false };

  const paragraphs = draft
    .split(/\n{2,}/)
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (paragraphs.length <= 1) return { draft, changed: false };

  let changed = false;
  const kept = paragraphs.filter((paragraph) => {
    const hasQuestion = paragraph.includes("?");

    // Remove explicit time-picking questions (e.g., "Which time works?").
    if (hasQuestion && INFO_THEN_BOOKING_TIME_REQUEST_REGEX.test(paragraph)) {
      changed = true;
      return false;
    }

    // Remove paragraphs that offer concrete time options when lead didn't ask for times.
    if (INFO_THEN_BOOKING_EXPLICIT_TIME_TOKEN_REGEX.test(paragraph) && INFO_THEN_BOOKING_DAY_OR_DATE_TOKEN_REGEX.test(paragraph)) {
      changed = true;
      return false;
    }

    return true;
  });

  if (!changed || kept.length === 0) return { draft, changed: false };
  return { draft: kept.join("\n\n").trim(), changed: true };
}

const INFO_THEN_BOOKING_QUALIFICATION_CLAUSE_REGEX =
  /\bfor\s+founders\/operators\s+doing\s+\$?\s*\d[\d,]*(?:\.\d+)?\s*(?:m|k|million|thousand)?\+?\s*(?:in\s+)?(?:annual\s+revenue|arr)\s*,?\s*/i;
const INFO_THEN_BOOKING_QUALIFICATION_FALLBACK_REGEX =
  /\b(?:doing|at)\s+\$?\s*\d[\d,]*(?:\.\d+)?\s*(?:m|k|million|thousand)?\+?\s*(?:in\s+)?(?:annual\s+revenue|arr)\b/i;

export function applyInfoThenBookingNoQualificationGatingGuard(params: {
  draft: string;
  extraction: MeetingOverseerExtractDecision | null;
}): { draft: string; changed: boolean } {
  const draft = (params.draft || "").trim();
  if (!draft) return { draft, changed: false };

  const contract = params.extraction?.decision_contract_v1;
  if (!contract) return { draft, changed: false };
  if (contract.responseMode !== "info_then_booking") return { draft, changed: false };
  if (contract.hasBookingIntent !== "no") return { draft, changed: false };
  if (contract.needsPricingAnswer !== "no") return { draft, changed: false };

  let next = draft;
  const before = next;

  next = next.replace(INFO_THEN_BOOKING_QUALIFICATION_CLAUSE_REGEX, "for founders/operators, ");
  next = next.replace(INFO_THEN_BOOKING_QUALIFICATION_FALLBACK_REGEX, "").replace(/\s{2,}/g, " ");
  next = next.replace(/\s+,/g, ",").replace(/\(\s*\)/g, "");

  next = next
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (!next || next === before) return { draft, changed: false };
  return { draft: next, changed: true };
}

const INFO_THEN_BOOKING_QUALIFICATION_QUESTION_REGEX =
  /[^?\n]*\b(annual\s+revenue|arr|revenue\s+mark|revenue\s+target|qualified|unqualified|funding|raised|exit|sold|\$\s*\d[\d,]*(?:\.\d+)?\s*(?:m|million|k|thousand)?)\b[^?\n]*\?/gi;

export function applyInfoThenBookingNoQualificationQuestionGuard(params: {
  draft: string;
  extraction: MeetingOverseerExtractDecision | null;
}): { draft: string; changed: boolean } {
  const draft = (params.draft || "").trim();
  if (!draft) return { draft, changed: false };

  const contract = params.extraction?.decision_contract_v1;
  if (!contract) return { draft, changed: false };
  if (contract.responseMode !== "info_then_booking") return { draft, changed: false };
  if (contract.hasBookingIntent !== "no") return { draft, changed: false };
  if (contract.needsPricingAnswer !== "no") return { draft, changed: false };

  const before = draft;
  let next = draft.replace(INFO_THEN_BOOKING_QUALIFICATION_QUESTION_REGEX, "");

  if (next !== before) {
    // If we removed a gating question, remove dependent phrasing.
    next = next.replace(/\bif\s+yes,\s+/gi, "If helpful, ");
    next = next.replace(/\bif\s+so,\s+/gi, "If helpful, ");
  }

  next = next
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();

  if (!next || next === before) return { draft, changed: false };
  return { draft: next, changed: true };
}

const REVENUE_TARGET_EVIDENCE_REVENUE_REGEX = /\b(revenue|arr|sales)\b/i;
const REVENUE_TARGET_EVIDENCE_UNDER_TARGET_REGEX =
  /\b(still\s+(?:a\s+)?target|not\s+(?:there|at)[^.!?]{0,40}yet|below|under|target|goal)\b/i;
const REVENUE_TARGET_ANSWER_SENTENCE =
  "If you're not at the revenue target yet, that's helpful context; we generally look for founders who are at or clearly building toward it.";

export function applyRevenueTargetAnswerGuard(params: {
  draft: string;
  extraction: MeetingOverseerExtractDecision | null;
  latestInboundText?: string | null;
}): { draft: string; changed: boolean } {
  const draft = (params.draft || "").trim();
  if (!draft) return { draft, changed: false };

  const evidence = params.extraction?.evidence || [];
  const shouldAnswerFromEvidence = Array.isArray(evidence)
    ? evidence.some(
        (item) =>
          typeof item === "string" &&
          REVENUE_TARGET_EVIDENCE_REVENUE_REGEX.test(item) &&
          REVENUE_TARGET_EVIDENCE_UNDER_TARGET_REGEX.test(item)
      )
    : false;
  const inbound = (params.latestInboundText || "").trim();
  const shouldAnswerFromInbound =
    !!inbound &&
    REVENUE_TARGET_EVIDENCE_REVENUE_REGEX.test(inbound) &&
    REVENUE_TARGET_EVIDENCE_UNDER_TARGET_REGEX.test(inbound);
  const shouldAnswer = shouldAnswerFromEvidence || shouldAnswerFromInbound;
  if (!shouldAnswer) return { draft, changed: false };

  if (
    /\bnot a problem\b|\bno problem\b|\bnot an issue\b|\bno issue\b/i.test(draft) ||
    (/\b(building|build)\s+toward\b/i.test(draft) && /\b(revenue|arr|target)\b/i.test(draft))
  ) {
    return { draft, changed: false };
  }

  const paragraphs = draft
    .split(/\n{2,}/)
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (paragraphs.length === 0) return { draft, changed: false };

  const insertAt = paragraphs.length >= 2 ? 2 : 1;
  const nextParagraphs = [...paragraphs];
  nextParagraphs.splice(insertAt, 0, REVENUE_TARGET_ANSWER_SENTENCE);
  const nextDraft = nextParagraphs.join("\n\n").trim();
  if (!nextDraft || nextDraft === draft) return { draft, changed: false };
  return { draft: nextDraft, changed: true };
}

const LEAD_SCHEDULER_LINK_CHOICE_REGEX =
  /\b(?:your|their)\s+link\b[\s\S]{0,80}\b(?:our|ours)\b|\b(?:use|send)\s+ours\b|\bour\s+link\b/i;

function buildLeadSchedulerLinkClarificationDraft(params: {
  channel: DraftChannel;
  firstName: string | null;
  aiName: string;
}): string {
  const sentence = "Sounds good. I'll use your calendar link to book a time and send a confirmation.";

  if (params.channel === "sms") return sentence;
  if (params.channel === "linkedin") return sentence;

  const greeting = params.firstName ? `Hi ${params.firstName},\n\n` : "Hi,\n\n";
  return `${greeting}${sentence}\n\nBest,\n${params.aiName}`;
}

function applyLeadSchedulerLinkNoChoiceGuard(params: {
  draft: string;
  extraction: MeetingOverseerExtractDecision | null;
  leadSchedulerLink: string | null;
  channel: DraftChannel;
  firstName: string | null;
  aiName: string;
}): { draft: string; changed: boolean } {
  const draft = (params.draft || "").trim();
  const link = (params.leadSchedulerLink || "").trim();
  if (!draft || !link) return { draft, changed: false };

  const contract = params.extraction?.decision_contract_v1;
  if (contract?.hasBookingIntent !== "yes") return { draft, changed: false };

  // If the lead provided a scheduler link and extraction still thinks clarification is needed,
  // prefer a direct acknowledgement that we'll use their scheduler (avoids offering our times).
  if (contract?.responseMode === "clarify_only") {
    const target = buildLeadSchedulerLinkClarificationDraft({
      channel: params.channel,
      firstName: params.firstName,
      aiName: params.aiName,
    });
    return target && target !== draft ? { draft: target, changed: true } : { draft, changed: false };
  }

  const alreadyAcknowledgesLink =
    /\byour\s+(?:calendar|link)\b/i.test(draft) && !/\b(our|ours)\s+link\b/i.test(draft);
  if (alreadyAcknowledgesLink) return { draft, changed: false };

  // Fix the common failure mode: asking the lead to choose between their scheduler and ours.
  if (!LEAD_SCHEDULER_LINK_CHOICE_REGEX.test(draft) || !draft.includes("?")) {
    return { draft, changed: false };
  }

  return {
    draft: buildLeadSchedulerLinkClarificationDraft({
      channel: params.channel,
      firstName: params.firstName,
      aiName: params.aiName,
    }),
    changed: true,
  };
}

function normalizeEmailDraftLineBreaks(draft: string): string {
  const raw = (draft || "").trim();
  if (!raw) return raw;

  let next = raw;

  // Ensure the greeting line isn't run-on with the first sentence.
  next = next.replace(/^(Hi[^\n]*?,)\s+(?=\S)/, "$1\n\n");

  // Ensure common sign-offs start on a new paragraph.
  next = next.replace(/([?.!])\s+(Best|Thanks|Regards|Sincerely|Cheers),\n/gi, "$1\n\n$2,\n");

  // Fix common run-on artifacts when bullet items accidentally include the next sentence.
  next = next.replace(/(high[- ]signal)\s+(Member mix\b)/i, "$1.\n\n$2");
  next = next.replace(/(throughout\s+the\s+year)\s+(If\s+(?:it['’]s\s+)?helpful\b)/i, "$1.\n\n$2");

  return next.replace(/\n{3,}/g, "\n\n").trim();
}

const MISSING_BOOKING_LINK_CALL_CUE_REGEX = /\b(15[- ]?minute|quick)\s+(call|chat)\b|\b(grab|book|schedule)\s+(?:a\s+)?(?:time|call|chat|meeting)\b/i;
const EMAIL_SIGNOFF_REGEX = /\n\n(?:best|thanks|regards|sincerely|cheers),\n/i;

export function applyMissingBookingLinkForCallCue(params: {
  draft: string;
  bookingLink: string | null;
  leadSchedulerLink: string | null;
  extraction?: MeetingOverseerExtractDecision | null;
}): { draft: string; changed: boolean } {
  const draft = (params.draft || "").trim();
  const bookingLink = (params.bookingLink || "").trim();
  if (!draft || !bookingLink) return { draft, changed: false };
  if ((params.leadSchedulerLink || "").trim()) return { draft, changed: false };

  const contract = params.extraction?.decision_contract_v1;
  if (params.extraction?.needs_clarification === true || contract?.responseMode === "clarify_only") {
    return { draft, changed: false };
  }
  if (contract?.shouldBookNow === "yes") return { draft, changed: false };

  // If there's already any URL present, don't add another.
  if (/https?:\/\//i.test(draft)) return { draft, changed: false };
  if (!MISSING_BOOKING_LINK_CALL_CUE_REGEX.test(draft)) return { draft, changed: false };

  const insertion = `You can grab a time here: ${bookingLink}`;
  const match = draft.match(EMAIL_SIGNOFF_REGEX);
  if (match && typeof match.index === "number") {
    const idx = match.index;
    const next = `${draft.slice(0, idx).trim()}\n\n${insertion}\n\n${draft.slice(idx + 2).trim()}`.trim();
    return next && next !== draft ? { draft: next, changed: true } : { draft, changed: false };
  }

  const next = `${draft}\n\n${insertion}`.trim();
  return next && next !== draft ? { draft: next, changed: true } : { draft, changed: false };
}

export function buildActionSignalsPromptAppendix(result: ActionSignalDetectionResult | null | undefined): string {
  if (!hasActionSignalOrRoute(result)) return "";

  const lines = ["ACTION SIGNAL CONTEXT:"];
  const route = result?.route ?? null;

  if (route) {
    lines.push(`- Booking process route: Process ${route.processId}${route.uncertain ? " (uncertain)" : ""}.`);
    lines.push(`- Route confidence: ${Math.round(route.confidence * 100)}%.`);
    lines.push(`- Route rationale: ${route.rationale}`);
  }

  if (route?.processId === 1) {
    lines.push("- Process 1 guidance: prioritize concise qualification/context clarification before hard booking nudges.");
  } else if (route?.processId === 2) {
    lines.push("- Process 2 guidance: focus on selecting/confirming offered time options without adding unrelated scheduling flows.");
  } else if (route?.processId === 3) {
    lines.push("- Process 3 guidance: acknowledge the lead-proposed time and confirm details (timezone/date precision) without extra detours.");
  }

  if (hasActionSignal(result, "call_requested")) {
    lines.push("- The lead has requested or implied they want a phone call.");
    lines.push("- Acknowledge this. Offer to set up a call or confirm someone will reach out by phone.");
    lines.push("- Do NOT suggest email-only scheduling when a call was explicitly requested.");
  } else if (route?.processId === 4) {
    lines.push("- Process 4 guidance: treat this as call-first intent and avoid email-only scheduling language.");
  }

  if (hasActionSignal(result, "book_on_external_calendar")) {
    lines.push("- The lead wants to book on someone else's calendar or provided their own scheduling link.");
    lines.push("- Do NOT offer the workspace's default availability/booking link.");
    lines.push("- Acknowledge their calendar/link and coordinate through it.");
  } else if (route?.processId === 5) {
    lines.push("- Process 5 guidance: acknowledge the lead-provided scheduler flow and avoid nudging the workspace default booking link.");
  }

  return lines.join("\n");
}

function buildCallPhoneContextAppendix(opts: {
  actionSignals: ActionSignalDetectionResult | null | undefined;
  leadPhoneOnFile: boolean;
}): string {
  const result = opts.actionSignals;
  if (!hasActionSignalOrRoute(result)) return "";

  const hasCallIntent = hasActionSignal(result, "call_requested") || result?.route?.processId === 4;
  if (!hasCallIntent) return "";

  const lines: string[] = ["PHONE CONTEXT:"];
  lines.push(`- Lead phone on file: ${opts.leadPhoneOnFile ? "yes" : "no"}.`);
  if (opts.leadPhoneOnFile) {
    lines.push("- Do NOT ask the lead for their phone number (do not ask \"which number should we call?\").");
    lines.push("- Confirm we will call them, and optionally ask what time works best to call.");
  } else {
    lines.push("- If a phone number is needed, ask: \"What's the best number to reach you?\" (one short question).");
    lines.push("- Do not ask \"which number should we call?\".");
  }
  lines.push("- Never include any phone number digits in the outbound draft.");

  return lines.join("\n");
}
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

// Hard safety: never allow phone numbers to leak into outbound drafts.
const PHONE_NUMBER_REGEX =
  /\b(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}(?:\s*(?:ext\.?|x)\s*\d{1,5})?\b/i;
const PHONE_NUMBER_GLOBAL_REGEX =
  /\b(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}(?:\s*(?:ext\.?|x)\s*\d{1,5})?\b/gi;
const PHONE_DIGITS_ONLY_REGEX = /\b\+?\d{10,15}\b/;
const PHONE_DIGITS_ONLY_GLOBAL_REGEX = /\b\+?\d{10,15}\b/g;

// Pricing placeholders like "${PRICE}" or "$X-$Y" (avoid matching real prices like "$5,000").
const PRICING_PLACEHOLDER_REGEX = /\$\{[A-Z_]+\}|\$[A-Z](?:\s*-\s*\$[A-Z])?(?![A-Za-z0-9])/;
const PRICING_PLACEHOLDER_GLOBAL_REGEX = /\$\{[A-Z_]+\}|\$[A-Z](?:\s*-\s*\$[A-Z])?(?![A-Za-z0-9])/g;
const DOLLAR_AMOUNT_REGEX = /\$\s*\d[\d,]*(?:\.\d{1,2})?/g;
const DOLLAR_AMOUNT_PRESENCE_REGEX = /\$\s*\d[\d,]*(?:\.\d{1,2})?/;
// For threshold contexts (ARR/revenue/etc), we only consider strong pricing nouns as evidence that
// a nearby dollar amount is actually a price. Cadence tokens like "per year" are ambiguous (ARR is annual),
// and "membership" alone is frequently used in qualification language.
const PRICING_STRONG_NEARBY_REGEX = /\b(price|pricing|fee|fees|cost|costs|investment|billing|billed|payment|pay)\b/i;
const MEMBERSHIP_PRICING_NEARBY_REGEX = /\bmembership\s+(?:fee|cost|price|is)\b/i;
const THRESHOLD_NEARBY_REGEX = /\b(revenue|arr|mrr|raised|raise|funding|valuation|gmv|run[\s-]?rate)\b/i;
const MONTHLY_CADENCE_REGEX = /\b(monthly|per\s+month|\/\s?(?:mo|month))\b/i;
const ANNUAL_CADENCE_REGEX = /\b(annual|annually|yearly|per\s+year|\/\s?(?:yr|year))\b/i;
const QUARTERLY_CADENCE_REGEX = /\b(quarterly|per\s+quarter|\/\s?(?:qtr|quarter))\b/i;
const NEGATED_MONTHLY_CADENCE_REGEX = /\b(no\s+monthly\s+(?:payment\s+)?plan|not\s+monthly|without\s+monthly)\b/i;
const MONTHLY_PLAN_REGEX = /\bmonthly\s+(?:payment\s+)?plan\b/i;
const MONTHLY_BILLING_STYLE_REGEX = /\b(monthly\s+(?:payment\s+)?plan|monthly\s+billing|month[-\s]?to[-\s]?month(?:\s+billing)?|billed\s+monthly)\b/i;
const MONTHLY_EQUIVALENT_PHRASE_REGEX =
  /\b(?:equates?\s+to|works?\s+out\s+to)\s+\$\s*\d[\d,]*(?:\.\d{1,2})?\s*(?:\/|per\s+)\s*month\b/i;
const WORKS_OUT_TO_MONTHLY_REGEX = /\bworks?\s+out\s+to\s+\$\s*(\d[\d,]*(?:\.\d{1,2})?)\s*(?:\/|per\s+)\s*month\b/gi;
const ORPHAN_PRICING_CADENCE_REGEX = /(?:\/\s?(?:mo|month|yr|year|qtr|quarter)|per\s+(?:month|year|quarter))\b/i;
// Note: "membership" alone appears frequently in non-pricing descriptions ("membership includes..."),
// so we only treat it as a pricing hint when paired with fee/price/cost wording.
const PRICING_LINE_HINT_REGEX =
  /\b(membership\s+(?:fee|price|cost)|fee|price|pricing|cost|billing|billed|payment|pay)\b/i;
const QUARTERLY_ONLY_BILLING_REGEX =
  /\b(no\s+monthly\s+(?:payment\s+)?plan|no\s+monthly\s+option|quarterly\s+only|billed\s+quarterly(?:\s+only)?)\b/i;
const PRICING_CONTEXT_LINE_REGEX =
  /\$\s*\d|\b(price|pricing|cost|fee|investment|monthly|annual|quarterly|billing|billed|per\s+month|per\s+year|per\s+quarter)\b/i;

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
    hasPlaceholders: BOOKING_LINK_PLACEHOLDER_REGEX.test(content) || PRICING_PLACEHOLDER_REGEX.test(content),
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

  const hadPricingPlaceholders = PRICING_PLACEHOLDER_REGEX.test(result);
  if (hadPricingPlaceholders) {
    result = result.replace(PRICING_PLACEHOLDER_GLOBAL_REGEX, "");
  }

  const hadTruncatedUrl = TRUNCATED_URL_REGEX.test(result);
  if (hadTruncatedUrl) {
    result = result.replace(TRUNCATED_URL_GLOBAL_REGEX, "");
  }

  const hadPhone = PHONE_NUMBER_REGEX.test(result) || PHONE_DIGITS_ONLY_REGEX.test(result);
  if (hadPhone) {
    result = result.replace(PHONE_NUMBER_GLOBAL_REGEX, "[phone redacted]");
    result = result.replace(PHONE_DIGITS_ONLY_GLOBAL_REGEX, "[phone redacted]");
  }

  // Avoid mutating formatting too aggressively (newlines matter for email).
  result = result.replace(/[ \t]{2,}/g, " ").trim();

  if (hadPlaceholders || hadPricingPlaceholders || hadTruncatedUrl || hadPhone) {
    console.warn(`[AI Drafts] Sanitized draft for lead ${leadId} (${channel})`, {
      hadPlaceholders,
      hadPricingPlaceholders,
      hadTruncatedUrl,
      hadPhone,
      changed: result !== before,
    });
  }

  return result;
}

function parseDollarAmountToNumber(token: string): number | null {
  const normalized = token.replace(/^\$/, "").replace(/[,\s]/g, "");
  const parsed = Number.parseFloat(normalized);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

type PricingCadence = "monthly" | "annual" | "quarterly" | "unknown";
type PricingClaim = {
  amount: number;
  cadences: Set<PricingCadence>;
  index: number;
  token: string;
};

function isLikelyNonPricingDollarAmount(text: string, index: number, rawToken: string): boolean {
  const suffix = text.slice(index + rawToken.length, index + rawToken.length + 4);
  if (/^\s*[kKmMbB]/.test(suffix)) return true;

  const windowStart = Math.max(0, index - 40);
  const windowEnd = Math.min(text.length, index + rawToken.length + 40);
  const nearby = text.slice(windowStart, windowEnd);
  if (THRESHOLD_NEARBY_REGEX.test(nearby)) {
    // Avoid treating qualification thresholds like "$1M ARR" as pricing, even when "membership"
    // appears nearby ("membership requirement"). Only treat as pricing when there's a strong
    // pricing signal ("fee", "cost", "pricing", etc.) or an explicit "membership is $X" pattern.
    if (!PRICING_STRONG_NEARBY_REGEX.test(nearby) && !MEMBERSHIP_PRICING_NEARBY_REGEX.test(nearby)) {
      return true;
    }
  }

  return false;
}

function extractCadencesFromNearby(text: string): Set<PricingCadence> {
  const cadences = new Set<PricingCadence>();
  const hasNegatedMonthly = NEGATED_MONTHLY_CADENCE_REGEX.test(text);
  if (MONTHLY_CADENCE_REGEX.test(text) && !hasNegatedMonthly) cadences.add("monthly");
  if (ANNUAL_CADENCE_REGEX.test(text)) cadences.add("annual");
  if (QUARTERLY_CADENCE_REGEX.test(text)) cadences.add("quarterly");
  if (cadences.size === 0) cadences.add("unknown");
  return cadences;
}

function findLastIndexOfAny(text: string, chars: string[], beforeIndex: number): number {
  let best = -1;
  for (const char of chars) {
    const idx = text.lastIndexOf(char, beforeIndex);
    if (idx > best) best = idx;
  }
  return best;
}

function findNextIndexOfAny(text: string, chars: string[], fromIndex: number): number {
  let best = -1;
  for (const char of chars) {
    const idx = text.indexOf(char, fromIndex);
    if (idx !== -1 && (best === -1 || idx < best)) best = idx;
  }
  return best;
}

function extractCadencesNearToken(text: string, index: number, rawToken: string): Set<PricingCadence> {
  const tokenEnd = index + rawToken.length;
  const clauseBreaks = ["\n", ".", "!", "?", ";", ":"];
  const localLeftBoundary = findLastIndexOfAny(text, clauseBreaks, index - 1);
  const localRightBoundary = findNextIndexOfAny(text, clauseBreaks, tokenEnd);
  const localStart = Math.max(localLeftBoundary === -1 ? 0 : localLeftBoundary + 1, index - 40);
  const localEnd = Math.min(localRightBoundary === -1 ? text.length : localRightBoundary, tokenEnd + 50);
  const before = text.slice(localStart, index);
  const after = text.slice(tokenEnd, localEnd);
  const local = `${before}${rawToken}${after}`;

  const cadences = new Set<PricingCadence>();
  const hasNegatedMonthly = NEGATED_MONTHLY_CADENCE_REGEX.test(local);
  if (MONTHLY_CADENCE_REGEX.test(local) && !hasNegatedMonthly) cadences.add("monthly");
  if (ANNUAL_CADENCE_REGEX.test(local)) cadences.add("annual");
  if (QUARTERLY_CADENCE_REGEX.test(local)) cadences.add("quarterly");
  if (cadences.size > 0) return cadences;

  const clauseStart = findLastIndexOfAny(text, clauseBreaks, index - 1);
  const clauseEnd = findNextIndexOfAny(text, clauseBreaks, tokenEnd);
  const start = clauseStart === -1 ? 0 : clauseStart + 1;
  const end = clauseEnd === -1 ? text.length : clauseEnd;
  const clause = text.slice(start, end);
  const amountMatches = clause.match(DOLLAR_AMOUNT_REGEX) || [];
  if (amountMatches.length > 1) {
    return new Set(["unknown"]);
  }

  return extractCadencesFromNearby(clause);
}

function extractPricingClaims(text: string): PricingClaim[] {
  if (!text || !text.trim()) return [];
  const claims: PricingClaim[] = [];
  for (const match of text.matchAll(DOLLAR_AMOUNT_REGEX)) {
    const raw = match[0];
    const index = match.index ?? -1;
    if (index < 0) continue;
    if (isLikelyNonPricingDollarAmount(text, index, raw)) continue;

    const amount = parseDollarAmountToNumber(raw);
    if (amount === null) continue;

    const cadences = extractCadencesNearToken(text, index, raw);
    claims.push({
      amount,
      cadences,
      index,
      token: raw,
    });
  }
  return claims;
}

function collectPricingSnippetsFromText(text: string, maxSnippets: number): string[] {
  if (!text || !text.trim()) return [];
  const snippets: string[] = [];
  const pushSnippet = (value: string) => {
    const normalized = value.trim().replace(/\s+/g, " ");
    if (!normalized || normalized.length < 8) return;
    if (!PRICING_CONTEXT_LINE_REGEX.test(normalized)) return;
    if (snippets.some((existing) => existing.toLowerCase() === normalized.toLowerCase())) return;
    snippets.push(normalized.length > 220 ? `${normalized.slice(0, 220)}...` : normalized);
  };

  for (const line of text.split(/\n+/)) {
    if (snippets.length >= maxSnippets) break;
    pushSnippet(line);
  }

  if (snippets.length < maxSnippets) {
    for (const sentence of text.split(/(?<=[.!?])\s+/)) {
      if (snippets.length >= maxSnippets) break;
      pushSnippet(sentence);
    }
  }

  return snippets.slice(0, maxSnippets);
}

function buildVerifiedPricingContext(opts: {
  serviceDescription: string | null;
  knowledgeAssets: KnowledgeAssetForContext[];
}): string | null {
  const lines: string[] = [];
  const appendLines = (prefix: string, text: string, maxSnippets: number) => {
    const snippets = collectPricingSnippetsFromText(text, maxSnippets);
    for (const snippet of snippets) {
      lines.push(`${prefix}${snippet}`);
    }
  };

  if (opts.serviceDescription) {
    appendLines("SERVICE: ", opts.serviceDescription, 4);
  }

  for (const asset of opts.knowledgeAssets.slice(0, 8)) {
    const source = resolveKnowledgeAssetContextSource(asset).content;
    if (!source || !source.trim()) continue;
    const prefix = asset.name ? `${asset.name}: ` : "ASSET: ";
    appendLines(prefix, source, 2);
    if (lines.length >= 10) break;
  }

  if (lines.length === 0) return null;
  return `VERIFIED PRICING CONTEXT:\n${lines.slice(0, 10).map((line) => `- ${line}`).join("\n")}`;
}

function buildPricingCadenceMap(text: string): Map<number, Set<PricingCadence>> {
  const map = new Map<number, Set<PricingCadence>>();
  for (const claim of extractPricingClaims(text)) {
    const existing = map.get(claim.amount) ?? new Set<PricingCadence>();
    for (const cadence of claim.cadences) existing.add(cadence);
    map.set(claim.amount, existing);
  }
  return map;
}

function getKnownCadences(cadences: Set<PricingCadence>): Set<PricingCadence> {
  const known = new Set<PricingCadence>();
  for (const cadence of cadences) {
    if (cadence !== "unknown") known.add(cadence);
  }
  return known;
}

function cadenceMatchesDraftClaim(
  draftCadences: Set<PricingCadence>,
  supportedCadences: Set<PricingCadence>
): boolean {
  const draftKnown = getKnownCadences(draftCadences);
  if (draftKnown.size === 0) return true;

  const supportedKnown = getKnownCadences(supportedCadences);
  if (supportedKnown.size === 0) return false;

  for (const cadence of draftKnown) {
    if (supportedKnown.has(cadence)) return true;
  }
  return false;
}

function resolvePricingClaimSupport(
  claim: PricingClaim,
  serviceDescriptionMap: Map<number, Set<PricingCadence>>,
  knowledgeContextMap: Map<number, Set<PricingCadence>>
): { supported: boolean; cadenceMismatch: boolean } {
  const serviceCadences = serviceDescriptionMap.get(claim.amount);
  if (serviceCadences) {
    const supported = cadenceMatchesDraftClaim(claim.cadences, serviceCadences);
    return { supported, cadenceMismatch: !supported };
  }

  const knowledgeCadences = knowledgeContextMap.get(claim.amount);
  if (!knowledgeCadences) {
    return { supported: false, cadenceMismatch: false };
  }

  const supported = cadenceMatchesDraftClaim(claim.cadences, knowledgeCadences);
  return { supported, cadenceMismatch: !supported };
}

function formatUsdAmount(amount: number): string {
  return `$${new Intl.NumberFormat("en-US").format(amount)}`;
}

function buildMonthlyEquivalentSentence(amount: number): string {
  return `It works out to ${formatUsdAmount(amount)} per month for founders who want to explore before committing annually.`;
}

type SupportedPricingOption = {
  amount: number;
  cadence: PricingCadence;
};

function preferredCadenceOrder(opts: { preferQuarterlyCadence: boolean }): PricingCadence[] {
  return opts.preferQuarterlyCadence
    ? ["quarterly", "annual", "unknown", "monthly"]
    : ["annual", "quarterly", "monthly", "unknown"];
}

function collectSupportedPricingOptions(params: {
  serviceDescriptionMap: Map<number, Set<PricingCadence>>;
  knowledgeContextMap: Map<number, Set<PricingCadence>>;
  preferQuarterlyCadence: boolean;
}): SupportedPricingOption[] {
  const sourceMap = params.serviceDescriptionMap.size > 0 ? params.serviceDescriptionMap : params.knowledgeContextMap;
  if (sourceMap.size === 0) return [];

  const cadenceOrder = preferredCadenceOrder({ preferQuarterlyCadence: params.preferQuarterlyCadence });
  const options: SupportedPricingOption[] = [];
  for (const [amount, cadences] of sourceMap.entries()) {
    const knownCadences = getKnownCadences(cadences);
    if (knownCadences.size === 0) {
      options.push({ amount, cadence: "unknown" });
      continue;
    }
    for (const cadence of knownCadences) {
      options.push({ amount, cadence });
    }
  }

  return options.sort((a, b) => {
    const cadenceDelta = cadenceOrder.indexOf(a.cadence) - cadenceOrder.indexOf(b.cadence);
    if (cadenceDelta !== 0) return cadenceDelta;
    return a.amount - b.amount;
  });
}

function selectPreferredMonthlyEquivalentAmount(options: SupportedPricingOption[]): number | null {
  const monthly = options.find((option) => option.cadence === "monthly");
  return monthly?.amount ?? null;
}

function normalizeMonthlyEquivalentPhrasing(
  draft: string,
  monthlyAmount: number | null
): { draft: string; normalized: boolean } {
  if (!draft.trim() || monthlyAmount === null) return { draft, normalized: false };

  let normalized = false;
  let next = draft;

  const lines = next.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] || "";
    if (!MONTHLY_BILLING_STYLE_REGEX.test(line)) continue;
    lines[i] = buildMonthlyEquivalentSentence(monthlyAmount);
    normalized = true;
  }

  if (!normalized) return { draft, normalized: false };

  next = lines
    .join("\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  next = next
    .replace(
      /((?:equates?\s+to|works?\s+out\s+to)\s+\$\s*\d[\d,]*(?:\.\d{1,2})?\s*(?:\/|per\s+)\s*month)\s+equivalent\b/gi,
      "$1"
    )
    .replace(/(\$\s*\d[\d,]*(?:\.\d{1,2})?\s*\/?\s*month)\s+equivalent\b/gi, "$1");

  if (!MONTHLY_EQUIVALENT_PHRASE_REGEX.test(next)) {
    next = `${buildMonthlyEquivalentSentence(monthlyAmount)}\n\n${next}`.trim();
  }

  return { draft: next, normalized: true };
}

function normalizeMonthlyEquivalentClauseGrammar(draft: string): { draft: string; normalized: boolean } {
  const text = (draft || "").trim();
  if (!text) return { draft: text, normalized: false };

  let normalized = false;
  let next = text
    .replace(/\boptions\s+that\s+equates\s+to\b/gi, () => {
      normalized = true;
      return "options that work out to";
    })
    .replace(/\boptions\s+that\s+equate\s+to\b/gi, () => {
      normalized = true;
      return "options that work out to";
    })
    .replace(/\boption\s+that\s+equates\s+to\b/gi, () => {
      normalized = true;
      return "option that works out to";
    })
    .replace(/\boption\s+that\s+equate\s+to\b/gi, () => {
      normalized = true;
      return "option that works out to";
    });

  // Prefer "per month" over "/month" when the clause is embedded in a sentence.
  next = next.replace(/(\$\s*\d[\d,]*(?:\.\d{1,2})?)\s*\/\s*month\b/gi, (_match, amount: string) => {
    normalized = true;
    return `${amount} per month`;
  });

  if (!normalized) return { draft: text, normalized: false };

  next = next
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { draft: next, normalized: true };
}
function enforceAnnualThenMonthlyEquivalentOrdering(params: {
  draft: string;
  annualAmount: number;
  monthlyAmount: number;
}): { draft: string; normalized: boolean } {
  const draft = (params.draft || "").trim();
  if (!draft) return { draft, normalized: false };

  const paragraphs = draft.split(/\n{2,}/);
  const annualLabel = formatUsdAmount(params.annualAmount);
  const monthlyEqRegex =
    /\b(equates?|works?\s+out)\s+to\s+\$\s*\d[\d,]*(?:\.\d{1,2})?\s*(?:\/|per\s+)month\b/i;

  let normalized = false;
  const nextParagraphs = paragraphs.map((rawParagraph) => {
    const paragraph = (rawParagraph || "").trim();
    if (!paragraph) return rawParagraph;
    if (!monthlyEqRegex.test(paragraph)) return rawParagraph;

    const annualIndex = paragraph.indexOf(annualLabel);
    const monthlyIndex = paragraph.search(monthlyEqRegex);
    const hasAnnualReference = annualIndex >= 0 || /\b(annual|annually|per\s+year|yearly)\b/i.test(paragraph);

    if (hasAnnualReference && (annualIndex < 0 || annualIndex <= monthlyIndex)) {
      return rawParagraph;
    }

    normalized = true;
    return `The membership fee is ${annualLabel} per year. ${buildMonthlyEquivalentSentence(params.monthlyAmount)}`;
  });

  if (!normalized) return { draft, normalized: false };

  return {
    draft: nextParagraphs
      .join("\n\n")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
    normalized: true,
  };
}

function formatPricingOption(option: SupportedPricingOption, opts: { preferQuarterlyCadence: boolean }): string {
  const amount = formatUsdAmount(option.amount);

  if (option.cadence === "annual") {
    if (opts.preferQuarterlyCadence) {
      return `${amount} per year (billed quarterly)`;
    }
    return `${amount} per year`;
  }
  if (option.cadence === "quarterly") {
    return `${amount} per quarter`;
  }
  if (option.cadence === "monthly") {
    return opts.preferQuarterlyCadence
      ? `${amount} monthly equivalent (billed quarterly)`
      : `${amount}/month`;
  }
  return amount;
}

function replaceBrokenPricingSentence(draft: string, sentence: string): string {
  const collapsedSentence = sentence.trim().replace(/\s+/g, " ");
  if (!collapsedSentence) return draft;

  const lines = draft.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]?.trim() || "";
    if (!line) continue;
    if (/confirm\s+which\s+pricing\s+option/i.test(line)) continue;
    if (DOLLAR_AMOUNT_PRESENCE_REGEX.test(line)) continue;

    const looksPricingRelated =
      /\b(the\s+)?membership\s+(fee|price|cost)\s+is\b/i.test(line) ||
      /\b(the\s+)?(fee|price|cost)\s+is\b/i.test(line) ||
      /\b(happy\s+to\s+share\s+pricing)\b/i.test(line) ||
      /\b(monthly\s+(?:payment\s+)?plan|quarterly\s+billing)\b/i.test(line);

    if (!looksPricingRelated) continue;

    lines[i] = collapsedSentence;
    return lines
      .join("\n")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  return `${collapsedSentence}\n\n${draft}`.trim();
}

function stripOrphanPricingCadenceLines(draft: string): { draft: string; removedLines: number } {
  const lines = draft.split("\n");
  let removedLines = 0;
  const slashCadenceRegex = /\/\s?(?:mo|month|yr|year|qtr|quarter)\b/i;
  const nonPricingFrequencyContextRegex = /\b(events?|meetups?|sessions?|talks?|retreats?|masterminds?)\b/i;
  const kept = lines.filter((line) => {
    const trimmed = (line || "").trim();
    if (!trimmed) return true;
    if (DOLLAR_AMOUNT_PRESENCE_REGEX.test(trimmed)) return true;
    const hasSlashCadence = slashCadenceRegex.test(trimmed);
    const looksPricingHint = PRICING_LINE_HINT_REGEX.test(trimmed) || hasSlashCadence;
    if (!looksPricingHint) return true;
    if (!ORPHAN_PRICING_CADENCE_REGEX.test(trimmed)) return true;
    // Avoid stripping legitimate frequency lines like "150+ events per year".
    if (nonPricingFrequencyContextRegex.test(trimmed)) return true;
    removedLines += 1;
    return false;
  });

  const normalized = kept
    .join("\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { draft: normalized, removedLines };
}

export function extractPricingAmounts(text: string): number[] {
  if (!text || !text.trim()) return [];

  const seen = new Set<number>();
  for (const claim of extractPricingClaims(text)) {
    seen.add(claim.amount);
  }

  return Array.from(seen.values());
}

export function detectPricingHallucinations(
  draft: string,
  serviceDescription: string | null,
  knowledgeContext: string | null
): { hallucinated: number[]; valid: number[]; allDraft: number[]; cadenceMismatched: number[] } {
  const draftClaims = extractPricingClaims(draft);
  const serviceDescriptionMap = buildPricingCadenceMap(serviceDescription ?? "");
  const knowledgeContextMap = buildPricingCadenceMap(knowledgeContext ?? "");

  const hallucinated = new Set<number>();
  const valid = new Set<number>();
  const cadenceMismatched = new Set<number>();

  for (const claim of draftClaims) {
    const support = resolvePricingClaimSupport(claim, serviceDescriptionMap, knowledgeContextMap);
    if (support.supported) {
      valid.add(claim.amount);
      continue;
    }

    if (support.cadenceMismatch) {
      cadenceMismatched.add(claim.amount);
      continue;
    }

    hallucinated.add(claim.amount);
  }

  return {
    hallucinated: Array.from(hallucinated.values()),
    valid: Array.from(valid.values()),
    allDraft: Array.from(new Set(draftClaims.map((claim) => claim.amount)).values()),
    cadenceMismatched: Array.from(cadenceMismatched.values()),
  };
}

export function enforcePricingAmountSafety(
  draft: string,
  serviceDescription: string | null,
  knowledgeContext?: string | null,
  opts?: {
    requirePricingAnswer?: boolean;
  }
): {
  draft: string;
  removedAmounts: number[];
  removedCadenceAmounts: number[];
  normalizedCadencePhrase: boolean;
  addedClarifier: boolean;
} {
  const requirePricingAnswer = opts?.requirePricingAnswer === true;
  const serviceDescriptionMap = buildPricingCadenceMap(serviceDescription ?? "");
  const knowledgeContextMap = buildPricingCadenceMap(knowledgeContext ?? "");
  const sourceHasPricing = serviceDescriptionMap.size > 0 || knowledgeContextMap.size > 0;
  const preferQuarterlyCadence = QUARTERLY_ONLY_BILLING_REGEX.test(`${serviceDescription || ""}\n${knowledgeContext || ""}`);
  const removedAmounts: number[] = [];
  const removedCadenceAmounts: number[] = [];

  let next = draft.replace(DOLLAR_AMOUNT_REGEX, (token, offset, fullText) => {
    if (typeof offset === "number" && isLikelyNonPricingDollarAmount(fullText, offset, token)) {
      return token;
    }

    const amount = parseDollarAmountToNumber(token);
    if (amount === null) return token;

    const cadences = typeof offset === "number" ? extractCadencesNearToken(fullText, offset, token) : extractCadencesFromNearby(token);
    const claim: PricingClaim = {
      amount,
      cadences,
      index: typeof offset === "number" ? offset : -1,
      token,
    };
    const support = resolvePricingClaimSupport(claim, serviceDescriptionMap, knowledgeContextMap);
    if (support.supported) return token;

    if (support.cadenceMismatch) {
      removedCadenceAmounts.push(amount);
    } else {
      removedAmounts.push(amount);
    }
    return "";
  });

  next = next
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([.,;:!?])/g, "$1")
    .replace(/\(\s*\)/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .trim();

  let normalizedCadencePhrase = false;
  if (preferQuarterlyCadence && MONTHLY_PLAN_REGEX.test(next)) {
    next = next.replace(MONTHLY_PLAN_REGEX, "quarterly billing");
    normalizedCadencePhrase = true;
  }

  const strippedOrphanCadence = stripOrphanPricingCadenceLines(next);
  if (strippedOrphanCadence.removedLines > 0) {
    next = strippedOrphanCadence.draft;
  }

  let addedClarifier = false;
  const removedAny = removedAmounts.length > 0 || removedCadenceAmounts.length > 0;
  const hasAnyDollarAmount = DOLLAR_AMOUNT_PRESENCE_REGEX.test(next);
  const supportedOptions = collectSupportedPricingOptions({
    serviceDescriptionMap,
    knowledgeContextMap,
    preferQuarterlyCadence,
  });
  const buildSupportedPricingSentence = (): string | null => {
    if (supportedOptions.length === 0) return null;
    const [primary, secondary] = supportedOptions;
    if (primary && secondary && primary.cadence === "annual" && secondary.cadence === "monthly") {
      return `The membership fee is ${formatUsdAmount(primary.amount)} per year. ${buildMonthlyEquivalentSentence(secondary.amount)}`;
    }
    if (primary && primary.cadence === "monthly") {
      return buildMonthlyEquivalentSentence(primary.amount);
    }
    const primaryText = formatPricingOption(primary, { preferQuarterlyCadence });
    const secondaryText = secondary ? formatPricingOption(secondary, { preferQuarterlyCadence }) : null;
    return secondaryText
      ? `The membership fee is ${primaryText}. We also offer ${secondaryText}.`
      : `The membership fee is ${primaryText}.`;
  };

  if (removedAny && !hasAnyDollarAmount) {
    const replacementSentence = buildSupportedPricingSentence();
    if (replacementSentence) {
      next = replaceBrokenPricingSentence(next, replacementSentence);
    }
  }

  if (requirePricingAnswer && !DOLLAR_AMOUNT_PRESENCE_REGEX.test(next)) {
    const replacementSentence = buildSupportedPricingSentence();
    if (replacementSentence) {
      next = replaceBrokenPricingSentence(next, replacementSentence);
    }
  }

  const monthlyEquivalentAmount = selectPreferredMonthlyEquivalentAmount(supportedOptions);
  const monthlyNormalization = normalizeMonthlyEquivalentPhrasing(next, monthlyEquivalentAmount);
  if (monthlyNormalization.normalized) {
    next = monthlyNormalization.draft;
    normalizedCadencePhrase = true;
  }

  const monthlyGrammarFix = normalizeMonthlyEquivalentClauseGrammar(next);
  if (monthlyGrammarFix.normalized) {
    next = monthlyGrammarFix.draft;
    normalizedCadencePhrase = true;
  }

  const annualOption = supportedOptions.find((option) => option.cadence === "annual") || null;
  if (annualOption && monthlyEquivalentAmount !== null) {
    const annualMonthlyOrdering = enforceAnnualThenMonthlyEquivalentOrdering({
      draft: next,
      annualAmount: annualOption.amount,
      monthlyAmount: monthlyEquivalentAmount,
    });
    if (annualMonthlyOrdering.normalized) {
      next = annualMonthlyOrdering.draft;
      normalizedCadencePhrase = true;
    }
  }
  if (
    (removedAny || (requirePricingAnswer && supportedOptions.length === 0)) &&
    !DOLLAR_AMOUNT_PRESENCE_REGEX.test(next) &&
    !/confirm\s+which\s+pricing\s+option/i.test(next)
  ) {
    const clarifier = sourceHasPricing
      ? "To share exact pricing accurately, can you confirm which pricing option you want details on?"
      : "To share exact pricing accurately, can you confirm which pricing details you want?";
    next = next ? `${next}\n\n${clarifier}` : clarifier;
    addedClarifier = true;
  }

  return { draft: next, removedAmounts, removedCadenceAmounts, normalizedCadencePhrase, addedClarifier };
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

function formatGuardrailStatsForLog(stats: {
  beforeLen: number;
  afterLen: number;
  delta: number;
  ratio: number;
  beforeLines: number;
  afterLines: number;
  lineDelta: number;
  lineRatio: number;
}): string {
  return [
    `beforeLen=${stats.beforeLen}`,
    `afterLen=${stats.afterLen}`,
    `delta=${stats.delta}`,
    `ratio=${stats.ratio.toFixed(2)}`,
    `beforeLines=${stats.beforeLines}`,
    `afterLines=${stats.afterLines}`,
    `lineDelta=${stats.lineDelta}`,
    `lineRatio=${stats.lineRatio.toFixed(2)}`,
  ].join(" ");
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
  metadata?: unknown;
}): Promise<{
  finalDraft: string;
  interactionId: string | null;
  model: string;
  promptKey: string;
  promptKeyForTelemetry: string;
  changed: boolean;
  violationsDetected: string[];
  changes: string[];
} | null> {
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
      metadata: opts.metadata,
      model: verifierModel,
      reasoningEffort: verifierReasoningEffort,
      temperature: 0,
      failureSeverity: "warning",
      systemFallback: instructions,
      input: inputMessages,
      schemaName: "email_draft_verification_step3",
      strict: true,
      schema: EMAIL_DRAFT_VERIFY_STEP3_JSON_SCHEMA,
      attempts: [1600],
      budget: { min: 1600, max: 2000 },
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
        await markAiInteractionError(interactionId, `${kind}: ${result.error.message.slice(0, 500)}`, { severity: "warning" });
      }

      return null;
    }

    const parsed = result.data;

    const finalDraft = parsed.finalDraft.trim();
    if (!finalDraft) return null;

    const normalizedFinal = normalizeDraftForCompare(finalDraft);
    const normalizedBefore = normalizeDraftForCompare(opts.draft);
    if (!parsed.changed && normalizedFinal !== normalizedBefore) {
      if (shouldLogVerifierDetails) {
        console.warn(`[AI Drafts] Step 3 verifier returned changed=false but output differs; discarding`, {
          leadId: opts.leadId,
          beforeLen: normalizedBefore.length,
          afterLen: normalizedFinal.length,
        });
      }
      if (interactionId) {
        await markAiInteractionError(interactionId, "email_step3_changed_flag_mismatch", { severity: "warning" });
      }
      return null;
    }

    const guardrail = evaluateStep3RewriteGuardrail(opts.draft, finalDraft);
    if (guardrail.isRewrite) {
      const statsLine = formatGuardrailStatsForLog(guardrail.stats);
      if (shouldLogVerifierDetails) {
        console.warn(`[AI Drafts] Step 3 verifier produced a likely rewrite; discarding output`, {
          leadId: opts.leadId,
          stats: guardrail.stats,
          config: guardrail.config,
        });
      }
      if (interactionId) {
        await markAiInteractionError(interactionId, `email_step3_rewrite_guardrail: ${statsLine}`, { severity: "warning" });
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

    return {
      finalDraft,
      interactionId,
      model: verifierModel,
      promptKey,
      promptKeyForTelemetry,
      changed: parsed.changed,
      violationsDetected: parsed.violationsDetected,
      changes: parsed.changes,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (shouldLogVerifierDetails) {
      console.warn("[AI Drafts] Step 3 verifier failed:", message);
    }
    if (interactionId) {
      await markAiInteractionError(interactionId, `email_step3_error: ${message.slice(0, 200)}`, { severity: "warning" });
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

export function mergeServiceDescriptions(
  primary: string | null | undefined,
  secondary: string | null | undefined
): string | null {
  const a = (primary || "").trim();
  const b = (secondary || "").trim();

  if (!a && !b) return null;
  if (!a) return b;
  if (!b) return a;

  const normalize = (value: string): string => value.toLowerCase().replace(/\s+/g, " ").trim();
  const aNorm = normalize(a);
  const bNorm = normalize(b);

  if (aNorm.includes(bNorm)) {
    return a.length >= b.length ? a : b;
  }

  if (bNorm.includes(aNorm)) {
    return b.length >= a.length ? b : a;
  }

  return `${a}\n\n${b}`;
}

function buildDateContext(timeZone: string, nowOverride?: Date | null): string {
  const now = nowOverride ? new Date(nowOverride) : new Date();
  const dayFormat = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const tzParts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "short",
  }).formatToParts(now);
  const shortTz = tzParts.find((part) => part.type === "timeZoneName")?.value || timeZone;
  return `Today is ${dayFormat.format(now)} (${shortTz}).`;
}

const WEEKDAY_REGEX = /\b(mon(day)?|tue(s(day)?)?|wed(nesday)?|thu(r(s(day)?)?)?|fri(day)?|sat(urday)?|sun(day)?)\b/gi;

function normalizeWeekdayToken(raw: string): string | null {
  const token = raw.trim().toLowerCase();
  if (token.startsWith("mon")) return "mon";
  if (token.startsWith("tue")) return "tue";
  if (token.startsWith("wed")) return "wed";
  if (token.startsWith("thu")) return "thu";
  if (token.startsWith("fri")) return "fri";
  if (token.startsWith("sat")) return "sat";
  if (token.startsWith("sun")) return "sun";
  return null;
}

function getLocalDateParts(date: Date, timeZone: string): { year: number; month: number; day: number } | null {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);
    const year = Number.parseInt(parts.find((part) => part.type === "year")?.value || "", 10);
    const month = Number.parseInt(parts.find((part) => part.type === "month")?.value || "", 10);
    const day = Number.parseInt(parts.find((part) => part.type === "day")?.value || "", 10);
    if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
    return { year, month, day };
  } catch {
    return null;
  }
}

function getDayDiffInTimeZone(targetIso: string, now: Date, timeZone: string): number | null {
  const targetDate = new Date(targetIso);
  if (Number.isNaN(targetDate.getTime())) return null;

  const nowParts = getLocalDateParts(now, timeZone);
  const targetParts = getLocalDateParts(targetDate, timeZone);
  if (!nowParts || !targetParts) return null;

  const nowUtcMidnight = Date.UTC(nowParts.year, nowParts.month - 1, nowParts.day);
  const targetUtcMidnight = Date.UTC(targetParts.year, targetParts.month - 1, targetParts.day);
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.floor((targetUtcMidnight - nowUtcMidnight) / msPerDay);
}

function parseClockToken(
  raw: string,
  fallbackMeridiem?: "am" | "pm"
): { minutes: number; meridiem: "am" | "pm" } | null {
  const normalized = (raw || "").trim().toLowerCase().replace(/\./g, "");
  if (!normalized) return null;

  const match = normalized.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (!match) return null;

  const hours = Number.parseInt(match[1] || "", 10);
  const minutes = match[2] ? Number.parseInt(match[2], 10) : 0;
  const meridiem = (match[3] as "am" | "pm" | undefined) || fallbackMeridiem || null;

  if (!Number.isFinite(hours) || hours < 1 || hours > 12) return null;
  if (!Number.isFinite(minutes) || minutes < 0 || minutes > 59) return null;
  if (!meridiem) return null;

  const normalizedHours = hours % 12;
  const totalMinutes = normalizedHours * 60 + minutes + (meridiem === "pm" ? 12 * 60 : 0);

  return { minutes: totalMinutes, meridiem };
}

function parseExplicitTimeWindow(
  message: string
): { startMinutes: number; endMinutes: number } | null {
  const patterns = [
    /\bbetween\s+(\d{1,2}(?::\d{2})?\s*(?:a\.?m?\.?|p\.?m?\.?)?)\s*(?:and|to|-)\s*(\d{1,2}(?::\d{2})?\s*(?:a\.?m?\.?|p\.?m?\.?)?)/i,
    /\bfrom\s+(\d{1,2}(?::\d{2})?\s*(?:a\.?m?\.?|p\.?m?\.?)?)\s*(?:to|-)\s*(\d{1,2}(?::\d{2})?\s*(?:a\.?m?\.?|p\.?m?\.?)?)/i,
    /\b(\d{1,2}(?::\d{2})?)\s*-\s*(\d{1,2}(?::\d{2})?)\s*(am|pm)\b/i,
  ];

  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (!match) continue;

    const startRaw = (match[1] || "").trim();
    const endRaw = (match[2] || "").trim();
    const sharedMeridiem = (match[3] || "").trim().toLowerCase() as "am" | "pm" | "";

    const endToken = parseClockToken(endRaw, sharedMeridiem || undefined);
    const startToken = parseClockToken(startRaw, (sharedMeridiem || endToken?.meridiem || undefined) as
      | "am"
      | "pm"
      | undefined);

    if (!startToken || !endToken) continue;

    return {
      startMinutes: startToken.minutes,
      endMinutes: endToken.minutes,
    };
  }

  return null;
}

function getMinutesOfDayInTimeZone(targetIso: string, timeZone: string): number | null {
  const targetDate = new Date(targetIso);
  if (Number.isNaN(targetDate.getTime())) return null;
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(targetDate);
    const hour = Number.parseInt(parts.find((part) => part.type === "hour")?.value || "", 10);
    const minute = Number.parseInt(parts.find((part) => part.type === "minute")?.value || "", 10);
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
    return hour * 60 + minute;
  } catch {
    return null;
  }
}

function isMinuteWithinWindow(value: number, startMinutes: number, endMinutes: number): boolean {
  if (startMinutes <= endMinutes) {
    return value >= startMinutes && value <= endMinutes;
  }
  // Handles overnight windows like 10pm-1am.
  return value >= startMinutes || value <= endMinutes;
}

export function extractTimingPreferencesFromText(
  text: string,
  timeZone: string
): {
  weekdayTokens?: string[];
  relativeWeek?: "this_week" | "next_week";
  timeWindow?: { startMinutes: number; endMinutes: number };
} | null {
  const message = (text || "").trim();
  if (!message) return null;

  const lower = message.toLowerCase();
  const weekdayTokens = new Set<string>();
  const weekdayMatches = message.matchAll(WEEKDAY_REGEX);
  for (const match of weekdayMatches) {
    const normalized = normalizeWeekdayToken(match[1] || "");
    if (normalized) weekdayTokens.add(normalized);
  }

  let relativeWeek: "this_week" | "next_week" | undefined;
  if (/\bnext\s+week\b/i.test(lower) || /\bnext\s+(mon(day)?|tue(s(day)?)?|wed(nesday)?|thu(r(s(day)?)?)?|fri(day)?|sat(urday)?|sun(day)?)\b/i.test(lower)) {
    relativeWeek = "next_week";
  } else if (/\b(this|later\s+this)\s+week\b/i.test(lower) || /\bthis\s+(mon(day)?|tue(s(day)?)?|wed(nesday)?|thu(r(s(day)?)?)?|fri(day)?|sat(urday)?|sun(day)?)\b/i.test(lower)) {
    relativeWeek = "this_week";
  }

  const timeWindow = parseExplicitTimeWindow(message);
  if (weekdayTokens.size === 0 && !relativeWeek && !timeWindow) return null;

  // Keep an explicit dependency on timezone for relative-week interpretation downstream.
  void timeZone;

  return {
    weekdayTokens: weekdayTokens.size > 0 ? Array.from(weekdayTokens) : undefined,
    relativeWeek,
    timeWindow: timeWindow || undefined,
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
  dateContext: string;
  leadTimezoneContext: string;
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
${opts.dateContext}
${opts.leadTimezoneContext}
Guidelines:
- Keep each SMS part <= 160 characters (hard limit). Total parts max 3.
- Be professional but personable
- Don't use emojis unless the lead used them first
- Only mention the website if an OUR WEBSITE section is provided. Never claim you lack an official link.
- Never use pricing placeholders like \${PRICE}, $X-$Y, or made-up numbers. If you mention pricing, the numeric dollar amount MUST match a price/fee/cost stated in About Our Business or Reference Information — do not round, estimate, or invent. If no pricing is explicitly present in those sections, do not state any dollar amount; instead ask one clarifying question and offer a quick call.
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
  dateContext: string;
  leadTimezoneContext: string;
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
${opts.dateContext}
${opts.leadTimezoneContext}

Guidelines:
- Output plain text only (no markdown).
- Keep it concise and natural (1-3 short paragraphs).
- Don't use emojis unless the lead used them first.
- Only mention the website if an OUR WEBSITE section is provided. Never claim you lack an official link.
- Never use pricing placeholders like \${PRICE}, $X-$Y, or made-up numbers. If you mention pricing, the numeric dollar amount MUST match a price/fee/cost stated in About Our Business or Reference Information — do not round, estimate, or invent. If no pricing is explicitly present in those sections, do not state any dollar amount; instead ask one clarifying question and offer a quick call.
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
  dateContext: string;
  leadTimezoneContext: string;
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
- Never use pricing placeholders like \${PRICE}, $X-$Y, or made-up numbers. If you mention pricing, the numeric dollar amount MUST match a price/fee/cost stated in OFFER or Reference Information — do not round, estimate, or invent. If no pricing is explicitly present in those sections, do not state any dollar amount; instead ask one clarifying question and offer a quick call.
- If the lead opted out/unsubscribed/asked to stop, output an empty reply ("") and nothing else.
- Only mention the website if an OUR WEBSITE section is provided. Never claim you lack an official link.
- If the lead asks for more info (e.g., "send me more info"), summarize our offer and relevant Reference Information. Do NOT treat "more info" as a website request unless they explicitly asked for a link.

DATE CONTEXT:
${opts.dateContext}

LEAD TIMEZONE:
${opts.leadTimezoneContext}
IMPORTANT: When the lead mentions times, interpret them in the lead's timezone if known.

SCHEDULING RULES:
${availabilityBlock}
- Do not imply a meeting is booked unless clear booking confirmation context exists (explicit lead confirmation or a should-book-now path with a selected matching slot).
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
  dateContext: string;
  leadTimezoneContext: string;
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
- ${opts.dateContext}
- ${opts.leadTimezoneContext}

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
1. What makes this lead unique (personalization_points). Use only grounded facts from provided context; if no reliable personalization exists, use an empty list.
2. What the response should achieve (intent_summary)
3. Whether to offer scheduling times (should_offer_times, times_to_offer) — TIMING AWARENESS: If the lead expressed a timing preference (e.g., "next week", "after the 15th", "this month"), ONLY select times from the list that match their request. Do NOT offer "this week" times if they said "next week". When no timing preference is expressed, prefer sooner options. If no available times match their stated preference, set should_offer_times to false and plan to ask what works better.
   - LEAD SCHEDULER: If a lead-provided scheduling link is present above, set should_offer_times to false (times_to_offer = null) and plan to acknowledge their link instead of proposing our times. Keep the response scheduling-only (no extra pitch/agenda/qualification detours).
4. The email structure (outline) - aligned with ${opts.shouldSelectArchetype ? "your selected archetype" : "the archetype above"}
5. What to avoid (must_avoid)
${archetypeTask}

Scheduling priority:
- If the lead is clearly ready to book, strategy should be booking-first and concise.
- Avoid adding new qualification questions when the conversation already establishes fit/qualification.
- If the lead already confirmed meeting the revenue/fit threshold, do not ask another qualification question.
- Keep timezone framing consistent with the lead's stated window when times are proposed.
- If the lead provided a scheduling link or a concrete booking window, keep the plan scheduling-only. Do not include extra selling points or meeting agenda content.

If the lead asks for more info, ensure the strategy includes concrete details from OUR OFFER and REFERENCE INFORMATION in the intent_summary/outline. Do not treat "more info" as a website request unless the lead explicitly asked for a link.
If the lead asks explicit questions (for example pricing, attendance frequency, or location), make sure each explicit question is answered in the strategy outline.

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
PERSONALIZATION POINTS (use only grounded points; if none, keep generic):
${opts.strategy.personalization_points.length > 0 ? opts.strategy.personalization_points.map(p => `- ${p}`).join("\n") : "- none"}

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
    ? `\nLEAD-PROVIDED SCHEDULING LINK (EXPLICITLY SHARED BY LEAD):\n${opts.leadSchedulerLink}\nIMPORTANT: Do NOT offer our availability times or our booking link. Acknowledge their link and confirm we will use their scheduler (no need to repeat the full URL). Do NOT imply the meeting is already booked. If a clarifier is truly needed, ask ONE short question. Keep the response scheduling-only: no pitch, agenda, or extra qualification detours.`
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
  - Prefer collective voice ("we"/"our") when natural, but first-person voice and personal sign-offs are allowed when they fit the conversation.
  - If the lead opted out/unsubscribed/asked to stop, output an empty reply ("") and nothing else.
  - Do not imply a meeting is booked unless there is clear scheduling confirmation context (for example explicit lead acceptance or a should-book-now confirmation path with a selected slot).
  - If the lead gives a timing window (for example, "after 10am") and you still need clarification, ask ONE question to pin down the exact start time. Do NOT propose a specific start time yourself.
  - If the lead is clearly ready to book, prioritize scheduling only: do not add extra pitch or re-qualification questions.
  - If the lead already confirmed qualification/thresholds, do not ask follow-up qualification questions.
  - If you present time options, keep them in one timezone context and align to any lead-provided window.
  - If the lead asked explicit questions, answer all of them before adding extra context.
  - If the lead asked for pricing/fee/cadence details, include concrete pricing/cadence details from provided context. Never invent missing numbers.
- If the lead asked for more info, include the concrete details from the strategy. Do not add a website or link unless it appears in the strategy or conversation.
- Do not add extra polite closings beyond the provided signature block.

FORBIDDEN TERMS (never use):
${forbiddenTerms}

${opts.signature ? `SIGNATURE (include at end):\n${opts.signature}` : ""}

Write the email now, following the strategy and archetype structure exactly.`;
}

function buildStep1BridgeEmailDraft(opts: {
  aiName: string;
  aiGreeting: string;
  firstName: string;
  signature: string | null;
  strategy: EmailDraftStrategy;
}): string {
  const greeting = (opts.aiGreeting || "Hi {firstName},").replace("{firstName}", opts.firstName || "there");
  const personalization = opts.strategy.personalization_points
    .map((point) => point.trim())
    .filter(Boolean)
    .slice(0, 2);
  const outlinePoints = opts.strategy.outline
    .map((point) => point.trim())
    .filter(Boolean)
    .slice(0, 3);
  const intentSummary = opts.strategy.intent_summary?.trim() || "Happy to help and share the most relevant next steps.";

  const lines: string[] = [
    greeting,
    "",
    "Thanks for the reply.",
    "",
    intentSummary,
  ];

  if (personalization.length > 0) {
    lines.push("");
    lines.push(personalization.map((point) => `- ${point}`).join("\n"));
  }

  if (outlinePoints.length > 0) {
    lines.push("");
    lines.push(outlinePoints.map((point) => `- ${point}`).join("\n"));
  }

  if (opts.strategy.should_offer_times && opts.strategy.times_to_offer?.length) {
    lines.push("");
    lines.push("If helpful, I can hold one of these times:");
    lines.push(opts.strategy.times_to_offer.slice(0, 2).map((slot) => `- ${slot}`).join("\n"));
    lines.push("Let me know which works best.");
  } else {
    lines.push("");
    lines.push("If helpful, I can send over a couple of time options.");
  }

  if (opts.signature?.trim()) {
    lines.push("", opts.signature.trim());
  } else {
    lines.push("", `Best,\n${opts.aiName}`);
  }

  return lines.join("\n").trim();
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
    const reuseExistingDraft = opts.reuseExistingDraft !== false;
    const meetingOverseerMode = opts.meetingOverseerMode === "fresh" ? "fresh" : "persisted";
    const reuseMeetingOverseerDecisions = meetingOverseerMode !== "fresh";
    const persistMeetingOverseerDecisions = opts.persistMeetingOverseerDecisions !== false;

    if (triggerMessageId && reuseExistingDraft) {
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

        let runId: string | null = null;
        try {
          runId =
            (
              await prisma.draftPipelineRun.findUnique({
                where: { triggerMessageId_channel: { triggerMessageId, channel } },
                select: { id: true },
              })
            )?.id ?? null;
        } catch {
          // ignore
        }

        return { success: true, draftId: existing.id, content: existing.content, runId, reusedExistingDraft: true };
      }
    }

	    let triggerMessageRecord: {
	      body: string;
	      subject: string | null;
	      rawText: string | null;
	      rawHtml: string | null;
        sentAt: Date;
	    } | null = null;
	    if (triggerMessageId) {
	      try {
	        triggerMessageRecord = await prisma.message.findFirst({
	          where: { id: triggerMessageId, leadId },
	          select: { body: true, subject: true, rawText: true, rawHtml: true, sentAt: true },
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
        phone: true,
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
                            take: 10,
                            select: {
                                name: true,
                                type: true,
                                fileUrl: true,
                                rawContent: true,
                                textContent: true,
                                aiContextMode: true,
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
    const skippedRoutes: DraftRouteSkip[] = [];

    // ---------------------------------------------------------------------------
    // Phase 123: Draft pipeline run + artifact persistence (fail-open)
    // ---------------------------------------------------------------------------
    let draftPipelineRunId: string | null = null;
    if (triggerMessageId) {
      try {
        const run = await prisma.draftPipelineRun.upsert({
          where: { triggerMessageId_channel: { triggerMessageId, channel } },
          create: {
            clientId: lead.clientId,
            leadId,
            triggerMessageId,
            channel,
            status: "RUNNING",
          },
          update: {},
          select: { id: true },
        });
        draftPipelineRunId = run.id;
      } catch (error) {
        console.warn("[AI Drafts] Failed to create DraftPipelineRun; continuing without run artifacts", {
          leadId,
          triggerMessageId,
          channel,
          errorMessage: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const persistDraftPipelineArtifact = async (opts: {
      stage: DraftPipelineStage;
      iteration?: number;
      promptKey?: string | null;
      model?: string | null;
      payload?: unknown;
      text?: string | null;
    }): Promise<void> => {
      if (!draftPipelineRunId) return;
      const iteration = typeof opts.iteration === "number" && Number.isFinite(opts.iteration) ? Math.trunc(opts.iteration) : 0;

      const payload = validateArtifactPayload(opts.payload);
      const createOrUpdate = {
        ...(opts.promptKey ? { promptKey: opts.promptKey } : {}),
        ...(opts.model ? { model: opts.model } : {}),
        ...(payload !== null ? { payload } : {}),
        ...(opts.text ? { text: opts.text } : {}),
      };

      try {
        await prisma.draftPipelineArtifact.upsert({
          where: {
            runId_stage_iteration: {
              runId: draftPipelineRunId,
              stage: opts.stage,
              iteration,
            },
          },
          create: {
            runId: draftPipelineRunId,
            stage: opts.stage,
            iteration,
            ...createOrUpdate,
          },
          update: createOrUpdate,
          select: { id: true },
        });
      } catch (error) {
        console.warn("[AI Drafts] Failed to persist DraftPipelineArtifact; continuing", {
          leadId,
          triggerMessageId,
          channel,
          stage: opts.stage,
          iteration,
          errorMessage: error instanceof Error ? error.message : String(error),
        });
      }
    };

    const markRouteSkipped = async (route: DraftRouteSkip): Promise<void> => {
      if (!skippedRoutes.includes(route)) skippedRoutes.push(route);

      const routeConfig: Record<
        DraftRouteSkip,
        {
          stage: DraftPipelineStage;
          skipRoute:
            | "draft_generation"
            | "draft_generation_step2"
            | "draft_verification_step3"
            | "meeting_overseer_draft";
        }
      > = {
        draft_generation: {
          stage: DRAFT_PIPELINE_STAGES.draftGenerationStep2,
          skipRoute: "draft_generation",
        },
        draft_generation_step2: {
          stage: DRAFT_PIPELINE_STAGES.draftGenerationStep2,
          skipRoute: "draft_generation_step2",
        },
        draft_verification_step3: {
          stage: DRAFT_PIPELINE_STAGES.draftVerifierStep3,
          skipRoute: "draft_verification_step3",
        },
        meeting_overseer: {
          stage: DRAFT_PIPELINE_STAGES.meetingOverseerGate,
          skipRoute: "meeting_overseer_draft",
        },
      };

      const config = routeConfig[route];
      console.info("[AI Drafts] Route skipped by workspace setting", {
        route: config.skipRoute,
        clientId: lead.clientId,
        leadId,
        channel,
      });

      await Promise.all([
        persistDraftPipelineArtifact({
          stage: config.stage,
          payload: {
            skipped: true,
            reason: "disabled_by_workspace_settings",
            route: config.skipRoute,
            channel,
          },
        }),
        recordAiRouteSkip({
          clientId: lead.clientId,
          leadId,
          route: config.skipRoute,
          channel,
          triggerMessageId,
          reason: "disabled_by_workspace_settings",
        }),
      ]);
    };

    if (!(settings?.draftGenerationEnabled ?? true)) {
      await markRouteSkipped("draft_generation");
      return {
        success: true,
        runId: draftPipelineRunId,
        skippedRoutes,
        blockedBySetting: "draftGenerationEnabled",
      };
    }

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
    const serviceDescription = mergeServiceDescriptions(
      persona.serviceDescription,
      settings?.serviceDescription?.trim() || null
    );

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

    const knowledgeAssets: KnowledgeAssetForContext[] = (settings?.knowledgeAssets ?? []).map((asset) => ({
      ...asset,
      aiContextMode: asset.aiContextMode === "raw" ? "raw" : "notes",
    }));
    let primaryWebsiteUrl = extractPrimaryWebsiteUrlFromAssets(knowledgeAssets);
    let knowledgeContext = "";
    let draftPromptMetadata: unknown = undefined;

    const leadContextBundleEnabled =
      Boolean(settings?.leadContextBundleEnabled) && !isLeadContextBundleGloballyDisabled();
    let usedLeadContextBundle = false;

    if (leadContextBundleEnabled) {
      try {
        const bundle = await buildLeadContextBundle({
          clientId: lead.clientId,
          leadId,
          profile: "draft",
          timeoutMs: 500,
          settings: settings ?? null,
          knowledgeAssets,
          serviceDescription: serviceDescription || null,
          goals: aiGoals || null,
        });

        usedLeadContextBundle = true;
        draftPromptMetadata = buildLeadContextBundleTelemetryMetadata(bundle);
        primaryWebsiteUrl = bundle.primaryWebsiteUrl;

        knowledgeContext = (bundle.knowledgeContext || "").trim();
        const memoryContext = (bundle.leadMemoryContext || "").trim();
        if (memoryContext) {
          knowledgeContext = [knowledgeContext, `LEAD MEMORY:\n${memoryContext}`].filter(Boolean).join("\n\n");
        }
      } catch (error) {
        console.warn("[AI Drafts] LeadContextBundle build failed; falling back to legacy context assembly", {
          leadId,
          clientId: lead.clientId,
          errorMessage: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (!usedLeadContextBundle) {
      // Legacy knowledge context assembly (kept as a safe fallback).
      if (knowledgeAssets.length > 0) {
        const assetSnippets = knowledgeAssets
          .map((a) => ({
            name: a.name,
            source: resolveKnowledgeAssetContextSource(a).content,
          }))
          .filter((a) => a.source && a.name !== PRIMARY_WEBSITE_ASSET_NAME)
          .map((a) => `[${a.name}]: ${a.source.slice(0, 1600)}${a.source.length > 1600 ? "..." : ""}`);

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
        redact: false,
      });
      const draftMemoryContext = leadMemoryResult.context.trim();
      if (draftMemoryContext) {
        knowledgeContext = [knowledgeContext, `LEAD MEMORY:\n${draftMemoryContext}`].filter(Boolean).join("\n\n");
      }
    }

    const verifiedPricingContext = buildVerifiedPricingContext({
      serviceDescription: serviceDescription || null,
      knowledgeAssets,
    });
    if (verifiedPricingContext && !/VERIFIED PRICING CONTEXT:/i.test(knowledgeContext)) {
      knowledgeContext = [knowledgeContext, verifiedPricingContext].filter(Boolean).join("\n\n");
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

    const schedulerInstructionText = [triggerMessageRecord?.subject, triggerMessageRecord?.body].filter(Boolean).join("\n\n");
    const hasExplicitSchedulerInstruction = hasExplicitSchedulerLinkInstruction(schedulerInstructionText);
    const triggerMessageSchedulerLink = (() => {
      const bodyText = (triggerMessageRecord?.body || "").trim();
      const rawText = (triggerMessageRecord?.rawText || "").trim();
      return extractSchedulerLinkFromText(`${bodyText}\n${rawText}`);
    })();
    const leadSchedulerLink =
      (opts.leadSchedulerLinkOverride || "").trim() ||
      (hasExplicitSchedulerInstruction
        ? triggerMessageSchedulerLink || (lead.externalSchedulingLink || "").trim() || null
        : null);
    const leadHasSchedulerLink = Boolean(leadSchedulerLink);

    const shouldConsiderScheduling = [
      "Meeting Requested",
      "Call Requested",
      "Interested",
      "Positive",
      "Information Requested",
    ].includes(sentimentTag) && !leadHasSchedulerLink;

    let latestMessageBody = (triggerMessageRecord?.body || "").trim();
    let latestMessageSubject = (triggerMessageRecord?.subject || "").trim();
    if (!latestMessageBody) {
      try {
        const latestInbound = await prisma.message.findFirst({
          where: { leadId, channel, direction: "inbound" },
          orderBy: [{ sentAt: "desc" }, { createdAt: "desc" }],
          select: { body: true, subject: true },
        });
        latestMessageBody = (latestInbound?.body || "").trim();
        latestMessageSubject = (latestInbound?.subject || "").trim();
      } catch (error) {
        console.warn("[AI Drafts] Failed to load latest inbound message for timezone inference:", error);
      }
    }
	    const tzResult = await ensureLeadTimezone(leadId, {
	      conversationText: latestMessageBody || null,
	      subjectText: latestMessageSubject || null,
	    });
	    const leadTimeZone = tzResult.timezone || null;
	    const workspaceTimeZone = settings?.timezone || "America/New_York";
	    const dateContext = buildDateContext(leadTimeZone || workspaceTimeZone, triggerMessageRecord?.sentAt ?? null);
	    const leadTimezoneContext = leadTimeZone
	      ? `Lead's timezone: ${leadTimeZone}`
	      : "Lead's timezone: unknown";

    let bookingEscalationReason: string | null = null;
    // Best-effort early check: if the booking process has exceeded max waves, avoid
    // loading/offering availability that we will later suppress.
    if (shouldConsiderScheduling && lead.emailCampaign?.id) {
      try {
        const shouldEscalate = await shouldEscalateForMaxWaves({
          leadId,
          emailCampaignId: lead.emailCampaign.id,
        });
        if (shouldEscalate) {
          bookingEscalationReason = "max_booking_attempts_exceeded";
        }
      } catch {
        // fail-open
      }
    }

    let availability: string[] = [];
    let offeredSlotsForOverseer: OfferedSlot[] = [];

    if (lead.offeredSlots) {
      try {
        const parsed = JSON.parse(lead.offeredSlots);
        if (Array.isArray(parsed)) {
          offeredSlotsForOverseer = parsed
            .map((entry) => {
              if (!entry || typeof entry !== "object") return null;
              const label = typeof (entry as { label?: unknown }).label === "string" ? (entry as { label: string }).label.trim() : "";
              const datetime =
                typeof (entry as { datetime?: unknown }).datetime === "string"
                  ? (entry as { datetime: string }).datetime.trim()
                  : "";
              const offeredAt =
                typeof (entry as { offeredAt?: unknown }).offeredAt === "string"
                  ? (entry as { offeredAt: string }).offeredAt.trim()
                  : "";
              if (!label || !datetime) return null;
              return { label, datetime, offeredAt };
            })
            .filter((entry): entry is OfferedSlot => Boolean(entry));
        }
      } catch {
        // Ignore malformed offeredSlots.
      }
    }
    // If we already offered slots in a prior outbound, treat those as the current
    // "availability" so the draft can reply using the same options verbatim.
    if (!bookingEscalationReason && offeredSlotsForOverseer.length > 0) {
      availability = offeredSlotsForOverseer.map((slot) => slot.label).filter(Boolean);
    }

    if (shouldConsiderScheduling && lead?.clientId && !bookingEscalationReason) {
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
          const timeZone = leadTimeZone || settings?.timezone || "UTC";
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

          let candidateSlotsUtc = slots.slotsUtc;
          const timingPreferences = latestMessageBody
            ? extractTimingPreferencesFromText(latestMessageBody, timeZone)
            : null;
          if (timingPreferences?.weekdayTokens?.length) {
              const weekdayFormatter = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" });
              const weekdayFiltered = candidateSlotsUtc.filter((iso) => {
                const d = new Date(iso);
                if (Number.isNaN(d.getTime())) return false;
                const weekdayToken = weekdayFormatter.format(d).toLowerCase().slice(0, 3);
                return timingPreferences.weekdayTokens!.includes(weekdayToken);
              });
              if (weekdayFiltered.length > 0) {
                candidateSlotsUtc = weekdayFiltered;
              }
          }

          if (timingPreferences?.relativeWeek) {
              const relativeFiltered = candidateSlotsUtc.filter((iso) => {
                const dayDiff = getDayDiffInTimeZone(iso, offeredAt, timeZone);
                if (dayDiff === null) return false;
                if (timingPreferences.relativeWeek === "this_week") {
                  return dayDiff >= 0 && dayDiff < 7;
                }
                return dayDiff >= 7 && dayDiff < 14;
              });
              if (relativeFiltered.length > 0) {
                candidateSlotsUtc = relativeFiltered;
              }
          }

          if (timingPreferences?.timeWindow) {
            const windowFiltered = candidateSlotsUtc.filter((iso) => {
              const minutes = getMinutesOfDayInTimeZone(iso, timeZone);
              if (minutes === null) return false;
              return isMinuteWithinWindow(
                minutes,
                timingPreferences.timeWindow!.startMinutes,
                timingPreferences.timeWindow!.endMinutes
              );
            });
            if (windowFiltered.length > 0) {
              candidateSlotsUtc = windowFiltered;
            }
          }

          const excludeUtcIso = timingPreferences?.timeWindow ? new Set<string>() : existingOffered;

          const selectedUtcIso = selectDistributedAvailabilitySlots({
            slotsUtcIso: candidateSlotsUtc,
            offeredCountBySlotUtcIso: offerCounts,
            timeZone,
            leadTimeZone: leadTimeZone || null,
            excludeUtcIso,
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
          offeredSlotsForOverseer = formatted.map((s) => ({
            label: s.label,
            datetime: s.datetime,
            offeredAt: offeredAtIso,
          }));

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
              // Avoid returning full Lead row; some deployments can have schema drift.
              select: { id: true },
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

      if (bookingResult.requiresHumanReview || bookingResult.escalationReason) {
        bookingEscalationReason =
          (bookingResult.escalationReason || "").trim() || "requires_human_review";

        console.log("[AI Drafts] Booking escalation active; suppressing booking instructions", {
          leadId,
          channel,
          escalationReason: bookingEscalationReason,
        });

        // Escalation should never block drafting; it just suppresses booking nudges.
        bookingProcessInstructions = null;
        availability = [];
        offeredSlotsForOverseer = [];
      } else {
        bookingProcessInstructions = bookingResult.instructions;

        if (bookingProcessInstructions) {
          console.log(
            `[AI Drafts] Using booking process stage ${bookingResult.stageNumber} (wave ${bookingResult.waveNumber}) for ${channel}`
          );
        }
      }
    } catch (error) {
      console.error("[AI Drafts] Failed to get booking process instructions:", error);
      // Continue without booking instructions on error
    }

    const bookingEscalationPromptAppendix =
      bookingEscalationReason && !leadSchedulerLink
        ? `\nBOOKING ESCALATION OVERRIDE (${bookingEscalationReason}):\nSCHEDULING: Do not propose specific meeting times or include any booking links. If scheduling comes up, ask for their preferred times/timezone and note a human will coordinate.\n`
        : "";
    const autoBookingSchedulingAppendix = opts.autoBookingContext?.schedulingDetected
      ? [
          "SCHEDULING CONTEXT (from auto-booking):",
          `- Scheduling intent was detected (intent: ${opts.autoBookingContext.schedulingIntent ?? "unknown"}).`,
          opts.autoBookingContext.failureReason === "no_match"
            ? "- Proposed time did not match current availability; acknowledge and offer alternatives from provided availability."
            : null,
          opts.autoBookingContext.failureReason === "needs_clarification"
            ? "- Scheduling details were ambiguous; ask one concise clarifying question."
            : null,
          opts.autoBookingContext.isQualifiedForBooking === false
            ? "- Qualification is currently not met; do not imply confirmed booking."
            : null,
          "- Do NOT say \"we'll call\" due to signature phone numbers unless the lead explicitly asked for a call.",
          "- Keep the response focused on scheduling/booking clarity.",
        ]
          .filter(Boolean)
          .join("\n")
      : "";
    const actionSignalsPromptAppendix = buildActionSignalsPromptAppendix(opts.actionSignals);
    const callPhoneContextAppendix = buildCallPhoneContextAppendix({
      actionSignals: opts.actionSignals,
      leadPhoneOnFile: Boolean((lead.phone || "").trim()),
    });
    const actionSignalsGateSummary = buildActionSignalsGateSummary(opts.actionSignals);

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
	      Number.parseInt(process.env.OPENAI_DRAFT_MAX_OUTPUT_TOKENS_CAP || "18000", 10) || 18_000
    );

    let draftContent: string | null = null;
    let emailVerifierForbiddenTerms: string[] | null = null;
    let emailLengthBoundsForClamp: { minChars: number; maxChars: number } | null = null;
    let generationInteractionId: string | null = null;
    let verificationInteractionId: string | null = null;

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
  let strategyPromptKeyUsed: string | null = null;

      let strategyInstructions = buildEmailDraftStrategyInstructions({
        aiName,
        aiTone,
        firstName,
        dateContext,
        leadTimezoneContext,
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

      if (bookingEscalationPromptAppendix) {
        strategyInstructions += bookingEscalationPromptAppendix;
      }
      if (autoBookingSchedulingAppendix) {
        strategyInstructions += `\n${autoBookingSchedulingAppendix}\n`;
      }
      if (actionSignalsPromptAppendix) {
        strategyInstructions += `\n${actionSignalsPromptAppendix}\n`;
      }
      if (callPhoneContextAppendix) {
        strategyInstructions += `\n${callPhoneContextAppendix}\n`;
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
          metadata: draftPromptMetadata,
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
          strategyPromptKeyUsed = attemptPromptKey;

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

      if (strategy) {
        await persistDraftPipelineArtifact({
          stage: DRAFT_PIPELINE_STAGES.draftStrategyStep1,
          promptKey: strategyPromptKeyUsed,
          model: draftModel,
          payload: {
            strategy,
            interactionId: strategyInteractionId,
            archetypeId: archetype?.id || null,
            shouldSelectArchetype,
          },
        });
      }

      const step2Enabled = settings?.draftGenerationStep2Enabled ?? true;
      if (!step2Enabled) {
        await markRouteSkipped("draft_generation_step2");
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

          if (!step2Enabled) {
            draftContent = buildStep1BridgeEmailDraft({
              aiName,
              aiGreeting,
              firstName,
              signature: aiSignature || null,
              strategy,
            });
          } else {
		        const generationInstructions =
              buildEmailDraftGenerationInstructions({
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
		        }) +
              emailLengthRules +
              (callPhoneContextAppendix ? `\n${callPhoneContextAppendix}\n` : "");

        const latestInboundForGeneration =
          (await getLatestInboundEmailTextForVerifier({ leadId, triggerMessageId }))?.trim() || null;

        const generationInput = `<latest_inbound>
${latestInboundForGeneration || "None."}
</latest_inbound>

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
                  metadata: draftPromptMetadata,
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
                metadata: draftPromptMetadata,
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
            generationInteractionId = generationResult.telemetry.interactionId;
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
          dateContext,
          leadTimezoneContext,
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

        if (bookingEscalationPromptAppendix) {
          fallbackSystemPrompt += bookingEscalationPromptAppendix;
        }
        if (autoBookingSchedulingAppendix) {
          fallbackSystemPrompt += `\n${autoBookingSchedulingAppendix}\n`;
        }
        if (actionSignalsPromptAppendix) {
          fallbackSystemPrompt += `\n${actionSignalsPromptAppendix}\n`;
        }
        if (callPhoneContextAppendix) {
          fallbackSystemPrompt += `\n${callPhoneContextAppendix}\n`;
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
              metadata: draftPromptMetadata,
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
        dateContext,
        leadTimezoneContext,
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
              dateContext,
              leadTimezoneContext,
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
              dateContext,
              leadTimezoneContext,
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

      if (bookingEscalationPromptAppendix) {
        instructions += bookingEscalationPromptAppendix;
      }
      if (autoBookingSchedulingAppendix) {
        instructions += `\n${autoBookingSchedulingAppendix}\n`;
      }
      if (actionSignalsPromptAppendix) {
        instructions += `\n${actionSignalsPromptAppendix}\n`;
      }
      if (callPhoneContextAppendix) {
        instructions += `\n${callPhoneContextAppendix}\n`;
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
        metadata: draftPromptMetadata,
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
            metadata: draftPromptMetadata,
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
            generationInteractionId = fallbackResult.telemetry.interactionId;
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

    await persistDraftPipelineArtifact({
      stage: DRAFT_PIPELINE_STAGES.draftGenerationStep2,
      text: draftContent,
      payload: {
        channel,
        usedLeadContextBundle,
        hasAvailability: availability.length > 0,
        step2Skipped: skippedRoutes.includes("draft_generation_step2"),
      },
    });

    let bookingLink: string | null = null;
    let hasPublicBookingLinkOverride = false;
    try {
      const resolved = await resolveBookingLink(lead.clientId, settings);
      bookingLink = resolved.bookingLink;
      hasPublicBookingLinkOverride = resolved.hasPublicOverride;
    } catch (error) {
      console.error("[AI Drafts] Failed to resolve canonical booking link:", error);
    }

    if (bookingEscalationReason) {
      bookingLink = null;
      hasPublicBookingLinkOverride = false;
    }

      if (channel === "email" && draftContent && (settings?.draftVerificationStep3Enabled ?? true)) {
        // Prevent verifier truncations by keeping the draft within our configured bounds.
        const preBounds = emailLengthBoundsForClamp ?? getEmailDraftCharBoundsFromEnv();
        if (draftContent.trim().length > preBounds.maxChars) {
          draftContent = draftContent.trim().slice(0, preBounds.maxChars).trimEnd();
        }

        try {
          const verification = await runEmailDraftVerificationStep3({
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
            metadata: draftPromptMetadata,
          });

          if (verification?.finalDraft) {
            verificationInteractionId = verification.interactionId;
            draftContent = verification.finalDraft;
            await persistDraftPipelineArtifact({
              stage: DRAFT_PIPELINE_STAGES.draftVerifierStep3,
              promptKey: verification.promptKeyForTelemetry,
              model: verification.model,
              payload: {
                interactionId: verification.interactionId,
                promptKey: verification.promptKey,
                promptKeyForTelemetry: verification.promptKeyForTelemetry,
                changed: verification.changed,
                violationsDetected: verification.violationsDetected,
                changes: verification.changes,
              },
              text: verification.finalDraft,
            });
          }
        } catch (error) {
          console.error("[AI Drafts] Step 3 verifier threw unexpectedly:", error);
        }

      } else if (channel === "email" && draftContent) {
        await markRouteSkipped("draft_verification_step3");
      }

    let meetingOverseerExtractionDecision: MeetingOverseerExtractDecision | null = null;

    if (draftContent && triggerMessageId) {
      if (!(settings?.meetingOverseerEnabled ?? true)) {
        await markRouteSkipped("meeting_overseer");
      } else {
        const latestInboundBody = triggerMessageRecord?.body?.trim() ?? "";
        const latestInboundSubject = triggerMessageRecord?.subject?.trim() ?? "";
        const latestInboundText = [
          latestInboundSubject ? `Subject: ${latestInboundSubject}` : "",
          latestInboundBody,
        ]
          .filter(Boolean)
          .join("\n\n")
          .trim();

        if (!latestInboundText) {
          console.warn("[AI Drafts] Missing trigger message body; skipping meeting overseer gate.", {
            leadId,
            triggerMessageId,
          });
        } else {
          try {
            const shouldGate = shouldRunMeetingOverseer({
              messageText: latestInboundText,
              sentimentTag,
              offeredSlotsCount: availability.length,
            });

            if (shouldGate) {
              let extractionDecision: MeetingOverseerExtractDecision | null = null;
              if (reuseMeetingOverseerDecisions) {
                const extraction = await getMeetingOverseerDecision(triggerMessageId, "extract");
                extractionDecision =
                  extraction && typeof extraction === "object" && "is_scheduling_related" in extraction
                    ? (extraction as MeetingOverseerExtractDecision)
                    : null;
              } else {
                extractionDecision = await runMeetingOverseerExtraction({
                  clientId: lead.clientId,
                  leadId,
                  messageId: triggerMessageId,
                  messageText: latestInboundText,
                  leadTimezone: leadTimeZone || null,
                  referenceDate: triggerMessageRecord?.sentAt ?? null,
                  offeredSlots: offeredSlotsForOverseer,
                  conversationContext: conversationTranscript || null,
                  businessContext: [serviceDescription, aiGoals].filter(Boolean).join(" | ") || null,
                  reuseExistingDecision: false,
                  persistDecision: persistMeetingOverseerDecisions,
                });

                if (!extractionDecision) {
                  const fallbackExtraction = await getMeetingOverseerDecision(triggerMessageId, "extract");
                  extractionDecision =
                    fallbackExtraction && typeof fallbackExtraction === "object" && "is_scheduling_related" in fallbackExtraction
                      ? (fallbackExtraction as MeetingOverseerExtractDecision)
                      : null;
                }
              }

              if (extractionDecision) {
                extractionDecision = repairShouldBookNowAgainstOfferedSlots({
                  decision: extractionDecision,
                  offeredSlots: offeredSlotsForOverseer,
                  leadTimezoneHint: leadTimeZone || null,
                });
              }
              meetingOverseerExtractionDecision = extractionDecision;

              await persistDraftPipelineArtifact({
                stage: DRAFT_PIPELINE_STAGES.meetingOverseerExtract,
                payload: { extraction: extractionDecision },
              });

              let gateMemoryContext: string | null = null;
              let gatePromptMetadata: unknown = undefined;

              try {
                if (leadContextBundleEnabled) {
                  const gateBundle = await buildLeadContextBundle({
                    clientId: lead.clientId,
                    leadId,
                    profile: "meeting_overseer_gate",
                    timeoutMs: 500,
                    settings: settings ?? null,
                  });
                  gateMemoryContext = (gateBundle.leadMemoryContext || "").trim() || null;
                  gatePromptMetadata = buildLeadContextBundleTelemetryMetadata(gateBundle);
                } else {
                  const leadMemoryResult = await getLeadMemoryContext({
                    leadId,
                    clientId: lead.clientId,
                    maxTokens: 600,
                    maxEntryTokens: 300,
                    redact: true,
                  });
                  gateMemoryContext = leadMemoryResult.context.trim() || null;
                }
              } catch (error) {
                console.warn("[AI Drafts] Failed to build meeting overseer memory context; continuing without memory", {
                  leadId,
                  triggerMessageId,
                  errorMessage: error instanceof Error ? error.message : String(error),
                });
              }

              if (opts.autoBookingContext?.schedulingDetected) {
                const summary = [
                  `auto_booking_failure_reason: ${opts.autoBookingContext.failureReason ?? "none"}`,
                  `auto_booking_intent: ${opts.autoBookingContext.schedulingIntent ?? "unknown"}`,
                  opts.autoBookingContext.clarificationMessage
                    ? `auto_booking_clarification: ${opts.autoBookingContext.clarificationMessage}`
                    : null,
                  opts.autoBookingContext.isQualifiedForBooking === false
                    ? "auto_booking_qualification: not_qualified"
                    : null,
                  "draft_policy: avoid implying phone-call outreach unless explicitly requested",
                ]
                  .filter(Boolean)
                  .join("\n");
                gateMemoryContext = gateMemoryContext
                  ? `${gateMemoryContext}\n\nAUTO-BOOKING CONTEXT:\n${summary}`
                  : `AUTO-BOOKING CONTEXT:\n${summary}`;
              }

              if (actionSignalsGateSummary) {
                gateMemoryContext = gateMemoryContext
                  ? `${gateMemoryContext}\n\nACTION SIGNAL CONTEXT:\n${actionSignalsGateSummary}`
                  : `ACTION SIGNAL CONTEXT:\n${actionSignalsGateSummary}`;
              }

              const offeredSlotSummary = offeredSlotsForOverseer
                .slice(0, 6)
                .map((slot, idx) => `${idx + 1}. ${slot.label} (${slot.datetime})`)
                .join("\n");
              const gateDateAndSlotContext = [
                `date_anchor: ${dateContext}`,
                `lead_timezone: ${leadTimeZone || "unknown"}`,
                `offered_slots_source_of_truth:\n${offeredSlotSummary || "None."}`,
              ].join("\n");
              gateMemoryContext = gateMemoryContext
                ? `${gateMemoryContext}\n\nDATE & SLOT CONTEXT:\n${gateDateAndSlotContext}`
                : `DATE & SLOT CONTEXT:\n${gateDateAndSlotContext}`;

              const gateResult = await runMeetingOverseerGateDecision({
                clientId: lead.clientId,
                leadId,
                messageId: triggerMessageId,
                channel,
                latestInbound: latestInboundText,
                draft: draftContent,
                availability,
                bookingLink,
                extraction: extractionDecision,
                memoryContext: gateMemoryContext,
                serviceDescription: serviceDescription || null,
                knowledgeContext: knowledgeContext || null,
                metadata: gatePromptMetadata,
                leadSchedulerLink,
                timeoutMs: emailVerifierTimeoutMs,
                reuseExistingDecision: reuseMeetingOverseerDecisions,
                persistDecision: persistMeetingOverseerDecisions,
              });
              const gateDraft = gateResult.finalDraft;

              if (gateDraft) {
                draftContent = gateDraft;
              }

              await persistDraftPipelineArtifact({
                stage: DRAFT_PIPELINE_STAGES.meetingOverseerGate,
                payload: gateResult.decision,
                text: gateDraft,
              });
            }
          } catch (overseerError) {
            console.warn("[AI Drafts] Meeting overseer failed; continuing with pre-gate draft", {
              leadId,
              triggerMessageId,
              channel,
              errorType: overseerError instanceof Error ? overseerError.name : "unknown",
              errorMessage: overseerError instanceof Error ? overseerError.message : String(overseerError),
            });
          }
        }
      }
    }

    if (draftContent) {
      const latestInboundTextForGuards = (() => {
        const body = (triggerMessageRecord?.body || "").trim();
        const subject = (triggerMessageRecord?.subject || "").trim();
        const combined = [subject ? `Subject: ${subject}` : "", body].filter(Boolean).join("\n\n").trim();
        return combined || null;
      })();

      draftContent = applyShouldBookNowConfirmationIfNeeded({
        draft: draftContent,
        channel,
        firstName: firstName || null,
        aiName,
        extraction: meetingOverseerExtractionDecision,
        availability,
        clientId: lead.clientId,
        latestInboundText: latestInboundTextForGuards,
      });

          const bookingOnlyGuard = applyBookingOnlyConcisionGuard({
            draft: draftContent,
            extraction: meetingOverseerExtractionDecision,
            channel,
          });
          if (bookingOnlyGuard.changed) {
            draftContent = bookingOnlyGuard.draft;
            console.log("[AI Drafts] Applied booking_only concision guard", {
              leadId,
              channel,
            });
          }

          const confirmationWordingGuard = applySchedulingConfirmationWordingGuard({
            draft: draftContent,
          });
          if (confirmationWordingGuard.changed) {
            draftContent = confirmationWordingGuard.draft;
            console.log("[AI Drafts] Applied booking confirmation wording guard", {
              leadId,
              channel,
            });
          }

      if (channel === "email") {
        const normalized = normalizeEmailDraftLineBreaks(draftContent);
        if (normalized && normalized !== draftContent) {
          draftContent = normalized;
          console.log("[AI Drafts] Normalized email draft line breaks", { leadId, channel });
        }
      }

      const contactUpdateGuard = applyContactUpdateNoSchedulingGuard({
        draft: draftContent,
        latestInboundText: latestInboundTextForGuards,
        channel,
        firstName: firstName || null,
        aiName,
      });
      if (contactUpdateGuard.changed) {
        draftContent = contactUpdateGuard.draft;
		        console.log("[AI Drafts] Applied contact-update scheduling suppression guard", {
		          leadId,
		          channel,
		        });
		      }

		      const pricingNoSchedulingGuard = applyPricingAnswerNoSchedulingGuard({
		        draft: draftContent,
		        extraction: meetingOverseerExtractionDecision,
		      });
      if (pricingNoSchedulingGuard.changed) {
        draftContent = pricingNoSchedulingGuard.draft;
        console.log("[AI Drafts] Applied pricing-mode scheduling suppression guard", {
          leadId,
          channel,
        });
      }

      const pricingQualificationGuard = applyPricingAnswerQualificationGuard({
        draft: draftContent,
        extraction: meetingOverseerExtractionDecision,
        bookingLink,
        leadSchedulerLink,
      });
      if (pricingQualificationGuard.changed) {
        draftContent = pricingQualificationGuard.draft;
        console.log("[AI Drafts] Applied pricing-mode qualification guard", {
          leadId,
          channel,
        });
      }

      const clarificationGuard = applyNeedsClarificationSingleQuestionGuard({
        draft: draftContent,
        extraction: meetingOverseerExtractionDecision,
      });
      if (clarificationGuard.changed) {
        draftContent = clarificationGuard.draft;
        console.log("[AI Drafts] Applied needs_clarification single-question guard", {
          leadId,
          channel,
        });
      }

      const clarifyWindowGuard = applyClarifyOnlyWindowStartTimeGuard({
        draft: draftContent,
        extraction: meetingOverseerExtractionDecision,
      });
      if (clarifyWindowGuard.changed) {
        draftContent = clarifyWindowGuard.draft;
        console.log("[AI Drafts] Applied clarify-only window start-time guard", {
          leadId,
          channel,
        });
      }

	      const timezoneGuard = applyTimezoneQuestionSuppressionGuard({
	        draft: draftContent,
	        extraction: meetingOverseerExtractionDecision,
	      });
	      if (timezoneGuard.changed) {
	        draftContent = timezoneGuard.draft;
	        console.log("[AI Drafts] Applied timezone-question suppression guard", {
	          leadId,
	          channel,
	        });
	      }

        const relativeDateGuard = applyRelativeWeekdayDateDisambiguationGuard({
          draft: draftContent,
          extraction: meetingOverseerExtractionDecision,
          timeZone: leadTimeZone || settings?.timezone || "UTC",
          referenceDate: triggerMessageRecord?.sentAt ?? null,
        });
        if (relativeDateGuard.changed) {
          draftContent = relativeDateGuard.draft;
          console.log("[AI Drafts] Applied relative-weekday date disambiguation guard", {
            leadId,
            channel,
          });
        }

        const thatDayGuard = applyClarifyOnlyThatDayDisambiguationGuard({
          draft: draftContent,
          extraction: meetingOverseerExtractionDecision,
        });
        if (thatDayGuard.changed) {
          draftContent = thatDayGuard.draft;
          console.log("[AI Drafts] Applied clarify_only that-day disambiguation guard", {
            leadId,
            channel,
          });
        }

	      const infoThenBookingGuard = applyInfoThenBookingNoTimeRequestGuard({
	        draft: draftContent,
	        extraction: meetingOverseerExtractionDecision,
	      });
	      if (infoThenBookingGuard.changed) {
        draftContent = infoThenBookingGuard.draft;
        console.log("[AI Drafts] Applied info_then_booking scheduling suppression guard", {
          leadId,
          channel,
        });
      }

      const infoThenBookingQualificationGuard = applyInfoThenBookingNoQualificationGatingGuard({
        draft: draftContent,
        extraction: meetingOverseerExtractionDecision,
      });
      if (infoThenBookingQualificationGuard.changed) {
        draftContent = infoThenBookingQualificationGuard.draft;
        console.log("[AI Drafts] Applied info_then_booking qualification suppression guard", {
          leadId,
          channel,
        });
      }

      const infoThenBookingQualificationQuestionGuard = applyInfoThenBookingNoQualificationQuestionGuard({
        draft: draftContent,
        extraction: meetingOverseerExtractionDecision,
      });
      if (infoThenBookingQualificationQuestionGuard.changed) {
        draftContent = infoThenBookingQualificationQuestionGuard.draft;
        console.log("[AI Drafts] Applied info_then_booking qualification-question guard", {
          leadId,
          channel,
        });
      }

      const revenueTargetGuard = applyRevenueTargetAnswerGuard({
        draft: draftContent,
        extraction: meetingOverseerExtractionDecision,
        latestInboundText: latestInboundTextForGuards,
      });
      if (revenueTargetGuard.changed) {
        draftContent = revenueTargetGuard.draft;
        console.log("[AI Drafts] Applied revenue-target answer guard", {
          leadId,
          channel,
        });
      }

      const leadSchedulerChoiceGuard = applyLeadSchedulerLinkNoChoiceGuard({
        draft: draftContent,
        extraction: meetingOverseerExtractionDecision,
        leadSchedulerLink,
        channel,
        firstName: firstName || null,
        aiName,
      });
      if (leadSchedulerChoiceGuard.changed) {
        draftContent = leadSchedulerChoiceGuard.draft;
        console.log("[AI Drafts] Applied lead-scheduler-link no-choice guard", {
          leadId,
          channel,
        });
      }

	      if (channel === "email") {
	        const missingBookingLinkGuard = applyMissingBookingLinkForCallCue({
	          draft: draftContent,
	          bookingLink,
	          leadSchedulerLink,
	          extraction: meetingOverseerExtractionDecision,
	        });
	        if (missingBookingLinkGuard.changed) {
	          draftContent = missingBookingLinkGuard.draft;
	          console.log("[AI Drafts] Applied missing booking-link call-cue guard", {
	            leadId,
            channel,
          });
        }
      }
    }

    if (channel === "email" && draftContent) {
      // Hard post-pass enforcement (even if verifier or gate fails).
      if (leadSchedulerLink) {
        const canonicalWorkspaceLink = (bookingLink || "").trim();
        if (canonicalWorkspaceLink) {
          const bookingRegex = new RegExp(escapeRegExpSimple(canonicalWorkspaceLink), "gi");
          draftContent = draftContent.replace(bookingRegex, leadSchedulerLink);
        }
      } else {
        draftContent = enforceCanonicalBookingLink(draftContent, bookingLink, {
          replaceAllUrls: hasPublicBookingLinkOverride,
        });
      }

      const bookingPlacement = normalizeBookingLinkPlacement(draftContent, leadSchedulerLink || bookingLink || null);
      if (bookingPlacement.changed) {
        draftContent = bookingPlacement.draft;
      }

      draftContent = replaceEmDashesWithCommaSpace(draftContent);
      const forbiddenTerms = emailVerifierForbiddenTerms ?? DEFAULT_FORBIDDEN_TERMS;
      const forbiddenResult = removeForbiddenTerms(draftContent, forbiddenTerms);
      draftContent = forbiddenResult.output;
    }

    draftContent = sanitizeDraftContent(draftContent, leadId, channel);
    let pricingSafety: ReturnType<typeof enforcePricingAmountSafety> | null = null;
    if (channel === "email") {
      const pricingSafetyResult = enforcePricingAmountSafety(draftContent, serviceDescription, knowledgeContext, {
        requirePricingAnswer: meetingOverseerExtractionDecision?.decision_contract_v1?.needsPricingAnswer === "yes",
      });
      pricingSafety = pricingSafetyResult;
      draftContent = pricingSafetyResult.draft;

      if (
        pricingSafetyResult.removedAmounts.length > 0 ||
        pricingSafetyResult.removedCadenceAmounts.length > 0 ||
        pricingSafetyResult.normalizedCadencePhrase
      ) {
        const removedAmountLabel = pricingSafetyResult.removedAmounts.length
          ? `removed unsupported $${pricingSafetyResult.removedAmounts.join(", $")}`
          : "";
        const removedCadenceLabel = pricingSafetyResult.removedCadenceAmounts.length
          ? `removed cadence-mismatched $${pricingSafetyResult.removedCadenceAmounts.join(", $")}`
          : "";
        const normalizedCadenceLabel = pricingSafetyResult.normalizedCadencePhrase
          ? "normalized pricing cadence phrasing to approved equivalent language"
          : "";
        const summary = [removedAmountLabel, removedCadenceLabel, normalizedCadenceLabel].filter(Boolean).join("; ");
        console.warn(
          `[pricing-safety] Lead ${leadId}: auto-applied (${summary || "no-op"})`
        );
      }
    }

    const pricingCheck = detectPricingHallucinations(draftContent, serviceDescription, knowledgeContext);
    if (pricingCheck.hallucinated.length > 0 || pricingCheck.cadenceMismatched.length > 0) {
      const hallucinatedLabel = pricingCheck.hallucinated.length
        ? `$${pricingCheck.hallucinated.join(", $")} not found in source material`
        : "";
      const cadenceMismatchLabel = pricingCheck.cadenceMismatched.length
        ? `$${pricingCheck.cadenceMismatched.join(", $")} cadence-mismatched`
        : "";
      console.warn(
        `[pricing-hallucination] Lead ${leadId}: ${[hallucinatedLabel, cadenceMismatchLabel].filter(Boolean).join("; ")}`
      );
      const interactionIdForPricingSignal =
        channel === "email" ? (verificationInteractionId || generationInteractionId) : generationInteractionId;
      if (interactionIdForPricingSignal) {
        await markAiInteractionError(
          interactionIdForPricingSignal,
          `pricing_hallucination_detected: hallucinated=${pricingCheck.hallucinated.join(",")} cadence_mismatch=${pricingCheck.cadenceMismatched.join(",")} valid=${pricingCheck.valid.join(",")}`,
          { severity: "warning" }
        );
      }
    }

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

    await persistDraftPipelineArtifact({
      stage: DRAFT_PIPELINE_STAGES.finalDraft,
      text: draftContent,
      payload: { bookingLink, channel, pricingHallucination: pricingCheck, pricingSafety },
    });

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
      await markInboxCountsDirtyByLeadId(leadId).catch(() => undefined);

      if (draftPipelineRunId) {
        try {
          await prisma.draftPipelineRun.update({
            where: { id: draftPipelineRunId },
            data: { draftId: draft.id, status: "COMPLETED" },
            select: { id: true },
          });
        } catch (error) {
          console.warn("[AI Drafts] Failed to link DraftPipelineRun to AIDraft; continuing", {
            leadId,
            triggerMessageId,
            channel,
            errorMessage: error instanceof Error ? error.message : String(error),
          });
        }
      }

      return {
        success: true,
        draftId: draft.id,
        content: draftContent,
        runId: draftPipelineRunId,
        ...(bookingEscalationReason ? { bookingEscalationReason } : {}),
        ...(offeredSlotsForOverseer.length ? { offeredSlots: offeredSlotsForOverseer } : {}),
        ...(availability.length ? { availability } : {}),
        ...(skippedRoutes.length ? { skippedRoutes } : {}),
      };
    } catch (error) {
      // If multiple workers raced, return the already-created draft instead of failing.
      if (triggerMessageId && isPrismaUniqueConstraintError(error)) {
        const existing = await prisma.aIDraft.findFirst({
          where: { triggerMessageId, channel },
          select: { id: true, content: true },
        });
        if (existing) {
          if (draftPipelineRunId) {
            try {
              await prisma.draftPipelineRun.update({
                where: { id: draftPipelineRunId },
                data: { draftId: existing.id, status: "COMPLETED" },
                select: { id: true },
              });
            } catch {
              // fail-open
            }
          }
          if (opts.reuseExistingDraft === false) {
            try {
              await prisma.aIDraft.update({
                where: { id: existing.id },
                data: { content: draftContent, status: "pending" },
                select: { id: true },
              });
              await markInboxCountsDirtyByLeadId(leadId).catch(() => undefined);
              return {
                success: true,
                draftId: existing.id,
                content: draftContent,
                runId: draftPipelineRunId,
                ...(bookingEscalationReason ? { bookingEscalationReason } : {}),
                ...(offeredSlotsForOverseer.length ? { offeredSlots: offeredSlotsForOverseer } : {}),
                ...(availability.length ? { availability } : {}),
                reusedExistingDraft: true,
                ...(skippedRoutes.length ? { skippedRoutes } : {}),
              };
            } catch {
              // Fall through to existing-content return as a fail-safe.
            }
          }

          return {
            success: true,
            draftId: existing.id,
            content: existing.content,
            runId: draftPipelineRunId,
            ...(bookingEscalationReason ? { bookingEscalationReason } : {}),
            ...(offeredSlotsForOverseer.length ? { offeredSlots: offeredSlotsForOverseer } : {}),
            ...(availability.length ? { availability } : {}),
            reusedExistingDraft: true,
            ...(skippedRoutes.length ? { skippedRoutes } : {}),
          };
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
