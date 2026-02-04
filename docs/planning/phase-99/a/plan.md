# Phase 99a — Define Admin Auth Helper

## Focus
Create a small, testable helper for admin/provisioning secret validation to avoid fragile in-route auth logic.

## Inputs
- Review finding: re-engagement backfill auth is too permissive/fragile
- Root plan constraints and desired behavior
- Reference pattern: `lib/calendly-webhook.ts:3-8` (timing-safe comparison with Buffer + length-check)

## Work

### Step 1: Create `lib/admin-actions-auth.ts`

```ts
import crypto from "node:crypto";

/**
 * Extract Bearer token from Authorization header.
 */
export function getBearerToken(headers: Headers): string | null {
  const authHeader = headers.get("authorization") ?? "";
  const [scheme, token] = authHeader.split(" ");
  if (scheme !== "Bearer" || !token) return null;
  return token;
}

/**
 * Extract provided admin secret from headers.
 * Priority: Bearer token → x-admin-secret → x-workspace-provisioning-secret
 * NOTE: Does NOT accept x-cron-secret or query params.
 */
export function getProvidedAdminSecret(headers: Headers): string | null {
  const bearer = getBearerToken(headers);
  if (bearer) return bearer;

  const xAdminSecret = headers.get("x-admin-secret");
  if (xAdminSecret) return xAdminSecret;

  const xProvisioningSecret = headers.get("x-workspace-provisioning-secret");
  if (xProvisioningSecret) return xProvisioningSecret;

  return null;
}

/**
 * Collect all configured admin secrets from env (non-empty, trimmed).
 */
export function getAllowedAdminSecrets(env: NodeJS.ProcessEnv): string[] {
  const candidates = [
    env.ADMIN_ACTIONS_SECRET,
    env.WORKSPACE_PROVISIONING_SECRET,
  ];
  return candidates
    .map((s) => (s ?? "").trim())
    .filter((s) => s.length > 0);
}

/**
 * Timing-safe comparison: returns true if `provided` matches any secret in `allowed`.
 * Uses Buffer + length-check to avoid timing leaks.
 */
export function isAuthorizedSecret(provided: string | null, allowed: string[]): boolean {
  if (!provided || allowed.length === 0) return false;
  const providedBuf = Buffer.from(provided, "utf8");
  for (const secret of allowed) {
    const secretBuf = Buffer.from(secret, "utf8");
    if (providedBuf.length === secretBuf.length && crypto.timingSafeEqual(providedBuf, secretBuf)) {
      return true;
    }
  }
  return false;
}

export type AdminAuthResult =
  | { ok: true }
  | { ok: false; status: 500 | 401; error: string };

/**
 * Main entry point: validates admin auth from headers.
 * Returns { ok: true } on success, or { ok: false, status, error } on failure.
 */
export function requireAdminActionsAuth(
  headers: Headers,
  env: NodeJS.ProcessEnv = process.env
): AdminAuthResult {
  const allowed = getAllowedAdminSecrets(env);
  if (allowed.length === 0) {
    return {
      ok: false,
      status: 500,
      error: "Server misconfiguration: no admin secrets configured",
    };
  }

  const provided = getProvidedAdminSecret(headers);
  if (!isAuthorizedSecret(provided, allowed)) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }

  return { ok: true };
}
```

### Step 2: Verify helper has no Next.js dependencies

- `Headers` is a standard Web API type (available in Node 18+).
- No imports from `next/*`.
- Accepts `env` object as parameter (default `process.env`) for testability.

### Validations

- [ ] File created at `lib/admin-actions-auth.ts`
- [ ] No TypeScript errors: `npx tsc --noEmit lib/admin-actions-auth.ts` (or rely on `npm run build`)
- [ ] Helper functions are exported and documented

## Output
- New helper module `lib/admin-actions-auth.ts` with explicit, testable auth contract

## Handoff
Proceed to Phase 99b to wire the helper into the re-engagement backfill route and add tests.

