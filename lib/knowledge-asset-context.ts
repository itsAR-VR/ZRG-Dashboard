import "server-only";

import {
  estimateBytesFromText,
  estimateTokensFromBytes,
  estimateTokensFromText,
  truncateTextToTokenEstimate,
} from "@/lib/ai/token-estimate";

export type KnowledgeAssetForContext = {
  name: string;
  type?: string | null;
  fileUrl?: string | null;
  originalFileName?: string | null;
  mimeType?: string | null;
  textContent?: string | null;
  updatedAt?: Date | null;
};

export type KnowledgeAssetTokenStats = {
  name: string;
  type: string | null;
  originalFileName: string | null;
  mimeType: string | null;
  bytes: number;
  tokensEstimated: number;
  includedBytes: number;
  includedTokensEstimated: number;
  truncated: boolean;
};

export type KnowledgeContextBuildResult = {
  context: string;
  stats: {
    maxTokens: number;
    maxAssetTokens: number;
    totalAssets: number;
    totalBytes: number;
    totalTokensEstimated: number;
    includedAssets: number;
    includedBytes: number;
    includedTokensEstimated: number;
    truncatedAssets: number;
    perAsset: KnowledgeAssetTokenStats[];
  };
};

export const PRIMARY_WEBSITE_ASSET_NAME = "Primary: Website URL";

function extractFirstUrlCandidate(input: string): string | null {
  const httpMatch = input.match(/https?:\/\/[^\s)]+/i);
  if (httpMatch?.[0]) return httpMatch[0];
  const wwwMatch = input.match(/\bwww\.[^\s)]+/i);
  if (wwwMatch?.[0]) return wwwMatch[0];
  return null;
}

export function normalizeWebsiteUrl(value: string | null | undefined): string | null {
  const raw = (value || "").trim();
  if (!raw) return null;

  const candidate = extractFirstUrlCandidate(raw) || raw;
  const withScheme = /^https?:\/\//i.test(candidate) ? candidate : `https://${candidate}`;

  try {
    const parsed = new URL(withScheme);
    if (!["http:", "https:"].includes(parsed.protocol)) return null;
    const normalized = parsed.href;
    return normalized.endsWith("/") && parsed.pathname === "/" ? normalized.slice(0, -1) : normalized;
  } catch {
    return null;
  }
}

export function extractPrimaryWebsiteUrlFromAssets(
  assets: Array<Pick<KnowledgeAssetForContext, "name" | "textContent" | "fileUrl" | "type">>
): string | null {
  const list = Array.isArray(assets) ? assets : [];
  const asset = list.find((a) => (a.name || "").trim().toLowerCase() === PRIMARY_WEBSITE_ASSET_NAME.toLowerCase());
  if (!asset) return null;

  const candidate = (asset.fileUrl || asset.textContent || "").trim();
  return normalizeWebsiteUrl(candidate);
}

export function buildKnowledgeContextFromAssets(opts: {
  assets: KnowledgeAssetForContext[];
  maxTokens: number;
  maxAssetTokens?: number;
}): KnowledgeContextBuildResult {
  const assets = Array.isArray(opts.assets) ? opts.assets : [];
  const maxAssetTokens = typeof opts.maxAssetTokens === "number" && Number.isFinite(opts.maxAssetTokens) ? Math.max(0, Math.trunc(opts.maxAssetTokens)) : 1200;
  let remainingTokens = typeof opts.maxTokens === "number" && Number.isFinite(opts.maxTokens) ? Math.max(0, Math.trunc(opts.maxTokens)) : 0;

  const sorted = [...assets].sort((a, b) => {
    const aTime = a.updatedAt instanceof Date ? a.updatedAt.getTime() : 0;
    const bTime = b.updatedAt instanceof Date ? b.updatedAt.getTime() : 0;
    return bTime - aTime;
  });

  const perAsset: KnowledgeAssetTokenStats[] = [];
  let totalBytes = 0;
  let totalTokensEstimated = 0;
  let includedAssets = 0;
  let includedBytes = 0;
  let includedTokensEstimated = 0;
  let truncatedAssets = 0;

  const blocks: string[] = [];

  for (const asset of sorted) {
    const raw = (asset.textContent || "").trim();
    const bytes = estimateBytesFromText(raw);
    const tokensEstimated = estimateTokensFromBytes(bytes);

    totalBytes += bytes;
    totalTokensEstimated += tokensEstimated;

    if (!raw) {
      perAsset.push({
        name: asset.name,
        type: asset.type ?? null,
        originalFileName: asset.originalFileName ?? null,
        mimeType: asset.mimeType ?? null,
        bytes,
        tokensEstimated,
        includedBytes: 0,
        includedTokensEstimated: 0,
        truncated: false,
      });
      continue;
    }

    if (remainingTokens <= 0) {
      perAsset.push({
        name: asset.name,
        type: asset.type ?? null,
        originalFileName: asset.originalFileName ?? null,
        mimeType: asset.mimeType ?? null,
        bytes,
        tokensEstimated,
        includedBytes: 0,
        includedTokensEstimated: 0,
        truncated: false,
      });
      continue;
    }

    const header = `[${asset.name}]`;
    const headerTokens = estimateTokensFromText(header) + 2; // label + separators
    if (headerTokens >= remainingTokens) {
      perAsset.push({
        name: asset.name,
        type: asset.type ?? null,
        originalFileName: asset.originalFileName ?? null,
        mimeType: asset.mimeType ?? null,
        bytes,
        tokensEstimated,
        includedBytes: 0,
        includedTokensEstimated: 0,
        truncated: false,
      });
      continue;
    }

    const availableTokens = Math.max(0, remainingTokens - headerTokens);
    const perAssetBudget = Math.min(maxAssetTokens, availableTokens);

    const truncated = truncateTextToTokenEstimate(raw, perAssetBudget, { keep: "start" });
    const snippet = truncated.text.trim();
    const snippetBytes = estimateBytesFromText(snippet);
    const snippetTokens = estimateTokensFromBytes(snippetBytes);

    const consumed = headerTokens + snippetTokens;
    remainingTokens = Math.max(0, remainingTokens - consumed);

    blocks.push(`${header}\n${snippet}`);

    includedAssets += 1;
    includedBytes += snippetBytes;
    includedTokensEstimated += snippetTokens + headerTokens;
    if (truncated.truncated) truncatedAssets += 1;

    perAsset.push({
      name: asset.name,
      type: asset.type ?? null,
      originalFileName: asset.originalFileName ?? null,
      mimeType: asset.mimeType ?? null,
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
      maxTokens: typeof opts.maxTokens === "number" && Number.isFinite(opts.maxTokens) ? Math.max(0, Math.trunc(opts.maxTokens)) : 0,
      maxAssetTokens,
      totalAssets: assets.length,
      totalBytes,
      totalTokensEstimated,
      includedAssets,
      includedBytes,
      includedTokensEstimated,
      truncatedAssets,
      perAsset,
    },
  };
}
