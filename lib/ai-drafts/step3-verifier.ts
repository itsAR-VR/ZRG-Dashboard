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

export function enforceCanonicalBookingLink(
  draft: string,
  canonicalBookingLink: string | null,
  opts?: { replaceAllUrls?: boolean }
): string {
  const trimmedCanonical = (canonicalBookingLink || "").trim();
  const hasCanonical = Boolean(trimmedCanonical);

  let result = draft;

  if (SCHEDULING_LINK_PLACEHOLDER_REGEX.test(result)) {
    result = result.replace(SCHEDULING_LINK_PLACEHOLDER_REGEX, hasCanonical ? trimmedCanonical : "");
  }

  if (SCHEDULING_LINK_URL_REGEX.test(result)) {
    result = result.replace(SCHEDULING_LINK_URL_REGEX, hasCanonical ? trimmedCanonical : "");
  }

  if (GHL_WIDGET_BOOKING_URL_REGEX.test(result)) {
    result = result.replace(GHL_WIDGET_BOOKING_URL_REGEX, hasCanonical ? trimmedCanonical : "");
  }

  if (opts?.replaceAllUrls && hasCanonical && ANY_HTTP_URL_REGEX.test(result)) {
    result = result.replace(ANY_HTTP_URL_REGEX, trimmedCanonical);
  }

  return result;
}
