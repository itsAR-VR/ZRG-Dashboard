# Phase 33a — Schema & Data Model

## Focus

Add lead scoring fields to the Prisma schema to store fit/intent/overall scores and AI reasoning for each lead, plus add a dedicated ICP field to `WorkspaceSettings` (AI Personality settings).

## Inputs

- Root plan defining the 1-4 scale and dual-axis (fit + intent) approach
- Existing `Lead` model in `prisma/schema.prisma`

## Work

1. **Review existing Lead model** to understand current fields and relationships

2. **Add scoring fields to Lead model:**
   ```prisma
   // null = unscored, 0 = Blacklist/opt-out, 1-4 = scored
   fitScore       Int?
   intentScore    Int?
   overallScore   Int?
   scoreReasoning String?  @db.Text
   scoredAt       DateTime?
   ```

3. **Add DB indexes for filtering/sorting:**
   - Add an index for common inbox/CRM usage:
     - `@@index([clientId, overallScore, updatedAt(sort: Desc)])`
   - Consider additional indexes if needed (e.g., `clientId + fitScore`, `clientId + intentScore`)

4. **Add dedicated ICP field to WorkspaceSettings:**
   ```prisma
   idealCustomerProfile String? @db.Text
   ```
   - This is edited in the Settings UI (subphase f) and injected into scoring prompts.

5. **Run migration:**
   ```bash
   npm run db:push
   ```

6. **Verify in Prisma Studio** that fields are added correctly

## Output

**Completed 2026-01-17:**

1. Added scoring fields to `Lead` model in `prisma/schema.prisma` (lines 289-294):
   - `fitScore Int?`
   - `intentScore Int?`
   - `overallScore Int?`
   - `scoreReasoning String? @db.Text`
   - `scoredAt DateTime?`

2. Added `idealCustomerProfile String? @db.Text` to `WorkspaceSettings` (line 198)

3. Added composite indexes for lead score filtering (lines 385-388):
   - `@@index([overallScore])`
   - `@@index([clientId, overallScore])`
   - `@@index([clientId, overallScore, updatedAt(sort: Desc)])`

4. Ran `npm run db:push` — database synced successfully

## Handoff

Schema is ready with all scoring fields and indexes. Subphase b can now build the AI scoring engine that populates these fields, using `WorkspaceSettings.idealCustomerProfile` as part of the scoring context.
