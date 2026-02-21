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
  if (
    !/(calendly\.com|meetings\.hubspot\.com|hubspot\.com\/meetings|leadconnectorhq\.com|gohighlevel\.com|msgsndr\.com|\/widget\/booking\/|\/widget\/bookings\/|calendar\.google\.com\/appointments\/schedules\/|calendar\.notion\.so\/meet\/)/i.test(
      raw
    )
  ) {
    return null;
  }

  const candidates = raw.match(/https?:\/\/[^\s<>"']+|www\.[^\s<>"']+/gi) || [];
  for (const candidate of candidates) {
    const normalized = normalizeUrlCandidate(candidate);
    if (!normalized) continue;
    const type = detectCalendarType(normalized);
    if (type !== "unknown") return normalized;
    if (/calendar\.google\.com\/appointments\/schedules\//i.test(normalized)) return normalized;
    // Notion Calendar (unsupported for availability fetch today, but still a lead-provided scheduler link).
    if (/calendar\.notion\.so\/meet\//i.test(normalized)) return normalized;
  }

  return null;
}

// We only treat a lead-provided scheduler link as "explicitly shared" when the inbound
// message clearly instructs us to use it. This avoids false positives from email signatures
// that contain generic "Schedule a meeting" CTAs.
const EXPLICIT_SCHEDULER_INSTRUCTION_PATTERNS: RegExp[] = [
  /\b(feel\s+free|you\s+can|go\s+ahead(?:\s+and)?)\s+(?:to\s+)?(?:book|schedule|grab|pick|find)\b/i,
  /\b(find|pick|grab)\s+(?:a|some)?\s*time\s+here\b/i,
  /\bhere(?:'s| is)\s+my\s+(?:calendly|calendar|scheduler|scheduling\s+link|link)\b/i,
  /\b(use|book|schedule)\s+(?:via\s+)?my\s+(?:calendly|calendar|scheduler|scheduling\s+link)\b/i,
  /\b(use|book|schedule)\s+via\s+my\s+link\b/i,
];

export function hasExplicitSchedulerLinkInstruction(text: string): boolean {
  const raw = (text || "").trim();
  if (!raw) return false;
  return EXPLICIT_SCHEDULER_INSTRUCTION_PATTERNS.some((pattern) => pattern.test(raw));
}
