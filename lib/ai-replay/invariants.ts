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
  /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2}\b/gi;
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

function extractDateTokens(value: string): string[] {
  const matches = value.match(MONTH_PATTERN) || [];
  return Array.from(new Set(matches.map((entry) => normalizeText(entry))));
}

function extractTimeTokens(value: string): string[] {
  const matches = value.match(TIME_PATTERN) || [];
  return Array.from(new Set(matches.map((entry) => normalizeTimeToken(entry))));
}

function extractUrls(value: string): string[] {
  return value.match(URL_PATTERN) || [];
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
  const offeredSlots = Array.isArray(input.offeredSlots) ? input.offeredSlots : [];
  const offered = buildOfferedSlotCorpus(offeredSlots);

  const draftTimes = extractTimeTokens(draft);
  const draftDates = extractDateTokens(draft);
  const hasBookingIntent = looksLikeBookingIntent(inbound);

  if (offeredSlots.length > 0) {
    const mentionsOfferedPhrase = offered.normalizedPhrases.some((phrase) => phrase && normalizedDraft.includes(phrase));
    const mentionsOfferedTime = draftTimes.some((token) => offered.timeTokens.has(token));

    if ((draftTimes.length > 0 || /\b(today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(draft)) &&
      !mentionsOfferedPhrase &&
      !mentionsOfferedTime) {
      failures.push({
        code: "slot_mismatch",
        message: "Draft proposes time options that do not match offered availability.",
        severity: "critical",
      });
    }

    const dateIsCommittal =
      draftTimes.length > 0 || /\b(booked|confirmed|confirming|scheduled|let'?s do|would either of these work|which works)\b/i.test(draft);

    if (offered.dateTokens.size > 0 && draftDates.length > 0 && dateIsCommittal) {
      const hasUnsupportedDate = draftDates.some((token) => !offered.dateTokens.has(token));
      if (hasUnsupportedDate) {
        failures.push({
          code: "date_mismatch",
          message: "Draft references a date that is not present in offered availability.",
          severity: "critical",
        });
      }
    }
  }

  const knownLink = normalizeText(input.bookingLink || input.leadSchedulerLink || "");
  const inboundUrls = extractUrls(inbound);
  const draftUrls = extractUrls(draft);
  const draftMentionsLink =
    draftUrls.length > 0 || /\b(link|calendar|calendly|book here|schedule here|scheduling link)\b/i.test(draft);

  if (draftMentionsLink && !knownLink && inboundUrls.length === 0) {
    failures.push({
      code: "fabricated_link",
      message: "Draft references a scheduling link that is not present in context.",
      severity: "critical",
    });
  } else if (draftUrls.length > 0 && knownLink) {
    const hasUnknownUrl = draftUrls.some((url) => !normalizeText(url).includes(knownLink));
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
