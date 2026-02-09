import { Prisma } from "@prisma/client";

export const DRAFT_PIPELINE_ARTIFACT_MAX_PAYLOAD_BYTES = 32 * 1024;

/**
 * Enforce a hard cap on stored JSON payloads to avoid bloating DB rows and
 * accidentally persisting large/PII-heavy blobs.
 *
 * Fail-open behavior:
 * - If payload is undefined/null -> null (skip).
 * - If payload is not JSON-serializable -> store a small error object.
 * - If payload exceeds the cap -> store a small error object.
 */
export function validateArtifactPayload(payload: unknown): Prisma.InputJsonValue | null {
  if (payload === undefined || payload === null) return null;

  let json: string;
  try {
    json = JSON.stringify(payload);
  } catch {
    return { error: "payload_not_serializable" };
  }

  const bytes = Buffer.byteLength(json, "utf8");
  if (bytes > DRAFT_PIPELINE_ARTIFACT_MAX_PAYLOAD_BYTES) {
    return { error: "payload_too_large", bytes, maxBytes: DRAFT_PIPELINE_ARTIFACT_MAX_PAYLOAD_BYTES };
  }

  // Re-parse to guarantee it is valid JSON and strip undefined / symbols / functions.
  return JSON.parse(json) as Prisma.InputJsonValue;
}

