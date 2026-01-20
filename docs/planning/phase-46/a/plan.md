# Phase 46a — Repro + Root-Cause Attribution

## Focus
Determine whether FC’s “double set” is a true double-send (two provider sends) or a data-ingestion duplication (two `Message` rows for one send), and map each observed symptom to a concrete code path.

## Inputs
- Jam `d7811703-1d14-4aa8-8c96-c670ebbde5c2` (user observes “double set” of outbound emails)
- Suspect code paths:
  - `actions/email-actions.ts:sendEmailReply`, `sendEmailReplyForLead`
  - `lib/conversation-sync.ts:syncEmailConversationHistorySystem`
  - `app/api/webhooks/email/route.ts:handleEmailSent`
  - `lib/background-jobs/email-inbound-post-process.ts` (AI auto-send)
  - `lib/followup-engine.ts` + `app/api/cron/followups/route.ts` (cron sends)

## Work
1) Identify a concrete “double set” lead/thread from Jam (e.g., by lead email/name visible in the video) and capture:
   - leadId
   - clientId (Founders Club workspace id is `ef824aca-a3c9-4cde-b51f-2e421ebb6b6e` per Jam network payload)
   - timestamps of the two outbound messages
2) DB forensics (local/target env as available):
   - Pull the two outbound `Message` rows and compare:
     - `source` (`zrg` vs `inboxxia_campaign`)
     - `sentBy` / `sentByUserId`
     - `aiDraftId`
     - `emailBisonReplyId` vs `inboxxiaScheduledEmailId`
     - `sentAt` and `createdAt`
   - Hypothesis checks:
     - If one message has `aiDraftId` and another has `emailBisonReplyId`, likely “send row + sync-import row”.
     - If one message is `source="inboxxia_campaign"` and the other is `source="zrg"`, likely “campaign email + dashboard reply/follow-up email”.
     - If both are `source="zrg"` with different `aiDraftId`, suspect multiple automation senders (follow-ups + auto-send) or a duplicate job run.
3) Reproduce on demand (staging/local if possible):
   - Send an EmailBison reply from the UI and observe whether a second outbound message appears after `syncEmailConversationHistorySystem(...)` runs.
   - Verify if the provider actually sent twice (EmailBison UI/metadata) vs only our DB duplicating.
4) Document the exact root cause(s) and rank by impact:
   - “Duplicate Message rows only” vs “double provider send”.

## Output
- A short root-cause report (in this file or a linked note) that lists:
  - Which path caused the “double set” (send+sync, campaign+follow-up, cron concurrency, etc.)
  - Evidence (fields/timestamps) that distinguishes between true double-sends and duplicate records.

## Handoff
If the dominant cause is send+sync duplication, proceed to **46b** with a clear strategy for outbound EmailBison identifier capture and/or improved healing logic.

## Output (Filled)
### Finding: “Double set” is primarily **duplicate `Message` rows** (send row + sync-import row), not proven double provider sends

- FC workspace (`Lead.clientId = ef824aca-a3c9-4cde-b51f-2e421ebb6b6e`) shows many instances of **two outbound email `Message` rows in the same minute** where:
  - one row has `emailBisonReplyId IS NULL` (created at send-time by our dashboard),
  - and one row has `emailBisonReplyId IS NOT NULL` (created by `syncEmailConversationHistorySystem(...)` importing from EmailBison).
- Example lead/thread from Jam network payload: `leadId = b5e5aefb-2699-426f-8678-b1e900c177ba`
  - Send-created row:
    - `Message.id = cf2d19ca-977d-4903-bea4-58c8f3ea9acc`
    - `sentAt = 2026-01-20 18:11:35.360`, `createdAt = 2026-01-20 18:11:35.361`
    - `source = "zrg"`, `sentBy = "setter"`, `aiDraftId = c9e6a387-a3fe-4cdc-8481-19e253259ada`
    - `emailBisonReplyId = NULL`
  - Sync-imported row:
    - `Message.id = f386a529-25de-46c8-9f7d-8de9cbefd571`
    - `sentAt = 2026-01-20 18:11:34.000`, `createdAt = 2026-01-20 18:11:35.924`
    - `source = "zrg"`, `sentBy = NULL`, `aiDraftId = NULL`
    - `emailBisonReplyId = "1898795"`
    - `body_len = 500` (matches current sync truncation behavior)
- Pattern prevalence: within the last 30 days, the query “two outbound email messages in same minute where one has an EmailBison reply id and the other does not” returns many leads (20/20 rows shown), consistent with a systemic send↔sync reconciliation bug rather than an isolated user double-click.

### Jam linkage (operator confusion amplifier)
- Jam shows “double set” outbound emails appearing back-to-back in a thread.
- Jam network response shows outbound messages are rendered with `sender = "ai"` (current UI mapping), which makes “setter send + sync-import row” look like “AI sent twice” rather than “same provider send recorded twice”.

### Root cause ranking
1) **Primary**: EmailBison reply send creates a `Message` row without `emailBisonReplyId`, then immediate post-send sync imports the same outbound reply and inserts another row when heal-match fails.
2) **Secondary**: UI attribution collapses all outbound to “ai”, masking the difference between setter/manual vs automation sources and making duplicates appear as mysterious double-sends.

## Handoff (Filled)
Proceed to **46b** with the working assumption that the fix is **in `syncEmailConversationHistorySystem(...)`**: when importing an outbound EmailBison reply, attach `emailBisonReplyId` to the existing send-created outbound message (high-confidence match) instead of inserting a new `Message` row.
