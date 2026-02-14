import type { OfferedSlot } from "@/lib/booking";
import type { ReplayInvariantFailure } from "@/lib/ai-replay/types";

type EvaluateReplayInvariantsInput = {
  inboundBody: string;
  draft: string;
  offeredSlots: OfferedSlot[];
  bookingLink: string | null;
  leadSchedulerLink: string | null;
};

const MONTH_PATTERN =
  /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2}(?:st|nd|rd|th)?\b/gi;
const TIME_PATTERN = /\b(1[0-2]|0?[1-9])(?::([0-5]\d))?\s?(am|pm)\b/gi;
const URL_PATTERN = /https?:\/\/[^\s)]+|www\.[^\s)]+/gi;

function normalizeText(value: string | null | undefined): string {
  return (value || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeTimeToken(raw: string): string {
  const normalized = normalizeText(raw).replace(/\s+/g, "");
  const match = normalized.match(/^(\d{1,2})(?::([0-5]\d))?(am|pm)$/);
  if (!match) return normalized;

  const hour = Number.parseInt(match[1] || "0", 10);
  const minute = match[2] || "00";
  const meridiem = match[3] || "";
  return `${hour}:${minute}${meridiem}`;
}

function normalizeDateToken(raw: string): string {
  return normalizeText(raw).replace(/\b(\d{1,2})(st|nd|rd|th)\b/g, "$1");
}

function extractDateTokens(value: string): string[] {
  const matches = value.match(MONTH_PATTERN) || [];
  return Array.from(new Set(matches.map((entry) => normalizeDateToken(entry))));
}

function extractTimeTokens(value: string): string[] {
  const matches = value.match(TIME_PATTERN) || [];
  return Array.from(new Set(matches.map((entry) => normalizeTimeToken(entry))));
}

function extractUrls(value: string): string[] {
  return value.match(URL_PATTERN) || [];
}

function looksLikeSchedulingUrl(url: string): boolean {
  return /(calendly\.com|meetings\.hubspot\.com|hubspot\.com\/meetings|leadconnectorhq\.com|gohighlevel\.com|msgsndr\.com|\/widget\/booking\/|\/widget\/bookings\/|calendar\.google\.com\/appointments\/schedules\/)/i.test(
    url || ""
  );
}

function looksLikeBookingIntent(text: string): boolean {
  return /\b(book|booking|schedule|scheduled|availability|available|slot|time works|which works|call)\b/i.test(text);
}

function containsSalesHeavyTerms(text: string): boolean {
  const matches = text.match(
    /\b(program|community|offer|offering|package|results|testimonials|curriculum|module|coaching|transformation|case study)\b/gi
  );
  return (matches?.length || 0) >= 2;
}

function hasLogisticsSignal(text: string): boolean {
  if (/\b(schedule|slot|time|which works|availability|calendar)\b/i.test(text)) return true;
  return extractTimeTokens(text).length > 0 || extractDateTokens(text).length > 0;
}

function isInformationFirstInbound(text: string): boolean {
  return /\b(learn more|share (?:a bit )?about|more info|membership|who (?:some )?of the other members|how .*supports)\b/i.test(
    text
  );
}

function buildOfferedSlotCorpus(slots: OfferedSlot[]): {
  normalizedPhrases: string[];
  dateTokens: Set<string>;
  timeTokens: Set<string>;
} {
  const normalizedPhrases: string[] = [];
  const dateTokens = new Set<string>();
  const timeTokens = new Set<string>();

  for (const slot of slots || []) {
    const label = normalizeText(slot?.label || "");
    const datetime = normalizeText(slot?.datetime || "");
    const phrase = [label, datetime].filter(Boolean).join(" ");
    if (phrase) normalizedPhrases.push(phrase);

    for (const token of extractDateTokens(`${slot?.label || ""} ${slot?.datetime || ""}`)) {
      dateTokens.add(token);
    }
    for (const token of extractTimeTokens(`${slot?.label || ""} ${slot?.datetime || ""}`)) {
      timeTokens.add(token);
    }
  }

  return { normalizedPhrases, dateTokens, timeTokens };
}

export function evaluateReplayInvariantFailures(input: EvaluateReplayInvariantsInput): ReplayInvariantFailure[] {
  const inbound = input.inboundBody || "";
  const draft = (input.draft || "").trim();
  const failures: ReplayInvariantFailure[] = [];

  if (!draft) {
    failures.push({
      code: "empty_draft",
      message: "Draft is empty.",
      severity: "critical",
    });
    return failures;
  }

  const normalizedDraft = normalizeText(draft);
  const normalizedInbound = normalizeText(inbound);
  const inboundTimes = new Set(extractTimeTokens(inbound));
  const inboundDates = new Set(extractDateTokens(inbound));
  const offeredSlots = Array.isArray(input.offeredSlots) ? input.offeredSlots : [];
  const offered = buildOfferedSlotCorpus(offeredSlots);

  const draftTimes = extractTimeTokens(draft);
  const draftDates = extractDateTokens(draft);
  const hasBookingIntent = looksLikeBookingIntent(inbound);

  if (offeredSlots.length > 0) {
    const mentionsOfferedPhrase = offered.normalizedPhrases.some((phrase) => phrase && normalizedDraft.includes(phrase));

    const looksLikeWindowClarifier =
      draft.includes("?") &&
      (/\bwhat\s+(?:(?:exact|specific)\s+)?start\s+time\b/i.test(draft) || /\bwhat\s+time\b/i.test(draft)) &&
      (/\b(after|before|between)\b/i.test(draft) || /\b\d{1,2}\s*[-–]\s*\d{1,2}\s*(?:am|pm)\b/i.test(draft));

    // If the lead proposed an exact time and we are simply confirming it, do not require
    // it to be present in the offered slot list (the lead may be proposing a new time).
    const introducedTimes = draftTimes.filter((token) => !offered.timeTokens.has(token) && !inboundTimes.has(token));

    // Only flag slot mismatches when the draft proposes concrete times. Clarifying-only
    // questions like "What time next Monday afternoon works?" should not fail simply
    // because offered slots exist in the record.
    if (introducedTimes.length > 0 && !mentionsOfferedPhrase && !looksLikeWindowClarifier) {
      failures.push({
        code: "slot_mismatch",
        message: "Draft proposes time options that do not match offered availability.",
        severity: "critical",
      });
    }

    const dateIsCommittal =
      draftTimes.length > 0 || /\b(booked|confirmed|confirming|scheduled|let'?s do|would either of these work|which works)\b/i.test(draft);

    if (offered.dateTokens.size > 0 && draftDates.length > 0 && dateIsCommittal) {
      const hasUnsupportedDate = draftDates.some((token) => !offered.dateTokens.has(token) && !inboundDates.has(token));
      if (hasUnsupportedDate) {
        failures.push({
          code: "date_mismatch",
          message: "Draft references a date that is not present in offered availability.",
          severity: "critical",
        });
      }
    }
  }

  const knownLinks = [input.bookingLink, input.leadSchedulerLink]
    .map((value) => normalizeText(value))
    .filter(Boolean);
  const inboundUrls = extractUrls(inbound);
  const inboundSchedulingUrls = inboundUrls.filter(looksLikeSchedulingUrl);
  const draftUrls = extractUrls(draft);
  const draftSchedulingUrls = draftUrls.filter(looksLikeSchedulingUrl);
  const SCHEDULING_LINK_CTA_REGEX =
    /\b(calendly|calendar\s+link|scheduling\s+link|scheduler\s+link|booking\s+link|book\s+here|schedule\s+here|grab\s+a\s+time\s+here|use\s+(?:my|this)\s+(?:calendly|calendar)|book\s+via\s+(?:my|this)\s+link)\b/i;
  const draftMentionsLink = draftSchedulingUrls.length > 0 || SCHEDULING_LINK_CTA_REGEX.test(draft);

  if (draftMentionsLink && knownLinks.length === 0 && inboundSchedulingUrls.length === 0) {
    failures.push({
      code: "fabricated_link",
      message: "Draft references a scheduling link that is not present in context.",
      severity: "critical",
    });
  } else if (draftSchedulingUrls.length > 0 && (knownLinks.length > 0 || inboundSchedulingUrls.length > 0)) {
    const allowedLinks = knownLinks.length > 0 ? knownLinks : inboundSchedulingUrls.map((value) => normalizeText(value)).filter(Boolean);
    const hasUnknownUrl = draftSchedulingUrls.some((url) => {
      const normalizedUrl = normalizeText(url);
      return !allowedLinks.some((knownLink) => normalizedUrl.includes(knownLink));
    });
    if (hasUnknownUrl) {
      failures.push({
        code: "fabricated_link",
        message: "Draft includes a URL that does not match known scheduling links.",
        severity: "critical",
      });
    }
  }

  if (
    hasBookingIntent &&
    offeredSlots.length > 0 &&
    !isInformationFirstInbound(normalizedInbound) &&
    containsSalesHeavyTerms(normalizedDraft) &&
    !hasLogisticsSignal(draft)
  ) {
    failures.push({
      code: "non_logistics_reply",
      message: "Draft drifts into non-logistics selling content for a booking-intent reply.",
      severity: "critical",
    });
  }

  return failures;
}
