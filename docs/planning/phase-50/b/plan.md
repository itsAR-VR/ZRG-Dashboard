# Phase 50b — Webhooks: Capture Sender/Recipient from Email Providers

## Focus

Update the three email webhooks to capture and store `fromEmail`, `fromName`, `toEmail`, `toName` when creating Message records.

## Inputs

- Schema changes from subphase a (new Message fields available)
- Webhook files:
  - `app/api/webhooks/email/route.ts` (EmailBison/Inboxxia)
  - `app/api/webhooks/smartlead/route.ts`
  - `app/api/webhooks/instantly/route.ts`

## Work

### 1. EmailBison Webhook (`app/api/webhooks/email/route.ts`)

**Payload structure** (from exploration):
```typescript
reply.from_email_address?: string | null
reply.from_name?: string | null
reply.to?: { address: string; name: string | null }[] | null
// Sender mailbox (our side)
data.sender_email?: { email?: string; name?: string | null } | null
```

**Update Message creation** in these handlers:
- `handleLeadReplied()` (~line 570)
- `handleLeadInterested()` (~line 1066)
- `handleUntrackedReply()` (~line 1611)
- Outbound handler: `handleEmailSent()` (campaign outbound)

**Extract and store:**
```typescript
fromEmail: reply.from_email_address ?? null,
fromName: reply.from_name ?? null,
toEmail: reply.to?.[0]?.address ?? data?.sender_email?.email ?? null,
toName: reply.to?.[0]?.name ?? data?.sender_email?.name ?? null,
```

**For outbound campaign sends** (`handleEmailSent()`), persist the same shape on the outbound `Message` row:
```typescript
fromEmail: data?.sender_email?.email ?? null,
fromName: data?.sender_email?.name ?? null,
toEmail: lead.email ?? null,
toName: [lead.firstName, lead.lastName].filter(Boolean).join(" ") || null,
```

### 2. SmartLead Webhook (`app/api/webhooks/smartlead/route.ts`)

**Payload structure:**
```typescript
payload.from_email?: string | null
payload.to_email?: string | null
payload.sl_lead_name?: string | null
payload.sl_lead_email?: string | null
payload.cc_emails?: string[] | null
```

**Update Message creation**:

Inbound (`EMAIL_REPLY`) Message row:
```typescript
fromEmail: replyFromEmail ?? null,
fromName: normalizeOptionalString(payload.sl_lead_name),
toEmail: normalizeOptionalString(payload.to_email),
toName: null,
```

Outbound (`EMAIL_SENT`) Message row:
```typescript
fromEmail: normalizeOptionalString(payload.from_email),
fromName: null,
toEmail: normalizeOptionalString(payload.to_email) ?? leadEmail,
toName: normalizeOptionalString(payload.sl_lead_name),
```

### 3. Instantly Webhook (`app/api/webhooks/instantly/route.ts`)

**Payload structure:**
```typescript
payload.contact_email?: string
payload.contact_name?: string
payload.email_account?: string // Instantly "eaccount" (sending mailbox/account); expected to be an email address per Instantly API v2
```

**Update Message creation**:

Inbound (`reply_received`) Message row:
```typescript
fromEmail: normalizeOptionalString(payload.contact_email),
fromName: normalizeOptionalString(payload.contact_name),
toEmail: normalizeOptionalString(payload.email_account), // our mailbox/account ("eaccount")
toName: null,
```

Outbound (`email_sent`) Message row:
```typescript
fromEmail: normalizeOptionalString(payload.email_account), // our mailbox/account ("eaccount")
fromName: null,
toEmail: normalizeOptionalString(payload.contact_email),
toName: normalizeOptionalString(payload.contact_name),
```

### Verification

- Trigger test email via each provider
- Check Message record in Prisma Studio for populated fields
- Confirm no webhook dedupe behavior changed (only new columns populated)

## Output

- Updated `app/api/webhooks/email/route.ts` (EmailBison):
  - `handleLeadReplied()` - added from/to fields (inbound)
  - `handleLeadInterested()` - added from/to fields (inbound)
  - `handleUntrackedReply()` - added from/to fields (inbound)
  - bounce handlers - added from/to fields (inbound)
  - `handleEmailSent()` - added from/to fields (outbound campaign)
- Updated `app/api/webhooks/smartlead/route.ts`:
  - EMAIL_REPLY handler - added from/to fields (inbound)
  - EMAIL_SENT handler - added from/to fields (outbound)
- Updated `app/api/webhooks/instantly/route.ts`:
  - reply_received handler - added from/to fields (inbound)
  - email_sent handler - added from/to fields (outbound)

## Handoff

Subphase c will create helper utilities for formatting email participants and extend the UI message type to include these fields.
