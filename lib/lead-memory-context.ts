import "server-only";

import { prisma } from "@/lib/prisma";
import {
  estimateBytesFromText,
  estimateTokensFromBytes,
  estimateTokensFromText,
  truncateTextToTokenEstimate,
} from "@/lib/ai/token-estimate";

export const DEFAULT_LEAD_MEMORY_RETENTION_DAYS = 90;

export type LeadMemoryEntryForContext = {
  category: string | null;
  content: string | null;
  createdAt?: Date | null;
};

export type LeadMemoryTokenStats = {
  category: string | null;
  bytes: number;
  tokensEstimated: number;
  includedBytes: number;
  includedTokensEstimated: number;
  truncated: boolean;
};

export type LeadMemoryContextBuildResult = {
  context: string;
  stats: {
    maxTokens: number;
    maxEntryTokens: number;
    totalEntries: number;
    totalBytes: number;
    totalTokensEstimated: number;
    includedEntries: number;
    includedBytes: number;
    includedTokensEstimated: number;
    truncatedEntries: number;
    perEntry: LeadMemoryTokenStats[];
  };
};

function redactPotentialPii(value: string): string {
  return value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]")
    .replace(/\+?\d[\d\s().-]{7,}\d/g, "[redacted-phone]");
}

export function computeLeadMemoryExpiryDate(createdAt: Date, retentionDays = DEFAULT_LEAD_MEMORY_RETENTION_DAYS): Date {
  const safeDays = Number.isFinite(retentionDays) ? Math.max(1, Math.trunc(retentionDays)) : DEFAULT_LEAD_MEMORY_RETENTION_DAYS;
  const expiresAt = new Date(createdAt);
  expiresAt.setUTCDate(expiresAt.getUTCDate() + safeDays);
  return expiresAt;
}

export function buildLeadMemoryContextFromEntries(opts: {
  entries: LeadMemoryEntryForContext[];
  maxTokens: number;
  maxEntryTokens?: number;
  redact?: boolean;
}): LeadMemoryContextBuildResult {
  const entries = Array.isArray(opts.entries) ? opts.entries : [];
  const maxTokens = Number.isFinite(opts.maxTokens) ? Math.max(0, Math.trunc(opts.maxTokens)) : 0;
  const maxEntryTokens =
    typeof opts.maxEntryTokens === "number" && Number.isFinite(opts.maxEntryTokens)
      ? Math.max(0, Math.trunc(opts.maxEntryTokens))
      : 400;

  let remainingTokens = maxTokens;
  const sorted = [...entries].sort((a, b) => {
    const aTime = a.createdAt instanceof Date ? a.createdAt.getTime() : 0;
    const bTime = b.createdAt instanceof Date ? b.createdAt.getTime() : 0;
    return bTime - aTime;
  });

  const perEntry: LeadMemoryTokenStats[] = [];
  let totalBytes = 0;
  let totalTokensEstimated = 0;
  let includedEntries = 0;
  let includedBytes = 0;
  let includedTokensEstimated = 0;
  let truncatedEntries = 0;

  const blocks: string[] = [];

  for (const entry of sorted) {
    const rawContent = (entry.content || "").trim();
    const content = opts.redact ? redactPotentialPii(rawContent) : rawContent;
    const bytes = estimateBytesFromText(content);
    const tokensEstimated = estimateTokensFromBytes(bytes);

    totalBytes += bytes;
    totalTokensEstimated += tokensEstimated;

    if (!content) {
      perEntry.push({
        category: entry.category ?? null,
        bytes,
        tokensEstimated,
        includedBytes: 0,
        includedTokensEstimated: 0,
        truncated: false,
      });
      continue;
    }

    if (remainingTokens <= 0) {
      perEntry.push({
        category: entry.category ?? null,
        bytes,
        tokensEstimated,
        includedBytes: 0,
        includedTokensEstimated: 0,
        truncated: false,
      });
      continue;
    }

    const categoryLabel = (entry.category || "").trim() || "Note";
    const header = `[${categoryLabel}]`;
    const headerTokens = estimateTokensFromText(header) + 2;

    if (headerTokens >= remainingTokens) {
      perEntry.push({
        category: entry.category ?? null,
        bytes,
        tokensEstimated,
        includedBytes: 0,
        includedTokensEstimated: 0,
        truncated: false,
      });
      continue;
    }

    const availableTokens = Math.max(0, remainingTokens - headerTokens);
    const entryBudget = Math.min(maxEntryTokens, availableTokens);

    const truncated = truncateTextToTokenEstimate(content, entryBudget, { keep: "start" });
    const snippet = truncated.text.trim();
    if (!snippet) {
      perEntry.push({
        category: entry.category ?? null,
        bytes,
        tokensEstimated,
        includedBytes: 0,
        includedTokensEstimated: 0,
        truncated: false,
      });
      continue;
    }

    const snippetBytes = estimateBytesFromText(snippet);
    const snippetTokens = estimateTokensFromBytes(snippetBytes);
    const consumed = headerTokens + snippetTokens;
    remainingTokens = Math.max(0, remainingTokens - consumed);

    blocks.push(`${header}\n${snippet}`);

    includedEntries += 1;
    includedBytes += snippetBytes;
    includedTokensEstimated += snippetTokens + headerTokens;
    if (truncated.truncated) truncatedEntries += 1;

    perEntry.push({
      category: entry.category ?? null,
      bytes,
      tokensEstimated,
      includedBytes: snippetBytes,
      includedTokensEstimated: snippetTokens,
      truncated: truncated.truncated,
    });
  }

  return {
    context: blocks.join("\n\n"),
    stats: {
      maxTokens,
      maxEntryTokens,
      totalEntries: entries.length,
      totalBytes,
      totalTokensEstimated,
      includedEntries,
      includedBytes,
      includedTokensEstimated,
      truncatedEntries,
      perEntry,
    },
  };
}

export async function getLeadMemoryContext(opts: {
  leadId: string;
  clientId: string;
  maxTokens?: number;
  maxEntryTokens?: number;
  redact?: boolean;
  includeExpired?: boolean;
}): Promise<LeadMemoryContextBuildResult> {
  const maxTokens =
    typeof opts.maxTokens === "number" && Number.isFinite(opts.maxTokens)
      ? Math.max(0, Math.trunc(opts.maxTokens))
      : 1200;

  const maxEntryTokens =
    typeof opts.maxEntryTokens === "number" && Number.isFinite(opts.maxEntryTokens)
      ? Math.max(0, Math.trunc(opts.maxEntryTokens))
      : 400;

  if (!opts.leadId || !opts.clientId || maxTokens <= 0) {
    return buildLeadMemoryContextFromEntries({ entries: [], maxTokens, maxEntryTokens, redact: opts.redact });
  }

  const now = new Date();
  const entries = await prisma.leadMemoryEntry.findMany({
    where: {
      leadId: opts.leadId,
      clientId: opts.clientId,
      ...(opts.includeExpired
        ? {}
        : {
            OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
          }),
    },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      category: true,
      content: true,
      createdAt: true,
    },
  });

  return buildLeadMemoryContextFromEntries({
    entries,
    maxTokens,
    maxEntryTokens,
    redact: opts.redact,
  });
}
