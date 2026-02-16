# Phase 158d — Server Action Drift Warning Mitigation (Decision + Fix)

## Focus
Reduce or responsibly handle the high-volume warnings:
`Failed to find Server Action "<id>". This request might be from an older or newer deployment.`

## Inputs
- Phase 158a issue inventory (counts, request paths: `POST /`, `POST /auth/login`, status `404`).
- Relevant routes/pages/components that define server actions for:
  - login/auth flows
  - dashboard root actions

## Work
- Determine whether these warnings are:
  1) Normal after deployments (stale open tabs / cached HTML), or
  2) A caching/misrouting issue causing action requests to hit a deployment that doesn’t contain the referenced action.
- Investigate caching/dynamic config for `/` and `/auth/login`:
  - Ensure routes are dynamic where appropriate (auth pages should not be statically cached across deployments).
  - If static caching is intentional, ensure it does not ship server-action IDs that can go stale.
- Decide on mitigation strategy:
  - If server-side elimination is not feasible, implement a UX fallback so affected users get a clear “App updated — refresh” path instead of silent failures.

## Validation (RED TEAM)
- Confirm warning distribution from export:
  - `528` total `Failed to find Server Action` warnings (`/auth/login`: `278`, `/`: `249`, `/index`: `1`).
  - status distribution `404:442`, blank status remainder.
- Confirm mitigation paths exist:
  - login action error path shows refresh message + hard reload.
  - dashboard workspace bootstrap error path offers reload CTA when version skew is detected.
  - root/login route headers now use `Cache-Control: no-store`.
- Context7 grounding (Next.js docs):
  - Version skew is expected when active clients run old assets against newer deploys.
  - `deploymentId` is the documented protection mechanism for skew detection + hard navigation fallback.

## Output
- Decision:
  - Warning storm is primarily version skew/stale-client traffic across deployments (not a single broken server action). Full server-side elimination is not realistic while old tabs remain open, so mitigation is to reduce stale cache exposure and provide explicit refresh fallback UX.
- Implemented mitigation:
  - Added shared detector: `lib/server-action-version-skew.ts`.
  - `app/auth/login/page.tsx` now detects version-skew action errors and forces refresh after showing `App update detected. Please refresh and try again.`.
  - `components/dashboard/dashboard-shell.tsx` now maps workspace bootstrap version-skew failures to refresh-required messaging and swaps Retry → Reload CTA.
  - `next.config.mjs` now sets:
    - `deploymentId` from deployment envs (supports Next.js version-skew protection),
    - `Cache-Control: no-store` headers for `/` and `/auth/login` to reduce stale action payload reuse.
- Coordination notes:
  - `next.config.mjs` is shared with Phase 159 (Server Actions body-size work); changes were merged additively without removing existing body-size/origin settings.
  - `/` behavior is touched by older dashboard phases; mitigation was limited to error handling and cache headers only.

## Handoff
Proceed to Phase 158e to validate locally and confirm the warning/error signatures stop appearing post-deploy.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Parsed warning export specifically for server-action IDs/status/path distribution.
  - Pulled Next.js docs via Context7 to confirm version-skew model + `deploymentId` guidance before coding.
  - Implemented route-level and client-fallback mitigations with minimal surface area.
- Commands run:
  - `node ... (server-action warning counts/status/action IDs)` — pass.
  - `mcp__context7__resolve-library-id` (`next.js`) — pass.
  - `mcp__context7__query-docs` (version skew + deploymentId guidance) — pass.
- Blockers:
  - Residual warning noise from already-open stale tabs may persist until clients refresh.
- Next concrete steps:
  - Validate full gate suite + replay outputs and record production follow-up blocker (158e).
