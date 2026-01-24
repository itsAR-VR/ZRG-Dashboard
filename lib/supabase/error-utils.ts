import "server-only";

export function getSupabaseAuthErrorCode(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const anyError = error as { code?: unknown };
  return typeof anyError.code === "string" ? anyError.code : null;
}

export function isSupabaseAuthError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const anyError = error as { __isAuthError?: unknown; name?: unknown; code?: unknown; status?: unknown };

  if (anyError.__isAuthError === true) return true;
  if (typeof anyError.name === "string" && anyError.name.toLowerCase().includes("auth")) return true;
  if (typeof anyError.code === "string" && anyError.code.length > 0) return true;
  return typeof anyError.status === "number";
}

export function isSupabaseInvalidOrMissingSessionError(error: unknown): boolean {
  const code = getSupabaseAuthErrorCode(error);
  if (!code) return false;
  return (
    code === "refresh_token_not_found" ||
    code === "invalid_refresh_token" ||
    code === "invalid_jwt" ||
    code === "session_not_found"
  );
}

export function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const anyError = error as { name?: unknown; code?: unknown };
  if (anyError.name === "AbortError") return true;
  if (anyError.code === "UND_ERR_ABORTED") return true;
  return false;
}
