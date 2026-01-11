# Phase 15b — AI Personality UI: Campaign Assignment Panel

## Focus
Add a polished UI panel to Settings → AI Personality to configure per-campaign response mode and threshold.

## Inputs
- Phase 15a server actions (`getEmailCampaigns`, `updateEmailCampaignConfig`)
- Existing settings UI patterns in `components/dashboard/settings-view.tsx`

## Work
- Create a small client component under `components/dashboard/settings/` to:
  - Fetch campaigns for the active workspace.
  - Render a table/list with:
    - Campaign name + bisonCampaignId
    - Response mode selector (Setter Managed vs AI Auto‑Send)
    - Confidence threshold numeric input (enabled for AI Auto‑Send)
    - Per-row Save/Revert controls and toasts
  - Provide clear copy explaining behavior (auto-send only on high confidence; otherwise Jon gets a DM).
- Mount the panel inside the AI Personality tab.

## Output
- Added an AI Personality “Campaign Assignment” panel that configures EmailBison campaigns without Prisma/DB access:
  - New component: `components/dashboard/settings/ai-campaign-assignment.tsx` (per-row mode + threshold, Save/Revert, refresh, 80/20 helper copy).
  - Mounted in Settings → AI Personality: `components/dashboard/settings-view.tsx`.

## Handoff
Phase 15c: update Analytics “Email Campaign KPIs” to show `Setter` vs `AI ≥ {threshold}%` so assignment is visible at a glance.
