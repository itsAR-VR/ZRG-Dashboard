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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildForbiddenTermRegex(term: string): RegExp | null {
  const trimmed = term.trim();
  if (!trimmed) return null;
  const escaped = escapeRegExp(trimmed);
  if (/\s/.test(trimmed)) {
    return new RegExp(escaped, "gi");
  }
  // Single-word terms should remove common trailing punctuation (e.g., "However, ").
  // Avoid consuming newlines so we don't collapse paragraphs.
  return new RegExp(`\\b${escaped}\\b(?:[ \\t]*[,.;:!?])?[ \\t]*`, "gi");
}

export function removeForbiddenTerms(input: string, terms: string[]): { output: string; removed: string[] } {
  if (!input.trim() || !Array.isArray(terms) || terms.length === 0) {
    return { output: input, removed: [] };
  }

  const removed: string[] = [];
  let result = input;

  for (const term of terms) {
    const regex = buildForbiddenTermRegex(term);
    if (!regex) continue;
    if (regex.test(result)) {
      result = result.replace(regex, "");
      removed.push(term);
    }
  }

  if (removed.length === 0) return { output: input, removed };

  result = result.replace(/[ \t]{2,}/g, " ");
  result = result.replace(/[ \t]+([,.;:!?])/g, "$1");
  // If a term removal leaves a line starting with punctuation (e.g., ", hello"), strip it.
  result = result.replace(/(^|\n)[,.;:!?]+[ \t]*/g, "$1");
  result = result.replace(/\n{3,}/g, "\n\n");

  return { output: result.trim(), removed };
}

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
    // Deduping can leave artifacts like "and ." when a duplicated URL was removed.
    // Clean up the most common case: "<canonical> and <removed>."
    const escapedCanonical = trimmedCanonical.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const orphanConjunction = new RegExp(`${escapedCanonical}\\s+(?:and|or)\\s+([,.;:!?])`, "gi");
    result = result.replace(orphanConjunction, `${trimmedCanonical}$1`);
    result = result.replace(/[ \t]{2,}/g, " ");
    result = result.replace(/[ \t]+([,.;:!?])/g, "$1");
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
