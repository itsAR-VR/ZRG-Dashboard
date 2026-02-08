export type SafeActionErrorClass =
  | "not_authenticated"
  | "unauthorized"
  | "auth_timeout"
  | "db_error"
  | "invalid_input"
  | "unknown";

export type SafeActionError = {
  debugId: string;
  errorClass: SafeActionErrorClass;
  publicMessage: string;
};

function createDebugId(): string {
  // Prefer UUIDs when available (Node + Edge runtimes).
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  try {
    return typeof error === "string" ? error : JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function detectErrorClass(error: unknown, message: string): SafeActionErrorClass {
  if (error instanceof Error && error.name === "AbortError") return "auth_timeout";
  if (message.includes("AbortError")) return "auth_timeout";

  if (message === "Not authenticated") return "not_authenticated";
  if (message === "Unauthorized") return "unauthorized";

  // Prisma errors often include a `code` field.
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (code === "P1001") return "db_error";
  }

  return "unknown";
}

export function toSafeActionError(
  error: unknown,
  opts?: { defaultPublicMessage?: string }
): SafeActionError {
  const debugId = createDebugId();
  const message = getErrorMessage(error);
  const errorClass = detectErrorClass(error, message);

  if (errorClass === "not_authenticated") {
    return { debugId, errorClass, publicMessage: "Not authenticated" };
  }
  if (errorClass === "unauthorized") {
    return { debugId, errorClass, publicMessage: "Unauthorized" };
  }
  if (errorClass === "auth_timeout") {
    return { debugId, errorClass, publicMessage: "Authentication timed out" };
  }
  if (errorClass === "db_error") {
    return { debugId, errorClass, publicMessage: "Database error" };
  }

  return {
    debugId,
    errorClass,
    publicMessage: opts?.defaultPublicMessage || "Unexpected error",
  };
}
