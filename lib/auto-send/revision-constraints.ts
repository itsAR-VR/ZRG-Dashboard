import type { OfferedSlot } from "@/lib/booking";
import { evaluateReplayInvariantFailures } from "@/lib/ai-replay/invariants";

type RevisionConstraintInput = {
  inboundBody: string;
  offeredSlots: OfferedSlot[];
  bookingLink: string | null;
  leadSchedulerLink: string | null;
  currentDraft?: string | null;
};

export type RevisionConstraintResult = {
  hardRequirements: string[];
  hardForbidden: string[];
  preferSingleSlotForWindow: boolean;
  currentInvariantCodes: string[];
};

export type RevisionValidationResult = {
  passed: boolean;
  reasons: string[];
  invariantCodes: string[];
};

const TIME_PATTERN = /\b(1[0-2]|0?[1-9])(?::([0-5]\d))?\s?(am|pm)\b/gi;
const WEEKDAY_PATTERN = /\b(mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\b/i;

type WeekOfMonthPreference = {
  monthIndex: number;
  weekIndex: number;
};

type ParsedWindowPreference = {
  dayToken: string | null;
  timeOfDay: "morning" | "afternoon" | "evening" | null;
  range: { startMinutes: number; endMinutes: number } | null;
  weekOfMonth: WeekOfMonthPreference | null;
  hasWindowSignal: boolean;
};

function normalizeText(value: string | null | undefined): string {
  return (value || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function dedupeStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function extractTimeTokens(value: string): string[] {
  const matches = value.match(TIME_PATTERN) || [];
  return dedupeStrings(
    matches.map((entry) => {
      const normalized = normalizeText(entry).replace(/\s+/g, "");
      const match = normalized.match(/^(\d{1,2})(?::([0-5]\d))?(am|pm)$/);
      if (!match) return normalized;
      const hour = Number.parseInt(match[1] || "0", 10);
      const minute = match[2] || "00";
      const meridiem = match[3] || "";
      return `${hour}:${minute}${meridiem}`;
    })
  );
}

function normalizeDayToken(raw: string | null | undefined): string | null {
  const value = (raw || "").trim().toLowerCase();
  if (!value) return null;
  if (value.startsWith("mon")) return "mon";
  if (value.startsWith("tue")) return "tue";
  if (value.startsWith("wed")) return "wed";
  if (value.startsWith("thu")) return "thu";
  if (value.startsWith("fri")) return "fri";
  if (value.startsWith("sat")) return "sat";
  if (value.startsWith("sun")) return "sun";
  return null;
}

function normalizeWeekOrdinalToken(raw: string | null | undefined): number | null {
  const value = (raw || "").trim().toLowerCase();
  if (!value) return null;
  if (value === "1" || value === "1st" || value === "first") return 1;
  if (value === "2" || value === "2nd" || value === "second") return 2;
  if (value === "3" || value === "3rd" || value === "third") return 3;
  if (value === "4" || value === "4th" || value === "fourth") return 4;
  if (value === "5" || value === "5th" || value === "fifth") return 5;
  return null;
}

function normalizeMonthToken(raw: string | null | undefined): number | null {
  const value = (raw || "").trim().toLowerCase();
  if (!value) return null;
  if (value.startsWith("jan")) return 0;
  if (value.startsWith("feb")) return 1;
  if (value.startsWith("mar")) return 2;
  if (value.startsWith("apr")) return 3;
  if (value === "may") return 4;
  if (value.startsWith("jun")) return 5;
  if (value.startsWith("jul")) return 6;
  if (value.startsWith("aug")) return 7;
  if (value.startsWith("sep")) return 8;
  if (value.startsWith("oct")) return 9;
  if (value.startsWith("nov")) return 10;
  if (value.startsWith("dec")) return 11;
  return null;
}

function parseWeekOfMonthPreference(text: string): WeekOfMonthPreference | null {
  const message = normalizeText(text);
  if (!message) return null;
  const match = message.match(
    /\b(first|second|third|fourth|fifth|1st|2nd|3rd|4th|5th|1|2|3|4|5)\s+week\s+(?:of|in)\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/i
  );
  if (!match) return null;
  const weekIndex = normalizeWeekOrdinalToken(match[1]);
  const monthIndex = normalizeMonthToken(match[2]);
  if (!weekIndex || monthIndex === null) return null;
  return { monthIndex, weekIndex };
}

function weekOfMonthMonSunUtc(year: number, monthIndex: number, dayOfMonth: number): number | null {
  if (!Number.isFinite(year) || year < 1970) return null;
  if (!Number.isFinite(monthIndex) || monthIndex < 0 || monthIndex > 11) return null;
  if (!Number.isFinite(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 31) return null;

  const first = new Date(Date.UTC(year, monthIndex, 1));
  const firstDow = first.getUTCDay(); // 0=Sun...6=Sat
  const daysToMonday = (8 - firstDow) % 7;
  const firstMonday = 1 + daysToMonday;
  if (dayOfMonth < firstMonday) return 0;

  return Math.floor((dayOfMonth - firstMonday) / 7) + 1;
}

function parseSlotUtcDateParts(slot: OfferedSlot): { year: number; monthIndex: number; dayOfMonth: number } | null {
  const raw = typeof slot?.datetime === "string" ? slot.datetime.trim() : "";
  if (!raw) return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return {
    year: parsed.getUTCFullYear(),
    monthIndex: parsed.getUTCMonth(),
    dayOfMonth: parsed.getUTCDate(),
  };
}

function parseTimeTokenToMinutes(token: string): number | null {
  const normalized = normalizeText(token).replace(/\s+/g, "");
  const match = normalized.match(/^(\d{1,2})(?::([0-5]\d))?(am|pm)$/);
  if (!match) return null;
  const hour12 = Number.parseInt(match[1] || "", 10);
  const minute = Number.parseInt(match[2] || "0", 10);
  const meridiem = match[3] || "";
  if (!Number.isFinite(hour12) || hour12 < 1 || hour12 > 12) return null;
  if (!Number.isFinite(minute) || minute < 0 || minute > 59) return null;
  const hour24 = meridiem === "am" ? (hour12 === 12 ? 0 : hour12) : hour12 === 12 ? 12 : hour12 + 12;
  return hour24 * 60 + minute;
}

function isMinuteWithinRange(value: number, startMinutes: number, endMinutes: number): boolean {
  if (startMinutes <= endMinutes) return value >= startMinutes && value <= endMinutes;
  return value >= startMinutes || value <= endMinutes;
}

function parseWindowRange(text: string): { startMinutes: number; endMinutes: number } | null {
  const message = normalizeText(text);
  if (!message) return null;

  const patterns = [
    /\bbetween\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm))\s*(?:and|to|-)\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm))\b/i,
    /\bfrom\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm))\s*(?:to|-)\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm))\b/i,
    /\b(\d{1,2}(?::\d{2})?)\s*-\s*(\d{1,2}(?::\d{2})?)\s*(am|pm)\b/i,
  ];

  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (!match) continue;

    const sharedMeridiem = (match[3] || "").trim().toLowerCase();
    const startRaw = `${(match[1] || "").trim()}${sharedMeridiem && !/\b(am|pm)\b/i.test(match[1] || "") ? sharedMeridiem : ""}`;
    const endRaw = `${(match[2] || "").trim()}${sharedMeridiem && !/\b(am|pm)\b/i.test(match[2] || "") ? sharedMeridiem : ""}`;
    const startMinutes = parseTimeTokenToMinutes(startRaw);
    const endMinutes = parseTimeTokenToMinutes(endRaw);
    if (startMinutes === null || endMinutes === null) continue;
    return { startMinutes, endMinutes };
  }

  return null;
}

function parseInboundWindowPreference(inboundBody: string): ParsedWindowPreference {
  const inbound = normalizeText(inboundBody);
  const dayMatch = inbound.match(WEEKDAY_PATTERN);
  const dayToken = normalizeDayToken(dayMatch?.[1] || null);
  const weekOfMonth = parseWeekOfMonthPreference(inboundBody);

  const timeOfDay = /\bmorning\b/i.test(inbound)
    ? "morning"
    : /\bafternoon\b/i.test(inbound)
      ? "afternoon"
      : /\bevening\b/i.test(inbound)
        ? "evening"
        : null;
  const range = parseWindowRange(inboundBody);

  const hasWindowSignal =
    Boolean(dayToken) ||
    Boolean(weekOfMonth) ||
    Boolean(timeOfDay) ||
    Boolean(range) ||
    /\b(today|tomorrow|this week|next week|between|after|before)\b/i.test(inbound);

  return { dayToken, weekOfMonth, timeOfDay, range, hasWindowSignal };
}

function slotMatchesWindowPreference(slot: OfferedSlot, preference: ParsedWindowPreference): boolean {
  const label = `${slot?.label || ""}`.trim();
  if (!label) return false;

  if (preference.weekOfMonth) {
    const parts = parseSlotUtcDateParts(slot);
    if (!parts) return false;
    if (parts.monthIndex !== preference.weekOfMonth.monthIndex) return false;
    const slotWeek = weekOfMonthMonSunUtc(parts.year, parts.monthIndex, parts.dayOfMonth);
    if (slotWeek !== preference.weekOfMonth.weekIndex) return false;
  }

  if (preference.dayToken) {
    const dayMatch = normalizeText(label).match(WEEKDAY_PATTERN);
    const slotDay = normalizeDayToken(dayMatch?.[1] || null);
    if (slotDay !== preference.dayToken) return false;
  }

  const slotTimes = extractTimeTokens(label);
  const slotMinute = slotTimes.length > 0 ? parseTimeTokenToMinutes(slotTimes[0] || "") : null;

  if (preference.range) {
    if (slotMinute === null) return false;
    if (!isMinuteWithinRange(slotMinute, preference.range.startMinutes, preference.range.endMinutes)) return false;
  }

  if (preference.timeOfDay) {
    if (slotMinute === null) return false;
    if (preference.timeOfDay === "morning" && !(slotMinute >= 5 * 60 && slotMinute < 12 * 60)) return false;
    if (preference.timeOfDay === "afternoon" && !(slotMinute >= 12 * 60 && slotMinute < 17 * 60)) return false;
    if (preference.timeOfDay === "evening" && !(slotMinute >= 17 * 60 && slotMinute < 21 * 60)) return false;
  }

  return true;
}

function hasOfferedSlotMatchingInboundWindow(inboundBody: string, slots: OfferedSlot[]): boolean {
  const preference = parseInboundWindowPreference(inboundBody);
  if (!preference.hasWindowSignal) return true;
  if (!Array.isArray(slots) || slots.length === 0) return false;
  return slots.some((slot) => slotMatchesWindowPreference(slot, preference));
}

function draftIncludesKnownSchedulingLink(draft: string, bookingLink: string | null, leadSchedulerLink: string | null): boolean {
  const text = normalizeText(draft);
  const known = [leadSchedulerLink, bookingLink].map((entry) => normalizeText(entry)).filter(Boolean);
  if (known.length === 0) return false;
  return known.some((link) => text.includes(link));
}

function hasWindowPreferenceWithoutExactTime(inboundBody: string): boolean {
  const inbound = normalizeText(inboundBody);
  if (!inbound) return false;
  const hasWeekOfMonth = Boolean(parseWeekOfMonthPreference(inboundBody));

  const hasWindowLanguage =
    hasWeekOfMonth ||
    /\bbetween\b/.test(inbound) ||
    /\bafter\b/.test(inbound) ||
    /\bbefore\b/.test(inbound) ||
    /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/.test(inbound) ||
    /\b(today|tomorrow|this week|next week)\b/.test(inbound);
  if (!hasWindowLanguage) return false;

  // If an explicit slot-like time is present, treat it as specific rather than broad window.
  const inboundTimes = extractTimeTokens(inboundBody);
  return inboundTimes.length === 0 || /\bbetween\b/.test(inbound) || /\bafter\b/.test(inbound) || /\bbefore\b/.test(inbound);
}

function offeredTimeTokens(slots: OfferedSlot[]): Set<string> {
  const out = new Set<string>();
  for (const slot of slots || []) {
    const merged = `${slot?.label || ""} ${slot?.datetime || ""}`;
    for (const token of extractTimeTokens(merged)) out.add(token);
  }
  return out;
}

function countOfferedTimesMentioned(draft: string, slots: OfferedSlot[]): number {
  const offered = offeredTimeTokens(slots);
  if (offered.size === 0) return 0;
  const mentioned = new Set<string>();
  for (const token of extractTimeTokens(draft || "")) {
    if (offered.has(token)) mentioned.add(token);
  }
  return mentioned.size;
}

export function buildRevisionHardConstraints(input: RevisionConstraintInput): RevisionConstraintResult {
  const failures =
    typeof input.currentDraft === "string" && input.currentDraft.trim()
      ? evaluateReplayInvariantFailures({
          inboundBody: input.inboundBody,
          draft: input.currentDraft,
          offeredSlots: input.offeredSlots || [],
          bookingLink: input.bookingLink,
          leadSchedulerLink: input.leadSchedulerLink,
        })
      : [];
  const codes = failures.map((entry) => entry.code);

  const hardRequirements: string[] = [
    "Use latest inbound message facts as source-of-truth. Do not invent or reinterpret constraints.",
    "If offering times and offered slots are provided, use slot text verbatim from provided availability.",
    "Keep timezone context consistent with lead timezone or explicit lead-stated timezone tokens.",
    "Do not imply a booking is already confirmed unless context explicitly confirms it.",
  ];
  const hardForbidden: string[] = [
    "Do not include any URL not present in provided booking_link or lead_scheduler_link context.",
    "Do not add extra sales pitch content in scheduling-focused replies.",
  ];

  if (codes.includes("slot_mismatch")) {
    hardRequirements.push("Resolve slot mismatch: only include offered slot times and remove unsupported alternatives.");
  }
  if (codes.includes("date_mismatch")) {
    hardRequirements.push("Resolve date mismatch: remove dates not present in offered availability.");
  }
  if (codes.includes("fabricated_link")) {
    hardRequirements.push("Resolve link mismatch: keep only known booking link(s) from context.");
  }
  if (codes.includes("non_logistics_reply")) {
    hardRequirements.push("Resolve logistics drift: keep reply scheduling/logistics-only.");
  }

  const preferSingleSlotForWindow =
    (input.offeredSlots || []).length > 0 && hasWindowPreferenceWithoutExactTime(input.inboundBody);
  const hasWindowMatch = hasOfferedSlotMatchingInboundWindow(input.inboundBody, input.offeredSlots || []);
  if (preferSingleSlotForWindow) {
    hardRequirements.push(
      "Lead provided a day/window preference without exact slot: propose exactly one best-matching in-window slot and ask for confirmation; do not add a second fallback option."
    );
    if (!hasWindowMatch) {
      hardRequirements.push(
        "No offered slot matches the requested window. Do not confirm an unavailable time; direct the lead to the provided scheduling link."
      );
    }
  }

  return {
    hardRequirements: dedupeStrings(hardRequirements).slice(0, 12),
    hardForbidden: dedupeStrings(hardForbidden).slice(0, 8),
    preferSingleSlotForWindow,
    currentInvariantCodes: dedupeStrings(codes),
  };
}

export function validateRevisionAgainstHardConstraints(input: RevisionConstraintInput & { draft: string }): RevisionValidationResult {
  const reasons: string[] = [];
  const failures = evaluateReplayInvariantFailures({
    inboundBody: input.inboundBody,
    draft: input.draft,
    offeredSlots: input.offeredSlots || [],
    bookingLink: input.bookingLink,
    leadSchedulerLink: input.leadSchedulerLink,
  });

  for (const failure of failures) {
    reasons.push(`[${failure.code}] ${failure.message}`);
  }

  const preferSingleSlotForWindow =
    (input.offeredSlots || []).length > 0 && hasWindowPreferenceWithoutExactTime(input.inboundBody);
  const hasWindowMatch = hasOfferedSlotMatchingInboundWindow(input.inboundBody, input.offeredSlots || []);
  if (preferSingleSlotForWindow) {
    const offeredMentions = countOfferedTimesMentioned(input.draft, input.offeredSlots || []);
    if (offeredMentions > 1) {
      reasons.push(
        "[window_over_offer] Lead provided day/window preference; draft offered multiple slot options instead of one-slot confirmation."
      );
    }

    if (!hasWindowMatch) {
      const hasKnownLink = draftIncludesKnownSchedulingLink(input.draft, input.bookingLink, input.leadSchedulerLink);
      if (!hasKnownLink) {
        reasons.push(
          "[window_no_match_link_missing] No offered slot matches the requested window; draft must direct to the provided scheduling link."
        );
      }
      if (offeredMentions > 0 || extractTimeTokens(input.draft).length > 0) {
        reasons.push(
          "[window_no_match_link_only] No offered slot matches the requested window; draft must be link-only and must not propose any times."
        );
      }
      const hasCommittalCue =
        /\b(works(?:\s+for\s+me)?|booked|confirmed|scheduled|lock(?:ed)?\s+in|calendar\s+invite)\b/i.test(input.draft);
      const mentionsTime = extractTimeTokens(input.draft).length > 0;
      if (hasCommittalCue && mentionsTime && !hasKnownLink) {
        reasons.push(
          "[window_no_match_confirmed_time] Draft confirms a concrete time even though no offered slot matches the requested window."
        );
      }
    }
  }

  return {
    passed: reasons.length === 0,
    reasons: dedupeStrings(reasons).slice(0, 12),
    invariantCodes: dedupeStrings(failures.map((failure) => failure.code)),
  };
}
