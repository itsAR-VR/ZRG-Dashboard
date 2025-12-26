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

/**
 * Best-effort phone formatting for syncing to GHL contacts.
 *
 * GHL requires a phone on the contact to send SMS. When we only have a 10-digit national number
 * (common for US leads), we may still want to sync it. This helper prefers true E.164 inputs but
 * can fall back to an explicit default country calling code when provided.
 */
export function toGhlPhoneBestEffort(
  phone: string | null | undefined,
  opts?: { defaultCountryCallingCode?: string }
): string | null {
  const raw = phone?.trim();
  if (!raw) return null;

  const digits = normalizePhoneDigits(raw);
  if (!digits) return null;

  const normalized = stripInternationalPrefix00(digits);
  if (normalized.startsWith("0")) return null;
  if (normalized.length > 15) return null;

  // If the value already looks like it has a country code, treat it as E.164-ish.
  const looksExplicitInternational = raw.startsWith("+") || raw.startsWith("00");
  const looksLikeIncludesCountryCode = normalized.length > 10;
  if (looksExplicitInternational || looksLikeIncludesCountryCode) {
    return `+${normalized}`;
  }

  // If we only have a national-format number, only convert when a default country calling code is provided.
  if (normalized.length === 10) {
    const ccRaw = opts?.defaultCountryCallingCode?.trim();
    const ccDigits = ccRaw ? ccRaw.replace(/\D/g, "") : "";
    if (!ccDigits) return null;
    return `+${ccDigits}${normalized}`;
  }

  return null;
}

export function isSamePhone(a: string | null | undefined, b: string | null | undefined): boolean {
  const ad = normalizePhoneDigits(a);
  const bd = normalizePhoneDigits(b);
  return !!ad && !!bd && ad === bd;
}
