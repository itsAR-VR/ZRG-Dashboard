export function replaceEmDashesWithCommaSpace(input: string): string {
  if (!input.includes("—")) return input;

  let result = input.replace(/\u2014/g, ", ");
  result = result.replace(/\s+,/g, ",");
  result = result.replace(/, {2,}/g, ", ");
  return result;
}

const SCHEDULING_LINK_PLACEHOLDER_REGEX = /\[(?:calendly|calendar|booking|scheduling)\s+link\]/gi;
// Avoid capturing trailing punctuation (common in sentences like "... here: <url>.").
const SCHEDULING_LINK_URL_REGEX =
  /\bhttps?:\/\/(?:www\.)?(?:calendly\.com|cal\.com)\/[^\s)<>\]]*[^\s)<>\].,!?]/gi;
const GHL_WIDGET_BOOKING_URL_REGEX =
  /\bhttps?:\/\/[^\s)<>\]]*\/widget\/booking(?:s)?\/[^\s)<>\]]*[^\s)<>\].,!?]/gi;
const ANY_HTTP_URL_REGEX = /\bhttps?:\/\/[^\s)<>\]]*[^\s)<>\].,!?]/gi;

// Matches markdown links where the display text is also a URL: [https://...](https://...)
// This pattern causes visual duplication in rendered output.
const MARKDOWN_LINK_WITH_URL_TEXT_REGEX =
  /\[(https?:\/\/[^\]]+)\]\((https?:\/\/[^)]+)\)/gi;

export function enforceCanonicalBookingLink(
  draft: string,
  canonicalBookingLink: string | null,
  opts?: { replaceAllUrls?: boolean }
): string {
  const trimmedCanonical = (canonicalBookingLink || "").trim();
  const hasCanonical = Boolean(trimmedCanonical);

  let result = draft;

  // Step 1: Collapse markdown links where display text is a URL [url](url) → single URL
  // This prevents visual duplication (e.g., seeing the link twice in rendered output).
  result = result.replace(MARKDOWN_LINK_WITH_URL_TEXT_REGEX, (_match, displayUrl, hrefUrl) => {
    // If we have a canonical booking link, use it; otherwise use the href URL.
    if (hasCanonical) {
      return trimmedCanonical;
    }
    // Prefer the href URL since it's the actual link destination.
    return hrefUrl || displayUrl || "";
  });

  // Step 2: Replace placeholder text like [calendly link]
  if (SCHEDULING_LINK_PLACEHOLDER_REGEX.test(result)) {
    result = result.replace(SCHEDULING_LINK_PLACEHOLDER_REGEX, hasCanonical ? trimmedCanonical : "");
  }

  // Step 3: Replace scheduling URLs (Calendly, Cal.com)
  if (SCHEDULING_LINK_URL_REGEX.test(result)) {
    result = result.replace(SCHEDULING_LINK_URL_REGEX, hasCanonical ? trimmedCanonical : "");
  }

  // Step 4: Replace GHL widget booking URLs
  if (GHL_WIDGET_BOOKING_URL_REGEX.test(result)) {
    result = result.replace(GHL_WIDGET_BOOKING_URL_REGEX, hasCanonical ? trimmedCanonical : "");
  }

  // Step 5: Replace all URLs if public override is set
  if (opts?.replaceAllUrls && hasCanonical && ANY_HTTP_URL_REGEX.test(result)) {
    result = result.replace(ANY_HTTP_URL_REGEX, trimmedCanonical);
  }

  // Step 6: Deduplicate - ensure only ONE booking link appears in the final draft.
  // If the canonical link appears multiple times, keep only the first occurrence.
  if (hasCanonical) {
    result = deduplicateBookingLink(result, trimmedCanonical);
  }

  return result;
}

/**
 * Ensures only one instance of the booking link appears in the draft.
 * Keeps the first occurrence and removes subsequent duplicates.
 */
function deduplicateBookingLink(draft: string, bookingLink: string): string {
  if (!bookingLink) return draft;

  // Escape special regex characters in the booking link for safe matching
  const escapedLink = bookingLink.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const linkRegex = new RegExp(escapedLink, "gi");

  let firstOccurrence = true;
  return draft.replace(linkRegex, (match) => {
    if (firstOccurrence) {
      firstOccurrence = false;
      return match;
    }
    // Remove subsequent occurrences
    return "";
  });
}
