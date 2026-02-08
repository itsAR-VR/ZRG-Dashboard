# Phase 118 — v1.16 Launch: Ship Inbox Fix + Final Production Hardening

## Purpose
Ship v1.16 safely by landing the Phase 117 Inbox fix (Jam “Error loading conversations”) plus custom-domain-safe Server Actions allowlisting, then executing production smoke tests, security checks, and a concrete rollback runbook.

## Context
- Phase 116 (“AI auto-send revision tracking + rollout controls”) is complete locally but still requires a manual production canary execution (`docs/planning/phase-116/e/plan.md`).
- Phase 117 addressed a launch blocker from Jam: Master Inbox showed a digest-only Next.js error while Server Actions returned HTTP 500. The fix set is implemented locally and passes local quality gates, but still needs commit + production verification.
- Launch decisions (user-confirmed):
  - Inbox must support **All Workspaces** (no selected workspace).
  - A **custom domain** will be used in the future. We must not rely on the current `*.vercel.app` domain; Server Actions must support multiple domains securely (no wildcard allow-all by default).
    - Planned domains: `cold2close.ai` and `app.codex.ai`.

## Concurrent Phases

| Phase | Status | Overlap | Coordination |
|-------|--------|---------|--------------|
| Phase 117 | In progress (code changes pending commit) | Inbox Server Actions, `next.config.mjs` allowedOrigins, Prisma/Supabase hardening | Phase 118 packages “ship + verify + runbook” work; do not duplicate Phase 117 implementation decisions. |
| Phase 116 | Shipped (canary pending) | rollout toggles + runbooks | Only proceed with Phase 116 canary after inbox stability is confirmed in production. |

## Repo Reality Check (RED TEAM)
- What exists today:
  - Phase 116 is complete and includes canary steps: `docs/planning/phase-116/e/plan.md`.
  - Phase 117 is the launch-blocker fix plan for the Master Inbox Jam: `docs/planning/phase-117/plan.md`.
  - In this workspace, Phase 117 implementation changes are present but not yet committed (must be handled in Phase 118a).
  - Server Actions origin allowlisting is implemented in `next.config.mjs` and is driven by:
    - `SERVER_ACTIONS_ALLOWED_ORIGINS` (explicit allowlist), plus
    - hostnames parsed from `NEXT_PUBLIC_APP_URL` and `VERCEL_URL`.
- What this phase assumes:
  - The production deploy path is either Git-integrated (push to `main`) or via Vercel CLI. If neither is true, Phase 118b must be adapted.
  - A custom domain name is known (or will be known before DNS cutover) so `SERVER_ACTIONS_ALLOWED_ORIGINS` can be set explicitly.

## Objectives
* [ ] Consolidate and commit the Phase 117 fix set (code + planning docs) with quality gates.
* [ ] Deploy to production and confirm the Jam repro is resolved (Inbox loads).
* [ ] Ensure Server Actions allowlisting supports current + future custom domain(s) securely.
* [ ] Audit cron/webhook auth and close any remaining launch blockers (explicitly resolve the Calendly signing-key risk).
* [ ] Produce a final launch + rollback runbook and link it from repo docs if needed.

## Constraints
- Do not log secrets or PII (message bodies, emails, phone numbers, tokens) in logs or docs.
- Keep scope to launch-readiness + safety. No feature expansion.
- Preserve RBAC (`requireAuthUser`, `resolveClientScope`, etc.) and do not bypass server-side access checks.
- Server Actions must return serializable data across the Server→Client boundary (no `Date` instances, no `Error` objects).
- Security default must remain safe: same-origin only unless an explicit allowlist is configured.

## Success Criteria
- [ ] The Phase 117 fix set is committed on `main`, and `npm run typecheck`, `npm test`, `npm run lint`, `npm run build` all pass.
- [ ] Production smoke:
  - Login works (no redirect loop).
  - Master Inbox renders without “Error loading conversations”.
  - Selecting a workspace loads conversations.
  - **All Workspaces** loads combined conversations without a polling-driven 500 loop.
  - No Server Action 500s with digest suffix `@E352` (invalid `"use server"` exports).
- [ ] `SERVER_ACTIONS_ALLOWED_ORIGINS` is documented and (when a custom domain is introduced) configured so Server Actions continue to work on both the Vercel domain and the custom domain.
- [ ] Cron endpoints require `Authorization: Bearer <CRON_SECRET>` and return 401 without it.
- [ ] Webhooks have required secrets; Calendly webhook signature enforcement risk is explicitly resolved (enforced or accepted with mitigation).
- [ ] Rollback/runbook is decision-complete (thresholds + commands + verification steps).

## RED TEAM Findings (Gaps / Weak Spots)

### Highest-risk failure modes
- Fixes remain uncommitted → ship process stalls / deploy drifts.
  - Mitigation: Phase 118a requires a clean two-commit structure (code, then docs) with quality gates re-run immediately before commit.
- Production smoke not executed → Jam “fixed locally” but still broken in prod.
  - Mitigation: Phase 118b is mandatory; do not proceed to Phase 116 canary until it passes.
- Custom domain cutover breaks Server Actions due to CSRF origin mismatch.
  - Mitigation: Phase 118c documents `SERVER_ACTIONS_ALLOWED_ORIGINS` format and requires setting it in Vercel Production before DNS cutover.
- Calendly webhook unsigned acceptance remains ambiguous.
  - Mitigation: Phase 118d forces an explicit decision (enforce signing key vs accept risk with mitigations).
- A `"use server"` module exports a non-function value → Next.js throws `E352` and **all** Server Actions for `/` fail with digest-only 500s (Jam symptom).
  - Mitigation: keep the regression test `lib/__tests__/use-server-exports.test.ts` and add a pre-deploy sanity check (`rg '^export (const|let|var|class|default)' actions` should be empty).

## Open Questions (Need Human Input)
- [x] What is the intended custom domain (or domain family) we should support via `SERVER_ACTIONS_ALLOWED_ORIGINS`?
  - Answer: `cold2close.ai` and `app.codex.ai` (treat both as first-class for cutover).
- [x] What is the production deploy path for this repo? Git-integrated deploy on push to `main`, or Vercel CLI (`vercel --prod`)?
  - Answer: Git-integrated deploy on push to `main`.
- [x] Calendly webhook signing key policy: enforce for production workspaces, or accept risk with mitigations?
  - Answer: enforce signing key for production webhooks.

## Subphase Index
* a — Consolidate, verify, and commit Phase 117 fix set
* b — Production deploy + smoke verification (Jam repro)
* c — Custom-domain readiness (Server Actions allowlist + docs)
* d — Security/ops audit (cron + webhooks) and remaining launch blockers
* e — Final runbook + Phase 116 canary scheduling

## Phase Summary (running)
- 2026-02-08 — Loaded Jam via MCP and confirmed repeated Server Action 500s with invalid placeholders. Enforced Calendly webhook signature verification in production, required `NEXT_PUBLIC_APP_URL` for production link/webhook URL generation, and updated custom-domain allowlist docs for `cold2close.ai` + `app.codex.ai`. (files: `app/api/webhooks/calendly/[clientId]/route.ts`, `actions/calendly-actions.ts`, `app/api/admin/fix-calendly-webhooks/route.ts`, `lib/app-url.ts`, `next.config.mjs`, `README.md`, `components/dashboard/settings/integrations-manager.tsx`, `docs/planning/phase-117/*`, `docs/planning/phase-118/*`)
- 2026-02-08 — Root-caused the production Server Action digest suffix `@E352` to a non-function export in a `"use server"` module. Removed the offending export from `actions/ai-ops-feed-actions.ts` by moving test-only helpers into `lib/ai-ops-feed-internals.ts`, and added a regression test to prevent `"use server"` export violations. This unblocks all Server Actions on `/` (workspaces + Inbox). (files: `actions/ai-ops-feed-actions.ts`, `lib/ai-ops-feed-internals.ts`, `lib/__tests__/ai-ops-feed.test.ts`, `lib/__tests__/use-server-exports.test.ts`, `docs/planning/phase-118/b/plan.md`)
