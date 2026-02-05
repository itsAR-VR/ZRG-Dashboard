import "server-only";

export function stripNullBytes(text?: string | null): string | undefined {
  if (typeof text !== "string") return text ?? undefined;
  if (!text.includes("\u0000")) return text;
  return text.replace(/\u0000/g, "");
}

function stripQuotedSections(text: string): string {
  let result = text
    .split("\n")
    .filter((line) => !line.trim().startsWith(">"))
    .join("\n");

  // Common thread separators / quoted headers across clients
  const threadMarkers: RegExp[] = [
    /On .*wrote:/i,
    /^From:\s.+$/im,
    /^Sent:\s.+$/im,
    /^To:\s.+$/im,
    /^Subject:\s.+$/im,
    /^-----Original Message-----$/im,
  ];

  let earliestMarkerIndex = -1;
  for (const marker of threadMarkers) {
    const idx = result.search(marker);
    if (idx !== -1 && (earliestMarkerIndex === -1 || idx < earliestMarkerIndex)) {
      earliestMarkerIndex = idx;
    }
  }
  if (earliestMarkerIndex !== -1) {
    result = result.slice(0, earliestMarkerIndex);
  }

  // Standard signature delimiter
  const signatureIndex = result.search(/^\s*--\s*$/m);
  if (signatureIndex !== -1) {
    result = result.slice(0, signatureIndex);
  }

  // Heuristic signature trimming:
  // If the message has a clear main body and then a footer block (after a blank line)
  // that looks like a contact signature, strip the footer.
  const lines = result.split("\n");
  while (lines.length > 0 && !lines[lines.length - 1].trim()) lines.pop();

  const emailPattern = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
  const urlPattern = /\bhttps?:\/\/\S+|\bwww\.\S+/i;
  const phonePattern = /(?:\+?\d{1,3}[-.\s]?)?(?:\(\d{2,4}\)|\d{2,4})[-.\s]?\d{3,4}[-.\s]?\d{3,4}\b/;
  const signatureLabelPattern = /\b(tel|telephone|phone|mobile|cell|direct|whats\s*app|whatsapp|linkedin|website|www)\b|(?:^|\s)(t:|m:|p:|e:)\b/i;

  // Find last blank line as a separator between body and footer
  let lastBlankLine = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].trim()) {
      lastBlankLine = i;
      break;
    }
  }

  if (lastBlankLine !== -1) {
    const bodyAbove = lines.slice(0, lastBlankLine).some((l) => l.trim());
    const footer = lines.slice(lastBlankLine + 1).filter((l) => l.trim());

    if (bodyAbove && footer.length >= 2) {
      const footerText = footer.join("\n");
      const looksLikeSignature =
        emailPattern.test(footerText) ||
        urlPattern.test(footerText) ||
        phonePattern.test(footerText) ||
        signatureLabelPattern.test(footerText);

      if (looksLikeSignature) {
        lines.splice(lastBlankLine);
      }
    }
  }

  return lines.join("\n").trim();
}

function decodeBasicHtmlEntities(input: string): string {
  return input
    .replaceAll("&nbsp;", " ")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&#x27;", "'");
}

function htmlToPlain(html: string): string {
  return stripQuotedSections(
    decodeBasicHtmlEntities(
      html
        .replace(/<style[\s\S]*?<\/style>/gi, "")
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<blockquote[\s\S]*?<\/blockquote>/gi, "")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/p>/gi, "\n")
        .replace(/<\/div>/gi, "\n")
        .replace(/<[^>]+>/g, "")
    )
  );
}

function looksLikeHtml(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (!trimmed.includes("<") || !trimmed.includes(">")) return false;
  // Basic tag heuristic (avoid treating things like "<3" as HTML)
  return /<\/?[a-z][\s\S]*>/i.test(trimmed);
}

export function cleanEmailBody(
  htmlBody?: string | null,
  textBody?: string | null
): { cleaned: string; rawText?: string; rawHtml?: string } {
  const rawText = stripNullBytes(textBody);
  const isHtmlTextBody = typeof textBody === "string" && looksLikeHtml(textBody);
  const rawHtml = stripNullBytes(htmlBody ?? (isHtmlTextBody ? textBody ?? undefined : undefined));

  const source = rawText || rawHtml || "";
  if (!source.trim()) {
    return { cleaned: "", rawText, rawHtml };
  }

  const cleaned = rawText
    ? isHtmlTextBody
      ? htmlToPlain(rawText)
      : stripQuotedSections(rawText)
    : htmlToPlain(rawHtml || "");

  return {
    cleaned: stripNullBytes(cleaned.trim()) || "",
    rawText,
    rawHtml,
  };
}
