# Phase 62a — Schema: Add Lead.qualificationAnswers and Dual Booking Link Settings

## Focus
Add the database fields needed to track qualification answers on leads and support dual booking links per provider.

## Inputs
- Root phase plan defining the data model requirements
- Current `Lead` and `WorkspaceSettings` models in `prisma/schema.prisma`
- Phase 61 uncommitted changes (must be committed/merged first)

## Work

### Pre-Flight Check
1. Run `git status` to confirm Phase 61 changes are handled
2. Read current `prisma/schema.prisma` to understand existing fields

### Schema Changes

**Add to `Lead` model:**
```prisma
// Qualification answer tracking (Phase 62)
qualificationAnswers           String?   @db.Text  // JSON: { questionId: answer, ... }
qualificationAnswersExtractedAt DateTime?           // When answers were last extracted
```

**Add to `WorkspaceSettings` model:**
```prisma
// Direct booking links without qualification questions (Phase 62)
calendlyDirectBookEventTypeLink  String?  // Calendly link without questions
calendlyDirectBookEventTypeUri   String?  // Resolved API URI (auto-populated)
ghlDirectBookCalendarId          String?  // GHL calendar without questions
```

### Migration
1. Update `prisma/schema.prisma` with new fields
2. Run `npm run db:push` to apply changes
3. Verify migration success via `npx prisma studio`

### Validation
- [ ] `npm run db:push` succeeds
- [ ] New fields appear in Prisma Studio
- [ ] No breaking changes to existing queries

## Output
- Updated `prisma/schema.prisma` with new Lead and WorkspaceSettings fields
- Database migration applied

## Handoff
Schema is ready. Subphase 62b can now implement answer extraction logic that stores to `Lead.qualificationAnswers`.

## Review Notes
- Implemented `Lead.qualificationAnswers` as `Json?` (JSONB) instead of JSON-as-text for safer parsing/backfills.
- Validation: `npm run db:push` ran successfully and reported “already in sync” (2026-01-27T17:08Z).
