# Phase 45e — Verification and Testing

## Focus

Verify the complete Phase 45 implementation with lint, build, and manual testing of all three fixes/features.

## Inputs

- Subphase a: Booking link null case fix in `lib/booking-process-instructions.ts`
- Subphase b: Post-processing sanitization in `lib/ai-drafts.ts`
- Subphase c: Bulk regeneration server action in `actions/message-actions.ts`
- Subphase d: Settings UI component in `components/dashboard/settings-view.tsx`

## Work

### 1. Build verification

```bash
# Check for TypeScript errors
npm run lint

# Full production build
npm run build
```

Both must pass with no errors (warnings acceptable if pre-existing).

### 2. Bug 1 verification (Placeholder text fix)

**Setup:**
1. Use a workspace with no booking link configured (no default `CalendarLink` and no provider link available via `getBookingLink(...)`)
2. Ensure a lead exists with positive sentiment (e.g., "Interested")

**Test:**
1. Trigger draft generation for the lead (via webhook or manual action)
2. Check the generated draft content in the database
3. Verify no placeholder text appears: `{insert booking link}`, `{booking link}`, `[booking link]`, etc.

**Expected logs:**
```
[BookingProcess] Stage X requests booking link but none configured for client <clientId>
```

**Success criteria:**
- Draft contains no placeholder text
- Warning log is emitted
- AI suggests alternative (ask for availability or offer times)

### 3. Bug 2 verification (Truncated URL fix)

**Test the sanitization function directly:**

```typescript
// Test cases for sanitizeDraftContent()
const testCases = [
  // Placeholders should be removed
  { input: "Book here: {insert booking link}", expected: "Book here:" },
  { input: "Click {booking link} to schedule", expected: "Click to schedule" },
  { input: "Use [your booking link]", expected: "Use" },

  // Truncated URLs should be removed
  { input: "Book at https://c ", expected: "Book at" },
  { input: "Link: https://cal ", expected: "Link:" },

  // Valid URLs should NOT be removed
  { input: "Book at https://calendly.com/user", expected: "Book at https://calendly.com/user" },
  { input: "Link: https://cal.com/user", expected: "Link: https://cal.com/user" },

  // Mixed case should work
  { input: "{BOOKING LINK}", expected: "" },
];
```

**Verify logs when sanitization occurs:**
```
[AI Drafts] Sanitized draft for lead <leadId> (email): { hadPlaceholders: true, hadTruncatedUrl: false }
```

### 4. Bulk regeneration verification

**Setup:**
1. Log in as workspace admin
2. Navigate to Settings → AI Personality tab
3. Ensure workspace has pending drafts for the chosen channel (or adjust if bulk regen is expanded to “all eligible leads”)

**Test flow:**
1. Select channel (Email, SMS, or LinkedIn)
2. Click "Regenerate All Drafts"
3. Observe progress indicator updating
4. If "Continue" button appears, click to process more leads
5. Click "Reset" to clear progress

**Verify in database:**
```sql
SELECT d.id, d.channel, d.status, d.content, d."updatedAt"
FROM "AIDraft" d
JOIN "Lead" l ON l.id = d."leadId"
WHERE l."clientId" = '<clientId>'
  AND d.channel = '<channel>' -- sms | email | linkedin
ORDER BY d."updatedAt" DESC
LIMIT 20;
```

**Success criteria:**
- Progress shows: processed/total, regenerated, skipped, errors
- Drafts are updated in database
- No timeout errors (pagination handles large counts)
- Admin-only: non-admins don't see the card

### 5. Regression checks

Verify existing functionality still works:
- [ ] Manual draft regeneration (single lead) still works
- [ ] Auto-draft generation on new inbound messages still works
- [ ] Draft send functionality not affected
- [ ] Booking process stages with valid booking links still work

### 6. Documentation

Update `CLAUDE.md` if needed:
- Add note about bulk regeneration feature
- Document the sanitization safety net

### 7. Final checklist

- [ ] `npm run lint` passes (0 errors)
- [ ] `npm run build` passes
- [ ] Bug 1 fix verified (no placeholder text)
- [ ] Bug 2 fix verified (truncated URLs removed)
- [ ] Bulk regeneration works with progress tracking
- [ ] Pagination/continuation works for large lead counts
- [ ] Admin-only access control working
- [ ] No regressions in existing draft functionality

## Output

- Verified implementation ready for commit
- All success criteria met
- Documentation updated if needed

## Handoff

Phase 45 complete. Create `docs/planning/phase-45/review.md` with:
- Summary of changes made
- Verification results
- Any follow-up items identified
