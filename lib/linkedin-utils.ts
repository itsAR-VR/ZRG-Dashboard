/**
 * LinkedIn URL normalization and utility functions
 */

/**
 * Normalize a LinkedIn URL to a consistent format
 * Returns: https://linkedin.com/in/username (lowercase, no trailing slash)
 * Returns null if the URL is not a valid LinkedIn profile URL
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
      // Also check for company pages which we might want to handle differently
      const companyMatch = pathname.match(/\/company\/([^/?#]+)/);
      if (companyMatch) {
        // Return company URL in normalized format
        return `https://linkedin.com/company/${companyMatch[1]}`;
      }
      return null;
    }

    const username = profileMatch[1];

    // Return normalized URL
    return `https://linkedin.com/in/${username}`;
  } catch {
    // URL parsing failed, try regex fallback
    const fallbackMatch = url.match(/linkedin\.com\/in\/([a-zA-Z0-9_-]+)/i);
    if (fallbackMatch) {
      return `https://linkedin.com/in/${fallbackMatch[1].toLowerCase()}`;
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
