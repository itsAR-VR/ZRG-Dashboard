export function getPublicAppUrl(): string {
  const fromEnv = (process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || "").trim();
  const fromVercel = (process.env.VERCEL_URL || "").trim();

  const vercelEnv = process.env.VERCEL_ENV;
  const isProduction = vercelEnv ? vercelEnv === "production" : process.env.NODE_ENV === "production";
  if (isProduction && !fromEnv) {
    throw new Error("Missing public app URL. Set NEXT_PUBLIC_APP_URL (recommended) or APP_URL.");
  }

  const normalized = fromEnv || fromVercel;
  if (!normalized) {
    if (process.env.NODE_ENV !== "production") return "http://localhost:3000";
    throw new Error("Missing public app URL. Set NEXT_PUBLIC_APP_URL (recommended) or APP_URL.");
  }

  if (normalized.startsWith("http://") || normalized.startsWith("https://")) {
    return normalized.replace(/\/+$/, "");
  }

  // VERCEL_URL is usually just the host (no protocol).
  return `https://${normalized.replace(/\/+$/, "")}`;
}
