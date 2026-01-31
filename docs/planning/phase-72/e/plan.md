# Phase 72e — Smart CC Management on Outbound

## Focus

Update `lib/email-send.ts` to implement smart TO/CC resolution: when replying to a CC'd person, make them the TO recipient and put the original lead in CC.

## Inputs

- Phase 72d: AI drafts now address the correct person
- `lib/email-send.ts` handles all outbound email routing
- Message records have `fromEmail` from the inbound sender

## Work

### 1. Create Smart Recipient Resolution Function

Add to `lib/email-send.ts`:

```typescript
import { detectCcReplier, emailsMatch, normalizeOptionalEmail } from "@/lib/email-participants";

interface ResolvedRecipients {
  toEmail: string;
  toName: string | null;
  cc: string[];
}

/**
 * Resolve TO and CC addresses based on who sent the inbound message.
 * If a CC person replied, make them the TO recipient with original lead in CC.
 */
async function resolveOutboundRecipients(params: {
  lead: { email: string | null; firstName: string | null; lastName: string | null };
  latestInboundEmail: { fromEmail: string | null; fromName: string | null; cc: string[] } | null;
}): Promise<ResolvedRecipients> {
  const { lead, latestInboundEmail } = params;

  const leadPrimaryEmail = normalizeOptionalEmail(lead.email);
  const inboundFromEmail = normalizeOptionalEmail(latestInboundEmail?.fromEmail);

  // If no valid lead email, can't send
  if (!leadPrimaryEmail) {
    throw new Error("Lead has no email address");
  }

  // Detect if CC person replied
  const { isCcReplier } = detectCcReplier({
    leadEmail: leadPrimaryEmail,
    inboundFromEmail,
  });

  if (isCcReplier && inboundFromEmail) {
    // CC person replied: make them TO, put original lead in CC
    const existingCc = latestInboundEmail?.cc || [];

    // Build new CC list: original lead + other CCs (excluding the new TO)
    const newCc = [
      leadPrimaryEmail,
      ...existingCc.filter(
        e => !emailsMatch(e, inboundFromEmail) && !emailsMatch(e, leadPrimaryEmail)
      ),
    ].filter(Boolean) as string[];

    return {
      toEmail: inboundFromEmail,
      toName: latestInboundEmail?.fromName || null,
      cc: newCc,
    };
  }

  // Normal case: original lead replied
  const existingCc = latestInboundEmail?.cc || [];

  return {
    toEmail: leadPrimaryEmail,
    toName: lead.firstName ? `${lead.firstName} ${lead.lastName || ""}`.trim() : null,
    cc: existingCc.filter(e => !emailsMatch(e, leadPrimaryEmail)),
  };
}
```

### 2. Update `sendEmailReplySystem()` to Use Smart Resolution

In the main send function, replace the hardcoded TO = lead.email logic:

```typescript
// Before:
// const toEmails = lead.email ? [{ name: lead.firstName, email_address: lead.email }] : [];

// After:
const recipients = await resolveOutboundRecipients({
  lead,
  latestInboundEmail,
});

const toEmails = [{ name: recipients.toName, email_address: recipients.toEmail }];
const ccEmails = recipients.cc.map(email => ({ name: null, email_address: email }));
```

### 3. Update Provider-Specific Send Functions

Ensure the resolved recipients flow through to:
- EmailBison API calls
- SmartLead API calls
- Instantly API calls

Each provider may have slightly different parameter structures.

### 4. Update Message Record on Send

When creating the outbound Message record, ensure `toEmail` reflects the actual recipient:

```typescript
await prisma.message.create({
  data: {
    // ...
    toEmail: recipients.toEmail,
    toName: recipients.toName,
    cc: recipients.cc,
    // ...
  },
});
```

## Output

- `lib/email-send.ts` now resolves recipients via `resolveOutboundRecipients()`:
  - TO = current replier (or latest inbound sender) when it differs from primary
  - CC always includes the original lead when swapping
- Provider send calls now use resolved recipients (EmailBison/SmartLead/Instantly).
- Outbound `Message.toEmail` reflects the actual recipient used for the send.

## Coordination Notes

**Potential conflicts with:** Phase 70 (email send refactor)
**Files affected:** `lib/email-send.ts`
**Integration notes:** Reused Phase 70 `resolveOutboundCc()` and extended recipient logic without changing public API.

## Handoff

Outbound email routing now handles CC repliers correctly. Phase 72f will ensure follow-ups inherit the same swap logic.
