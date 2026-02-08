# Phase 117a — Repro + Root Cause Identification (Jam → Action IDs → Logs)

## Focus
Turn the Jam “Error loading conversations” report into a deterministic repro and identify the real underlying exception behind the digest-only Server Components render error.

## Inputs
- Jam report: `https://jam.dev/c/1ad53b5c-5bbe-4c7e-a545-fc71739582ac`
- Client callsites:
  - `components/dashboard/inbox-view.tsx` (calls `getConversationsCursor(...)`)
  - `app/page.tsx` (calls `getClients()`)
- Server actions:
  - `actions/lead-actions.ts` (`getConversationsCursor`)
  - `actions/client-actions.ts` (`getClients`)
- Auth/session plumbing:
  - `middleware.ts`
  - `lib/supabase/middleware.ts`
  - `lib/workspace-access.ts` (`requireAuthUser`, `resolveClientScope`)
- DB client init:
  - `lib/prisma.ts`

## Work

### Step 0 — Environment Pre-Flight (RT-1, highest-priority diagnostic)
Check `DATABASE_URL` first — a missing/malformed value causes **all** Server Actions to crash at import time with a module-level error (digest-only 500). This is the most likely single-point-of-failure matching the Jam evidence.
- Verify `.env.local` has a valid `DATABASE_URL` and `DIRECT_URL`.
  - If missing/empty: `vercel env pull .env.local`.
- Verify Vercel Production env has `DATABASE_URL` set:
  - `vercel env ls --environment production` (look for `DATABASE_URL`).
- Quick reachability check: `npx prisma db execute --stdin <<< "SELECT 1"` (uses `DIRECT_URL`).

### Step 1 — Confirm Jam Evidence Points to Server Actions
- Note `next-action` headers and the repeated `POST /` calls returning 500.
- Capture the digest value shown in the UI (from Jam screenshot) for correlation.

### Step 2 — Map `next-action` IDs to Specific Functions (local build manifest)
- Run `npm run build`.
- Map IDs using a build-output search (Next build artifacts can change filenames across versions):
  - `rg -n "4064c1fbbbb0d620f8508228282abd391b3af36ad6" .next`
  - `rg -n "4047f2f67240bd11d1791bfeb6a4b7aaa683d346a3" .next`
  - The match context should reveal the manifest entry that maps action ID → module/exported function.
- If needed, inspect `.next/server/*manifest*.json` near the match location.
- Expected mapping (hypothesis based on request arg shapes):
  - `4064c1f...` → `getConversationsCursor`
  - `4047f2f...` → `getClients`

### Step 3 — Reproduce Locally with Production-Like Env
- Start dev server with `.env.local` loaded and navigate to `/`.
- Confirm whether Server Action calls succeed:
  - `getClients()` populates sidebar workspaces.
  - `getConversationsCursor()` loads a first page without throwing.
- Capture server-side logs for the first failing request (we need the true exception message).

### Step 4 — Narrow the Failure Class (updated decision tree)
- If **all server actions** invoked from `/` fail:
  - suspect env/DB connectivity (`DATABASE_URL`), Prisma module-load crash (RT-1), Server Action return-value serialization failures (RT-12), or middleware session refresh crashes.
- If only **inbox actions** fail:
  - suspect query perf/timeouts, arg decoding/shape mismatch, return-value serialization failures (RT-12), or RBAC scope edge case.
- If failures occur when `activeWorkspace` is unset (All Workspaces view):
  - suspect invalid params being passed to the action (Jam shows `clientId: {}` and `cursor: {}`), and/or scope fan-out/perf (large `clientIds` list) and/or DB statement timeout.
  - Note: this is amplified by `refetchInterval: 30000` which re-fires the failing query every 30s (RT-NEW-1).

### Step 5 — Check Vercel Logs for Specific Error Patterns (RT-4 awareness)
Use Vercel logs for the affected deployment to retrieve the real stack/error behind the digest:
- `vercel list --environment production --status READY --yes`
- `vercel logs <deployment-url>`
- **Search for these specific patterns:**
  - Prisma adapter errors (e.g., `PrismaPg`, `P1001`, `ECONNREFUSED`)
  - `AbortError` — indicates Supabase auth timeout in middleware (RT-4)
  - `supabase.auth.getUser threw:` — middleware timeout cascade
  - `[middleware]` prefix — any middleware-level failures
- If "Not authenticated" errors appear without corresponding login failures, suspect Supabase latency (not actual missing credentials).

## Planned Output
- A root-cause classification (env/DB vs middleware/auth vs action arg mismatch vs query perf) with:
  - which action(s) are failing
  - the first concrete stack/error message (not a digest)
  - the minimal repro steps

## Planned Handoff
- Phase 117b implements the smallest fix that eliminates the 500 and restores Master Inbox load.

## Output

- Root cause (highest confidence): inbox-critical Server Actions returned non-plain values (notably `Date` instances) which can throw during Server Action serialization, surfacing as HTTP 500 + digest-only “Server Components render” errors in production (Jam).
- Amplifiers:
  - Conversations query fired before workspaces were loaded, sending invalid placeholders (`clientId: {}` / `cursor: {}`) and then re-polling every 30s.
  - Empty-string filters (`filter: ""`) were being cast into a union and passed through to the action layer.
- Fix strategy: make Server Action return payloads wire-safe (ISO strings / omit unused fields), gate initial queries until workspaces are loaded, and disable polling while erroring/unready.

## Handoff

- Execute Phase 117b: serialize/omit `Date` fields in Server Action outputs, guard the client query initiation path (including All Workspaces), and add custom-domain-safe Server Actions origin allowlisting.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Pulled Jam artifacts and confirmed Server Actions are returning HTTP 500 with digest-only payloads; request body includes invalid placeholders (`clientId: {}`, `cursor: {}`, `filter: ""`).
  - Audited repo touchpoints and identified a likely root cause class: Server Actions returning `Date` values across the Server→Client boundary (e.g., `getClients.createdAt`, conversation timestamps), which can throw during serialization (RT-12).
  - Updated Phase 117 plans to reflect resolved decisions (All Workspaces supported; custom domain planned) and added an env-driven Server Actions origin allowlist strategy.
- Commands run:
  - `git status --porcelain` — found untracked `docs/planning/phase-117/` only
  - `sed/rg/nl` inspections: `next.config.mjs`, `lib/prisma.ts`, `actions/client-actions.ts`, `actions/lead-actions.ts`, `lib/workspace-access.ts`
  - Jam MCP: `getDetails`, `getNetworkRequests`, `getConsoleLogs`, `getUserEvents`
- Blockers:
  - None (Phase 117b can proceed without additional user input).
- Next concrete steps:
  - Execute 117b with a focus on: (1) make Server Action returns plain/serializable, (2) fix invalid `clientId`/`cursor` placeholders, (3) keep All Workspaces supported without a polling-driven 500 loop.
