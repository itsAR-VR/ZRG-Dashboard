import "server-only";

const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);

function isEnabled(raw: string | undefined): boolean {
  if (!raw) return false;
  return TRUE_VALUES.has(raw.trim().toLowerCase());
}

export function isInboxReadApiEnabled(): boolean {
  return isEnabled(process.env.NEXT_PUBLIC_INBOX_READ_API_V1);
}

export function isAnalyticsReadApiEnabled(): boolean {
  return isEnabled(process.env.NEXT_PUBLIC_ANALYTICS_READ_API_V1);
}
