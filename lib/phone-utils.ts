export function normalizePhoneDigits(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 7) return null;
  return digits;
}

function stripInternationalPrefix00(digits: string): string {
  if (digits.startsWith("00") && digits.length > 2) return digits.slice(2);
  return digits;
}

/**
 * Canonical storage format for phones in our DB:
 * - `+` plus sign
 * - digits only (no spaces/hyphens)
 *
 * Example: `+442085379206`
 */
export function toStoredPhone(phone: string | null | undefined): string | null {
  const digits = normalizePhoneDigits(phone);
  if (!digits) return null;
  const normalized = stripInternationalPrefix00(digits);
  return `+${normalized}`;
}

/**
 * Human-friendly international formatting used for UI + GHL upserts.
 * - Always includes a leading `+{countryCode}` when we can infer it.
 * - Uses `+1 XXX-XXX-XXXX` for NANP numbers when possible.
 */
export function toDisplayPhone(phone: string | null | undefined): string | null {
  const digits = normalizePhoneDigits(phone);
  if (!digits) return null;
  const normalized = stripInternationalPrefix00(digits);

  if (normalized.length <= 10) return `+${normalized}`;

  // Heuristic: many of our numbers are in E.164 with a ~10-digit national component.
  const ccLen = Math.min(3, Math.max(1, normalized.length - 10));
  const countryCode = normalized.slice(0, ccLen);
  const national = normalized.slice(ccLen);

  if (countryCode === "1" && national.length === 10) {
    return `+1 ${national.slice(0, 3)}-${national.slice(3, 6)}-${national.slice(6)}`;
  }

  return `+${countryCode} ${national}`;
}

export function toGhlPhone(phone: string | null | undefined): string | null {
  return toDisplayPhone(phone);
}

export function isSamePhone(a: string | null | undefined, b: string | null | undefined): boolean {
  const ad = normalizePhoneDigits(a);
  const bd = normalizePhoneDigits(b);
  return !!ad && !!bd && ad === bd;
}

