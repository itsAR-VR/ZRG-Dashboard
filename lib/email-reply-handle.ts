type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

function base64UrlEncode(value: string): string {
  return Buffer.from(value, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64UrlDecode(value: string): string {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  return Buffer.from(padded, "base64").toString("utf8");
}

function safeJsonParse(value: string): JsonValue | null {
  try {
    return JSON.parse(value) as JsonValue;
  } catch {
    return null;
  }
}

type SmartLeadReplyHandleV1 = {
  campaignId: string;
  statsId: string | null;
  messageId: string | null;
  toEmail: string | null;
  // Optional: included only to keep handles unique under provider retry/dup conditions.
  eventTimestamp?: number | null;
  dedupeKey?: string | null;
};

type InstantlyReplyHandleV1 = {
  replyToUuid: string;
  eaccount: string;
  // Optional: included only to keep handles unique under provider retry/dup conditions.
  eventTimestamp?: number | null;
  dedupeKey?: string | null;
};

export function encodeSmartLeadReplyHandle(data: SmartLeadReplyHandleV1): string {
  return `smartlead:${base64UrlEncode(JSON.stringify(data))}`;
}

export function decodeSmartLeadReplyHandle(value: string): SmartLeadReplyHandleV1 | null {
  if (typeof value !== "string") return null;
  if (!value.startsWith("smartlead:")) return null;
  const encoded = value.slice("smartlead:".length);
  const decoded = base64UrlDecode(encoded);
  const parsed = safeJsonParse(decoded);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const obj = parsed as Record<string, JsonValue>;

  const campaignId = typeof obj.campaignId === "string" ? obj.campaignId.trim() : "";
  if (!campaignId) return null;

  const statsId = typeof obj.statsId === "string" ? obj.statsId.trim() : null;
  const messageId = typeof obj.messageId === "string" ? obj.messageId.trim() : null;
  const toEmail = typeof obj.toEmail === "string" ? obj.toEmail.trim() : null;

  return {
    campaignId,
    statsId: statsId || null,
    messageId: messageId || null,
    toEmail: toEmail || null,
  };
}

export function encodeInstantlyReplyHandle(data: InstantlyReplyHandleV1): string {
  return `instantly:${base64UrlEncode(JSON.stringify(data))}`;
}

export function decodeInstantlyReplyHandle(value: string): InstantlyReplyHandleV1 | null {
  if (typeof value !== "string") return null;
  if (!value.startsWith("instantly:")) return null;
  const encoded = value.slice("instantly:".length);
  const decoded = base64UrlDecode(encoded);
  const parsed = safeJsonParse(decoded);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const obj = parsed as Record<string, JsonValue>;

  const replyToUuid = typeof obj.replyToUuid === "string" ? obj.replyToUuid.trim() : "";
  const eaccount = typeof obj.eaccount === "string" ? obj.eaccount.trim() : "";
  if (!replyToUuid || !eaccount) return null;

  return { replyToUuid, eaccount };
}
