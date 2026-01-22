# Phase 50 — Email CC/Participant Visibility

## Purpose

Add email-style participant visibility (From/To/CC) to the inbox conversation view and an editable CC recipient editor to the compose area, so users can see who is CC'd on threads and control who receives their replies.

## Context

When someone is CC'd on an email thread, that information is captured in the database (`cc` field on Message model) but **never displayed in the UI**. Users cannot:

1. See who is CC'd on incoming emails
2. See who their reply will go to
3. Edit CC recipients before sending

This creates confusion in multi-party email threads and prevents users from managing recipients effectively.

### Current State

**Database:**
- `Message.cc String[] @default([])` — stores CC email addresses (no names)
- `Message.bcc String[] @default([])` — stores BCC email addresses
- `Message.fromEmail/fromName/toEmail/toName` fields exist in `prisma/schema.prisma` (Phase 50) but are not consistently populated or surfaced to the UI yet

**Webhook Capture:**
| Provider | CC Capture | BCC Capture | From/To Available |
|----------|-----------|-------------|-------------------|
| EmailBison | Yes (with names) | Yes (with names) | Yes |
| SmartLead | Yes (no names) | No | Yes |
| Instantly | No (not in webhook payload used today) | No (not in webhook payload used today) | Yes (contact email + `email_account` / `eaccount`) |

**Reply Sending:**
| Provider | CC Support | BCC Support |
|----------|-----------|-------------|
| EmailBison | Yes | Yes |
| SmartLead | Yes | Yes |
| Instantly | Yes (via `cc_address_email_list`) | Yes (via `bcc_address_email_list`) |

**UI:**
- `chat-message.tsx` — Shows sender label, timestamp, subject, content. **No From/To/CC display.**
- `action-station.tsx` — Shows compose textarea, AI draft indicator, send buttons. **No recipient preview or editor.**

### User Requirements

1. **Thread Participant Display**: Show From/To/CC/BCC in email message headers (include BCC whenever present, inbound or outbound)
2. **Recipient Preview**: Before sending, show who will receive the reply
3. **Editable CC**: Allow adding/removing CC recipients
4. **Name + Email Display**: Show `Name <email@example.com>` format when available

## Concurrent Phases

| Phase | Status | Overlap | Coordination |
|-------|--------|---------|--------------|
| Phase 49 | Complete | `lib/ai-drafts.ts` | No overlap — Phase 49 touches draft generation, not email UI/webhooks |
| Phase 48 | Complete | Background jobs | No overlap — Phase 48 touches auto-send orchestrator, not email metadata |
| Phase 47 | Complete | `settings-view.tsx` | No overlap — Phase 47 touches AI settings, not inbox components |
| Phase 46 | Complete | `actions/lead-actions.ts`, `components/dashboard/chat-message.tsx`, `components/dashboard/action-station.tsx`, `actions/email-actions.ts` | Overlaps inbox attribution + email send paths — ensure Phase 50 follows current sender/source mapping patterns and does not regress EmailBison send/sync dedupe work |

## Pre-Flight Conflict Check

- [ ] Run `git status --porcelain` and start implementation from a clean working tree (Phase 50 touches `prisma/schema.prisma` + inbox UI)
- [ ] Re-read current versions of key touchpoints (avoid stale line numbers):
  - `actions/lead-actions.ts:getConversation(...)` (server→UI message mapping boundary)
  - `components/dashboard/chat-message.tsx`
  - `components/dashboard/action-station.tsx`
  - `actions/message-actions.ts` (`sendEmailMessage`, `approveAndSendDraft`, `approveAndSendDraftSystem`)
  - `actions/email-actions.ts` (`sendEmailReply`, `sendEmailReplyForLead`)
  - `app/api/webhooks/email/route.ts`, `app/api/webhooks/smartlead/route.ts`, `app/api/webhooks/instantly/route.ts`

## Objectives

* [ ] Ensure `fromEmail`, `fromName`, `toEmail`, `toName` fields exist on Message model (already present in schema) and are applied to DB
* [ ] Update email webhooks to capture sender/recipient information
* [ ] Create email participant helper utilities + extend the UI message shape
* [ ] Add email participant header to chat message display
* [ ] Add editable CC recipient section to compose area (setters + admins/owners)
* [ ] Update email send actions to accept custom CC list (manual send + draft approval)

## Constraints

- Must preserve existing CC behavior in replies (pass through from inbound)
- Backward compatible — existing messages without new fields fall back gracefully
- BCC not editable in this phase (view only)
- CC editing allowed for setters as well as admins/owners (all authorized roles)
- CC overrides must be enforced server-side (authorized users only; sanitize + limit CC list)
- Keep CC validation lightweight (client-side format validation + server-side normalization + size limits)

## Success Criteria

- [x] Email messages in inbox show From/To/CC/BCC header (BCC shown whenever present)
- [x] Compose area shows "Sending to" preview with To and CC recipients
- [x] Users can add/remove CC recipients before sending
- [x] Instantly replies include CC/BCC when provided
- [x] New inbound emails capture fromEmail/toEmail from webhooks
- [x] `npm run lint` passes
- [x] `npm run build` passes
- [x] `npm run db:push` completes successfully

## Subphase Index

* a — Schema: Add from/to fields to Message model
* b — Webhooks: Capture sender/recipient from EmailBison, SmartLead, Instantly
* c — Helpers + Types: Participant formatting utilities + plumb fields to UI
* d — UI: Add EmailParticipantHeader to chat-message.tsx
* e — UI: Add EmailRecipientEditor to action-station.tsx (setters + admins/owners)
* f — Actions: Update email send actions for custom CC (manual send + draft approval) + persist from/to on outbound rows

## Files to Modify

| File | Changes |
|------|---------|
| `prisma/schema.prisma` | Add `fromEmail`, `fromName`, `toEmail`, `toName` to Message |
| `app/api/webhooks/email/route.ts` | Capture from/to fields from EmailBison payload |
| `app/api/webhooks/smartlead/route.ts` | Capture from/to fields from SmartLead payload |
| `app/api/webhooks/instantly/route.ts` | Capture from/to fields from Instantly payload |
| `lib/email-participants.ts` | NEW: Formatting and validation helpers |
| `lib/mock-data.ts` | Extend `Message` type to include from/to fields (and any provider-detection fields needed by UI) |
| `actions/lead-actions.ts` | Include from/to fields in `getConversation(...)` message mapping so UI can render headers |
| `components/dashboard/chat-message.tsx` | Add EmailParticipantHeader component |
| `components/dashboard/action-station.tsx` | Add EmailRecipientEditor component |
| `actions/email-actions.ts` | Accept custom CC list in send functions |
| `actions/message-actions.ts` | Pass CC to underlying email actions (manual send + draft approval) |
| `lib/instantly-api.ts` | Add CC/BCC support for Instantly reply API (`cc_address_email_list`, `bcc_address_email_list`) |

## Verification Plan

1. **Schema migration** — Run `npm run db:push`, verify new fields in Prisma Studio
2. **Webhook test** — Send test email with CC via EmailBison/SmartLead, verify from/to/cc stored
3. **Message display** — View email in inbox, confirm From/To/CC header appears
4. **Compose preview** — Click reply, confirm recipient editor shows To and CC
5. **Edit CC (setter)** — Add/remove CC recipient, verify changes persist in compose
6. **Edit CC (inbox manager/admin/owner)** — Verify same behavior across roles
7. **Send with edited CC** — Send reply and approve/send draft, confirm recipients receive correctly
8. **Instantly CC/BCC** — Switch to Instantly workspace/lead, send reply with CC/BCC, confirm recipients receive correctly
9. **Build** — Run `npm run build` to verify no type errors

## Repo Reality Check (RED TEAM)

- What exists today:
  - `actions/lead-actions.ts:getConversation(...)` exposes `cc/bcc` plus `fromEmail/fromName/toEmail/toName` (and `emailBisonReplyId`) to the UI.
  - Email webhooks persist `fromEmail/fromName/toEmail/toName` onto inbound email `Message` rows (EmailBison, SmartLead, Instantly), and campaign outbound uses explicit from/to as well.
  - Outbound email replies created in `actions/email-actions.ts` persist `cc/bcc` and set `toEmail/toName` on the outbound `Message` row; `fromEmail/fromName` may be null (UI falls back to “You”).
  - Email draft approval sends go through `approveAndSendDraft(...)` → `approveAndSendDraftSystem(...)` → `actions/email-actions.ts:sendEmailReply(...)`.
- What this plan assumes:
  - Participant metadata is plumbed through the UI types and mapping so the inbox can render it deterministically.
  - CC overrides are allowed for authorized users (including setters); UI validates and lowercases inputs, but server-side sanitization/limits should still be enforced (follow-up).
- Verified touch points:
  - EmailBison webhook fields: `reply.from_email_address`, `reply.from_name`, optional `reply.to[]`, and `data.sender_email.{email,name}` exist in `app/api/webhooks/email/route.ts`.
  - SmartLead fields: `from_email`, `to_email`, `cc_emails` exist in `app/api/webhooks/smartlead/route.ts`.
  - Instantly fields: `contact_email`, `contact_name`, `email_account` exist in `app/api/webhooks/instantly/route.ts`.

## RED TEAM Findings (Gaps / Weak Spots)

### Highest-risk failure modes
- CC override implemented only in manual send path (`sendEmailMessage`) and not draft approval path (`approveAndSendDraft`) → users think CC editing is broken.
- UI validates CC but server doesn’t → invalid/abusive CC inputs can reach providers; must normalize + cap server-side.
- UI relies on fields that are not currently exposed (`emailBisonReplyId` / provider metadata) → provider-specific behavior (prefill, diagnostics) may be incorrect.
- Webhooks use incorrect payload fields (e.g., `reply.from.address` vs `reply.from_email_address`) → silently missing participant data.

### Missing or ambiguous requirements
- Whether CC names should ever be displayed (current schema stores CC as `String[]` of addresses only; supporting names would require a schema change).

### Performance / timeouts
- Webhooks already have tight execution budgets; additions must remain O(1) parsing with no extra network calls.

### Security / permissions
- CC overrides must be sanitized/limited server-side (UI-only validation is insufficient).

### Testing / validation
- Add explicit validation for: role differences (setter vs inbox manager/admin/owner), manual send vs draft approval send, and provider differences (EmailBison vs SmartLead vs Instantly).

## Assumptions (Agent)

- We can detect SmartLead vs Instantly threads using `Message.emailBisonReplyId` prefixes (`smartlead:` / `instantly:`) once plumbed through `actions/lead-actions.ts` → `lib/mock-data.ts`. (confidence ~95%)
- Default behavior remains: if no CC override is provided, replies continue to pass through thread CC from the latest inbound email (current behavior in `actions/email-actions.ts`). (confidence ~95%)
- Showing CC emails without names is acceptable for this phase (schema stores CC as `String[]` of addresses only). (confidence ~90%)
- Instantly webhook `email_account` corresponds to the Instantly API `eaccount` (the sending mailbox/account) and is expected to be an email address (per Instantly API docs; used as `eaccount` in `/api/v2/emails/reply`). (confidence ~90%)
  - Mitigation check: if we see non-email values in production payloads, store them separately (future) and fall back to “You” in the UI.

## Open Questions (Need Human Input)

- (none)

## Phase Summary

- Shipped:
  - Email participant fields persisted (`Message.fromEmail/fromName/toEmail/toName`) and plumbed to UI.
  - Inbox email message headers show From/To/CC/BCC.
  - Compose includes a CC editor; CC overrides apply to manual sends and email draft approval sends.
  - Instantly replies support CC/BCC via API v2 payload fields.
- Verified:
  - `npm run lint`: pass (warnings only)
  - `npm run build`: pass
  - `npm run db:push`: pass (“already in sync”)
- Notes:
  - Working tree is not clean; ensure `lib/email-participants.ts` and `docs/planning/phase-50/*` are committed before deploy.
  - Follow-up recommended: enforce server-side CC sanitization/limits (UI-only validation can be bypassed).
