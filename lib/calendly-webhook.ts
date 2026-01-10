import crypto from "node:crypto";

function timingSafeEqualHex(aHex: string, bHex: string): boolean {
  const a = Buffer.from(aHex, "hex");
  const b = Buffer.from(bHex, "hex");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function timingSafeEqualBase64(aB64: string, bB64: string): boolean {
  const a = Buffer.from(aB64, "base64");
  const b = Buffer.from(bB64, "base64");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function isWithinToleranceSeconds(timestampSec: number, toleranceSec: number): boolean {
  const nowSec = Math.floor(Date.now() / 1000);
  return Math.abs(nowSec - timestampSec) <= toleranceSec;
}

function parseSignatureParts(signatureHeader: string): { timestamp?: number; signature?: string } {
  const raw = signatureHeader.trim();
  if (!raw) return {};

  // Common pattern: "t=1700000000,v1=abcdef..."
  if (raw.includes("t=") && raw.includes("v1=")) {
    const parts = new Map<string, string>();
    for (const segment of raw.split(",")) {
      const [k, v] = segment.split("=").map((s) => s.trim());
      if (!k || !v) continue;
      parts.set(k, v);
    }
    const tRaw = parts.get("t");
    const v1 = parts.get("v1");
    const t = tRaw ? Number.parseInt(tRaw, 10) : undefined;
    return {
      timestamp: Number.isFinite(t as number) ? (t as number) : undefined,
      signature: v1 || undefined,
    };
  }

  // Otherwise treat as the signature value.
  return { signature: raw };
}

export function verifyCalendlyWebhookSignature(params: {
  signingKey: string | null;
  headers: Headers;
  rawBody: string;
  toleranceSeconds?: number;
}): { ok: true } | { ok: false; reason: string } {
  const signingKey = (params.signingKey || "").trim();
  if (!signingKey) {
    return { ok: false, reason: "Missing Calendly webhook signing key" };
  }

  const signatureHeader =
    params.headers.get("calendly-webhook-signature") ||
    params.headers.get("Calendly-Webhook-Signature") ||
    params.headers.get("calendly-signature") ||
    params.headers.get("x-calendly-webhook-signature") ||
    "";

  const timestampHeader =
    params.headers.get("calendly-webhook-timestamp") ||
    params.headers.get("Calendly-Webhook-Timestamp") ||
    params.headers.get("x-calendly-webhook-timestamp") ||
    "";

  const parsed = parseSignatureParts(signatureHeader);
  const signature = (parsed.signature || "").trim();
  if (!signature) return { ok: false, reason: "Missing Calendly webhook signature header" };

  const timestamp =
    parsed.timestamp ??
    (timestampHeader.trim() ? Number.parseInt(timestampHeader.trim(), 10) : undefined);

  const tolerance = params.toleranceSeconds ?? 5 * 60;
  if (typeof timestamp === "number" && Number.isFinite(timestamp)) {
    if (!isWithinToleranceSeconds(timestamp, tolerance)) {
      return { ok: false, reason: "Webhook timestamp outside tolerance window" };
    }
  }

  const candidates: string[] = [];
  if (typeof timestamp === "number" && Number.isFinite(timestamp)) {
    candidates.push(`${timestamp}.${params.rawBody}`);
    candidates.push(`${timestamp}${params.rawBody}`);
  }
  candidates.push(params.rawBody);

  for (const message of candidates) {
    const h = crypto.createHmac("sha256", signingKey).update(message, "utf8");
    const hex = h.digest("hex");
    const b64 = Buffer.from(hex, "hex").toString("base64");

    // Signature may be hex or base64 depending on webhook implementation.
    if (/^[0-9a-f]+$/i.test(signature) && signature.length === hex.length) {
      if (timingSafeEqualHex(signature.toLowerCase(), hex.toLowerCase())) return { ok: true };
    } else {
      // Try base64
      if (timingSafeEqualBase64(signature, b64)) return { ok: true };
      // Some providers send base64 of the raw digest rather than hex→base64.
      const rawDigestB64 = crypto.createHmac("sha256", signingKey).update(message, "utf8").digest("base64");
      if (timingSafeEqualBase64(signature, rawDigestB64)) return { ok: true };
    }
  }

  return { ok: false, reason: "Invalid webhook signature" };
}

