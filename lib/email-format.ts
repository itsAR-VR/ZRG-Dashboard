import { safeLinkifiedHtmlFromText } from "@/lib/safe-html";

export function emailBisonHtmlFromPlainText(input: string): string {
  return `<div>${safeLinkifiedHtmlFromText(input, { linkTarget: "_blank" })}</div>`;
}
