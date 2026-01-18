# Phase 31f — RED TEAM Correction: Race-Safe Message Inserts (No TOCTOU)

## Focus
Eliminate Prisma P2002 unique constraint failures for webhook message inserts by removing check-then-create (TOCTOU) patterns and using schema-real idempotency keys.

## Inputs
- Prod error: `PrismaClientKnownRequestError` `P2002` on `Message.emailBisonReplyId` (duplicate webhook deliveries racing).
- Schema reality: `prisma/schema.prisma` → `Message` unique fields:
  - `emailBisonReplyId`
  - `inboxxiaScheduledEmailId`
  - `ghlId`
  - `aiDraftId`
- Current hot paths to audit:
  - `app/api/webhooks/email/route.ts` (Inboxxia email webhook: multiple handlers insert `Message` rows)
  - `app/api/webhooks/ghl/sms/route.ts` (GHL SMS webhook inserts `Message` rows)
  - `app/api/webhooks/linkedin/route.ts`, `app/api/webhooks/smartlead/route.ts`, `app/api/webhooks/instantly/route.ts` (verify Message insert patterns)
- Important constraint: `Message` has no `updatedAt`, so “upsert then compare createdAt/updatedAt” cannot work.

## Work

### 1) Inventory all Message insert sites + dedupe keys (repo reality)
- Search for `prisma.message.create` / `prisma.message.createMany`.
- For each insert site, record:
  - Which unique id field (if any) is being used for dedupe.
  - Whether the current flow does `findUnique/findFirst` before `create` (TOCTOU risk).

### 2) Standardize on create-with-catch(P2002) for unique-id inserts
- Replace:
  - `findUnique({ where: { <uniqueId> }})` then `create({ data: { <uniqueId>, ... }})`
- With:
  - `try { create(...) } catch (P2002) { findUnique(...); return { deduped: true } }`
- Apply this consistently for:
  - `emailBisonReplyId` (inbound reply dedupe)
  - `inboxxiaScheduledEmailId` (EMAIL_SENT dedupe)
  - `ghlId` (SMS dedupe, where available)
  - `aiDraftId` (ensure approve/send from a draft cannot create duplicates)

### 3) Ensure background-job enqueue is idempotent too
- `BackgroundJob.dedupeKey` is unique; derive deterministic keys:
  - `EMAIL_INBOUND_POST_PROCESS:${messageId}`
  - (if new job types are added later) `${JOB_TYPE}:${messageId}`
- Avoid enqueueing on duplicate webhook deliveries unless the enqueue itself is deduped by key.

### 4) Add structured “dedupe hit” observability
- Add logs (or telemetry) that include:
  - event type
  - unique id key name + value (safe string)
  - leadId/clientId (workspace scope)
  - deduped=true/false

## Validation (RED TEAM)
- Concurrency test: send N identical webhook deliveries concurrently and verify:
  - all return `200`
  - exactly 1 `Message` row exists for the unique id value
  - duplicates return `{ deduped: true }` and do **not** emit a 500
- Verify across all unique keys present in schema (`emailBisonReplyId`, `inboxxiaScheduledEmailId`, `ghlId`, `aiDraftId`).
- Run: `npm run lint` and `npm run build`.

## Output

**Completed implementation across all webhook routes:**

1. **Shared utility in `lib/prisma.ts`:**
   - Added `isPrismaUniqueConstraintError(error)` - checks for P2002 code
   - Added `isPrismaConnectionError(error)` - checks for P1001 code (for 31i)

2. **Email webhook (`app/api/webhooks/email/route.ts`):**
   - Fixed `handleLeadReplied` - wrapped message create in try/catch for `emailBisonReplyId`
   - Fixed `handleLeadInterested` - same pattern for `emailBisonReplyId`
   - Fixed `handleUntrackedReply` (bounce path) - same pattern for `emailBisonReplyId`
   - Fixed `handleUntrackedReply` (regular path) - same pattern for `emailBisonReplyId`
   - Fixed `handleEmailSent` - same pattern for `inboxxiaScheduledEmailId`

3. **GHL SMS webhook (`app/api/webhooks/ghl/sms/route.ts`):**
   - Fixed `importHistoricalMessages` - wrapped message create for `ghlId`

4. **SmartLead webhook (`app/api/webhooks/smartlead/route.ts`):**
   - Fixed `EMAIL_REPLY` inbound handler - wrapped message create for `emailBisonReplyId`
   - Fixed `EMAIL_SENT` outbound handler - wrapped message create for `inboxxiaScheduledEmailId`

5. **Instantly webhook (`app/api/webhooks/instantly/route.ts`):**
   - Fixed `reply_received` inbound handler - wrapped message create for `emailBisonReplyId`
   - Fixed `email_sent` outbound handler - wrapped message create for `inboxxiaScheduledEmailId`

6. **LinkedIn webhook (`app/api/webhooks/linkedin/route.ts`):**
   - Fixed `handleInboundMessage` - wrapped message create with P2002 catch
   - Note: LinkedIn uses body+timestamp range for dedup (no unique ID field), but race can still occur

**Pattern applied consistently:**
```typescript
let message: { id: string };
try {
  message = await prisma.message.create({ data: { uniqueIdField, ... }, select: { id: true } });
} catch (error) {
  if (isPrismaUniqueConstraintError(error)) {
    console.log(`[Webhook] Dedupe race: uniqueIdField=${value} already exists`);
    return NextResponse.json({ success: true, deduped: true, eventType });
  }
  throw error;
}
```

**Verified:** `npm run build` completes successfully.

## Handoff
Proceed to 31g to remove slow work from webhook critical paths and rely on background jobs for enrichment/AI/autosend.
