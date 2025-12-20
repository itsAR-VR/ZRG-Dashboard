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
 * Storage format for phones in our DB:
 * - Prefer E.164 (`+` + digits) when a country calling code is present/likely.
 * - Otherwise store digits-only (national format) to avoid inventing invalid country codes.
 */
export function toStoredPhone(phone: string | null | undefined): string | null {
  const raw = phone?.trim();
  if (!raw) return null;
  const digits = normalizePhoneDigits(raw);
  if (!digits) return null;
  const normalized = stripInternationalPrefix00(digits);

  // Numbers with a leading 0 are almost always national-format (trunk prefix),
  // so we store digits-only rather than inventing a bogus `+0...` E.164 number.
  if (normalized.startsWith("0")) return normalized;

  const looksExplicitInternational = raw.startsWith("+") || raw.startsWith("00");
  const looksLikeIncludesCountryCode = normalized.length > 10;

  if (looksExplicitInternational || looksLikeIncludesCountryCode) {
    return `+${normalized}`;
  }

  return normalized;
}

/**
 * Human-friendly international formatting used for UI + GHL upserts.
 * - Always includes a leading `+{countryCode}` when we can infer it.
 * - Uses `+1 XXX-XXX-XXXX` for NANP numbers when possible.
 */
export function toDisplayPhone(phone: string | null | undefined): string | null {
  const raw = phone?.trim();
  if (!raw) return null;
  const digits = normalizePhoneDigits(raw);
  if (!digits) return null;
  const normalized = stripInternationalPrefix00(digits);

  // If we don't have a country calling code, don't pretend we do.
  if (normalized.startsWith("0") || normalized.length <= 10) {
    return raw;
  }

  // Common case: NANP with explicit country code.
  if (normalized.length === 11 && normalized.startsWith("1")) {
    const national = normalized.slice(1);
    return `+1 ${national.slice(0, 3)}-${national.slice(3, 6)}-${national.slice(6)}`;
  }

  // Fallback: show E.164-ish without guessing country code length.
  return `+${normalized}`;
}

export function toGhlPhone(phone: string | null | undefined): string | null {
  const raw = phone?.trim();
  if (!raw) return null;

  const digits = normalizePhoneDigits(raw);
  if (!digits) return null;

  const normalized = stripInternationalPrefix00(digits);

  // Avoid sending invalid E.164 numbers like `+0...`.
  if (normalized.startsWith("0")) return null;
  if (normalized.length > 15) return null;

  const looksExplicitInternational = raw.startsWith("+") || raw.startsWith("00");
  const looksLikeIncludesCountryCode = normalized.length > 10;
  if (!looksExplicitInternational && !looksLikeIncludesCountryCode) return null;

  return `+${normalized}`;
}

export function isSamePhone(a: string | null | undefined, b: string | null | undefined): boolean {
  const ad = normalizePhoneDigits(a);
  const bd = normalizePhoneDigits(b);
  return !!ad && !!bd && ad === bd;
}
