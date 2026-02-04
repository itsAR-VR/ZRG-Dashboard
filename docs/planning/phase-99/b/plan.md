# Phase 99b — Update Route + Tests

## Focus
Apply the stricter admin auth to the re-engagement backfill route and add unit test coverage.

## Inputs
- `lib/admin-actions-auth.ts` from Phase 99a
- `app/api/admin/followup-sequences/reengagement/backfill/route.ts` (current state: lines 8-32 contain inline auth)
- Test orchestration in `scripts/test-orchestrator.ts` (current state: 23 test files registered)

## Work

### Step 1: Update the route to use the helper

**File:** `app/api/admin/followup-sequences/reengagement/backfill/route.ts`

**Changes:**
1. Add import at top:
   ```ts
   import { requireAdminActionsAuth } from "@/lib/admin-actions-auth";
   ```
2. Remove the inline `getProvidedSecret()` function (lines 8-21)
3. Remove the inline `isAuthorized()` function (lines 23-32)
4. Update GET handler (line 58-61):
   ```ts
   export async function GET(request: NextRequest) {
     const authResult = requireAdminActionsAuth(request.headers);
     if (!authResult.ok) {
       return NextResponse.json({ error: authResult.error }, { status: authResult.status });
     }
     // ... rest unchanged
   }
   ```
5. Update POST handler (line 87-90) similarly

**Removed behaviors:**
- ❌ `request.headers.get("x-cron-secret")` no longer accepted
- ❌ `url.searchParams.get("secret")` no longer accepted
- ❌ `process.env.CRON_SECRET` no longer accepted as valid secret

### Step 2: Create unit tests

**File:** `lib/__tests__/admin-actions-auth.test.ts`

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  getBearerToken,
  getProvidedAdminSecret,
  getAllowedAdminSecrets,
  isAuthorizedSecret,
  requireAdminActionsAuth,
} from "../admin-actions-auth.js";

describe("admin-actions-auth", () => {
  describe("getBearerToken", () => {
    it("extracts Bearer token from Authorization header", () => {
      const headers = new Headers({ authorization: "Bearer my-secret" });
      assert.equal(getBearerToken(headers), "my-secret");
    });
    it("returns null for missing header", () => {
      const headers = new Headers();
      assert.equal(getBearerToken(headers), null);
    });
    it("returns null for non-Bearer scheme", () => {
      const headers = new Headers({ authorization: "Basic abc123" });
      assert.equal(getBearerToken(headers), null);
    });
  });

  describe("getProvidedAdminSecret", () => {
    it("prefers Bearer token", () => {
      const headers = new Headers({
        authorization: "Bearer bearer-secret",
        "x-admin-secret": "x-admin-secret",
      });
      assert.equal(getProvidedAdminSecret(headers), "bearer-secret");
    });
    it("falls back to x-admin-secret", () => {
      const headers = new Headers({ "x-admin-secret": "admin-secret" });
      assert.equal(getProvidedAdminSecret(headers), "admin-secret");
    });
    it("falls back to x-workspace-provisioning-secret", () => {
      const headers = new Headers({ "x-workspace-provisioning-secret": "prov-secret" });
      assert.equal(getProvidedAdminSecret(headers), "prov-secret");
    });
    it("returns null when no admin headers present", () => {
      const headers = new Headers({ "x-cron-secret": "cron-secret" });
      assert.equal(getProvidedAdminSecret(headers), null);
    });
  });

  describe("getAllowedAdminSecrets", () => {
    it("collects non-empty secrets", () => {
      const env = { ADMIN_ACTIONS_SECRET: "admin", WORKSPACE_PROVISIONING_SECRET: "prov" };
      assert.deepEqual(getAllowedAdminSecrets(env as NodeJS.ProcessEnv), ["admin", "prov"]);
    });
    it("filters empty and whitespace-only secrets", () => {
      const env = { ADMIN_ACTIONS_SECRET: "  ", WORKSPACE_PROVISIONING_SECRET: "valid" };
      assert.deepEqual(getAllowedAdminSecrets(env as NodeJS.ProcessEnv), ["valid"]);
    });
    it("returns empty array when no secrets configured", () => {
      assert.deepEqual(getAllowedAdminSecrets({} as NodeJS.ProcessEnv), []);
    });
  });

  describe("isAuthorizedSecret", () => {
    it("returns true for exact match", () => {
      assert.equal(isAuthorizedSecret("secret", ["secret"]), true);
    });
    it("returns true if any allowed secret matches", () => {
      assert.equal(isAuthorizedSecret("second", ["first", "second"]), true);
    });
    it("returns false for mismatch", () => {
      assert.equal(isAuthorizedSecret("wrong", ["correct"]), false);
    });
    it("returns false for null provided", () => {
      assert.equal(isAuthorizedSecret(null, ["secret"]), false);
    });
    it("returns false for empty allowed", () => {
      assert.equal(isAuthorizedSecret("secret", []), false);
    });
  });

  describe("requireAdminActionsAuth", () => {
    it("returns 500 when no secrets configured", () => {
      const headers = new Headers({ authorization: "Bearer any" });
      const result = requireAdminActionsAuth(headers, {} as NodeJS.ProcessEnv);
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.status, 500);
        assert.match(result.error, /misconfiguration/i);
      }
    });
    it("returns 401 for invalid secret", () => {
      const headers = new Headers({ authorization: "Bearer wrong" });
      const env = { ADMIN_ACTIONS_SECRET: "correct" } as NodeJS.ProcessEnv;
      const result = requireAdminActionsAuth(headers, env);
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.status, 401);
      }
    });
    it("returns ok for valid ADMIN_ACTIONS_SECRET", () => {
      const headers = new Headers({ authorization: "Bearer admin-secret" });
      const env = { ADMIN_ACTIONS_SECRET: "admin-secret" } as NodeJS.ProcessEnv;
      assert.deepEqual(requireAdminActionsAuth(headers, env), { ok: true });
    });
    it("returns ok for valid WORKSPACE_PROVISIONING_SECRET", () => {
      const headers = new Headers({ authorization: "Bearer prov-secret" });
      const env = { WORKSPACE_PROVISIONING_SECRET: "prov-secret" } as NodeJS.ProcessEnv;
      assert.deepEqual(requireAdminActionsAuth(headers, env), { ok: true });
    });
    it("accepts either secret when both are set", () => {
      const env = {
        ADMIN_ACTIONS_SECRET: "admin",
        WORKSPACE_PROVISIONING_SECRET: "prov",
      } as NodeJS.ProcessEnv;
      const h1 = new Headers({ authorization: "Bearer admin" });
      const h2 = new Headers({ authorization: "Bearer prov" });
      assert.deepEqual(requireAdminActionsAuth(h1, env), { ok: true });
      assert.deepEqual(requireAdminActionsAuth(h2, env), { ok: true });
    });
    it("rejects CRON_SECRET even if set", () => {
      const headers = new Headers({ "x-cron-secret": "cron-value" });
      const env = { CRON_SECRET: "cron-value", ADMIN_ACTIONS_SECRET: "admin" } as NodeJS.ProcessEnv;
      const result = requireAdminActionsAuth(headers, env);
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.status, 401);
    });
  });
});
```

### Step 3: Register test in orchestrator

**File:** `scripts/test-orchestrator.ts`

**Change:** Add to `TEST_FILES` array (after line 22):
```ts
"lib/__tests__/admin-actions-auth.test.ts",
```

### Validations

- [ ] Route no longer has inline `getProvidedSecret` / `isAuthorized` functions
- [ ] Route imports `requireAdminActionsAuth` from helper
- [ ] `npm run test` passes (including new test file)
- [ ] `npm run lint` passes
- [ ] Manual test: `curl` with `x-cron-secret` returns 401
- [ ] Manual test: `curl` with `?secret=...` returns 401
- [ ] Manual test: `curl` with `Authorization: Bearer $ADMIN_ACTIONS_SECRET` returns 200

## Output
- Hardened backfill route auth
- Unit tests in `lib/__tests__/admin-actions-auth.test.ts`
- Test registration in `scripts/test-orchestrator.ts`

## Handoff
Proceed to Phase 99c to update README docs and run validation.

