# Phase 109b — Backend: Drafts on Manual Sentiment Change

## Focus
When a setter manually updates `Lead.sentimentTag` to any draft-eligible sentiment, generate pending drafts for **all channels with any inbound message** (email/SMS/LinkedIn), best-effort. This is the same draft-generation logic that inbound post-processing uses — just wired to manual sentiment changes as a heal/refresh path.

## Inputs
- Phase 109 root plan + Phase 109a audit findings.
- **Existing draft pipeline (reuse semantics):**
  - `shouldGenerateDraft(sentimentTag, email?)` in `lib/ai-drafts.ts` (line 2683)
  - `generateResponseDraft(...)` in `lib/ai-drafts.ts` (line 1184)
  - `regenerateDraft(leadId, channel)` in `actions/message-actions.ts` (line 1389) as a reference for “last 80 messages → transcript → generate draft” behavior
- Current mutation: `actions/crm-actions.ts:updateLeadSentimentTag` (line 148).

## Key Insight (RED TEAM)
The “manual sentiment” path was missing the draft-generation step entirely. The safest fix is to reuse the same *semantics* as `regenerateDraft` (last-80 transcript + `shouldGenerateDraft` + `generateResponseDraft`), but keep the orchestration in `lib/` so it can run from server actions without depending on another server action.

## Work
1. **Add a thin orchestrator** (`lib/manual-draft-generation.ts`) that:
   - Finds **all channels with any inbound** message for the lead (no time window):
     ```typescript
     const channelsWithInbound = await prisma.message.groupBy({
       by: ['channel'],
       where: { leadId, direction: 'inbound' },
     });
     ```
   - For each channel (`email`, `sms`, `linkedin`) with inbound:
     - **Skip if pending draft already exists:**
       ```typescript
       const existingDraft = await prisma.aIDraft.findFirst({
         where: { leadId, channel, status: 'pending' }
       });
       if (existingDraft) continue; // Already has draft
       ```
    - Build transcript from the most recent 80 messages and call `generateResponseDraft(leadId, transcript, sentimentTag, channel)`
   - Process sequentially (channels ≤ 3) and continue best-effort on per-channel failures
   - Return summary `{ attempted, created, skipped, failed }`

2. **Wire into `updateLeadSentimentTag`**:
   - If the new sentiment is draft-eligible, call `generateDraftsForLeadOnManualSentiment(...)`
   - Keep the sentiment update non-fatal by catching errors and returning `{ success: true }` regardless of draft failures
   - Log a small summary when generation attempted (helps debugging without logging PII)

3. **Policy details:**
   - Skip channels with zero inbound messages (no transcript = no draft)
   - Skip channels with existing pending drafts (deduplication)
   - Re-check `shouldGenerateDraft(sentimentTag, email?)` per channel (email bounce protection)

## Validation (RED TEAM)
- [x] Unit test: verify channel selection/deduping helper behavior (`lib/__tests__/manual-draft-generation.test.ts`)
- [ ] Manual test: mark lead "Interested" with email + SMS inbound → verify drafts created for both channels
- [ ] Manual test: mark lead "Interested" when draft already exists → verify no duplicate created

## Output
- Manual sentiment changes to eligible tags create pending drafts for the applicable channels.
- Code changes:
  - `actions/crm-actions.ts` (wire orchestrator call after sentiment update)
  - `lib/manual-draft-generation.ts` (thin wrapper iterating channels → transcript → `generateResponseDraft`)
  - `lib/__tests__/manual-draft-generation.test.ts` + `scripts/test-orchestrator.ts` (regression coverage)

## Handoff
Proceed to Phase 109c to harden meeting-overseer so it cannot block draft creation.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Implemented `lib/manual-draft-generation.ts` to backfill drafts after manual sentiment changes, for channels with inbound history.
  - Wired generation into `actions/crm-actions.ts:updateLeadSentimentTag` (best-effort; errors logged but do not fail the action).
- Commands run:
  - `npm test` — pass
  - `npm run lint` — pass (warnings only)
  - `npm run build` — pass
- Blockers:
  - None.
- Next concrete steps:
  - Wrap meeting overseer gate to be non-fatal (109c).
  - Harden email webhook null byte ingestion (109d).
