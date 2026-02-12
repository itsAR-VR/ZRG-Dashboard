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

function hasWindowPreferenceWithoutExactTime(inboundBody: string): boolean {
  const inbound = normalizeText(inboundBody);
  if (!inbound) return false;

  const hasWindowLanguage =
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
  if (preferSingleSlotForWindow) {
    hardRequirements.push(
      "Lead provided a day/window preference without exact slot: propose exactly one best-matching in-window slot and ask for confirmation; do not add a second fallback option."
    );
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
  if (preferSingleSlotForWindow) {
    const offeredMentions = countOfferedTimesMentioned(input.draft, input.offeredSlots || []);
    if (offeredMentions > 1) {
      reasons.push(
        "[window_over_offer] Lead provided day/window preference; draft offered multiple slot options instead of one-slot confirmation."
      );
    }
  }

  return {
    passed: reasons.length === 0,
    reasons: dedupeStrings(reasons).slice(0, 12),
    invariantCodes: dedupeStrings(failures.map((failure) => failure.code)),
  };
}
