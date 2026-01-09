// Client-safe helpers for rendering user-generated text as HTML without XSS.
// Only produces a small, controlled subset of HTML: <br /> and <a>.

function normalizeNewlines(input: string): string {
  return input.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

export function escapeHtmlText(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function stripTrailingPunctuation(url: string): { url: string; trailing: string } {
  let trimmed = url;
  let trailing = "";
  // Common punctuation that often trails URLs in prose.
  while (trimmed.length > 0) {
    const last = trimmed.at(-1)!;
    if (!".,;:!?)]}".includes(last)) break;
    trimmed = trimmed.slice(0, -1);
    trailing = last + trailing;
  }
  return { url: trimmed, trailing };
}

export function isSafeHttpUrl(input: string): boolean {
  try {
    const url = new URL(input);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Convert plain text to safe HTML with:
 * - escaped text
 * - newline preservation via <br />
 * - linkified http(s) URLs
 */
export function safeLinkifiedHtmlFromText(
  input: string,
  opts?: { linkTarget?: "_blank" | "_self" }
): string {
  const text = normalizeNewlines(input || "");
  if (!text) return "";

  // Rough URL matcher; we validate further before emitting <a>.
  const urlRegex = /\bhttps?:\/\/[^\s<>()]+/gi;

  let out = "";
  let lastIndex = 0;

  for (const match of text.matchAll(urlRegex)) {
    const index = match.index ?? 0;
    const raw = match[0] ?? "";
    if (!raw) continue;

    // Add preceding text.
    out += escapeHtmlText(text.slice(lastIndex, index));

    const { url, trailing } = stripTrailingPunctuation(raw);
    if (url && isSafeHttpUrl(url)) {
      const target = opts?.linkTarget ?? "_blank";
      const escapedUrl = escapeHtmlText(url);
      out += `<a href="${escapedUrl}" target="${target}" rel="noopener noreferrer">${escapedUrl}</a>`;
      if (trailing) out += escapeHtmlText(trailing);
    } else {
      // Fallback: render as text if it's not a safe URL.
      out += escapeHtmlText(raw);
    }

    lastIndex = index + raw.length;
  }

  out += escapeHtmlText(text.slice(lastIndex));
  return out.replace(/\n/g, "<br />");
}

