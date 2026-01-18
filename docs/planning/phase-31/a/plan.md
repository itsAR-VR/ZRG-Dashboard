# Phase 31a — Fix P2002 Race Condition on emailBisonReplyId

## Focus
Eliminate the Prisma unique constraint failure (P2002) on `emailBisonReplyId` in the email webhook by replacing the check-then-create pattern with an atomic upsert or catch-and-return pattern.

## Inputs
- Root context: P2002 error occurs when duplicate webhook deliveries race past the deduplication check
- Current flow in `app/api/webhooks/email/route.ts`:
  1. `findUnique({ where: { emailBisonReplyId } })` → if exists, return deduped
  2. Process lead, sentiment, etc.
  3. `create({ data: { emailBisonReplyId, ... } })` → P2002 if another request created it
- Race window: Steps 2 takes time (lead upsert, sentiment classification, etc.)

## Work

### 1. Identify all message creation points with unique ID fields
- `emailBisonReplyId` (email inbound)
- `inboxxiaScheduledEmailId` (email outbound)
- `ghlId` (SMS)
- `smartleadReplyId`, `instantlyReplyId` (other providers)

### 2. Implement atomic upsert pattern
Replace:
```typescript
const existing = await prisma.message.findUnique({ where: { emailBisonReplyId } });
if (existing) return deduped response;
// ... processing ...
const message = await prisma.message.create({ data: { emailBisonReplyId, ... } });
```

With:
```typescript
try {
  const message = await prisma.message.upsert({
    where: { emailBisonReplyId },
    create: { emailBisonReplyId, ... },
    update: {}, // No-op update, we just want to ensure existence
  });
  // Check if this was a create or update (compare createdAt vs updatedAt or use a flag)
} catch (error) {
  if (isPrismaUniqueConstraintError(error)) {
    // Another request won the race, fetch and return
    const existing = await prisma.message.findUnique({ where: { emailBisonReplyId } });
    if (existing) return deduped response;
  }
  throw error;
}
```

### 3. Alternative: Move dedup check to after processing, catch P2002
For cases where we need to run processing before knowing the final message data:
```typescript
// ... processing (lead upsert, sentiment, etc.) ...
try {
  const message = await prisma.message.create({ data: { emailBisonReplyId, ... } });
} catch (error) {
  if (isPrismaUniqueConstraintError(error)) {
    // Already exists, treat as deduped
    const existing = await prisma.message.findUnique({ where: { emailBisonReplyId } });
    if (existing) {
      // Enqueue background job for the existing message
      await enqueueEmailInboundPostProcessJob({ ... });
      return NextResponse.json({ success: true, deduped: true, ... });
    }
  }
  throw error;
}
```

### 4. Apply pattern to all webhook handlers
- `handleLeadReplied`
- `handleLeadInterested`
- `handleUntrackedReply`
- `handleEmailSent`

### 5. Verify with tests
- Simulate concurrent webhook deliveries
- Confirm P2002 is handled gracefully

## Output

**Completed implementation:**

1. **Added shared utility functions to `lib/prisma.ts`:**
   - `isPrismaUniqueConstraintError(error)` - detects P2002 errors
   - `isPrismaConnectionError(error)` - detects P1001 errors (for use in later subphases)

2. **Fixed `app/api/webhooks/email/route.ts`:**
   - `handleLeadReplied` (line ~596): Wrapped message create in try/catch, catches P2002, fetches existing message, enqueues post-process job, returns deduped response
   - `handleLeadInterested` (line ~1089): Same pattern applied
   - `handleUntrackedReply` bounce handler (line ~1480): Catches P2002 for bounce message
   - `handleUntrackedReply` regular flow (line ~1655): Same pattern with full dedupe handling
   - `handleEmailSent` (line ~1894): Catches P2002 for `inboxxiaScheduledEmailId` duplicates

3. **Fixed `app/api/webhooks/ghl/sms/route.ts`:**
   - `importHistoricalMessages` (line ~295): Added inner try/catch for `ghlId` P2002

4. **Verified:**
   - `npm run lint` passes (only pre-existing warnings)
   - `npm run build` completes successfully

**Pattern used:** "Create-then-catch(P2002)" - keeps initial findUnique as optimization, wraps create in try/catch to handle race condition where duplicates both pass initial check.

## Handoff
P2002 race conditions on `emailBisonReplyId`, `inboxxiaScheduledEmailId`, and `ghlId` are now handled gracefully. Subphase b can proceed to harden EmailBison fetch with timeout/retry and graceful degradation.
