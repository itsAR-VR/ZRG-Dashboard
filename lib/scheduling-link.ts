import "server-only";

import { detectCalendarType } from "@/lib/calendar-availability";

function stripTrailingPunctuation(url: string): string {
  return url.replace(/[),.;:\]\}]+$/g, "");
}

function normalizeUrlCandidate(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const cleaned = stripTrailingPunctuation(trimmed);
  const withScheme = cleaned.startsWith("http://") || cleaned.startsWith("https://") ? cleaned : `https://${cleaned}`;

  try {
    const url = new URL(withScheme);
    return url.toString();
  } catch {
    return null;
  }
}

export function extractSchedulerLinkFromText(text: string): string | null {
  const raw = text || "";
  if (!raw.trim()) return null;

  // Quick scan for obvious calendar providers before doing more work.
  if (!/(calendly\.com|meetings\.hubspot\.com|hubspot\.com\/meetings|leadconnectorhq\.com|gohighlevel\.com|msgsndr\.com|\/widget\/booking\/|\/widget\/bookings\/)/i.test(raw)) {
    return null;
  }

  const candidates = raw.match(/https?:\/\/[^\s<>"']+|www\.[^\s<>"']+/gi) || [];
  for (const candidate of candidates) {
    const normalized = normalizeUrlCandidate(candidate);
    if (!normalized) continue;
    const type = detectCalendarType(normalized);
    if (type !== "unknown") return normalized;
  }

  return null;
}

