# Phase 116d — Rollout Controls + Observability (Stats-Only)

## Focus
Provide a **per-workspace** super-admin rollout toggle for auto-send revision, and expose revision “health” without leaking raw message content: kill-switch status, workspace toggle status, and attempt/applied counts over a bounded window.

## Inputs
- `actions/admin-dashboard-actions.ts` (`AdminDashboardSnapshot`)
- `components/dashboard/admin-dashboard-tab.tsx` (renders snapshot + health pills)
- `actions/lead-context-bundle-rollout-actions.ts` (pattern for true-super-admin toggles)
- `lib/auto-send/revision-agent.ts` (new persisted revision fields from Phase 116c)
- `prisma/schema.prisma` (`AIDraft` revision fields from Phase 116b)

## Work
1. Add super-admin per-workspace toggle UI (rollout control plane)
   - Create a server action module (mirrors lead-context-bundle rollout pattern):
     - `actions/auto-send-revision-rollout-actions.ts`
     - Requires true super-admin (`requireAuthUser` + `isTrueSuperAdminUser`)
     - Exposes:
       - `getAutoSendRevisionRolloutSettings(clientId)` → `{ autoSendRevisionEnabled, globallyDisabled }`
       - `updateAutoSendRevisionRolloutSettings(clientId, { autoSendRevisionEnabled })`
     - `globallyDisabled` should reflect the env kill-switch: `process.env.AUTO_SEND_REVISION_DISABLED === "1"`.
   - Update `components/dashboard/confidence-control-plane.tsx`:
     - Add a new toggle row: “Auto-Send Revision Enabled (per workspace)”
     - Display a note when globally disabled via env kill-switch.

2. Add revision kill-switch visibility to admin snapshot
   - Extend `AdminDashboardSnapshot.env` to include:
     - `autoSendRevisionDisabled: boolean` derived from `process.env.AUTO_SEND_REVISION_DISABLED === "1"`

3. Add workspace toggle visibility + revision effectiveness stats to admin snapshot (last 72h)
   - Extend `AdminDashboardSnapshot.drafts` with:
     - `autoSendRevision: { attemptedLast72h: number; appliedLast72h: number }`
   - Extend `AdminDashboardSnapshot.workspaceSettings` with:
     - `autoSendRevisionEnabled: boolean`
   - Query strategy (no raw text):
     - Count attempted: `AIDraft` rows where `autoSendRevisionAttemptedAt >= now-72h` and `lead.clientId = clientId`
     - Count applied: attempted + `autoSendRevisionApplied = true`

4. Render in UI (admin tab)
   - Add a `HealthPill` for revision kill-switch state (warn when disabled).
   - Add a small table or pill group for attempted/applied and applied-rate (derived).

5. Validation (manual)
   - Admin Dashboard loads with the new fields.
   - Snapshot copy JSON includes only booleans/counts/numbers.
   - Confidence Control Plane toggle is visible to super admins only, and writes persist.

## Output
- Super-admins can enable revision per workspace without deploy.
- Operators can quickly see revision toggles + outcomes without opening logs.

## Handoff
- Phase 116e uses these stats as part of canary monitoring and post-launch checks.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Added true-super-admin server actions to read/update per-workspace rollout toggle for auto-send revision. (file: `actions/auto-send-revision-rollout-actions.ts`)
  - Exposed the rollout toggle in the Confidence Control Plane UI and surfaced the global kill-switch status. (file: `components/dashboard/confidence-control-plane.tsx`)
  - Extended the Admin Dashboard snapshot and UI to include kill-switch state plus attempted/applied counts over the last 72 hours. (files: `actions/admin-dashboard-actions.ts`, `components/dashboard/admin-dashboard-tab.tsx`)
- Commands run:
  - `npm run typecheck` — pass
  - `npm test` — pass
  - `npm run build` — pass
- Blockers:
  - None
- Next concrete steps:
  - Finalize rollout checklist + rollback steps (Phase 116e) and run a phase review.
