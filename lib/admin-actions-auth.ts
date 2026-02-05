import crypto from "node:crypto";

export type AdminAuthEnv = {
  ADMIN_ACTIONS_SECRET?: string | null;
  WORKSPACE_PROVISIONING_SECRET?: string | null;
};

export function getAllowedAdminSecrets(env: AdminAuthEnv = process.env as AdminAuthEnv): string[] {
  return [env.ADMIN_ACTIONS_SECRET, env.WORKSPACE_PROVISIONING_SECRET]
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter((value) => value.length > 0);
}

export function getProvidedAdminSecret(headers: Headers): string | null {
  const authHeader = headers.get("authorization") ?? "";
  const [scheme, token] = authHeader.split(" ");
  if (scheme === "Bearer" && token) return token;

  return headers.get("x-admin-secret") ?? headers.get("x-workspace-provisioning-secret") ?? null;
}

function timingSafeEqualUtf8(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, "utf8");
  const bBuf = Buffer.from(b, "utf8");
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

export function verifyAdminActionSecret(params: {
  headers: Headers;
  env?: AdminAuthEnv;
}): { ok: true } | { ok: false; status: 401 | 500; reason: string } {
  const allowed = getAllowedAdminSecrets(params.env);
  if (allowed.length === 0) {
    return { ok: false, status: 500, reason: "Admin secrets not configured" };
  }

  const provided = getProvidedAdminSecret(params.headers);
  if (!provided) return { ok: false, status: 401, reason: "Unauthorized" };

  const ok = allowed.some((secret) => timingSafeEqualUtf8(secret, provided));
  if (!ok) return { ok: false, status: 401, reason: "Unauthorized" };

  return { ok: true };
}
