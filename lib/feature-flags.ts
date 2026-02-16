import "server-only";

const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);
const FALSE_VALUES = new Set(["0", "false", "no", "off"]);

function parseBooleanLike(raw: string | undefined): boolean | null {
  if (!raw) return null;
  const normalized = raw.trim().toLowerCase();
  if (!normalized) return null;
  if (TRUE_VALUES.has(normalized)) return true;
  if (FALSE_VALUES.has(normalized)) return false;
  return null;
}

function isProductionRuntime(): boolean {
  const vercelEnv = (process.env.VERCEL_ENV || "").trim().toLowerCase();
  if (vercelEnv) return vercelEnv === "production";
  return process.env.NODE_ENV === "production";
}

function resolveReadApiFlag(opts: { serverKey: string; publicKey: string }): boolean {
  const serverValue = parseBooleanLike(process.env[opts.serverKey]);
  if (serverValue !== null) return serverValue;

  const publicValue = parseBooleanLike(process.env[opts.publicKey]);
  if (publicValue !== null) return publicValue;

  // Production should never fail closed due to missing env vars.
  return isProductionRuntime();
}

export function isInboxReadApiEnabled(): boolean {
  return resolveReadApiFlag({
    serverKey: "INBOX_READ_API_V1",
    publicKey: "NEXT_PUBLIC_INBOX_READ_API_V1",
  });
}

export function isAnalyticsReadApiEnabled(): boolean {
  return resolveReadApiFlag({
    serverKey: "ANALYTICS_READ_API_V1",
    publicKey: "NEXT_PUBLIC_ANALYTICS_READ_API_V1",
  });
}
