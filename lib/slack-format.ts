/**
 * Slack formatting helpers.
 *
 * These are deliberately lightweight (string-only) so they can be used from
 * API routes and server-side libs without pulling in Slack SDKs.
 */

/**
 * Slack mrkdwn code blocks use triple backticks.
 * If the source text contains ``` it can prematurely close the block.
 */
export function sanitizeSlackCodeBlockText(input: string): string {
  return (input || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/```/g, "'''");
}

export function truncateSlackText(input: string, maxChars: number): string {
  const text = input || "";
  const limit = Math.max(0, maxChars);
  if (text.length <= limit) return text;
  const sliceLen = Math.max(0, limit - 4);
  return text.slice(0, sliceLen) + "\n...";
}

