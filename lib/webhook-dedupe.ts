import crypto from "crypto";

/**
 * Computes a stable dedupe key for GHL SMS webhook messages.
 * Used when the webhook payload lacks a provider message ID (ghlId).
 *
 * The key is deterministic based on message-specific fields that don't change
 * across webhook retries.
 */
export function computeGhlSmsDedupeKey(params: {
  clientId: string;
  contactId: string;
  workflowId?: string | null;
  dateCreated?: string | null;
  customDate?: string | null;
  customTime?: string | null;
  messageBody: string;
}): string {
  // Normalize the message body (trim, lowercase, collapse whitespace)
  const normalizedBody = (params.messageBody || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");

  // Build a stable input string from all available fields
  const inputParts = [
    params.clientId,
    params.contactId,
    params.workflowId || "",
    params.dateCreated || "",
    params.customDate || "",
    params.customTime || "",
    normalizedBody,
  ];

  const input = inputParts.join("|");

  // Compute SHA256 hash and take first 32 chars for reasonable index size
  const hash = crypto.createHash("sha256").update(input).digest("hex").slice(0, 32);

  return `ghl_sms:${hash}`;
}
