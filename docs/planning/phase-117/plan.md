# Phase 117 — Launch Readiness: Fix Inbox “Error loading conversations” (Server Actions 500) + Final Hardening

## Purpose
Make the app production-ready to launch by eliminating the production 500s blocking the Master Inbox (Jam repro) and by tightening the remaining “launch-blocker” surfaces: env correctness, cron/webhooks auth, and rollback/runbook.

## Context
- Phase 116 shipped the AI auto-send revision tracking + rollout controls, and is awaiting a manual production canary execution (`docs/planning/phase-116/e/plan.md`).
- New launch blocker: Jam report shows Master Inbox displays **“Error loading conversations”** with the generic Next.js production message (“An error occurred in the Server Components render…”) which corresponds to **Server Actions returning HTTP 500**.
  - Jam: `https://jam.dev/c/1ad53b5c-5bbe-4c7e-a545-fc71739582ac`
  - Network evidence: repeated `POST /` with `accept: text/x-component` and `next-action` headers returning **500**.
  - The request bodies align with the Server Action argument shapes used by:
    - `components/dashboard/inbox-view.tsx` → `actions/lead-actions.ts:getConversationsCursor(...)`
    - `app/page.tsx` → `actions/client-actions.ts:getClients()`
- The priority is to turn this into a deterministic, debuggable failure mode:
  - reproduce locally with production env
  - identify the exact underlying exception (not just a digest)
  - fix so these calls return structured `{ success: false, error }` rather than throwing/500’ing

## Repo Reality Check (RED TEAM — Verified 2026-02-07)

- What exists today:
  - The dashboard route is a **client component** (`app/page.tsx`) that calls Server Actions from the browser:
    - Workspaces: `actions/client-actions.ts:getClients()`
    - Conversations: `actions/lead-actions.ts:getConversationsCursor(...)` (invoked from `components/dashboard/inbox-view.tsx` via React Query).
  - Both actions have local `try/catch` and are intended to return `{ success, data?/conversations?, error? }` rather than throw.
  - **VERIFIED:** `requireAuthUser()` (line 98) and `resolveClientScope()` (line 1107) ARE inside their respective try blocks. Auth throws do NOT escape the catch — they return `{ success: false }`.
  - Prisma is initialized at module-load time in `lib/prisma.ts` using `process.env.DATABASE_URL!` and the `@prisma/adapter-pg` adapter. **This is a module-level crash risk** (RT-1).
  - `app/page.tsx:70-78` fetches workspaces via `getClients()` in `useEffect` but **silently ignores failures** — no error branch, no retry (RT-3).
  - `components/dashboard/inbox-view.tsx:287` — `useInfiniteQuery` has **no `enabled` gate** and fires immediately with invalid/placeholder params (Jam shows `clientId: {}` and `cursor: {}` rather than `null/undefined`), plus `refetchInterval: 30000` polls every 30s regardless of failure (RT-2, RT-NEW-1).
  - `components/dashboard/inbox-view.tsx:265` — filter type cast `activeFilter as ...` passes empty string `""` which is not in the union type (RT-6).
  - `lib/supabase/middleware.ts:244-269` — middleware **fails open** on non-auth Supabase errors, preserving stale cookies (RT-4).
- What this plan assumes:
  - The production 500 is caused by an exception occurring **outside** the "return `{ success: false }` path" — most likely a **module import-time env/DB crash** (`lib/prisma.ts`), a Server Action runtime serialization failure (non-serializable return values), or an action-arg decode/shape issue that occurs before the handler’s try/catch.
  - The Jam "digest-only" error can be converted into a concrete stack/message via local repro and/or Vercel logs.
- Verified touch points (paths exist in repo):
  - `app/page.tsx`, `components/dashboard/inbox-view.tsx`
  - `actions/client-actions.ts`, `actions/lead-actions.ts`
  - `middleware.ts`, `lib/supabase/middleware.ts`, `lib/workspace-access.ts`
  - `lib/prisma.ts`

## Concurrent Phases
Active uncommitted work exists for the Phase 117 fix set (Inbox launch blocker + hardening). Keep changes surgical and coordinated with Phase 116 rollout/runbook work.

| Phase | Status | Overlap | Coordination |
|-------|--------|---------|--------------|
| Phase 116 | Shipped (canary pending) | rollout/runbook + env toggles | Keep Phase 116 intact; Phase 117 should not broaden auto-send scope. |
| Phase 110 | Shipped | Master Inbox bug backlog reconciliation | Reuse triage patterns; don’t re-open solved issues without repro. |
| Phase 70/43 (historical) | Shipped | `getConversationsCursor()` filters/access controls | Re-read `actions/lead-actions.ts` carefully; keep filters backward compatible. |

## Objectives
* [x] Identify the real root cause of the production 500 (server action decode, env/DB, auth/session, Prisma, or query perf) with a locally reproducible repro.
* [x] Fix the Inbox launch blocker so Master Inbox loads conversations reliably (no Server Components render error).
* [x] Add minimal observability so future Server Action failures are diagnosable without “digest-only” dead ends.
* [ ] Run a final production-readiness sweep: env correctness, cron/webhook secrets, smoke tests, rollback levers.

## Constraints
- Do not log secrets or PII (message bodies, emails, phone numbers, tokens) in server logs or telemetry.
- Preserve existing role-based access controls:
  - `resolveClientScope(...)` and SETTER filtering must remain correct.
- Keep changes surgical (launch-blocker + hardening only). No feature expansions.
- Server Actions should return consistent `{ success, data?, error? }` shapes and avoid throwing when possible.
- If Prisma schema is changed, run `npm run db:push` against the correct DB and verify columns exist.

## Decisions (Resolved)
- Inbox must support an "All Workspaces" view (no selected workspace) without falling into a 500 loop.
- We will use a custom domain in the future; we must not rely on the current `*.vercel.app` hostname. Configure Server Actions origin allowlisting in a secure, env-driven way (no wildcard allow-all).
  - Proposed env var: `SERVER_ACTIONS_ALLOWED_ORIGINS` (comma-separated domains; supports `*.example.com` patterns per Next docs).

## Success Criteria
1. Master Inbox loads in production without “Error loading conversations” on a known-good user/workspace.
2. `getClients()` and `getConversationsCursor()` do not return HTTP 500 for expected failure modes (unauth, no access, empty workspace, bad filters); they return `{ success: false, error }`.
3. A minimal smoke suite passes locally: `npm run typecheck`, `npm test`, `npm run lint`, `npm run build`.
4. Launch runbook updated with explicit diagnostics + rollback steps for this incident class.

## RED TEAM Findings (Gaps / Weak Spots — Verified 2026-02-07)

### CRITICAL

#### RT-1: Prisma Module-Load Crash Is Unguarded (top suspect)
- **File:** `lib/prisma.ts:6-7`
- `process.env.DATABASE_URL!` + `new PrismaPg({ connectionString })` execute at **import time**. If `DATABASE_URL` is missing/malformed, every Server Action that imports `prisma` crashes with a module-level error → digest-only 500. Best explains the Jam evidence (both actions failing simultaneously).
- **Action:** Check env FIRST in 117a; add guard unconditionally in 117b (not "if applicable").

#### RT-2: Missing `enabled` Gate + `refetchInterval` Amplification
- **File:** `components/dashboard/inbox-view.tsx:287-309`
- No query gating by “client list loaded”/“params valid”. Jam shows the action is invoked with `clientId: {}` and `cursor: {}` (invalid), and `refetchInterval: 30000` repeats failures every 30 seconds.
- **Action:** In 117b, support "All Workspaces" explicitly but gate on *valid params* (and/or “workspaces loaded”), fix initialPageParam/cursor typing so first call uses `cursor: undefined/null`, and disable polling while in error/unauth states.

#### RT-12: Server Actions Returning `Date` (and other non-plain values) Can Cause 500s
- **Files:**
  - `actions/client-actions.ts:getClients` returns `createdAt: Date` via `...rest` (selected at line ~124).
  - `actions/lead-actions.ts:transformLeadToConversation` returns multiple `Date | null` fields (e.g., `currentReplierSince`, `scoredAt`, `assignedAt`, message `timestamp: msg.sentAt`).
- Risk: if a Server Action returns values that can't cross the Server→Client boundary cleanly, Next will throw during serialization, surfacing as a digest-only 500 even when the action "logically succeeded".
- **Action:** In 117a/117b, explicitly audit and eliminate non-plain return values from inbox-critical Server Actions:
  - Convert `Date` to ISO strings (or omit the field if unused).
  - Ensure `error` return fields are strings (not `Error` objects).

### HIGH

#### RT-3: `app/page.tsx` Silently Swallows `getClients()` Failures
- **File:** `app/page.tsx:70-78`
- If `result.success === false`, nothing happens — no error UI, no retry. Workspace list stays empty → cascades into RT-2 (null clientId query).
- **Action:** Add error handling branch in 117b.

#### RT-4: Middleware Fail-Open → Misleading "Not Authenticated" Errors
- **File:** `lib/supabase/middleware.ts:244-269`
- On non-auth errors (e.g., Supabase timeout/AbortError), middleware fails open with stale cookies. Server Action's `requireAuthUser()` then times out → "Not authenticated" (misleading — real issue is Supabase latency).
- **Action:** Check for AbortError patterns in 117a; distinguish `auth_timeout` from `not_authenticated` in 117c; document in 117e runbook.

#### RT-5: Calendly Webhook Signature Verification Is Optional
- **File:** `app/api/webhooks/calendly/[clientId]/route.ts:82-92`
- Missing signing key → accepts any POST with warning log. Forged events create appointments, trigger/pause follow-up sequences.
- **Action:** Explicitly flag in 117d audit output.

### MEDIUM

#### RT-6: Filter Type Safety Violation
- **File:** `components/dashboard/inbox-view.tsx:265`
- `activeFilter as "responses" | ... | undefined` casts `""` to a union that doesn't include `""`.
- **Action:** Convert `""` → `undefined` in 117b (plan already identifies this correctly).

#### RT-7: No `serverActions.allowedOrigins` in `next.config.mjs`
- No `experimental.serverActions.allowedOrigins` configured. If custom domain/proxy is used, Server Actions fail with CSRF origin mismatch.
- **Action:** In 117d, configure `experimental.serverActions.allowedOrigins` via an env-driven allowlist so both current and future domains can be supported securely (no wildcard).

#### RT-8: Phase 117c Validation Missing Standard Suite
- 117c validation omits `npm run typecheck`, `npm run lint`, `npm run build`.
- **Action:** Add to 117c validation section.

#### RT-9: `getConversationsCursor` Catch Block Leaks Error Details
- **File:** `actions/lead-actions.ts:1409-1418`
- Raw `error.message` returned to client — could include SQL/table names for Prisma errors.
- **Action:** Apply safe error helper to return values in 117c.

#### RT-11: Auth Error Noise in Production Logs
- **File:** `actions/lead-actions.ts:1409-1411`
- `console.error` fires for all errors including auth. With 30s polling, expired sessions spam logs.
- **Action:** Apply `getInboxCounts` auth-silencing pattern (line 773-778) in 117b/117c.

#### RT-13: Multiple Supabase GoTrueClient Instances (Console Warning)
- Jam console shows: "Multiple GoTrueClient instances detected in the same browser context... may produce undefined behavior when used concurrently under the same storage key."
- **File:** `lib/supabase/client.ts` creates a new browser client on every call (no singleton).
- **Action:** Non-blocking hardening in 117d (or follow-up): memoize the browser client instance (module-level or `globalThis`) to reduce undefined auth storage behavior.

### LOW

#### RT-10: Phase 117e Rollback Steps Lack Specificity
- "Revert to last known-good" without concrete commands, verification, or decision threshold.
- **Action:** Add `vercel list`, `vercel promote`, verification step, "rollback if > 3 unique 500s in 10 min" in 117e.

### Repo mismatches (fix the plan)
- Next.js build artifacts for Server Action ID mapping are version-sensitive (Next `16.0.x`).
  - Mitigation: don't rely on a single manifest filename; after `npm run build`, use `rg` to search `.next/` for the action IDs.

### Security / permissions
- Server Actions are public HTTP endpoints.
  - Mitigation: ensure `requireAuthUser()` / `resolveClientScope()` remain the gating layer for inbox queries and are not bypassed by new parsing/coercion.
- All 11 cron routes validate `CRON_SECRET` ✅. All webhook routes validate secrets (Calendly is enforced in production; see RT-5). All admin routes validate Bearer tokens ✅.

### Testing / validation
- There is no explicit regression test ensuring "invalid filter inputs" and "no workspace selected" do not produce 500s.
  - Mitigation: add minimal unit coverage and/or a smoke Playwright check (if already present) as part of Phase 117b/117d validation.

## Open Questions (Need Human Input)

- [ ] Are any production workspaces actively using Calendly webhooks without signing keys? (confidence ~80%)
  - Why it matters: production policy is to enforce signatures; any workspace missing a signing key will fail webhook ingestion until fixed.
  - Current assumption in this plan: run the admin fix endpoint (`app/api/admin/fix-calendly-webhooks/route.ts`) and/or re-connect Calendly using an OAuth app so `calendlyWebhookSigningKey` is present for every production workspace.

## Subphase Index
* a — Repro + root cause identification (Jam → action IDs → local build manifest → logs)
* b — Fix: make Inbox server actions non-500 + guard client query initiation
* c — Observability hardening (safe error capture + correlation IDs; no PII)
* d — Production readiness sweep (env/crons/webhooks auth + smoke checklist)
* e — Launch + rollback runbook (deploy sequence, monitoring, and emergency levers)

## Phase Summary (running)
- 2026-02-07 — Created Phase 117 plan and ran an initial RED TEAM pass based on Jam evidence; captured high-risk failure modes + open questions. (files: `docs/planning/phase-117/*`)
- 2026-02-07 — **RED TEAM deep review:** Verified all file paths + code against repo reality. Key correction: auth calls ARE inside try/catch (root cause is NOT unhandled auth throws). Identified 12 findings (2 Critical, 4 High, 5 Medium, 1 Low). Most likely root cause: Prisma module-load crash (RT-1). Added 3 new work items to 117b (client-side error handling, refetchInterval gate, auth-error silencing). Refined all subphases with specific line references and concrete remediation steps.
- 2026-02-08 — Resolved launch decisions (All Workspaces supported; custom domain planned) and tightened Phase 117 to address Jam evidence (`clientId:{}`/`cursor:{}`) + Server Action serialization risk (RT-12). Converted subphase docs to track planned vs actual Output/Handoff for Terminus Maximus execution. (files: `docs/planning/phase-117/*`)
- 2026-02-08 — Implemented Inbox hardening and closed the local repro class: wire-safe Server Action outputs, query gating to prevent invalid placeholders, safe error shaping + debug refs, Supabase browser client singleton, and env-driven Server Actions origin allowlisting. Ran `typecheck`, `test`, `lint`, `build`. (files: `actions/client-actions.ts`, `actions/lead-actions.ts`, `app/page.tsx`, `components/dashboard/inbox-view.tsx`, `lib/prisma.ts`, `lib/safe-action-error.ts`, `lib/supabase/client.ts`, `next.config.mjs`, `scripts/test-orchestrator.ts`)
