# Phase 112e — Rollout & Monitoring (DB Toggle + Env Kill-Switch + Safe Fallbacks)

## Focus
Ship LeadContextBundle + confidence policies safely:
- **DB-backed per-workspace toggle** (super-admin controlled)
- **env kill-switch** (global off without deploy)
- **safe fallbacks** (never block drafts/booking)
- **monitoring** that detects truncation/confidence drift without logging PII

## Inputs
- Bundle builder and consumers (from 112b/112c/112f):
  - `lib/lead-context-bundle.ts` (planned)
  - `lib/ai-drafts.ts`, `lib/meeting-overseer.ts`
  - `lib/auto-send-evaluator.ts`, `lib/auto-send-evaluator-input.ts`
  - `lib/followup-engine.ts`
- Settings + admin patterns:
  - `prisma/schema.prisma` (`WorkspaceSettings`)
  - `lib/workspace-access.ts` (`isTrueSuperAdminUser`)
  - `components/dashboard/settings-view.tsx`, `components/dashboard/admin-dashboard-tab.tsx`
- Telemetry:
  - `AIInteraction.metadata` (added in 112d)
  - `actions/ai-observability-actions.ts` (feature/source aggregates)

## Decisions (Locked 2026-02-06)
- Rollout control is **DB-backed per workspace**, not env-only.
- Super-admin only can enable/disable bundle + apply confidence policy changes.
- Env is used only as an emergency kill-switch (global off).

## Work
1. Add WorkspaceSettings rollout fields (schema + actions)
   - Prisma: add fields to `WorkspaceSettings`:
     - `leadContextBundleEnabled Boolean @default(false)`
     - `leadContextBundleBudgets Json?` (optional per-profile overrides)
     - Followup guardrails:
       - `followupBookingGateEnabled Boolean @default(false)`
   - Add super-admin-only server actions to update these fields (112g UI consumes them).

2. Define the env kill-switch (global off)
   - Add a single env var (name decision required, default below):
     - `LEAD_CONTEXT_BUNDLE_DISABLED=1`
   - Precedence:
     - if kill-switch is ON → bundle is OFF everywhere regardless of DB toggle
     - else → bundle enabled only when `WorkspaceSettings.leadContextBundleEnabled=true`

3. Safe fallback behavior (never block core flows)
   - If bundle build fails for any reason (DB read, unexpected nulls, budget math):
     - drafting must fall back to pre-existing context assembly
     - overseer gate must fall back to `memoryContext="None."` (or skip) and proceed
     - auto-send evaluator must fall back to the existing input builder path (no memory)
     - followup parse/booking gate must fall back to existing behavior (no booking gate)

4. Monitoring signals (stats-only)
   - Emit/record:
     - `AIInteraction.metadata.leadContextBundle.*` (counts + token estimates + truncation)
   - Track operational metrics per workspace:
     - auto-send confidence distribution (`AIDraft.autoSendConfidence`) and review-needed rates
     - meeting overseer gate `approve` vs `revise` rates (`MeetingOverseerDecision`)
     - followup auto-book outcomes (booked vs tasks created vs clarification)

5. Rollback playbook
   - Fast rollback options (in order):
     - flip `LEAD_CONTEXT_BUNDLE_DISABLED=1` (global immediate)
     - disable `WorkspaceSettings.leadContextBundleEnabled` for a single workspace
     - rollback confidence policy revision (112d) if thresholds were changed
   - Document “what to monitor” to validate rollback:
     - truncation spike returns to baseline
     - auto-send “needs_review” rate returns to baseline
     - auto-booking error rate does not increase

6. Manual smoke checklist (before enabling for more workspaces)
   - For 1-2 internal workspaces:
     - Drafting: generate a scheduling-related draft; ensure overseer gate stays non-fatal.
     - Auto-send: evaluate a pricing-related thread; confirm `verified_context_instructions` behavior unchanged.
     - Followup: run an inbound that proposes a time; ensure threshold/gate logic behaves as expected.
     - Confirm no raw lead memory is persisted in logs/telemetry.

## Validation (RED TEAM)
- `npm run db:push` completed for `WorkspaceSettings` changes.
- Queries confirm:
  - bundle toggles exist per workspace
  - `AIInteraction.metadata` contains only stats-only keys

## Output
- DB-backed rollout toggles exist in `WorkspaceSettings`.
- One env kill-switch exists for emergency shutdown.
- A concrete rollback + monitoring playbook is documented and implemented via UI/actions (112g).

## Handoff
112f wires followup thresholds + booking gate behind these toggles, and 112g exposes rollout controls + monitoring in the super-admin control plane UI.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Implemented super-admin-only rollout read/write actions for:
    - `WorkspaceSettings.leadContextBundleEnabled`
    - `WorkspaceSettings.followupBookingGateEnabled`
    - `WorkspaceSettings.leadContextBundleBudgets`
    (file: `actions/lead-context-bundle-rollout-actions.ts`)
  - Exposed global kill-switch state (`LEAD_CONTEXT_BUNDLE_DISABLED`) via the rollout settings action response.
- Commands run:
  - `npm run build` — pass
- Blockers:
  - None
- Next concrete steps:
  - Render these controls in the super-admin Settings/Admin control plane UI (Phase 112g).
