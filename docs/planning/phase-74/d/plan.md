# Phase 74d — Verification and Testing

## Focus

Verify the implementation works correctly end-to-end and passes quality gates.

## Inputs

- Phase 74a-c changes complete
- Key files modified:
  - `components/dashboard/action-station.tsx`
  - `actions/message-actions.ts`
  - `actions/email-actions.ts`
  - `lib/email-send.ts`
  - `lib/email-participants.ts`
  - `lib/instantly-api.ts`
  - `lib/__tests__/email-participants.test.ts`
  - `scripts/test-orchestrator.ts`

## Work

### 1. Code quality verification

```bash
npm test
npm run lint
npm run build
```

Both must pass with no new errors.

### 2. Manual testing scenarios

#### Scenario A: CC Replier Display (Phase 72 fix)
1. Find a lead where someone CC'd replied (has `currentReplierEmail` set)
2. Open conversation in inbox
3. Verify To: field shows the replier's email, not the original lead email

#### Scenario B: Edit To: Recipient
1. Open any email conversation
2. Use the To: dropdown to select a different known participant (e.g., primary vs current replier)
3. Verify the selected participant is shown in the To: control

#### Scenario C: Send with Modified Recipients
1. Open email conversation
2. Change To: recipient to a different email
3. Add a CC recipient
4. Send the email
5. Verify:
   - Email is sent successfully
   - Outbound message shows correct recipients
   - No errors in console

#### Scenario D: Empty To: Blocked
1. Open email conversation
2. Verify send is blocked if no To value is available (should not occur for leads with email)

#### Scenario E: Backward Compatibility
1. Open email conversation
2. Do NOT modify the To: field
3. Send email
4. Verify smart resolution still works (goes to currentReplier if set, else lead.email)

### 3. Edge case verification

- [ ] To: selection resets on conversation switch
- [ ] CC behavior unchanged
- [ ] Instantly threads show To but cannot override it (provider limitation)

## Output

- `npm test`: pass (78 tests) — Sat Jan 31 2026
- `npm run lint`: pass (warnings only) — Sat Jan 31 2026
- `npm run build`: pass — Sat Jan 31 2026

## Handoff

Phase 74 complete. Update root `plan.md` with Phase Summary section documenting what shipped.
