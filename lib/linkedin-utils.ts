/**
 * LinkedIn URL normalization and utility functions
 */

/**
 * Normalize a LinkedIn URL to profile-only format.
 * Returns https://linkedin.com/in/username (lowercase, no trailing slash)
 * Returns null if the URL is not a profile URL.
 */
export function normalizeLinkedInUrl(url: string | null | undefined): string | null {
  if (!url) return null;

  try {
    // Trim whitespace
    let cleaned = url.trim();

    // Handle mobile deep links (linkedin://in/username)
    if (cleaned.startsWith("linkedin://")) {
      cleaned = cleaned.replace("linkedin://", "https://linkedin.com/");
    }

    // Ensure URL has a protocol
    if (!cleaned.startsWith("http://") && !cleaned.startsWith("https://")) {
      cleaned = "https://" + cleaned;
    }

    // Parse the URL
    const parsed = new URL(cleaned);

    // Check if it's a LinkedIn domain
    const hostname = parsed.hostname.toLowerCase();
    if (!hostname.includes("linkedin.com")) {
      return null;
    }

    // Extract the pathname
    let pathname = parsed.pathname.toLowerCase();

    // Check if it's a profile URL (/in/username)
    const profileMatch = pathname.match(/\/in\/([^/?#]+)/);
    if (!profileMatch) {
      return null;
    }

    const username = profileMatch[1];

    // Return normalized URL
    return `https://linkedin.com/in/${username}`;
  } catch {
    // URL parsing failed, try profile regex fallback
    const fallbackMatch = url.match(/linkedin\.com\/in\/([a-zA-Z0-9_-]+)/i);
    if (fallbackMatch) {
      return `https://linkedin.com/in/${fallbackMatch[1].toLowerCase()}`;
    }
    return null;
  }
}

type LinkedInUrlKind = "profile" | "company" | "other";

/**
 * Normalize a LinkedIn URL and classify its type.
 * Returns both the normalized URL and whether it is a profile or company page.
 */
function normalizeLinkedInUrlWithKind(url: string | null | undefined): { kind: LinkedInUrlKind; value: string | null } {
  const normalized = normalizeLinkedInUrlAny(url);
  if (!normalized) {
    return { kind: "other", value: null };
  }

  if (/\/company\//i.test(normalized)) {
    return { kind: "company", value: normalized };
  }

  if (/\/in\//i.test(normalized)) {
    return { kind: "profile", value: normalized };
  }

  return { kind: "other", value: normalized };
}

/**
 * Classify and split a LinkedIn URL into profile/company variants.
 * Use this when writing to Lead.linkedinUrl (profile-only) and Lead.linkedinCompanyUrl.
 */
export function classifyLinkedInUrl(
  url: string | null | undefined
): { profileUrl: string | null; companyUrl: string | null } {
  const normalized = normalizeLinkedInUrlWithKind(url);

  if (!normalized.value) {
    return { profileUrl: null, companyUrl: null };
  }

  if (normalized.kind === "profile") {
    return { profileUrl: normalized.value, companyUrl: null };
  }

  if (normalized.kind === "company") {
    return { profileUrl: null, companyUrl: normalized.value };
  }

  return { profileUrl: null, companyUrl: null };
}

/**
 * Merge incoming LinkedIn profile URL into the profile field.
 *
 * Rules:
 * - Existing profile URL is preserved (fill-only).
 * - Only profile URLs are considered.
 * - Company URLs are ignored here; use mergeLinkedInCompanyUrl instead.
 */
export function mergeLinkedInUrl(currentUrl: string | null | undefined, incomingUrl: string | null | undefined): string | null {
  const current = classifyLinkedInUrl(currentUrl).profileUrl;
  const incoming = classifyLinkedInUrl(incomingUrl).profileUrl;

  if (current) return current;
  return incoming;
}

/**
 * Merge incoming LinkedIn company URL into the dedicated company field.
 *
 * Rules:
 * - Fill-only: never overwrite an existing company URL.
 * - Never stores profile URLs.
 */
export function mergeLinkedInCompanyUrl(
  currentCompanyUrl: string | null | undefined,
  incomingUrl: string | null | undefined
): string | null {
  const current = classifyLinkedInUrl(currentCompanyUrl).companyUrl;
  if (current) return current;
  return classifyLinkedInUrl(incomingUrl).companyUrl;
}

type LinkedInFieldMergeInput = {
  currentProfileUrl?: string | null;
  currentCompanyUrl?: string | null;
  incomingUrl?: string | null;
  incomingProfileUrl?: string | null;
  incomingCompanyUrl?: string | null;
};

/**
 * Merge profile/company LinkedIn fields with repair semantics.
 *
 * Repair rule:
 * - If the current profile field actually contains a company URL, preserve it in company field.
 * - If a valid incoming profile URL arrives later, it replaces the invalid company value in profile field.
 */
export function mergeLinkedInFields(input: LinkedInFieldMergeInput): {
  profileUrl: string | null;
  companyUrl: string | null;
} {
  const currentProfile = classifyLinkedInUrl(input.currentProfileUrl);
  const currentCompany = classifyLinkedInUrl(input.currentCompanyUrl);
  const incomingAny = classifyLinkedInUrl(input.incomingUrl);
  const incomingProfile = classifyLinkedInUrl(input.incomingProfileUrl);
  const incomingCompany = classifyLinkedInUrl(input.incomingCompanyUrl);

  const mergedProfile = currentProfile.profileUrl || incomingProfile.profileUrl || incomingAny.profileUrl;
  const mergedCompany =
    currentCompany.companyUrl ||
    currentProfile.companyUrl ||
    incomingCompany.companyUrl ||
    incomingProfile.companyUrl ||
    incomingAny.companyUrl;

  return {
    profileUrl: mergedProfile || null,
    companyUrl: mergedCompany || null,
  };
}

function collectLinkedInValueCandidates(value: unknown, out: string[], depth: number): void {
  if (depth > 3 || value == null) return;

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed) out.push(trimmed);
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectLinkedInValueCandidates(item, out, depth + 1);
    }
    return;
  }

  if (typeof value === "object") {
    for (const nested of Object.values(value as Record<string, unknown>)) {
      collectLinkedInValueCandidates(nested, out, depth + 1);
    }
  }
}

/**
 * Scan arbitrary values and pick first profile/company LinkedIn URLs found.
 * Useful for webhook/custom-variable payloads where key names are inconsistent.
 */
export function extractLinkedInUrlsFromValues(values: unknown[]): {
  profileUrl: string | null;
  companyUrl: string | null;
} {
  const candidates: string[] = [];
  for (const value of values) {
    collectLinkedInValueCandidates(value, candidates, 0);
  }

  let profileUrl: string | null = null;
  let companyUrl: string | null = null;

  for (const candidate of candidates) {
    if (!candidate.toLowerCase().includes("linkedin")) continue;
    const classified = classifyLinkedInUrl(candidate);
    if (!profileUrl && classified.profileUrl) profileUrl = classified.profileUrl;
    if (!companyUrl && classified.companyUrl) companyUrl = classified.companyUrl;
    if (profileUrl && companyUrl) break;
  }

  return { profileUrl, companyUrl };
}

/**
 * Normalize any LinkedIn URL (profile or company) to a consistent format.
 * Preserved for compatibility in places that intentionally need company links.
 */
export function normalizeLinkedInUrlAny(url: string | null | undefined): string | null {
  if (!url) return null;

  try {
    // Trim whitespace
    let cleaned = url.trim();

    // Handle mobile deep links (linkedin://in/username)
    if (cleaned.startsWith("linkedin://")) {
      cleaned = cleaned.replace("linkedin://", "https://linkedin.com/");
    }

    // Ensure URL has a protocol
    if (!cleaned.startsWith("http://") && !cleaned.startsWith("https://")) {
      cleaned = "https://" + cleaned;
    }

    const parsed = new URL(cleaned);
    const hostname = parsed.hostname.toLowerCase();
    if (!hostname.includes("linkedin.com")) {
      return null;
    }

    let pathname = parsed.pathname.toLowerCase();

    const profileMatch = pathname.match(/\/in\/([^/?#]+)/);
    if (profileMatch) {
      return `https://linkedin.com/in/${profileMatch[1]}`;
    }

    const companyMatch = pathname.match(/\/company\/([^/?#]+)/);
    if (companyMatch) {
      return `https://linkedin.com/company/${companyMatch[1]}`;
    }

    return null;
  } catch {
    const profileMatch = url.match(/linkedin\.com\/in\/([a-zA-Z0-9_-]+)/i);
    if (profileMatch) {
      return `https://linkedin.com/in/${profileMatch[1].toLowerCase()}`;
    }

    const fallbackCompanyMatch = url.match(/linkedin\.com\/company\/([a-zA-Z0-9_-]+)/i);
    if (fallbackCompanyMatch) {
      return `https://linkedin.com/company/${fallbackCompanyMatch[1].toLowerCase()}`;
    }

    return null;
  }
}

/**
 * Extract username from a LinkedIn profile URL
 */
export function extractLinkedInUsername(url: string | null | undefined): string | null {
  const normalized = normalizeLinkedInUrl(url);
  if (!normalized) return null;

  const match = normalized.match(/\/in\/([^/?#]+)/);
  return match ? match[1] : null;
}

/**
 * Check if a string looks like a LinkedIn URL
 */
export function isLinkedInUrl(text: string | null | undefined): boolean {
  if (!text) return false;
  return /linkedin\.com\/in\//i.test(text);
}

/**
 * Extract LinkedIn URL from a text block (e.g., email signature)
 * Returns the first LinkedIn profile URL found, or null
 */
export function extractLinkedInUrlFromText(text: string | null | undefined): string | null {
  if (!text) return null;

  // Match various LinkedIn URL formats in text
  const patterns = [
    // Full URLs with protocol
    /https?:\/\/(?:www\.)?linkedin\.com\/in\/[a-zA-Z0-9_-]+/gi,
    // URLs without protocol
    /(?:www\.)?linkedin\.com\/in\/[a-zA-Z0-9_-]+/gi,
  ];

  for (const pattern of patterns) {
    const matches = text.match(pattern);
    if (matches && matches.length > 0) {
      return normalizeLinkedInUrl(matches[0]);
    }
  }

  return null;
}
