import type { CrmResponseMode } from "@prisma/client";

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
  if (normalized === "interested") return "Interested";
  return null;
}

export function deriveCrmResponseMode(sentBy: string | null, sentByUserId: string | null): CrmResponseMode {
  if (sentBy === "ai") return "AI";
  if (sentByUserId || sentBy === "setter") return "HUMAN";
  return "UNKNOWN";
}
