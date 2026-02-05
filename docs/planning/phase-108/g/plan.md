# Phase 108g — Lead Memory (Postgres) Schema + Tool-Driven Retrieval

## Focus
Add a structured, workspace-safe lead memory layer in Postgres and expose retrieval helpers so AI drafting/overseer can reference confirmed facts without re-asking.

## Inputs
- `prisma/schema.prisma` (new memory tables + relations)
- Existing knowledge assets flow:
  - `actions/settings-actions.ts`
  - `lib/knowledge-asset-context.ts`
- Drafting + overseer paths:
  - `lib/ai-drafts.ts`
  - `lib/meeting-overseer.ts`

## Work
1. **Data model (Prisma):**
   - New `LeadMemoryEntry` (leadId, clientId, category, content, source, createdAt, expiresAt?).
   - New `LeadMemorySource` enum (manual, system, inference).
2. **Write path:**
   - Server actions for admins to create/update/expire memory entries.
3. **Read path:**
   - `getLeadMemoryContext(leadId, clientId, maxTokens?)` returns concise, redacted context.
   - Combine with Knowledge Assets context (separate sections) without duplicating PII.
4. **Wire to overseer/drafts:**
   - Populate `memoryContext` in `runMeetingOverseerGate` call.
5. **Retention + permissions:**
   - Default retention: 90 days.
   - Admin-only edit; setters view redacted summaries.

## Validation (RED TEAM)
- Unit tests for `getLeadMemoryContext` trimming + redaction.
- If schema changes: `npm run db:push` + verify tables.

## Output
- New lead memory schema + retrieval helper.
- Drafting/overseer can consume memory context when present.

## Handoff
Phase 108h uses lead memory in eval inputs; Phase 108j uses history/rollback to revert memory-driven proposals.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Added `LeadMemorySource` enum + `LeadMemoryEntry` model and relations in Prisma.
  - Implemented lead memory context builder + retrieval helper.
  - Added server actions for CRUD/expire + redacted listing.
  - Wired lead memory context into AI drafts and meeting overseer gate.
- Commands run:
  - `rg -n "model KnowledgeAsset" prisma/schema.prisma` — located schema insertion point
  - `rg -n "buildEmailDraftStrategyInstructions" -n lib/ai-drafts.ts` — located prompt context usage
- Blockers:
  - Prisma migration not applied yet → must run `npm run db:push` in Phase 108i.
- Coordination notes:
  - `prisma/schema.prisma` and `lib/ai-drafts.ts` already had working-tree changes from Phase 106/107; re-read before further edits.
- Next concrete steps:
  - Ensure lead memory context is used in eval inputs where appropriate (Phase 108h).
  - Add UI surfaces for memory management + redacted view if needed (Phase 108j or follow-up).
