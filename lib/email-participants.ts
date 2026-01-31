/**
 * Email participant formatting and validation utilities
 * Phase 50: Email CC/Participant Visibility
 */

export interface EmailParticipant {
  email: string;
  name?: string | null;
}

/**
 * Format a participant as "Name <email>" or just "email" if no name
 */
export function formatEmailParticipant(
  email: string,
  name?: string | null
): string {
  if (name && name.trim()) {
    return `${name.trim()} <${email}>`;
  }
  return email;
}

/**
 * Format a participant object
 */
export function formatParticipant(participant: EmailParticipant): string {
  return formatEmailParticipant(participant.email, participant.name);
}

/**
 * Format a CC list for display
 * Shows first N emails, then "+M more" for longer lists
 */
export function formatCcList(cc: string[], maxDisplay: number = 2): string {
  if (cc.length === 0) return "";
  if (cc.length <= maxDisplay) return cc.join(", ");
  return `${cc.slice(0, maxDisplay).join(", ")} +${cc.length - maxDisplay} more`;
}

/**
 * Validate email format (basic validation)
 */
export function validateEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

/**
 * Parse email addresses from various formats
 * Handles: "email@example.com", "Name <email@example.com>", etc.
 */
export function parseEmailAddress(input: string): EmailParticipant | null {
  const trimmed = input.trim();

  // Try "Name <email>" format
  const angleMatch = trimmed.match(/^(.+?)\s*<([^>]+)>$/);
  if (angleMatch) {
    const name = angleMatch[1].trim();
    const email = angleMatch[2].trim();
    if (validateEmail(email)) {
      return { email, name: name || null };
    }
  }

  // Try plain email
  if (validateEmail(trimmed)) {
    return { email: trimmed, name: null };
  }

  return null;
}

/**
 * Deduplicate email list (case-insensitive)
 */
export function deduplicateEmails(emails: string[]): string[] {
  const seen = new Set<string>();
  return emails.filter((email) => {
    const lower = email.toLowerCase().trim();
    if (seen.has(lower)) return false;
    seen.add(lower);
    return true;
  });
}

/**
 * Normalize email: lowercase and trim
 */
export function normalizeEmail(email: string): string {
  return email.toLowerCase().trim();
}

/**
 * Normalize optional email: lowercase + trim, or null if empty
 */
export function normalizeOptionalEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const normalized = email.toLowerCase().trim();
  return normalized.length > 0 ? normalized : null;
}

/**
 * Check if two emails match (case-insensitive, trimmed)
 */
export function emailsMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const normA = normalizeOptionalEmail(a);
  const normB = normalizeOptionalEmail(b);
  if (!normA || !normB) return false;
  return normA === normB;
}

/**
 * Detect if an inbound email came from a CC'd person (not the original lead)
 */
export function detectCcReplier(params: {
  leadEmail: string | null | undefined;
  inboundFromEmail: string | null | undefined;
}): { isCcReplier: boolean } {
  const leadEmail = normalizeOptionalEmail(params.leadEmail);
  const inboundFromEmail = normalizeOptionalEmail(params.inboundFromEmail);
  if (!leadEmail || !inboundFromEmail) return { isCcReplier: false };
  return { isCcReplier: leadEmail !== inboundFromEmail };
}

/**
 * Extract first name from a full name string
 */
export function extractFirstName(fullName: string | null | undefined): string | null {
  const trimmed = (fullName || "").trim();
  if (!trimmed) return null;
  const firstSpace = trimmed.indexOf(" ");
  return firstSpace > 0 ? trimmed.slice(0, firstSpace) : trimmed;
}

/**
 * Build the alternate emails array, adding a new email if not already present.
 * Ensures normalization and excludes the current primary email.
 */
export function addToAlternateEmails(
  existingAlternates: string[],
  newEmail: string | null | undefined,
  primaryEmail: string | null | undefined
): string[] {
  const normalizedPrimary = normalizeOptionalEmail(primaryEmail);
  const normalizedNew = normalizeOptionalEmail(newEmail);
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of existingAlternates || []) {
    const normalized = normalizeOptionalEmail(value);
    if (!normalized) continue;
    if (normalizedPrimary && normalized === normalizedPrimary) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }

  if (normalizedNew && (!normalizedPrimary || normalizedNew !== normalizedPrimary) && !seen.has(normalizedNew)) {
    result.push(normalizedNew);
  }

  return result;
}

/**
 * Server-side CC validation and normalization
 * - Validates format
 * - Normalizes to lowercase
 * - Deduplicates
 * - Enforces max limit
 */
export function sanitizeCcList(
  cc: string[],
  maxCc: number = 20
): { valid: string[]; invalid: string[] } {
  const valid: string[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();

  for (const raw of cc) {
    const email = raw.trim().toLowerCase();
    if (!email) continue;

    if (!validateEmail(email)) {
      invalid.push(raw);
      continue;
    }

    if (seen.has(email)) continue;
    seen.add(email);

    if (valid.length < maxCc) {
      valid.push(email);
    }
  }

  return { valid, invalid };
}
