import type { CrmResponseMode } from "@prisma/client";

export const CRM_RESPONSE_TYPES = [
  "MEETING_REQUEST",
  "INFORMATION_REQUEST",
  "FOLLOW_UP_FUTURE",
  "OBJECTION",
  "OTHER",
] as const;

export type CrmResponseType = (typeof CRM_RESPONSE_TYPES)[number];

export function normalizeCrmValue(value: unknown): string | null {
  if (value == null) return null;
  const raw = typeof value === "string" ? value : String(value);
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function mapLeadStatusFromSheet(value: string | null): string | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === "qualified") return "qualified";
  if (normalized === "meeting booked") return "meeting-booked";
  if (normalized === "not interested") return "not-interested";
  if (normalized === "blacklisted") return "blacklisted";
  return "new";
}

export function mapSentimentTagFromSheet(value: string | null): string | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === "meeting requested") return "Meeting Requested";
  if (normalized === "call requested") return "Call Requested";
  if (normalized === "information requested") return "Information Requested";
  if (normalized === "objection") return "Objection";
  if (normalized === "interested") return "Interested";
  return null;
}

export function deriveCrmResponseMode(sentBy: string | null, sentByUserId: string | null): CrmResponseMode {
  if (sentBy === "ai") return "AI";
  if (sentByUserId || sentBy === "setter") return "HUMAN";
  return "UNKNOWN";
}

export function deriveCrmResponseType(opts: {
  sentimentTag: string | null;
  snoozedUntil: Date | null;
  bookedEvidence: boolean;
  now?: Date;
}): CrmResponseType {
  const tag = (opts.sentimentTag || "").trim();
  if (opts.bookedEvidence || ["Meeting Booked", "Meeting Requested", "Call Requested"].includes(tag)) {
    return "MEETING_REQUEST";
  }
  if (tag === "Information Requested") return "INFORMATION_REQUEST";
  if (tag === "Objection") return "OBJECTION";
  if (tag === "Follow Up") return "FOLLOW_UP_FUTURE";
  return "OTHER";
}
