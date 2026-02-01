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
 * - linkified markdown-style links: [text](https://example.com)
 */
export function safeLinkifiedHtmlFromText(
  input: string,
  opts?: { linkTarget?: "_blank" | "_self" }
): string {
  const text = normalizeNewlines(input || "");
  if (!text) return "";

  // Rough URL matcher; we validate further before emitting <a>.
  const urlRegex = /\bhttps?:\/\/[^\s<>()]+/gi;
  const markdownLinkRegex = /\[([^\]\n]{1,200})\]\(([^)\s]+)\)/gi;

  type Token =
    | { kind: "url"; start: number; end: number; raw: string; url: string }
    | { kind: "md"; start: number; end: number; raw: string; label: string; url: string };

  const mdTokens: Token[] = [];
  for (const match of text.matchAll(markdownLinkRegex)) {
    const start = match.index ?? 0;
    const raw = match[0] ?? "";
    const label = match[1] ?? "";
    const url = match[2] ?? "";
    if (!raw || !label || !url) continue;
    mdTokens.push({ kind: "md", start, end: start + raw.length, raw, label, url });
  }

  const urlTokens: Token[] = [];
  for (const match of text.matchAll(urlRegex)) {
    const start = match.index ?? 0;
    const raw = match[0] ?? "";
    if (!raw) continue;
    urlTokens.push({ kind: "url", start, end: start + raw.length, raw, url: raw });
  }

  const urlTokensFiltered = urlTokens.filter((token) => {
    // Avoid double-linkifying URLs that are inside a markdown link token.
    return !mdTokens.some((md) => token.start >= md.start && token.start < md.end);
  });

  const tokens: Token[] = [...mdTokens, ...urlTokensFiltered].sort((a, b) => a.start - b.start);

  let out = "";
  let lastIndex = 0;

  for (const token of tokens) {
    if (token.start < lastIndex) continue;

    out += escapeHtmlText(text.slice(lastIndex, token.start));

    const target = opts?.linkTarget ?? "_blank";

    if (token.kind === "md") {
      const rawUrl = token.url.trim();
      const { url: strippedUrl, trailing } = stripTrailingPunctuation(rawUrl);
      const normalizedUrl = strippedUrl.startsWith("www.") ? `https://${strippedUrl}` : strippedUrl;

      if (normalizedUrl && isSafeHttpUrl(normalizedUrl)) {
        const escapedHref = escapeHtmlText(normalizedUrl);
        const escapedLabel = escapeHtmlText(token.label);
        out += `<a href="${escapedHref}" target="${target}" rel="noopener noreferrer">${escapedLabel}</a>`;
        if (trailing) out += escapeHtmlText(trailing);
      } else {
        out += escapeHtmlText(token.raw);
      }
    } else {
      const { url, trailing } = stripTrailingPunctuation(token.url);
      if (url && isSafeHttpUrl(url)) {
        const escapedUrl = escapeHtmlText(url);
        out += `<a href="${escapedUrl}" target="${target}" rel="noopener noreferrer">${escapedUrl}</a>`;
        if (trailing) out += escapeHtmlText(trailing);
      } else {
        out += escapeHtmlText(token.raw);
      }
    }

    lastIndex = token.end;
  }

  out += escapeHtmlText(text.slice(lastIndex));
  return out.replace(/\n/g, "<br />");
}
