# Phase 106j — Implementation: Meeting Overseer Decisions + Persistence

## Focus
Add a scheduling “overseer” that extracts meeting/time intent + preferences from inbound messages and persists decisions per message for debugging.

## Inputs
- Prompt registry: `lib/ai/prompt-registry.ts`
- Overseer logic: `lib/meeting-overseer.ts` (new)
- Prisma schema: `prisma/schema.prisma`
- Auto-booking pipeline: `lib/followup-engine.ts`

## Work
1. Add `MeetingOverseerDecision` model (message-scoped, JSON payload, stage).
2. Implement overseer extraction prompt (`meeting.overseer.extract.v1`) with strict JSON schema.
3. Add helpers to decide when to run the overseer and to store decisions.
4. Wire overseer execution in inbound pipelines (email/SMS/LinkedIn) with messageId.

## Output
- Overseer decisions are persisted per message and available to downstream steps.

## Handoff
Proceed to auto-booking slot selection + confirmations (Phase 106k).
