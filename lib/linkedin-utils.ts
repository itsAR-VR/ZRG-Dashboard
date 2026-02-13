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
 * Merge incoming LinkedIn URL into an existing value with strict precedence.
 *
 * Rules:
 * - New profile URL always wins over existing company URL.
 * - Existing profile is preserved unless incoming is a profile replacement.
 * - Company URL can only fill a missing existing value.
 */
export function mergeLinkedInUrl(currentUrl: string | null | undefined, incomingUrl: string | null | undefined): string | null {
  if (!incomingUrl) return currentUrl ?? null;

  const current = normalizeLinkedInUrlWithKind(currentUrl);
  const incoming = normalizeLinkedInUrlWithKind(incomingUrl);

  if (!incoming.value) {
    return current.value;
  }

  if (!current.value) {
    return incoming.value;
  }

  if (current.kind === "profile" && incoming.kind === "company") {
    return current.value;
  }

  if (current.kind === "company" && incoming.kind === "profile") {
    return incoming.value;
  }

  return current.value;
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
