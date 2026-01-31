# Phase 72c — Webhook Ingestion (CC Replier Detection)

## Focus

Update email webhook handlers (SmartLead, Instantly, EmailBison) to detect when a CC'd person replies and update the Lead record with alternate email and current replier information.

## Inputs

- Phase 72a: Lead model has `alternateEmails`, `currentReplierEmail`, `currentReplierName`, `currentReplierSince`
- Phase 72b: `lib/email-participants.ts` utilities available

## Work

### 1. SmartLead Webhook (`app/api/webhooks/smartlead/route.ts`)

In the `EMAIL_REPLY` handler, after creating/updating the message:

```typescript
import { detectCcReplier, addToAlternateEmails, normalizeOptionalEmail } from "@/lib/email-participants";

// After message creation, detect CC replier scenario
const leadEmail = normalizeOptionalEmail(lead.email);
const actualReplierEmail = normalizeOptionalEmail(replyFromEmail);
const actualReplierName = normalizeOptionalString(payload.sl_lead_name);

const { isCcReplier } = detectCcReplier({
  leadEmail,
  inboundFromEmail: actualReplierEmail,
});

// Fetch current state once (avoid overwriting alternates; decide whether to clear current replier)
const currentLead = await prisma.lead.findUnique({
  where: { id: lead.id },
  select: { alternateEmails: true, currentReplierEmail: true },
});

if (isCcReplier && actualReplierEmail) {
  await prisma.lead.update({
    where: { id: lead.id },
    data: {
      currentReplierEmail: actualReplierEmail,
      currentReplierName: actualReplierName || null,
      currentReplierSince: new Date(),
      alternateEmails: addToAlternateEmails(
        currentLead?.alternateEmails || [],
        actualReplierEmail,
        leadEmail
      ),
    },
  });

  console.log(`[SmartLead Webhook] CC replier detected: ${actualReplierEmail} (lead: ${leadEmail})`);
} else if (!isCcReplier && currentLead?.currentReplierEmail) {
  // Original lead replied again - clear current replier
  await prisma.lead.update({
    where: { id: lead.id },
    data: {
      currentReplierEmail: null,
      currentReplierName: null,
      currentReplierSince: null,
    },
  });
}
```

### 2. Instantly Webhook (`app/api/webhooks/instantly/route.ts`)

Same pattern as SmartLead, using:
- `leadEmail`: from lead record or payload
- `actualReplierEmail`: from `payload.contact_email`
- `actualReplierName`: from `payload.contact_name`

### 3. EmailBison Webhook (`app/api/webhooks/email/route.ts`)

Same pattern, using:
- `leadEmail`: from lead record or `payload.data.lead.email`
- `actualReplierEmail`: from `reply.from_email_address`
- `actualReplierName`: from `reply.from_name`

### 4. Background Job Handlers

If AI processing is done in background jobs (e.g., `lib/background-jobs/smartlead-inbound-post-process.ts`), the CC replier detection should happen there instead of the webhook handler. Check if the webhook creates the message synchronously or enqueues a job.

Pattern:
- If webhook creates message → detect CC replier in webhook
- If webhook enqueues job → detect CC replier in job handler

## Output

- `app/api/webhooks/smartlead/route.ts` now updates `Lead.currentReplier*` + `alternateEmails` on inbound replies.
- `app/api/webhooks/instantly/route.ts` now updates `Lead.currentReplier*` + `alternateEmails` on inbound replies.
- `app/api/webhooks/email/route.ts` adds a shared helper `updateLeadReplierState()` and calls it for all inbound reply handlers.
- Replier updates are minimal and run post-message-create (no extra provider API calls).

## Coordination Notes

**Potential conflicts with:** Phase 66 (email webhook processing), Phase 70 (email send pipeline)
**Files affected:** `app/api/webhooks/email/route.ts`, `app/api/webhooks/smartlead/route.ts`, `app/api/webhooks/instantly/route.ts`
**Integration notes:** Added isolated helper and updates without touching sentiment logic or background job enqueue.

## Handoff

Webhooks now track CC repliers. Phase 72d can pass replier identity into AI draft generation.
