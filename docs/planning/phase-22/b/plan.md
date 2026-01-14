# Phase 22b — DB Truth Audit (Lead/Message Sentiment + Attention Rollups)

## Focus
Determine whether the incorrect UI state is due to incorrect persisted data (e.g., lead sentiment not being updated) or incorrect query/derivation logic (data is correct but UI uses the wrong fields/joins).

## Inputs
- Repro artifacts from Phase 22a (workspace id and lead id(s), redacted as needed).
- Prisma schema: `prisma/schema.prisma`.

## Work
- Inspect the DB records for the affected workspace + lead(s):
  - Lead-level sentiment/status fields.
  - Message rollups used by inbox filters (lastInboundAt/lastOutboundAt/lastMessageDirection/snoozedUntil).
  - Message-level direction/channel correctness for the latest messages.
- Validate classification persistence:
  - Determine whether the latest inbound message(s) were analyzed and whether `Lead.sentimentTag` was updated.
  - If there is a “re-analyze sentiment” action, confirm what it updates and whether it is erroring.
- Confirm whether the expected positive state exists anywhere (lead field vs derived-from-messages), and whether any recent code is skipping updates.

## Output
- A concise “DB truth” summary:
  - What the DB says the sentiment/state is
  - What fields should drive Requires Attention / Previously Required Attention
  - Any anomalies (nulls/defaults/stale rollups) that explain the UI rendering

## Handoff
Proceed to Phase 22c to map the UI behavior to the exact code paths and identify the regression or mismatch between intended business logic and current implementation.

