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

const nextConfig = {
  turbopack: {
    root: process.cwd(),
  },
  images: {
    unoptimized: true,
  },
  ...(serverActionsAllowedOrigins.length > 0
    ? {
        experimental: {
          serverActions: {
            allowedOrigins: serverActionsAllowedOrigins,
          },
        },
      }
    : {}),
};

export default nextConfig;
