import { isIP } from "node:net";

export type KnowledgeAssetEditableType = "file" | "text" | "url";

export type KnowledgeAssetUpdateInput = {
  name?: string;
  textContent?: string | null;
  fileUrl?: string | null;
};

export type KnowledgeAssetUpdateData = {
  name?: string;
  textContent?: string | null;
  fileUrl?: string;
};

export function isPrivateNetworkHostname(hostname: string): boolean {
  const host = (hostname || "").toLowerCase();
  if (!host) return true;
  if (host === "localhost") return true;
  if (host.endsWith(".local")) return true;
  if (host === "0.0.0.0") return true;

  const ipKind = isIP(host);
  if (ipKind === 4) {
    const [a, b] = host.split(".").map((part) => Number.parseInt(part, 10));
    if (!Number.isFinite(a) || !Number.isFinite(b)) return true;
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
  }

  if (ipKind === 6) {
    if (host === "::1") return true;
    if (host.startsWith("fc") || host.startsWith("fd")) return true;
    if (host.startsWith("fe80")) return true;
  }

  return false;
}

export function buildKnowledgeAssetUpdateData(
  assetType: KnowledgeAssetEditableType,
  data: KnowledgeAssetUpdateInput
): { updateData: KnowledgeAssetUpdateData; error?: string } {
  const updateData: KnowledgeAssetUpdateData = {};

  if (data.name !== undefined) {
    const nextName = data.name.trim();
    if (!nextName) return { updateData, error: "Asset name is required" };
    updateData.name = nextName;
  }

  if (data.textContent !== undefined) {
    updateData.textContent = data.textContent;
  }

  if (data.fileUrl !== undefined && assetType === "url") {
    const nextUrl = (data.fileUrl || "").trim();
    if (!nextUrl) return { updateData, error: "URL is required" };

    let parsed: URL;
    try {
      parsed = new URL(nextUrl);
    } catch {
      return { updateData, error: "Invalid URL" };
    }
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return { updateData, error: "Only http(s) URLs are supported" };
    }
    if (isPrivateNetworkHostname(parsed.hostname)) {
      return { updateData, error: "URL hostname is not allowed" };
    }
    updateData.fileUrl = parsed.href;
  }

  return { updateData };
}
