# Phase 44c — Verification and Testing

## Focus

Verify that both fixes work correctly: Email Bison sends succeed and Calendly webhooks are received.

## Inputs

- EmailBison base host is configured per workspace (via UI after deploy, or via optional SQL backfill)
- Phase 44b completed: Calendly signing key fix deployed
- User has clicked "Ensure Webhooks" in Founders Club dashboard

## Work

### Step 1: Verify Email Bison fixes

**Test from Founders Club:**
1. Open Founders Club workspace in dashboard
2. Select a lead with an email draft
3. Click "Send" on the draft
4. Verify no 401 error in UI or logs
5. Check Email Bison platform to confirm email was sent

**Test from ZRG workspace:**
1. Open any ZRG workspace (e.g., ZRG B2B CMO Club)
2. Select a lead with an email draft
3. Click "Send" on the draft
4. Verify no 401 error

**SQL verification:**
```sql
SELECT c.name, ebh.host
FROM "Client" c
JOIN "EmailBisonBaseHost" ebh ON c."emailBisonBaseHostId" = ebh.id
WHERE c.name IN ('Founders Club', 'ZRG B2B CMO Club');
```

Expected:
- Founders Club → `send.foundersclubsend.com`
- ZRG B2B CMO Club → `send.meetinboxxia.com`

### Step 2: Verify Calendly webhook fix

**Pre-check:**
```sql
SELECT "calendlyWebhookSigningKey" IS NOT NULL as has_signing_key,
       "calendlyWebhookSubscriptionUri"
FROM "Client"
WHERE name = 'Founders Club';
```

If `has_signing_key` is still false, user needs to click "Ensure Webhooks".

**Test webhook:**
1. Book a test meeting on the Founders Club Calendly calendar
2. Wait for webhook to arrive
3. Check Vercel logs for:
   - `[Calendly Webhook] Signature verified` (success)
   - NOT `[Calendly Webhook] No signing key configured` (the old error)
4. Verify appointment was created in the database

### Step 3: Document AI Drafts behavior

No code changes needed. The AI drafts timeout is working as designed:
- OpenAI times out occasionally due to network/load
- System falls back to deterministic template draft
- Draft is still created and available for review/send

**Optional:** If timeouts become frequent, consider increasing `OPENAI_DRAFT_TIMEOUT_MS` environment variable from 120000 to 180000.

### Step 4: Update phase summary

Add results to `docs/planning/phase-44/plan.md`:
- Email Bison: FIXED (data fix applied)
- Calendly: FIXED (code deployed + webhooks recreated)
- AI Drafts: NO CHANGE NEEDED (fallback working correctly)

## Output

**Status:** Verification pending deployment

**Email Bison (Phase 44a):**
- ✅ Per-workspace base host setting implemented in dashboard UI
- ⏳ Awaiting deployment + base host configuration per workspace
- ⏳ Awaiting user verification that email sends work from dashboard

**Calendly (Phase 44b):**
- ✅ Code fix implemented in `actions/calendly-actions.ts`
- ✅ Build passes
- ⏳ Awaiting deployment to production
- ⏳ Awaiting user click "Ensure Webhooks" in Founders Club
- ⏳ Awaiting test booking to verify webhook is received

**AI Drafts:**
- ✅ No changes needed - fallback working correctly as designed

## Handoff

Phase 44c verification steps documented. After deployment:
1. Verify email sends work (Founders Club + ZRG workspaces)
2. Click "Ensure Webhooks" in Founders Club Settings
3. Book test meeting to verify Calendly webhooks
4. Monitor logs for any errors

Phase complete pending production verification.
