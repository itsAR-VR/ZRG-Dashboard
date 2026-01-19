# Phase 41e — Coordination + UI Refresh Strategy + Hardening (RED TEAM)

## Focus
Close gaps discovered in RED TEAM review: coordinate overlapping EmailBison work with Phase 42, define an explicit Settings UI refresh strategy (Integrations → Booking), and finalize validation steps that match the Jam repro.

## Decisions (User Confirmed)
- `401` user-facing errors must explicitly mention **URL/key mismatch** (not just “invalid/expired”).
- Sync must include **all** upstream campaigns (handle pagination/limits; no partial sync).
- No new test harness; use existing validation (`npm run lint`, `npm run typecheck`, `npm run build`) + manual runbook.

## Inputs
- Phase 41 root plan + subphases 41a–41d
- Jam: `914c06b0-c672-4658-bf3b-e5f20567c426` (Settings → Integrations → Sync Email → 401 toast)
- Code touch points:
  - `components/dashboard/settings/integrations-manager.tsx` (`handleSyncEmailCampaigns`, provider inference)
  - `components/dashboard/settings-view.tsx` (tabs; Booking tab mounts campaign assignment panel)
  - `components/dashboard/settings/ai-campaign-assignment.tsx` (`getEmailCampaigns` load behavior)
  - `actions/email-campaign-actions.ts` (`syncEmailCampaignsFromEmailBison`, `getEmailCampaigns`)
  - `lib/emailbison-api.ts` (`fetchEmailBisonCampaigns`, timeouts/retries, error mapping)
  - `lib/email-integration.ts` (provider resolution / multi-provider guard)

## Work
- **Coordination / conflict check**
  - Run `git status --porcelain` and confirm current uncommitted work (especially `lib/emailbison-api.ts`).
  - Review Phase 42 overlap and decide ownership:
    - either Phase 41 owns the EmailBison 401 mapping + diagnostics, or Phase 42 does
    - ensure the chosen phase owns the final user-facing error strings (avoid divergent copy)
- **UI refresh strategy (Integrations → Booking tab)**
  - Confirm how Settings tabs mount/unmount in `components/dashboard/settings-view.tsx` (does Booking tab content remain mounted?)
  - Define the concrete mechanism that guarantees updated campaigns appear without a hard refresh after a successful sync:
    - `router.refresh()` after a successful sync, or
    - a shared “refresh campaigns” callback/event, or
    - broadened `revalidatePath(...)` to include `/settings` (if relevant)
  - Ensure empty-state messaging is specific when campaigns are absent due to sync/auth failure (CTA back to Integrations → update key → Sync Email).
- **EmailBison sync completeness**
  - Verify whether `/api/campaigns` is paginated; if yes, define how to fetch all pages.
  - Verify whether `emailBisonWorkspaceId` is required/scoped for campaign listing; if yes, update the planned request shape.
- **Validation (Jam-aligned)**
  - Define an explicit manual runbook:
    - `/settings/integrations` → Sync Email with invalid key → actionable 401 message
    - update key → Sync Email → success toast shows a synced count
    - `/settings` → Booking tab → campaign assignment table shows campaigns without a hard refresh
  - Define the minimal automated validation expected in CI/local:
    - `npm run lint`
    - `npm run typecheck`
    - `npm run build`

## Output
- A single coordinated plan of record for EmailBison 401 diagnostics/error mapping (Phase 41 vs Phase 42).
- A concrete, testable Settings UI refresh strategy for campaign visibility after sync.
- A Jam-aligned verification runbook with clear expected outcomes.

## Handoff
Phase 41 is ready for execution once:
- Ownership vs Phase 42 is resolved (no duplicate/conflicting edits planned), and
- The refresh strategy and runbook are concrete enough to validate in one pass.
