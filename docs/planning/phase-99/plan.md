# Phase 99 — Harden Re-engagement Backfill Admin Auth

## Purpose
Tighten authentication for `/api/admin/followup-sequences/reengagement/backfill` so it only accepts admin/provisioning secrets via headers, handles multiple configured secrets correctly, and removes query-string auth.

## Context
Review finding flagged the endpoint as overly permissive and fragile: it accepts `?secret=...`, allows `CRON_SECRET`, and only checks the first configured env var. The desired behavior (per user decisions) is:
- Accept **only** `ADMIN_ACTIONS_SECRET` and/or `WORKSPACE_PROVISIONING_SECRET`
- Disallow query-string secrets
- Restrict changes to this endpoint only
- If both secrets are set, accept either

---

## Repo Reality Check (RED TEAM)

### What Exists Today

| Component | File Path | Verified |
|-----------|-----------|----------|
| Target route | `app/api/admin/followup-sequences/reengagement/backfill/route.ts` | ✓ Exists (157 lines) |
| Current `getProvidedSecret()` | Lines 8-21 | ✓ Accepts Bearer + x-admin-secret + x-cron-secret + x-workspace-provisioning-secret + query string |
| Current `isAuthorized()` | Lines 23-32 | ✓ Uses simple `===` comparison (not timing-safe), accepts CRON_SECRET |
| Test orchestrator | `scripts/test-orchestrator.ts` | ✓ Exists (modified by Phase 98) |
| Timing-safe util pattern | `lib/calendly-webhook.ts:3-8` | ✓ Uses Buffer + length-check pattern |
| README auth section | `README.md:384-407` | ✓ Currently documents CRON_SECRET as fallback (needs update) |
| Helper file target | `lib/admin-actions-auth.ts` | ✗ Does not exist (will be created) |
| Test file target | `lib/__tests__/admin-actions-auth.test.ts` | ✗ Does not exist (will be created) |

### Current Route Auth Logic (Lines 8-32)

```ts
function getProvidedSecret(request: NextRequest): string | null {
  const authHeader = request.headers.get("authorization") ?? "";
  const [scheme, token] = authHeader.split(" ");
  if (scheme === "Bearer" && token) return token;

  const headerSecret =
    request.headers.get("x-admin-secret") ??
    request.headers.get("x-cron-secret") ??          // ← REMOVE
    request.headers.get("x-workspace-provisioning-secret");
  if (headerSecret) return headerSecret;

  const url = new URL(request.url);
  return url.searchParams.get("secret") || null;    // ← REMOVE
}

function isAuthorized(request: NextRequest): boolean {
  const expectedSecret =
    process.env.ADMIN_ACTIONS_SECRET ??
    process.env.WORKSPACE_PROVISIONING_SECRET ??
    process.env.CRON_SECRET ??                       // ← REMOVE
    null;

  if (!expectedSecret) return false;
  return getProvidedSecret(request) === expectedSecret;  // ← NOT TIMING-SAFE, only checks FIRST env var
}
```

**Gaps identified:**
1. Accepts `x-cron-secret` header → must remove
2. Accepts `?secret=...` query param → must remove
3. Uses plain `===` comparison → must use timing-safe comparison
4. Only checks the **first** configured env var → must check **all** configured secrets

---

## RED TEAM Findings (Gaps / Weak Spots)

### Highest-Risk Failure Modes

| Risk | Impact | Mitigation |
|------|--------|------------|
| **Timing-safe comparison needs Buffer alignment** | If provided vs. expected secrets differ in length, `crypto.timingSafeEqual` throws | Length-check first: `if (a.length !== b.length) return false` (see `lib/calendly-webhook.ts:3-8`) |
| **Empty env vars treated as valid secrets** | `ADMIN_ACTIONS_SECRET=""` would pass auth if caller sends empty Bearer | `getAllowedAdminSecrets()` must filter out empty/whitespace-only values |
| **No misconfig detection** | If neither secret is configured, silent 401 is confusing | Return **500** with "misconfiguration" message when no admin secrets are set |
| **README says CRON_SECRET works** | README:388 documents CRON_SECRET as fallback | Must update README to remove CRON_SECRET mention |

### Missing or Ambiguous Requirements

| Gap | Resolution |
|-----|------------|
| What status code when no admin secrets configured? | Plan says 500 with clear misconfig message (Phase 99b) |
| Should helper be async or sync? | Sync—no I/O involved, just env reads + comparison |
| Should helper work with native Headers or NextRequest? | Accept standard `Headers` object to keep it framework-agnostic |

### Repo Mismatches (Fix the Plan)

| Issue | Correction |
|-------|------------|
| Plan 99a says "no dependency on Next.js types" | ✓ Correct—accept `Headers` + env object, not `NextRequest` |
| Plan 99b references removing `x-cron-secret` | ✓ Verified—line 15 in current route |
| Plan 99c references README section | ✓ Line 388 in README.md documents `CRON_SECRET` fallback |
| Plan 99a doesn't mention empty-string filtering | **Add:** `getAllowedAdminSecrets()` must filter empty strings after trim |
| Plan 99a doesn't specify length-check pattern | **Add:** Use Buffer conversion + length-check before `timingSafeEqual` |

### Performance / Timeouts

| Risk | Mitigation |
|------|------------|
| Timing-safe comparison has negligible overhead | No action needed—this is a single comparison per request |

### Security / Permissions

| Risk | Mitigation |
|------|------------|
| Side-channel timing attack on secret comparison | Use `crypto.timingSafeEqual` with Buffer + length-check |
| Secrets logged accidentally | Never log the provided or expected secret values; log only auth result |

### Testing / Validation

| Gap | Mitigation |
|-----|------------|
| No existing tests for this endpoint | Add unit tests in Phase 99b |
| Test orchestrator recently modified by Phase 98 | Merge test registration carefully; append to existing list |

### Multi-Agent Coordination

| Check | Status |
|-------|--------|
| Last 10 phases scanned for overlap | ✓ Phase 98 modified `scripts/test-orchestrator.ts` |
| Uncommitted changes in target files | ✓ `git status` shows clean (Phase 98 is committed) |
| Schema changes | ✗ None required |
| Coordination strategy | Append new test file to `TEST_FILES` array in orchestrator; no file conflicts |

---

## Objectives
* [ ] Define a small, testable admin-auth helper that validates admin/provisioning secrets and uses constant-time comparison
* [ ] Update the re-engagement backfill route to use the helper and reject query-string/cron secrets
* [ ] Add unit tests and update README docs for the endpoint auth behavior

## Constraints
- No schema changes
- Do not touch other admin routes
- Keep response shapes and status codes consistent with current route patterns
- Do not accept secrets via query params
- Only accept `Authorization: Bearer <secret>`, `x-admin-secret`, or `x-workspace-provisioning-secret`

## Success Criteria
- Endpoint returns **401** for `CRON_SECRET` and for query-string auth
- Endpoint returns **500** when neither `ADMIN_ACTIONS_SECRET` nor `WORKSPACE_PROVISIONING_SECRET` is configured
- Endpoint accepts `ADMIN_ACTIONS_SECRET` or `WORKSPACE_PROVISIONING_SECRET` even when both are set
- Unit tests cover helper behavior and are registered in `scripts/test-orchestrator.ts`
- README documents the header-only auth (no cron fallback, no query param)
- `npm run test`, `npm run lint`, `npm run build` pass

## Subphase Index
* a — Define admin-auth helper + behavior contract
* b — Update route + tests + test registration
* c — Update README + validation checklist

---

## Assumptions (Agent)

1. **Assumption:** Using Buffer.from(secret, "utf8") for timing-safe comparison is appropriate for plaintext secrets.
   - *Confidence:* ~98%
   - *Mitigation:* If secrets need to support hex/base64 encoding, add format detection.

2. **Assumption:** Returning 500 for misconfiguration (no secrets set) is preferable to silent 401.
   - *Confidence:* ~95%
   - *Mitigation:* If this causes deployment issues, can revert to 401 with a distinctive error message.

3. **Assumption:** Appending to `scripts/test-orchestrator.ts` is safe (no structural conflicts from Phase 98).
   - *Confidence:* ~99%
   - *Mitigation:* Read file before editing to confirm structure.

---

## Open Questions (Need Human Input)

None—requirements are sufficiently specified from the review finding and user decisions.

