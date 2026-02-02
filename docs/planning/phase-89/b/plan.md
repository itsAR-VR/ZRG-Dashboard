# Phase 89b — Assignment Logic Update (Sequence + Email-Only Gate)

## Focus
Implement weighted round-robin selection using an explicit per-workspace sequence (with repeats) and add an “Email-only” eligibility gate, while preserving idempotency and avoiding reassignment of already-owned leads.

## Inputs
- Phase 89a schema fields:
  - `WorkspaceSettings.roundRobinSetterSequence`
  - `WorkspaceSettings.roundRobinEmailOnly`
- Current assignment entrypoint: `lib/lead-assignment.ts:assignLeadRoundRobin()`
- Trigger point: inbound post-process pipeline calls `maybeAssignLead()` after sentiment classification.

## Work
1. Read new settings fields inside `assignLeadRoundRobin()`:
   - `roundRobinEnabled`, `roundRobinLastSetterIndex`, `roundRobinSetterSequence`, `roundRobinEmailOnly`
2. Email-only eligibility gating:
   - Add a `channel` parameter (`"email" | "sms" | "linkedin"`) to the assignment entrypoints.
   - If `roundRobinEmailOnly` is true and `channel !== "email"`, skip assignment and do not advance the pointer.
   - Rationale: “Email-only” should be enforced based on the triggering inbound channel (avoids SMS/LinkedIn assigning just because an email address exists on the Lead).
3. Build the effective rotation list:
   - Fetch active setters (`ClientMember.role=SETTER`, `createdAt asc`).
   - If `roundRobinSetterSequence` is non-empty:
     - Filter it down to only userIds that are still active setters.
     - If the filtered sequence is empty, skip assignment (log a warning).
   - Else, fallback to the unique active setter list (current behavior).
   - **Explicit fallback:** Empty `roundRobinSetterSequence` (`[]`) means "use active setters in creation order" — document in code comment.
4. Pointer + atomicity:
   - Keep the existing "assign only if unassigned" guard (`updateMany WHERE assignedToUserId IS NULL`).
   - Advance `roundRobinLastSetterIndex` only if the assignment update succeeded.
   - Reset the pointer to `-1` when the configured sequence changes (done in Phase 89c).
5. Concurrency hardening (decision: implement):
   - Lock the `WorkspaceSettings` row in the interactive transaction (`SELECT … FOR UPDATE`) before reading/updating the pointer to avoid pointer drift under concurrent assignments.
   - **Implementation approach:** Use Prisma raw query for the lock:
     ```typescript
     // Acquire row-level lock first (blocks concurrent transactions)
     await tx.$executeRaw`SELECT 1 FROM "WorkspaceSettings" WHERE "clientId" = ${clientId} FOR UPDATE`;
     // Then read settings with normal Prisma (lock is held for duration of transaction)
     const settings = await tx.workspaceSettings.findUnique({
       where: { clientId },
       select: {
         roundRobinEnabled: true,
         roundRobinLastSetterIndex: true,
         roundRobinSetterSequence: true,
         roundRobinEmailOnly: true,
       },
     });
     ```
   - **Edge case: pointer drift after setter removal** — If `roundRobinLastSetterIndex` is 4 but the filtered sequence now has only 3 entries, the modulo operation naturally handles this: `(4 + 1) % 3 = 2`. No special handling needed.
   - **Note:** `SELECT 1` instead of `SELECT *` is sufficient for locking and avoids fetching unused columns.

## Updated Function Signature (RED TEAM)

Updated:
- `maybeAssignLead({ leadId, clientId, sentimentTag, channel })`
- `assignLeadRoundRobin({ leadId, clientId, channel })`

All trigger sites now pass their channel explicitly (email pipeline + email/sms/linkedin background jobs).

## Observability (RED TEAM)

Add logging for weighted round-robin:
```typescript
console.log(
  `[LeadAssignment] Weighted round-robin: sequence=${effectiveSequence.length > 0 ? 'custom' : 'fallback'}, ` +
  `position=${nextIndex}, emailOnlyGate=${settings.roundRobinEmailOnly}, ` +
  `assignedTo=${nextSetter.userId}`
);
```

## Output
- Implemented weighted round-robin + email-only gating in `lib/lead-assignment.ts`:
  - Uses `WorkspaceSettings.roundRobinSetterSequence` when configured (duplicates preserved; inactive setters filtered out).
  - Falls back to active setters ordered by `createdAt asc` when sequence is empty.
  - Enforces email-only workspaces by requiring `channel === "email"` (prevents SMS/LinkedIn-triggered assignment).
  - Adds `SELECT … FOR UPDATE` lock on `WorkspaceSettings` row to prevent concurrent pointer drift.
  - Exports pure helpers `computeEffectiveSetterSequence()` and `getNextRoundRobinIndex()` for unit tests.
- Updated assignment trigger call sites to pass channel:
  - `lib/inbound-post-process/pipeline.ts` → `channel: "email"`
  - `lib/background-jobs/email-inbound-post-process.ts` → `channel: "email"`
  - `lib/background-jobs/sms-inbound-post-process.ts` → `channel: "sms"`
  - `lib/background-jobs/linkedin-inbound-post-process.ts` → `channel: "linkedin"`
- Backfill behavior: if `roundRobinEmailOnly` is enabled, `backfillLeadAssignments()` filters to leads with email attribution (`emailBisonLeadId` or `emailCampaignId`) and calls assignment with `channel: "email"`.

## Coordination Notes

- Fixed unrelated TypeScript errors in `lib/calendar-health-runner.ts` (Phase 86 in-flight) by typing internal `__links`/`__enabled` fields properly and removing `as any` casting.

## Validation (RED TEAM)

1. **Verify lock implementation:**
   - Check that `$executeRaw` with `FOR UPDATE` appears before any `findUnique` call on `workspaceSettings`
   - Confirm all settings reads happen AFTER the lock

2. **Verify email-only gating:**
   - Check that `roundRobinEmailOnly` is read from settings
   - Check that lead fetch includes `emailBisonLeadId` and `emailCampaignId`
   - Check that assignment is skipped (returns null, no pointer advance) when:
     - `roundRobinEmailOnly === true` AND
     - `lead.emailBisonLeadId === null` AND `lead.emailCampaignId === null`

3. **Verify sequence filtering:**
   - Check that sequence is filtered against active setters before use
   - Check that empty filtered sequence causes skip (log warning, return null)

4. **Verify observability:**
   - Check that weighted round-robin log line includes sequence type, position, and assignee

## Handoff
Proceed to Phase 89c to expose round-robin configuration via admin server actions + settings UI.
