export function getPublicAppUrl(): string {
  const raw =
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.APP_URL ||
    process.env.VERCEL_URL ||
    "";

  const normalized = raw.trim();
  if (!normalized) return "https://zrg-dashboard.vercel.app";

  if (normalized.startsWith("http://") || normalized.startsWith("https://")) {
    return normalized.replace(/\/+$/, "");
  }

  // VERCEL_URL is usually just the host (no protocol).
  return `https://${normalized.replace(/\/+$/, "")}`;
}

