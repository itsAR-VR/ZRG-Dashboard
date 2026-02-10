# Phase 129d — Tests + Rollout Checklist

## Focus
Add automated coverage for precedence, drift, staleness, and super-admin gating, then validate with repo quality gates and a manual smoke checklist.

## Inputs
- Root plan: `docs/planning/phase-129/plan.md`
- 129b runtime resolution changes (`getPromptWithOverrides`, `getEffectiveSnippet`)
- 129c UI changes (badges, reset, stale warnings)
- Existing test harness: `scripts/test-orchestrator.ts` (node:test + tsx)
- Existing test patterns: `lib/__tests__/prompt-runner-attempt-expansion.test.ts` (reference for prompt-related tests)

## Work

### 1. Unit tests — prompt precedence (no DB required)
- File: `lib/__tests__/prompt-system-defaults.test.ts` (new)
- Test cases:
  1. **Code-only:** No system or workspace overrides → code default used, telemetry key has no suffix.
  2. **System override only:** System override with matching `baseContentHash` → system content used, telemetry suffix `sys_<ts>`.
  3. **Workspace override only:** Workspace override with matching hash → workspace content used, telemetry suffix `ws_<ts>`.
  4. **Both exist, workspace wins:** Both overrides with matching hashes → workspace content used, telemetry suffix `ws_<ts>`.
  5. **System override, stale hash:** System override with mismatched `baseContentHash` → code default used (drift protection).
  6. **Workspace override, stale hash:** Workspace override with mismatched hash → falls through to system override (if present and valid) or code default.
  7. **Both stale:** Both overrides have mismatched hashes → code default used.

### 2. Unit tests — snippet precedence
- File: `lib/__tests__/prompt-system-defaults.test.ts` (same file, separate describe block)
- Test cases:
  1. **Code-only:** No overrides → code default, `source: "code"`.
  2. **System override only:** → system content, `source: "system"`.
  3. **Workspace override only:** → workspace content, `source: "workspace"`.
  4. **Both exist, workspace wins:** → workspace content, `source: "workspace"`.
  5. **Unknown snippet key:** → null returned.

### 3. Unit tests — stale warning detection
- File: `lib/__tests__/prompt-system-defaults.test.ts`
- Test cases:
  1. **Workspace override newer than system default:** `isStale: false`.
  2. **Workspace override older than system default:** `isStale: true`.
  3. **No system default exists:** `isStale: false` (nothing to be stale against).
  4. **No workspace override exists:** no stale check needed (using system/code default).

### 4. Unit tests — super-admin gating
- File: `lib/__tests__/prompt-system-defaults.test.ts`
- Test cases:
  1. **Super-admin user:** `requireSuperAdminUser()` returns `{ userId, userEmail }`.
  2. **Non-super-admin user:** `requireSuperAdminUser()` throws "Unauthorized: Super admin required".
  3. **No auth user:** `requireSuperAdminUser()` throws (inherits from `requireAuthUser()`).

### 5. Quality gates
- `npm test` — all tests pass (new + existing).
- `npm run lint` — no errors.
- `npm run build` — succeeds.

### 6. Manual smoke checklist (post-deploy or local)

**System Defaults (super-admin):**
- [ ] Edit a system default prompt message → save → verify uncustomized workspace picks it up at runtime.
- [ ] Edit a system default snippet → save → verify uncustomized workspace uses new value.
- [ ] Reset system default → verify workspace falls back to code default.

**Workspace Overrides:**
- [ ] Customize a workspace prompt → verify "Workspace Custom" blue badge.
- [ ] Verify workspace override persists when system default changes.
- [ ] Reset workspace override → verify it returns to system default (if present) or code default.
- [ ] Verify stale amber badge appears when system default is updated AFTER workspace override was saved.

**Drift Protection:**
- [ ] Deploy a code change that modifies a prompt template → verify system override with old hash is skipped.
- [ ] Verify workspace override with old hash is skipped.

**Permissions:**
- [ ] Non-super-admin: verify "System Defaults" tab is NOT visible in Settings.
- [ ] Super-admin: verify "System Defaults" tab IS visible.
- [ ] Non-super-admin: verify system prompt actions return 401/error.

**Telemetry:**
- [ ] Check `AIInteraction` table: system-only override prompt shows `sys_<ts>` suffix.
- [ ] Check `AIInteraction` table: workspace override prompt shows `ws_<ts>` suffix.
- [ ] Check `AIInteraction` table: no override shows clean `promptKey`.

## Output
- New test file: `lib/__tests__/prompt-system-defaults.test.ts` wired into `npm test`.
- All quality gates pass.
- Manual smoke checklist documented above.

## Handoff
If further phases are needed:
- Create a follow-up phase for production verification and monitoring metrics (AIInteraction telemetry) if rollouts require cautious gating.
- Consider follow-up for migrating existing `isTrueSuperAdminUser` inline checks in 7+ action files to use the new `requireSuperAdminUser()` helper (optional cleanup, not blocking).

## Progress This Turn (Terminus Maximus)
- Work done:
  - Added unit tests for 3-tier prompt override precedence + drift + telemetry suffixing. (`lib/__tests__/prompt-system-defaults.test.ts`)
  - Wired the new test into the repo test runner. (`scripts/test-orchestrator.ts`)
  - Ran full quality gates for the combined repo state (tests/lint/build) and Prisma schema sync. (`prisma/schema.prisma`)
- Commands run:
  - `npm test` — pass (281/281)
  - `npm run lint` — pass (warnings only)
  - `npm run build` — pass
  - `npm run db:push` — pass (`The database is already in sync with the Prisma schema.`)
- Blockers:
  - None
- Next concrete steps:
  - Write Phase 129 review artifact (`docs/planning/phase-129/review.md`) with success-criteria evidence mapping.
