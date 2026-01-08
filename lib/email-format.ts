export function emailBisonHtmlFromPlainText(input: string): string {
  const normalized = input.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  const escaped = normalized
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

  // Preserve single and blank lines by mapping every newline to an explicit <br />.
  const withBreaks = escaped.replace(/\n/g, "<br />");

  return `<div>${withBreaks}</div>`;
}

