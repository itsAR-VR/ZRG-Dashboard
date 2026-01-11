# Phase 15 — Campaign Assignment UI (AI Auto‑Send vs Setter‑Managed)

## Purpose
Add UI controls in **Settings → AI Personality** to configure which **EmailBison campaigns** are AI auto-send vs setter-managed, including per-campaign confidence threshold.

## Context
Phase 12 introduced per-campaign response modes (`SETTER_MANAGED` vs `AI_AUTO_SEND`) and a per-campaign confidence threshold (`autoSendConfidenceThreshold`). This is currently only configurable via DB/Prisma Studio. We need a first-class UI so operators can run the intended 80/20 experiment (most campaigns setter-managed, a subset AI auto-send) without touching the database.

## Objectives
* [x] Add server actions to read/update EmailCampaign response mode + threshold (admin-scoped)
* [x] Build a polished “Campaign Assignment” UI block inside AI Personality settings
* [x] Make analytics reflect the config clearly (mode + threshold shown in the KPI table)
* [x] Validate with `npm run lint` + `npm run build`

## Constraints
- No secrets/tokens in repo; only workspace-scoped authenticated users may view/update campaign settings.
- Campaign settings are stored on `EmailCampaign` (EmailBison campaigns); do not create new tables for this phase.
- Webhooks/automation should not depend on UI state; UI only updates DB config.
- Keep UI consistent with existing shadcn components and patterns in `components/dashboard/settings-view.tsx`.

## Success Criteria
- [x] In Settings → AI Personality, a user can set a campaign to `AI_AUTO_SEND` and adjust the confidence threshold.
- [x] Changes persist to the database and do not get overwritten by campaign sync/webhooks.
- [x] Analytics “Email Campaign KPIs” table visibly reflects the campaign’s response mode (and threshold for AI mode).

## Subphase Index
* a — Server actions for campaign config
* b — AI Personality UI: campaign assignment panel
* c — Analytics UI: show mode + threshold
* d — QA + docs tidy

## Phase Summary
- Added admin-scoped campaign config actions: `actions/email-campaign-actions.ts` (`getEmailCampaigns` now includes mode/threshold; `updateEmailCampaignConfig` persists changes).
- Added Settings → AI Personality “Campaign Assignment” panel: `components/dashboard/settings/ai-campaign-assignment.tsx` (per-row mode + threshold, Save/Revert, refresh, 80/20 guidance).
- Updated Analytics KPI table to display assignment clearly: `components/dashboard/analytics-view.tsx` (Setter vs `AI ≥ {threshold}%`).
- Verified `npm run lint` (warnings only) and `npm run build` succeed; campaign sync/webhook upserts only update `name` so they won’t overwrite mode/threshold.
