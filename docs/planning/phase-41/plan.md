# Phase 41 — Fix Email Campaign Sync + Booking Campaign Visibility

## Purpose
Restore reliable **Sync Email** behavior so Email campaigns populate correctly across the dashboard (including Booking-related views), and make failures (notably `401`) actionable instead of “Unknown error”.

## Context
Jam report (`914c06b0-c672-4658-bf3b-e5f20567c426`, recorded **January 19, 2026**) shows:
- Navigating to **Settings → Integrations**
- Clicking **Sync Email**
- Immediate toast error: `EmailBison campaigns fetch failed (401): Unknown error` (Jam transcript reads “Emailson”, but this maps to the EmailBison client codepath)

Impact: when Sync Email fails, the dashboard does not have a complete set of email campaigns in the database, so campaign-driven UIs (e.g. Booking/campaign assignment flows) appear incomplete.

Most likely touch points:
- UI trigger: `components/dashboard/settings/integrations-manager.tsx` (`handleSyncEmailCampaigns`)
- Server action: `actions/email-campaign-actions.ts` (`syncEmailCampaignsFromEmailBison`, plus SmartLead/Instantly variants)
- Provider client: `lib/emailbison-api.ts` (`fetchEmailBisonCampaigns`)
- Provider resolution rules: `lib/email-integration.ts` (`resolveEmailIntegrationProvider`)
- Booking/campaign UI surface: `components/dashboard/settings-view.tsx` (Settings → Booking tab) and `components/dashboard/settings/ai-campaign-assignment.tsx` (`getEmailCampaigns`)

## Repo Reality Check (RED TEAM)

- What exists today:
  - `handleSyncEmailCampaigns(...)` runs on Settings → Integrations, infers a provider client-side, then calls one server action:
    - `actions/email-campaign-actions.ts:syncEmailCampaignsFromEmailBison` (or SmartLead/Instantly variants)
  - `syncEmailCampaignsFromEmailBison(...)`:
    - is admin-gated (`requireClientAdminAccess(clientId)`)
    - resolves provider via `lib/email-integration.ts:resolveEmailIntegrationProvider(...)`
    - calls `lib/emailbison-api.ts:fetchEmailBisonCampaigns(apiKey)`
    - upserts `EmailCampaign` rows using `@@unique([clientId, bisonCampaignId])`
    - currently revalidates only `revalidatePath("/")` (may not refresh `/settings/*` UI without additional work)
  - `lib/emailbison-api.ts`:
    - uses `https://send.meetinboxxia.com` as the base URL
    - uses a timeout + bounded retries in `emailBisonFetch()` (`EMAILBISON_TIMEOUT_MS`, `EMAILBISON_MAX_RETRIES`)
    - error strings currently fall back to `"Unknown error"` when the upstream body is not JSON or lacks `error/message`
  - Booking-related campaign UI uses `getEmailCampaigns(activeWorkspace)` in `components/dashboard/settings/ai-campaign-assignment.tsx` and is rendered under `components/dashboard/settings-view.tsx` → Booking tab.
- What the plan assumes:
  - The observed `401` is from the EmailBison upstream call (not from Supabase/app auth).
  - A credentials issue is the most common cause, but “URL/key mismatch” is also plausible (EmailBison/Inboxxia appears to couple keys to a specific base URL).
- Verified touch points:
  - `components/dashboard/settings/integrations-manager.tsx` (`inferEmailProvider`, `handleSyncEmailCampaigns`)
  - `actions/email-campaign-actions.ts` (`syncEmailCampaignsFromEmailBison`, `getEmailCampaigns`)
  - `lib/emailbison-api.ts` (`fetchEmailBisonCampaigns`, `emailBisonFetch`, `EMAILBISON_TIMEOUT_MS`, `EMAILBISON_MAX_RETRIES`)
  - `lib/email-integration.ts` (`resolveEmailIntegrationProvider`)
  - `components/dashboard/settings-view.tsx`, `components/dashboard/settings/ai-campaign-assignment.tsx`
  - `prisma/schema.prisma` (`model EmailCampaign`, `@@unique([clientId, bisonCampaignId])`)

## Concurrent Phases

| Phase | Status | Overlap | Coordination |
|-------|--------|---------|--------------|
| Phase 42 | Active (plan exists; may run concurrently) | Domain: EmailBison auth + 401 diagnostics; File: `lib/emailbison-api.ts` | Avoid duplicate fixes; decide whether Phase 41 owns the 401 mapping + diagnostics, or Phase 42 does. If both proceed, merge changes intentionally and keep error messages consistent. |
| Phase 40 | Active (uncommitted working tree changes) | Files: `scripts/crawl4ai/*` | Avoid touching Crawl4AI deployment work while addressing Phase 41; resolve/stash/commit separately before merging. |
| Phase 39 | Reference | Files: `actions/email-campaign-actions.ts`, `components/dashboard/settings/ai-campaign-assignment.tsx` | Reuse existing patterns for campaign assignment UI (booking + persona assignment). |
| Phase 37 | Reference | File: `components/dashboard/settings/integrations-manager.tsx` | Keep integration settings patterns consistent (provider inference, toasts, admin gating). |
| Phase 36 | Reference | File: `components/dashboard/settings/ai-campaign-assignment.tsx` | Booking process assignment lives here; ensure campaign sync restores this view’s completeness. |

## Pre-Flight Conflict Check

- [ ] Run `git status --porcelain` and confirm only expected in-progress files are modified (EmailBison + Crawl4AI).
- [ ] Re-read current state of `lib/emailbison-api.ts` before editing (Phase 42 overlap; working tree may already contain partial fixes).
- [ ] Confirm no Prisma/schema changes are required for this phase; if schema changes become necessary, stop and coordinate before proceeding.

## Objectives
* [ ] Make Sync Email failures diagnosable (safe logging + actionable UX messages)
* [ ] Restore successful EmailBison campaign sync when credentials are valid
* [ ] Ensure Booking/campaign UIs reflect the latest synced campaigns
* [ ] Add regression coverage and a verification checklist matching the Jam repro

## Constraints
- Do not log or expose secrets (EmailBison/SmartLead/Instantly API keys, webhook secrets).
- Keep the **single-select email provider** model intact (`Client.emailProvider` with strict resolution rules).
- Server actions and API routes must continue returning structured `{ success, data?, error? }` responses.
- Changes must not break SmartLead/Instantly campaign sync paths.

## Non-Goals
- Adding multi-provider selection or changing provider resolution rules (keep the single-select model).
- Large refactors of settings UI state management (only changes needed to refresh campaign views after a sync).
- Changing EmailBison base URL semantics or credentials storage format without explicit confirmation.

## Success Criteria
- [ ] On `/settings/integrations`, clicking **Sync Email** for an EmailBison workspace with valid credentials inserts/updates campaigns and the campaigns show up in Settings → Booking (campaign assignment table) without needing a hard refresh. *(Implemented; requires manual verification with a known-good API key.)*
- [x] Sync includes **all** upstream campaigns (handle pagination/limits so we don’t silently omit campaigns). *(Implemented via EmailBison pagination support; verify with a large campaign set if applicable.)*
- [x] If the upstream returns `401`, the UI shows a clear instruction that explicitly mentions **URL/key mismatch** (not “Unknown error”), and server logs contain enough detail (status + safe payload summary) to debug.
- [x] No regressions for SmartLead/Instantly campaign sync (build passes; changes limited to revalidation + shared UX).

## Subphase Index
* a — Reproduce + add safe diagnostics for Sync Email
* b — Fix EmailBison campaign sync (auth, request shape, and error mapping)
* c — Fix Booking/campaign UI refresh and empty-state handling
* d — Tests + verification runbook (Jam-aligned)
* e — Coordination + UI refresh strategy + hardening gaps (RED TEAM)

## RED TEAM Findings (Gaps / Weak Spots)

### Highest-risk failure modes
- **401 is not “expired key”, but URL/key coupling or missing workspace scoping** → ensure the plan verifies base URL + endpoint path + whether `emailBisonWorkspaceId` is required for campaign listing; craft 401 message to hint at URL/key mismatch as well as invalid key.
- **UI still appears empty after successful sync** because `revalidatePath("/")` does not necessarily refresh `/settings/*` client state → explicitly define the refresh strategy for Settings tabs (Integrations → Booking).
- **Partial campaign sync (pagination)** → verify pagination and fetch all pages so “sync all campaigns” is true in practice.

### Missing or ambiguous requirements
- Should sync **delete** local `EmailCampaign` rows that no longer exist upstream, or keep them and only upsert? (Stale campaign risk; deletion may break assignments/leads.)
- What is the desired UX when multiple providers are configured but `emailProvider` is unset (UI currently “guesses”, server may throw)? Keep as-is or make UI error explicitly.
- There is no explicit test runner configured in `package.json`; decide whether “regression coverage” means:
  - (A) add a minimal test harness, or
  - (B) rely on `npm run lint`, `npm run typecheck`, `npm run build` + a manual runbook.

### Repo mismatches (fix the plan)
- The root plan did not include `lib/email-integration.ts` (provider resolution) or the booking surface (`components/dashboard/settings-view.tsx` → Booking tab, `components/dashboard/settings/ai-campaign-assignment.tsx`).
- Multi-agent overlap was missing: Phase 42 also targets EmailBison 401 diagnostics in `lib/emailbison-api.ts`.

### Performance / timeouts
- EmailBison network operations already have explicit timeouts + retries; ensure retries do **not** apply to auth failures (`401/403`) and ensure the user-facing error distinguishes timeout vs auth.

### Security / permissions
- Preserve `requireClientAdminAccess(clientId)` gating on sync actions; ensure logs never include API keys or full upstream payloads that may contain sensitive data.

### Testing / validation
- Jam-aligned runbook must be explicit about:
  - where to set an invalid key to reproduce 401 (Settings → Integrations)
  - what success looks like on Settings → Booking (campaign assignment table)

## Decisions (User Confirmed)

- `401` user-facing errors must explicitly mention **URL/key mismatch** (not just “invalid/expired”). (confirmed)
- Sync must include **all** upstream campaigns (handle pagination/limits; no partial sync). (confirmed)
- No new test harness; use existing validation (`npm run lint`, `npm run typecheck`, `npm run build`) + manual Jam-aligned runbook. (confirmed)

## Assumptions (Agent)

- Email campaign sync is intended to remain **idempotent** (safe to click multiple times) and implemented via `upsert` on `clientId+bisonCampaignId`. (confidence ~95%)
  - Mitigation check: confirm no downstream relies on deleting campaigns when upstream deletes them.
- Campaign sync should **not delete** local `EmailCampaign` rows that are missing upstream (avoid breaking campaign assignments/leads). (confidence ~85%)
  - Mitigation check: if you want strict “mirror upstream” semantics, we should add a safe cleanup strategy (likely “archive/disable” rather than delete, since campaigns are referenced by leads and other features).
- Booking “campaign visibility” refers primarily to Settings → Booking → Campaign Assignment table (`AiCampaignAssignmentPanel`). (confidence ~90%)
  - Mitigation check: if there are other booking UIs relying on campaigns, list them so the plan can revalidate/refresh them explicitly.

## Phase Summary
- Root cause surfaced by Jam was an upstream `401` from EmailBison campaign sync; fixed the “Unknown error” UX by mapping `401/403` to actionable guidance (including URL/key mismatch hints) and adding safe server diagnostics.
- Hardened EmailBison campaign parsing to tolerate multiple response shapes and avoid inserting invalid campaigns; added pagination support so sync fetches all pages when present.
- Added a small client-side event so campaign-driven UI surfaces refresh automatically after “Sync Email” (no hard refresh required).
- Improved campaign-driven UI empty states so users are directed to Settings → Integrations → “Sync Email” when campaigns are missing.
- Added `EMAILBISON_BASE_URL` support (default `https://send.meetinboxxia.com`) and documented it in `README.md`.
- Validation: `npm run lint` and `npm run build` pass locally (repo has pre-existing lint warnings unrelated to Phase 41).
- Remaining: manually verify the success path with a known-good EmailBison key (and confirm `EMAILBISON_BASE_URL` is correct for prod).
