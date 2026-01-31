# Phase 70a — Schema Migration (AIDraft Auto-Send Tracking)

## Focus

Add new fields to the `AIDraft` model to persist auto-send evaluation data (confidence score, threshold, reason, action taken, and notification status).

## Inputs

- Root plan objectives
- Current `AIDraft` model in `prisma/schema.prisma`
- Auto-send evaluation return type from `lib/auto-send-evaluator.ts`

## Work

1. Add the following fields to the `AIDraft` model in `prisma/schema.prisma`:

```prisma
model AIDraft {
  // ... existing fields ...

  // Auto-send evaluation tracking
  autoSendEvaluatedAt     DateTime?
  autoSendConfidence      Float?
  autoSendThreshold       Float?
  autoSendReason          String?   @db.Text
  autoSendAction          String?   // 'send_immediate' | 'send_delayed' | 'needs_review' | 'skip' | 'error'
  autoSendSlackNotified   Boolean   @default(false)

  @@index([autoSendAction])
  @@index([autoSendEvaluatedAt])
}
```

2. Run `npm run db:push` to apply schema changes

3. Verify with `npx prisma studio` that new columns exist

## Output

- Updated `prisma/schema.prisma` with 6 new fields on `AIDraft`
- Database schema updated via `npm run db:push`

## Handoff

Pass the updated schema to 70b. The orchestrator can now persist evaluation data to these new fields.
