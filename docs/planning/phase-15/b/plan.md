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
- Operators can configure campaign assignment without Prisma/DB access.

## Handoff
Phase 15c optionally improves the Analytics table to display mode + threshold clearly.

