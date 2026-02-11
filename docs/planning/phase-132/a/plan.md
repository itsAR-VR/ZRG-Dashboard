# Phase 132a — Data Model + Deterministic Delay Attribution

## Focus
Define the durable storage and deterministic attribution needed to measure:
- Setter response time per inbound anchor
- AI auto-send response time per inbound anchor
- Which delay (within min/max) was deterministically chosen for AI delayed sends

## Inputs
- Phase 132 root plan (`docs/planning/phase-132/plan.md`)
- Existing models: `Message`, `AIDraft` (`triggerMessageId`), `BackgroundJob` (`runAt`, `startedAt`, `finishedAt`)
- Deterministic delay logic in `lib/background-jobs/delayed-auto-send.ts`

## Work
1. Add a new Prisma model `ResponseTimingEvent` keyed by `inboundMessageId` (unique):
   - Required: `id` (uuid PK), `clientId`, `leadId`, `channel`, `inboundMessageId` (@unique), `inboundSentAt`
   - Setter fields: `setterResponseMessageId`, `setterResponseSentAt`, `setterSentByUserId`, `setterResponseMs` (Int?)
   - AI fields: `aiDraftId`, `aiResponseMessageId`, `aiResponseSentAt`, `aiResponseMs` (Int?)
   - Delay attribution: `aiDelayMinSeconds` (Int?), `aiDelayMaxSeconds` (Int?), `aiChosenDelaySeconds` (Int?), `aiActualDelaySeconds` (Int? — computed from `aiResponseSentAt - inboundSentAt`), `aiScheduledRunAt` (DateTime?), `aiBackgroundJobId` (String?), `aiJobStartedAt` (DateTime?), `aiJobFinishedAt` (DateTime?)
   - Timestamps: `createdAt`, `updatedAt`
   - Relations: `client Client`, `lead Lead`, `inboundMessage Message`
   - Indexes:
     - `@@index([clientId, inboundSentAt])` — workspace windowing
     - `@@index([leadId, channel, inboundSentAt])` — lead windowing
     - `@@index([setterSentByUserId])` — per-setter aggregation
     - `@@index([clientId, aiChosenDelaySeconds])` — AI delay bucket queries
2. Add composite index on `Message` model for processor performance:
   - `@@index([leadId, channel, sentAt])` — required by the window-function query in 132b
3. Export the deterministic delay helper from `lib/background-jobs/delayed-auto-send.ts`:
   - The existing `computeDeterministicDelay()` (line 32) is currently **private** (not exported)
   - Add `export` to the existing function, OR create a thin exported wrapper: `export function computeChosenDelaySeconds(messageId: string, minSeconds: number, maxSeconds: number): number`
   - Keep `computeDelayedAutoSendRunAt` and all other callers unchanged; this is instrumentation-only
4. Update any type exports/helpers needed to use the new model in server actions (no UI work yet).

## Validation (RED TEAM)
- After `npm run db:push`: verify `ResponseTimingEvent` table exists via Prisma Studio or `SELECT * FROM "ResponseTimingEvent" LIMIT 0`
- Verify the new `Message` index exists: `\d "Message"` should show `(leadId, channel, sentAt)` index
- Verify export: `import { computeChosenDelaySeconds } from '@/lib/background-jobs/delayed-auto-send'` compiles

## Output
- Added `ResponseTimingEvent` model and indexes in `prisma/schema.prisma`.
- Added composite index `@@index([leadId, channel, sentAt(sort: Desc)])` on `Message` in `prisma/schema.prisma`.
- Exported `computeChosenDelaySeconds()` from `lib/background-jobs/delayed-auto-send.ts`.
- Applied schema changes with `npm run db:push` (pass).

## Handoff
Subphase 132b uses the new model + helper to populate events via a bounded, idempotent processor and to backfill historical data.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Added `ResponseTimingEvent` Prisma model + indexes.
  - Added `Message` composite index for `(leadId, channel, sentAt)`.
  - Exported deterministic delay helper wrapper `computeChosenDelaySeconds()`.
- Commands run:
  - `npm run db:push` — pass (database in sync)
- Blockers:
  - None
- Next concrete steps:
  - Implement `lib/response-timing/processor.ts` + cron endpoint + backfill script (Phase 132b).

## Assumptions / Open Questions (RED TEAM)
- The `inboundMessageId` unique constraint ensures idempotency for one timing row per inbound anchor. If a lead has both setter AND AI responses to the same inbound, both are captured in the same row (separate columns). This is correct per the plan's design.
- `aiActualDelaySeconds` (from timestamps) is stored alongside `aiChosenDelaySeconds` (from deterministic helper) to capture both "intended" and "actual" delays, accounting for config changes over time.
