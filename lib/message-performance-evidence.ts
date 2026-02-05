import "server-only";

import { prisma } from "@/lib/prisma";
import type {
  MessagePerformanceAttribution,
  MessagePerformanceOutcome,
  MessagePerformanceRow,
  MessagePerformanceSender,
} from "@/lib/message-performance";

export type MessagePerformanceEvidenceSample = {
  messageId: string;
  leadId: string;
  channel: string;
  sentBy: MessagePerformanceSender;
  outcome: MessagePerformanceOutcome;
  attributionType: MessagePerformanceAttribution;
  sentAt: string;
  snippet: string;
};

function redactMessageSnippet(value: string): string {
  return value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]")
    .replace(/\+?\d[\d\s().-]{7,}\d/g, "[redacted-phone]")
    .replace(/https?:\/\/\S+/gi, "[redacted-url]")
    .replace(/\bwww\.\S+/gi, "[redacted-url]");
}

function normalizeSnippet(value: string, maxChars: number): string {
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (trimmed.length <= maxChars) return trimmed;
  return `${trimmed.slice(0, maxChars)}…`;
}

export async function buildMessagePerformanceEvidenceSample(opts: {
  clientId: string;
  rows: MessagePerformanceRow[];
  attributionType?: MessagePerformanceAttribution;
  maxPerBucket?: number;
  maxTotal?: number;
  maxSnippetChars?: number;
}): Promise<{ samples: MessagePerformanceEvidenceSample[]; selectedRows: MessagePerformanceRow[] }> {
  const maxPerBucket = Math.max(1, Math.trunc(opts.maxPerBucket ?? 3));
  const maxTotal = Math.max(1, Math.trunc(opts.maxTotal ?? 24));
  const maxSnippetChars = Math.max(80, Math.trunc(opts.maxSnippetChars ?? 320));

  const filtered = opts.attributionType
    ? opts.rows.filter((row) => row.attributionType === opts.attributionType)
    : opts.rows;

  const sorted = [...filtered].sort((a, b) => b.messageSentAt.getTime() - a.messageSentAt.getTime());

  const buckets = new Map<string, MessagePerformanceRow[]>();
  for (const row of sorted) {
    const bucketKey = `${row.sentBy}:${row.outcome}`;
    const bucket = buckets.get(bucketKey) ?? [];
    if (bucket.length < maxPerBucket) {
      bucket.push(row);
      buckets.set(bucketKey, bucket);
    }
  }

  const selectedRows: MessagePerformanceRow[] = [];
  for (const bucket of buckets.values()) {
    for (const row of bucket) {
      if (selectedRows.length >= maxTotal) break;
      selectedRows.push(row);
    }
  }

  const messageIds = selectedRows.map((row) => row.messageId);
  const messages = messageIds.length
    ? await prisma.message.findMany({
        where: { id: { in: messageIds }, lead: { clientId: opts.clientId } },
        select: { id: true, leadId: true, body: true, sentAt: true },
      })
    : [];

  const messageMap = new Map(messages.map((m) => [m.id, m]));

  const samples: MessagePerformanceEvidenceSample[] = selectedRows
    .map((row) => {
      const message = messageMap.get(row.messageId);
      if (!message) return null;
      const snippet = normalizeSnippet(redactMessageSnippet(message.body || ""), maxSnippetChars);
      return {
        messageId: row.messageId,
        leadId: row.leadId,
        channel: row.channel,
        sentBy: row.sentBy,
        outcome: row.outcome,
        attributionType: row.attributionType,
        sentAt: (message.sentAt ?? row.messageSentAt).toISOString(),
        snippet,
      };
    })
    .filter(Boolean) as MessagePerformanceEvidenceSample[];

  return { samples, selectedRows };
}
