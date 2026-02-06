# Phase 112g — Super-Admin Control Plane UI (Settings/Admin)

## Focus
Add a super-admin-only “control plane” inside Settings so operators can:
- enable/disable LeadContextBundle per workspace (DB-backed toggle + global kill-switch visibility)
- tune bundle budgets (knowledge/memory) and followup booking-gate toggles
- run calibration on-demand and review results
- approve/apply/rollback confidence policy proposals
- inspect per-call AI telemetry (AIInteraction) with bundle stats metadata

This is the operator UI for the backend work delivered in 112d/112e.

## Inputs
- UI entry point:
  - `components/dashboard/settings-view.tsx` (Admin tab)
  - `components/dashboard/admin-dashboard-tab.tsx` (existing admin health snapshot)
- Existing “eval + proposals + apply” UI pattern:
  - `components/dashboard/message-performance-panel.tsx`
  - `actions/message-performance-*.ts`
- Auth helpers:
  - `lib/workspace-access.ts` (`isTrueSuperAdminUser`)
  - `actions/access-actions.ts` (`getGlobalAdminStatus`, `getWorkspaceAdminStatus`)
- Telemetry + observability actions:
  - `actions/ai-observability-actions.ts` (aggregates)
  - new “per-call inspector” actions (added in this phase)
- Confidence system actions (from 112d):
  - `actions/confidence-policy-actions.ts` (planned)
- Settings/toggles actions (from 112e):
  - super-admin update actions for `WorkspaceSettings` rollout fields (planned)

## Decisions (Locked 2026-02-06)
- This control plane is **super-admin only** for toggles + apply/rollback.
- UI must include both:
  - overview metrics
  - deep per-call inspector

## Work
1. Add UI surface in Settings/Admin
   - **Create a new component** `components/dashboard/confidence-control-plane.tsx` for the entire control plane UI.
   - Render it inside `components/dashboard/admin-dashboard-tab.tsx` (gated by super-admin). Do **NOT** add to `settings-view.tsx` (already 338KB monolithic).
   - Gate rendering by `getGlobalAdminStatus()` and a server-side super-admin check in all actions.

2. Rollout controls UI (DB-backed)
   - Show current values:
     - `WorkspaceSettings.leadContextBundleEnabled`
     - `WorkspaceSettings.followupBookingGateEnabled`
     - `leadContextBundleBudgets` (JSON) with safe defaults summarized
   - Mutations:
     - toggle enable/disable
     - edit budgets (textarea JSON editor with validation) or a minimal structured form for v1
   - Safety:
     - confirm dialogs on enable/apply changes
     - show a warning banner when env kill-switch is ON (global off)

3. Confidence calibration UI
   - “Run calibration” button:
     - triggers `runConfidenceCalibrationRun(clientId, { windowFrom, windowTo, scope? })`
   - Calibration runs table:
     - status, window, createdAt, proposalsCreated, errors
     - detail dialog shows metrics snapshot JSON (no raw text)

4. Proposal workflow UI (approve/apply/rollback)
   - Proposals table (mirrors message performance panel):
     - status pills (PENDING/APPROVED/APPLIED/REJECTED)
     - view payload/evidence (super-admin only)
     - actions: approve, reject, apply
   - Revision history + rollback:
     - list recent revisions per policy
     - rollback button (super-admin only) that reverts to a selected revision snapshot

5. Per-call inspector UI (AIInteraction + metadata)
   - Add server actions (super-admin gated):
     - `listAiInteractions(clientId, filters, cursor)`:
       - filters: `featureId`, `promptKey`, `status`, `leadId?`, window (e.g. last 24h/7d/custom)
       - returns: id, createdAt, featureId, promptKey, model, latencyMs, token counts, metadata (summary)
     - `getAiInteraction(clientId, interactionId)`:
       - returns full row including `metadata`
   - UI:
     - filter controls + paginated table
     - row click opens a dialog with full JSON for `metadata`
     - optional deep-link to lead inbox view using `leadId`

6. Monitoring overview (rollout health)
   - Show bundle composition/truncation rollups:
     - % calls with `truncatedAssets > 0`
     - % calls with memory present
     - median/avg `tokensEstimated`
   - Use `AIInteraction.metadata` for rollups; avoid reading prompt inputs/outputs.

## Validation (RED TEAM)
- Permissions:
  - Non-super-admin cannot see controls or call server actions (server-side enforced).
- Safety:
  - No UI renders raw lead memory or message bodies.
  - JSON editors validate shape before saving (reject unknown keys).
- Usability:
  - Operators can answer: “Is bundle on?”, “Is truncation spiking?”, “What changed?”, “How do I roll back?”

## Output
- A super-admin-only control plane exists in Settings/Admin with:
  - rollout toggles + budgets editing
  - calibration run + proposal management
  - per-call AIInteraction inspector (metadata)

## Handoff
After UI lands, run a small staged rollout:
1. Enable bundle for 1 internal workspace.
2. Inspect truncation stats and per-call metadata.
3. Expand to 2-3 workspaces, then proceed with confidence calibration + proposals.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Added per-call AIInteraction inspector actions (super-admin only):
    - `listAiInteractions(...)`
    - `getAiInteraction(...)`
    (file: `actions/ai-interaction-inspector-actions.ts`)
  - Implemented super-admin control plane UI component:
    - rollout toggles + budgets JSON editor
    - calibration runs runner + details dialog
    - confidence proposals approve/reject/apply + revision rollback
    - AIInteraction inspector + detail dialog
    (file: `components/dashboard/confidence-control-plane.tsx`)
  - Integrated control plane into Settings/Admin tab surface via `AdminDashboardTab` (file: `components/dashboard/admin-dashboard-tab.tsx`).
- Commands run:
  - `npm run build` — pass
- Blockers:
  - None
- Next concrete steps:
  - Add minimal UX hardening (confirm dialogs on apply/rollback) if needed.
