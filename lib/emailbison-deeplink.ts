import type { EmailBisonReplyMessage } from "@/lib/emailbison-api";

function parseReplyTimestampMs(reply: EmailBisonReplyMessage): number {
  const candidate = reply.date_received ?? reply.created_at ?? reply.updated_at ?? null;
  if (!candidate) return Number.NEGATIVE_INFINITY;
  const parsed = new Date(candidate).getTime();
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

export function pickEmailBisonReplyUuidForDeepLink(params: {
  replies: EmailBisonReplyMessage[] | null | undefined;
  preferredReplyId?: string | null;
}): string | null {
  const replies = Array.isArray(params.replies) ? params.replies : [];
  const preferredReplyId = (params.preferredReplyId ?? "").trim();

  if (preferredReplyId) {
    const directMatch = replies.find((reply) => {
      const replyId = String(reply.id ?? "").trim();
      const uuid = typeof reply.uuid === "string" ? reply.uuid.trim() : "";
      return replyId === preferredReplyId && uuid.length > 0;
    });
    if (directMatch?.uuid) return directMatch.uuid.trim();
  }

  let bestUuid: string | null = null;
  let bestTimestamp = Number.NEGATIVE_INFINITY;

  for (const reply of replies) {
    const uuid = typeof reply.uuid === "string" ? reply.uuid.trim() : "";
    if (!uuid) continue;
    const ts = parseReplyTimestampMs(reply);
    if (ts > bestTimestamp) {
      bestTimestamp = ts;
      bestUuid = uuid;
    }
  }

  return bestUuid;
}

