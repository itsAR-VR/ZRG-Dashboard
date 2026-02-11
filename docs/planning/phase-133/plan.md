# Phase 133 — EmailBison Quick Access Deep Link (Lead Drawers)

## Purpose
Add “Open in EmailBison” quick-access links in the dashboard so clients can jump from a lead record to the correct EmailBison inbox view. (SmartLead/Instantly are explicitly deferred to a later phase.)

## Context
- GoHighLevel already has an “Open in Go High-Level” deep link in both lead drawers.
- EmailBison web UI deep link pattern (provided by user):
  - `https://<emailbison-base-origin>/inbox/replies/<reply_uuid>`
- EmailBison base origin must support white-label accounts per workspace:
  - Prefer `Client.emailBisonBaseHost.host` (hostname-only allowlist already exists in the repo)
  - Fallback: `EMAILBISON_BASE_URL`
  - Final fallback: `https://send.meetinboxxia.com`
- We already store EmailBison numeric reply IDs in the DB:
  - `Message.emailBisonReplyId = String(reply.id)` for EmailBison provider webhooks
  - SmartLead/Instantly also use `Message.emailBisonReplyId` but with prefixed handles (`smartlead:` / `instantly:`), so EmailBison-only logic must exclude those prefixes.
- Security requirement: never expose EmailBison API keys to the browser. Deep-link resolution must be server-side.
- UI placement decision (locked): add the EmailBison button directly below the existing GHL button in:
  - `components/dashboard/crm-drawer.tsx`
  - `components/dashboard/crm-view.tsx`

## Concurrent Phases
Overlap scan performed against the last 10 phases and current repo state (`git status --porcelain` shows a dirty working tree).

| Phase | Status | Overlap | Coordination |
|-------|--------|---------|--------------|
| Phase 132 | Active (uncommitted changes + planning artifacts) | Files: `components/dashboard/crm-drawer.tsx`, `scripts/test-orchestrator.ts` | Re-read current file state before editing; make changes only in the “Actions” area around the existing GHL link and merge carefully with response-timing UI work. |
| Phase 131 | Active (uncommitted changes + planning artifacts) | None expected | Independent; no coordination needed unless shared files are edited. |
| Phase 127 | Active (uncommitted changes) | None expected | Avoid touching memory-governance/conﬁdence UI files during this phase. |
| Working tree | Dirty | Many modified files unrelated to EmailBison deep links | Keep Phase 133 scoped to EmailBison deep link + lead drawer UI only. |

## Objectives
* [x] Add a server-side resolver that returns an EmailBison web UI deep link URL for a lead.
* [x] Add “Open in EmailBison” buttons in both lead drawers below the existing GHL button.
* [x] Ensure the link uses the per-workspace EmailBison base origin (white-label support) with safe fallbacks.
* [x] Add minimal unit tests for the reply UUID selection logic and pass quality gates.

## Constraints
- Never commit secrets/tokens/PII.
- Do not expose API keys to the client; deep-link resolution must run server-side.
- Only ship EmailBison in this phase; SmartLead/Instantly deep links are deferred.
- Visibility rule (locked): show the EmailBison button only when configured for the lead (at minimum `lead.emailBisonLeadId` truthy).
- Keep server action return shape consistent: `{ success, url?, error? }`.
- Avoid Playwright/live-web probing in this phase; rely on the confirmed EmailBison URL pattern.

## Success Criteria
- [x] In `crm-drawer` and `crm-view` lead drawers, EmailBison leads show an “Open in EmailBison” button under the existing GHL button.
- [x] Clicking opens a new tab to `https://<workspace-emailbison-origin>/inbox/replies/<uuid>`.
- [x] White-label base origin selection works (workspace-specific `emailBisonBaseHost.host` wins).
- [x] No secrets are ever sent to the browser.
- [x] Quality gates pass: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`.

## Subphase Index
* a — Deep-link contract + base-origin helpers + reply UUID selection rules
* b — Server action: resolve EmailBison reply URL for a lead
* c — UI: add “Open in EmailBison” buttons to both lead drawers
* d — Tests + quality gates + rollout notes

## Phase Summary
- Shipped:
  - Server action: `actions/emailbison-link-actions.ts` (`resolveEmailBisonReplyUrlForLead`)
  - UI buttons: `components/dashboard/crm-drawer.tsx`, `components/dashboard/crm-view.tsx`
  - Helper + tests: `lib/emailbison-deeplink.ts`, `lib/__tests__/emailbison-deeplink.test.ts`
- Verified:
  - `npm run lint`: pass (warnings only)
  - `npm run typecheck`: pass
  - `npm test`: pass
  - `npm run build`: pass
  - `npm run db:push`: skip (schema changes not part of Phase 133; working tree contains other active phases)
- Notes:
  - SmartLead/Instantly deep links are explicitly deferred.

## Repo Reality Check (RED TEAM)
- What exists today:
  - Server action: `actions/emailbison-link-actions.ts` (`resolveEmailBisonReplyUrlForLead`)
  - UI buttons: `components/dashboard/crm-drawer.tsx`, `components/dashboard/crm-view.tsx`
  - Helper + tests: `lib/emailbison-deeplink.ts`, `lib/__tests__/emailbison-deeplink.test.ts`
- Verified touch points:
  - `fetchEmailBisonReplies` (`lib/emailbison-api.ts`)
  - `resolveEmailIntegrationProvider` (`lib/email-integration.ts`)
  - `requireLeadAccessById` (`lib/workspace-access.ts`)
- Multi-agent context:
  - `components/dashboard/crm-drawer.tsx` and `scripts/test-orchestrator.ts` were also modified by Phase 132; Phase 133 changes were merged in-place around the existing “Actions” UI and test allowlist.

## RED TEAM Findings (Gaps / Weak Spots)

### Highest-risk failure modes
- Popup blockers can prevent opening a new tab in some browsers → mitigation: open a blank tab synchronously; if blocked, show a toast and skip the server call.
- EmailBison API outages/latency → mitigation: server action returns `{ success:false, error }`, UI closes the blank tab and shows a toast.

### Performance / timeouts
- Resolving the deep link fetches all replies for the lead → acceptable for user-initiated navigation; if this becomes slow, consider adding an EmailBison API endpoint for “latest reply with uuid”.

### Testing / validation
- Unit tests cover UUID selection only; server action behavior is validated via `npm run typecheck` + `npm test` (no live EmailBison integration test in this phase).

## Assumptions (Agent)
- EmailBison UI deep-link format stays `https://<base-origin>/inbox/replies/<reply_uuid>` (confidence ~95%).
