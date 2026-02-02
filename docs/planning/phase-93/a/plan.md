# Phase 93a — Data Model + Trigger Plumbing

## Focus
Introduce first-class support for persona-routed follow-up workflows by allowing a follow-up sequence to be bound to an AI persona, and by adding a new trigger value representing “start on first manual email reply”.

## Inputs
* Root intent: `docs/planning/phase-93/plan.md`
* Existing schema: `prisma/schema.prisma` (`FollowUpSequence`, `AiPersona`, `EmailCampaign`)
* Existing auto-start entrypoint: `lib/followup-automation.ts` (`autoStartMeetingRequestedSequenceOnSetterEmailReply`)

## Work
1. Prisma schema changes
   1. Add nullable `aiPersonaId` + relation on `FollowUpSequence` to `AiPersona`:
      ```prisma
      aiPersonaId   String?
      aiPersona     AiPersona? @relation(fields: [aiPersonaId], references: [id], onDelete: SetNull)
      ```
   2. Add indexes for routing performance:
      ```prisma
      @@index([clientId, triggerOn, isActive])  // Routing queries
      @@index([aiPersonaId])                     // Persona lookups
      ```
2. Server action/types plumbing
   1. Update `actions/followup-sequence-actions.ts` types:
      - Add `aiPersonaId: string | null` to `FollowUpSequenceData` interface
      - Add `"setter_reply"` to `triggerOn` union (in addition to existing values)
   2. Update CRUD operations:
      - `createFollowUpSequence`: Accept + persist `aiPersonaId`
      - `updateFollowUpSequence`: Accept + persist `aiPersonaId`
      - `getFollowUpSequence` / `getFollowUpSequences`: Include `aiPersonaId` in select
   3. **Validation (RED TEAM):** Verify `aiPersonaId` belongs to same `clientId`:
      ```typescript
      if (data.aiPersonaId) {
        const persona = await prisma.aiPersona.findUnique({
          where: { id: data.aiPersonaId },
          select: { clientId: true },
        });
        if (!persona || persona.clientId !== clientId) {
          return { success: false, error: "Invalid persona for this workspace" };
        }
      }
      ```
3. Backward compatibility
   - No changes to existing sequences required; `aiPersonaId` defaults to null.
4. Apply schema
   1. Run `npm run db:push` (required due to schema change).
   2. Run `prisma generate` (covered by build, but validate locally).

## Validation (RED TEAM)

- [ ] Schema includes `aiPersonaId` field with `onDelete: SetNull`
- [ ] Both indexes added (`[clientId, triggerOn, isActive]` and `[aiPersonaId]`)
- [ ] `FollowUpSequenceData` interface includes `aiPersonaId: string | null`
- [ ] `triggerOn` union includes `"setter_reply"`
- [ ] Server actions validate `aiPersonaId` ownership
- [ ] `npm run db:push` succeeds

## Output
* Updated `prisma/schema.prisma`:
  - Added `FollowUpSequence.aiPersonaId` + relation and indexes.
  - Added `AiPersona.followUpSequences` back-relation (required by Prisma).
* Updated `actions/followup-sequence-actions.ts`:
  - `FollowUpSequenceData` includes `aiPersonaId`
  - `triggerOn` union includes `"setter_reply"`
  - create/update validate persona ownership and persist `aiPersonaId`.
* Ran `npm run db:push` successfully after adding the missing back-relation.

## Handoff
Phase 93b can now add template tokens and rely on `FollowUpSequence.aiPersonaId` being available at runtime, and Phase 93c can route auto-start selection using this field.

## Coordination Notes

**Unrelated working tree changes detected:** `lib/availability-cache.ts`, `scripts/backfill-ai-auto-send.ts`, `lib/draft-availability-refresh.ts` (left untouched).
