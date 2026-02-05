# Phase 109e — Frontend: Refetch Drafts When Sentiment Changes

## Focus
Ensure the Master Inbox compose UI refetches pending drafts when a lead sentiment changes (e.g., setter marks lead Interested), so drafts "populate" without a refresh.

## Inputs
- Draft fetch logic:
  - `components/dashboard/action-station.tsx` draft fetch `useEffect` calls `getPendingDrafts(conversation.id, activeChannel)`.
  - Current deps (line 478): `[conversation?.id, activeChannel, deepLinkedDraftId]` — **no sentimentTag**

## Work
Implemented in `components/dashboard/action-station.tsx`:

1. **Refetch drafts when sentiment changes**
   - Updated draft fetch `useEffect` deps to include `conversation?.lead?.sentimentTag`.
   - This ensures a CRM drawer sentiment update triggers a refetch even when `conversation.id` is unchanged.

2. **Prevent clobbering user edits**
   - Added `composeMessageRef` + `originalDraftRef` refs and keep them updated via `useEffect`.
   - When drafts are fetched, only auto-populate the compose box if:
     - compose is empty, OR
     - compose still matches the last auto-populated draft (`composeMessage === originalDraft`).

3. Maintain current deep-link behavior (`deepLinkedDraftId`) — unchanged.

## Validation (RED TEAM)
- [x] Verified `conversation.lead.sentimentTag` exists on the UI type (`lib/mock-data.ts`) and is available in ActionStation props
- [ ] Manual test: change sentiment in CRM drawer → verify draft refetch occurs
- [ ] Manual test: edit compose box → change sentiment → verify user edit NOT clobbered
- [ ] Manual test: compose box empty → change sentiment → verify draft auto-populates

## Output
- Changing sentiment now triggers a draft refetch and compose box auto-populates when safe.
- Code changes:
  - `components/dashboard/action-station.tsx`
    - Draft fetch `useEffect` now depends on `conversation?.lead?.sentimentTag`
    - Draft auto-population is guarded to avoid overwriting user edits

## Handoff
Proceed to Phase 109f to reduce Insights cron failures from `max_output_tokens`.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Updated draft fetch `useEffect` deps to refetch on `conversation?.lead?.sentimentTag` changes.
  - Added ref-based guardrails so auto-populated draft content won’t overwrite user edits.
- Commands run:
  - `npm test` — pass (174 tests)
  - `npm run lint` — pass (warnings only)
  - `npm run build` — pass (warnings only)
- Blockers:
  - Manual UI verification is still pending (recommended to confirm CRM sentiment-change → draft refetch behavior end-to-end).
- Next concrete steps:
  - Apply the targeted Insights extraction budget bump (109f), then write the phase review.
