/** @type {import('next').NextConfig} */
function parseServerActionsAllowedOrigins() {
  const origins = new Set();

  const raw = process.env.SERVER_ACTIONS_ALLOWED_ORIGINS;
  if (raw) {
    for (const part of raw.split(",")) {
      const value = part.trim();
      if (value) origins.add(value);
    }
  }

  const addFromUrlLike = (value) => {
    if (!value) return;
    try {
      // Accept either a full URL or a bare hostname.
      const url = new URL(value.includes("://") ? value : `https://${value}`);
      if (url.hostname) origins.add(url.hostname);
    } catch {
      // Ignore malformed values to avoid breaking builds.
    }
  };

  addFromUrlLike(process.env.NEXT_PUBLIC_APP_URL);
  addFromUrlLike(process.env.APP_URL);
  addFromUrlLike(process.env.VERCEL_URL);

  return Array.from(origins);
}

const serverActionsAllowedOrigins = parseServerActionsAllowedOrigins();

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const KNOWLEDGE_ASSET_MAX_BYTES_DEFAULT = 12 * 1024 * 1024; // 12MB
const SERVER_ACTIONS_MULTIPART_OVERHEAD_BYTES = 2 * 1024 * 1024; // 2MB buffer

const knowledgeAssetMaxBytes = parsePositiveInt(process.env.KNOWLEDGE_ASSET_MAX_BYTES, KNOWLEDGE_ASSET_MAX_BYTES_DEFAULT);
const serverActionsBodySizeLimitMb = Math.ceil(
  (knowledgeAssetMaxBytes + SERVER_ACTIONS_MULTIPART_OVERHEAD_BYTES) / (1024 * 1024)
);
const deploymentId =
  process.env.DEPLOYMENT_VERSION ||
  process.env.VERCEL_DEPLOYMENT_ID ||
  process.env.VERCEL_GIT_COMMIT_SHA ||
  undefined;

const nextConfig = {
  turbopack: {
    root: process.cwd(),
  },
  images: {
    unoptimized: true,
  },
  experimental: {
    serverActions: {
      ...(serverActionsAllowedOrigins.length > 0 ? { allowedOrigins: serverActionsAllowedOrigins } : {}),
      bodySizeLimit: `${serverActionsBodySizeLimitMb}mb`,
    },
  },
  ...(deploymentId ? { deploymentId } : {}),
  async headers() {
    return [
      {
        source: "/",
        headers: [{ key: "Cache-Control", value: "no-store, max-age=0" }],
      },
      {
        source: "/auth/login",
        headers: [{ key: "Cache-Control", value: "no-store, max-age=0" }],
      },
    ];
  },
};

export default nextConfig;
