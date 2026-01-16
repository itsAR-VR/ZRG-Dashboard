# Phase 27c — Campaign Scope With CUSTOM Window

## Focus
Fix the bug where selecting a CUSTOM time window prevents campaign scope selection and/or causes campaign scope to be ignored when starting/recomputing packs.

## Inputs
- Phase 27b output: cache UX improved (easier to test)
- Jams:
  - `https://jam.dev/c/34f0fc9d-178d-4b6e-a1c0-0133b8483ada`
  - `https://jam.dev/c/27a746f7-587f-4911-9ef6-85fc936e91f3`
- UI: `components/dashboard/insights-chat-sheet.tsx`
- Actions: `startInsightsChatSeedQuestion`, `recomputeInsightContextPack`

## Work
- Use Jam evidence to identify whether the failure is:
  - UI (dialog not opening / disabled / state reset), or
  - request payload (campaignIds/allCampaigns not sent), or
  - backend pack selection (campaign filter ignored when windowPreset=CUSTOM).
- Add small guardrails:
  - If windowPreset=CUSTOM, validate we have both `customStart` and `customEnd` before starting a pack; surface a clear error (avoid silent fallbacks that look like “campaign scope broken”).
  - Ensure campaign scope label reflects the actual filter being used for the active pack (read from pack metadata if available).
- Verify for EmailBison campaign workspaces with campaigns present.

## Output
- Campaign scope selection no longer gets blocked by UI disable states:
  - Campaign scope button is always available; dialog shows loading/empty states instead of disabling the control.
- CUSTOM window no longer silently falls back: seed/recompute now requires valid custom start+end dates (and enforces end > start).
- Code: `components/dashboard/insights-chat-sheet.tsx`

## Handoff
Proceed to Phase 27d to remove global in-flight state so multiple sessions/inquiries can run without UI state collisions.
