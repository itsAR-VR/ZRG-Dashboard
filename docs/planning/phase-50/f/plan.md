# Phase 50f — Actions: Update Email Send Actions for Custom CC

## Focus

Update the email send server actions to accept a custom CC list from the UI (manual send + draft approval), allowing users to control who receives their replies, and persist participant metadata on outbound `Message` rows.

## Inputs

- UI changes from subphase e (CC list passed to send action)
- Existing email action files:
  - `actions/email-actions.ts` — `sendEmailReply`, `sendEmailReplyForLead`
  - `actions/message-actions.ts` — `sendEmailMessage`, `approveAndSendDraft`, `approveAndSendDraftSystem`

## Work

### 1. Update `actions/message-actions.ts`

Add CC parameter to `sendEmailMessage` and sanitize/limit overrides server-side (setters allowed):

```typescript
interface SendEmailMessageOptions {
  cc?: string[];  // Custom CC recipients
}

export async function sendEmailMessage(
  leadId: string,
  content: string,
  options?: SendEmailMessageOptions
): Promise<{ success: boolean; error?: string }> {
  // ... existing validation ...
  // Lead access already enforced in this action; CC overrides are allowed for authorized users (including setters).

  // Pass CC to underlying email action
  const result = await sendEmailReplyForLead(leadId, content, {
    cc: options?.cc,
  });

  // ...
}
```

Also update the email draft approval path so CC overrides apply when approving/sending an email draft:

- Extend `approveAndSendDraft(draftId, editedContent?, opts?)` to accept `{ cc?: string[] }`
- Extend `approveAndSendDraftSystem(draftId, opts)` to accept `{ cc?: string[] }` and pass through to `sendEmailReply(...)`
- CC overrides are allowed for authorized users (including setters); keep enforcement to existing draft/lead access checks

### 2. Update `actions/email-actions.ts`

#### Extend `sendEmailReply(...)` and `sendEmailReplyForLead(...)` opts

Add an optional `cc?: string[]` to the existing opts parameter (alongside `sentBy` / `sentByUserId`).

#### Normalize + validate CC overrides (RED TEAM)

Before passing `opts.cc` into provider payloads:

- trim whitespace
- lowercase for dedupe
- drop invalid email strings (basic format check)
- enforce a small max (e.g., 20) to prevent abuse and provider rejections

#### Modify CC Resolution Logic (~lines 277-278 for EmailBison, ~lines 373-374 for SmartLead)

Current behavior:
```typescript
const ccEmails = latestInboundEmail?.cc?.map(...) || [];
```

New behavior:
```typescript
// Use custom CC if provided, otherwise fall back to thread CC
const ccEmails = opts?.cc?.length
  ? opts.cc.map(email => ({ name: null, email_address: email }))
  : (latestInboundEmail?.cc?.map(address => ({ name: null, email_address: address })) || []);
```

For SmartLead (string array):
```typescript
const cc = opts?.cc?.length ? opts.cc : (latestInboundEmail?.cc || []).filter(Boolean);
```

Apply the same approach in both `sendEmailReply(...)` and `sendEmailReplyForLead(...)` so manual sends and draft sends behave consistently.

### 3. Update Outbound Message Record

When creating the outbound Message, use the actual CC sent:

```typescript
const message = await prisma.message.create({
  data: {
    // ... existing fields ...
    cc: (opts?.cc?.length ? opts.cc : (latestInboundEmail?.cc || [])),  // Store actual CC used
    // ...
  },
});
```

Also persist From/To fields on outbound rows (so the header renders for replies even before a sync/webhook round-trip):

- `toEmail` should always be the lead email (`lead.email`)
- `toName` can use the lead name (`lead.firstName` / `lead.lastName`) when available
- `fromEmail` should be populated when we can deterministically derive it (e.g., EmailBison via `EmailBisonSenderEmailSnapshot.emailAddress` for the chosen `senderEmailId`); otherwise leave null and fall back to "You" in the UI

### 4. Instantly CC/BCC Support

Instantly’s reply API supports CC/BCC via comma-separated lists (per Instantly API v2 docs for `POST /api/v2/emails/reply`).

Plan changes:

- Update `lib/instantly-api.ts:sendInstantlyReply(...)` to accept optional `cc?: string[]` and `bcc?: string[]`, and send:
  - `cc_address_email_list: cc.join(",")`
  - `bcc_address_email_list: bcc.join(",")`
- Update `actions/email-actions.ts` Instantly branch to pass:
  - `cc` resolved via `opts.cc` override or `latestInboundEmail.cc`
  - `bcc` resolved via `latestInboundEmail.bcc` (view-only in UI)

## Output

- [x] `sendEmailMessage` accepts optional `cc` parameter (already done in prior session)
- [x] `approveAndSendDraft` / `approveAndSendDraftSystem` accept optional `cc` for email drafts (already done)
- [x] `sendEmailReply` and `sendEmailReplyForLead` accept and use custom CC
- [x] CC resolution uses `opts.cc?.length ? opts.cc : fallback` pattern for EmailBison, SmartLead, Instantly
- [x] Outbound Message records store the actual CC used via `actualCcUsed` variable
- [x] Outbound Message records include `toEmail` and `toName` for participant header display
- [x] `lib/instantly-api.ts` updated to support `cc` and `bcc` via comma-separated lists
- [x] Instantly replies can include CC/BCC when provided

## Handoff

Phase 50 complete. Verification passed:
1. `npm run lint` - 0 errors, 17 warnings (pre-existing)
2. `npm run build` - ✓ Compiled successfully
3. `npm run db:push` - Database already in sync
4. Manual test: compose email, edit CC, send, verify recipients (pending user verification)
