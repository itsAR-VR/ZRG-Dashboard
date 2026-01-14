# Phase 18d — Frontend UX (Insights Console) + AI Personality Settings

## Focus
Build the user-facing UX:
- a shared “Insights Console” chat UI on the analytics page
- campaign + time-window controls
- progress UI for the first (seed) question
- admin controls for soft delete/restore and pack recompute/delete
- AI Personality settings for model/effort + action-tool toggles (off by default)

## Inputs
- Phase 18a action contract
- Phase 18b persistence + permissions
- Phase 18c runtime config and pack build progress/status API

## Work
- Add an Analytics-page entry point (button/sheet) for the chat UI
- Multi-session list per workspace (title, timestamps, author)
- Window selector (24h/7d/30d/custom) and campaign picker:
  - multi-select campaigns OR “All campaigns” with cap (default 10)
  - hide campaign picker in SMS-only workspaces
- Seed question flow:
  - start session + start context pack build
  - show progress (processed/total threads) with a “stop waiting” UX
- Follow-ups:
  - only enabled once pack is COMPLETE
- Admin UX:
  - delete/restore sessions (soft delete)
  - recompute/delete context packs
- Settings:
  - AI Personality card with model + effort selector
  - tool toggles for future actions (OFF by default; admin-only to change)

## Output
- Implemented “Insights Console” UI entry point + sheet:
  - `components/dashboard/insights-chat-sheet.tsx`
  - Mounted in Analytics header: `components/dashboard/analytics-view.tsx`
- UX features shipped:
  - Multi-session list (workspace-scoped) with title, last message preview, updatedAt
  - Window selector (24h/7d/30d/custom) with DB-backed per-user defaults via:
    - `getInsightsChatUserPreference` / `setInsightsChatUserPreference` (`actions/insights-chat-actions.ts`)
  - Campaign scope dialog (email workspaces only):
    - multi-select campaigns (uses `actions/email-campaign-actions.ts:getEmailCampaigns`)
    - “All campaigns” toggle with configurable cap (default 10)
    - hides automatically for SMS-only workspaces (no email campaigns)
  - Seed question flow (synchronous UX):
    - calls `startInsightsChatSeedQuestion` then loops `runInsightContextPackStep` with progress UI + “Stop waiting”
  - Follow-up flow:
    - disabled until pack is COMPLETE; then uses `sendInsightsChatMessage`
  - Admin-only UI actions:
    - show deleted sessions + restore
    - delete session
    - recompute/delete context pack
- AI Personality settings wiring:
  - Added “Insights Chatbot” card under AI Personality in `components/dashboard/settings-view.tsx`
  - Added admin gating via `actions/access-actions.ts:getWorkspaceAdminStatus`
  - Persisted settings via `actions/settings-actions.ts` (admin-only for insights chatbot fields)

## Handoff
Phase 18e adds cron booked summaries and completes validation + documentation.

