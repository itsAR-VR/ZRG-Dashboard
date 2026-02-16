const SERVER_ACTION_VERSION_SKEW_SUBSTRINGS = [
  "failed to find server action",
  "older or newer deployment",
  "version skew",
] as const;

export const SERVER_ACTION_VERSION_SKEW_REFRESH_MESSAGE =
  "App update detected. Please refresh and try again.";

export function isServerActionVersionSkewError(error: unknown): boolean {
  const message =
    typeof error === "string" ? error : error instanceof Error ? error.message : "";
  if (!message) return false;

  const normalized = message.toLowerCase();
  return SERVER_ACTION_VERSION_SKEW_SUBSTRINGS.some((part) => normalized.includes(part));
}
