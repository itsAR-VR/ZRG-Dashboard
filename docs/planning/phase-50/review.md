# Phase 50 — Review

## Summary
- Implemented email participant headers (From/To/CC/BCC) in the inbox message view.
- Added a CC recipient editor in the compose area and plumbed CC overrides through manual send + draft approval sends.
- Captured `fromEmail/fromName/toEmail/toName` on inbound email webhooks (EmailBison, SmartLead, Instantly) and plumbed these fields through the server→UI mapping.
- Added CC/BCC support for Instantly replies via `cc_address_email_list` / `bcc_address_email_list`.
- Quality gates: `npm run lint`, `npm run build`, and `npm run db:push` all succeeded (see Verification).
- Working tree is not clean (Phase 50 changes are present but uncommitted, and `lib/email-participants.ts` is currently untracked).

## What Shipped
- Schema
  - `prisma/schema.prisma` — Added `Message.fromEmail/fromName/toEmail/toName`.
- Webhooks (ingestion → DB)
  - `app/api/webhooks/email/route.ts` — Persist participant metadata on inbound replies and campaign outbound.
  - `app/api/webhooks/smartlead/route.ts` — Persist participant metadata on inbound/outbound.
  - `app/api/webhooks/instantly/route.ts` — Persist participant metadata on inbound/outbound.
- Server→UI boundary
  - `actions/lead-actions.ts` — Plumb participant metadata into `getConversation(...)` message mapping.
  - `lib/mock-data.ts` — Extend UI `Message` type with participant fields + `emailBisonReplyId`.
- UI
  - `components/dashboard/chat-message.tsx` — Render participant header for email messages.
  - `components/dashboard/action-station.tsx` — Add CC editor + pass CC into send actions.
- Send paths
  - `actions/message-actions.ts` — Add `{ cc?: string[] }` to `sendEmailMessage(...)`; pass CC through email draft approvals.
  - `actions/email-actions.ts` — Accept optional CC overrides and include CC/BCC for Instantly replies.
  - `lib/instantly-api.ts` — Send CC/BCC via Instantly API v2 reply payload fields.
- New helper (currently untracked; must be committed)
  - `lib/email-participants.ts` — Formatting + email validation + CC sanitization helpers.

## Verification

### Commands
- `npm run lint` — **pass** (warnings only) (Thu Jan 22 08:36 +04 2026)
- `npm run build` — **pass** (Thu Jan 22 08:36 +04 2026)
- `npm run db:push` — **pass** (“database is already in sync”) (Thu Jan 22 08:36 +04 2026)

### Notes
- Lint produced warnings (no errors), including React Hook exhaustive-deps warnings and `@next/next/no-img-element` warnings.
- Build produced warnings about multiple lockfiles / inferred workspace root and a deprecated middleware convention, but completed successfully.

## Success Criteria → Evidence

1. Email messages in inbox show From/To/CC/BCC header (BCC shown whenever present)
   - Evidence: `components/dashboard/chat-message.tsx` (`EmailParticipantHeader` renders From/To/CC/BCC).
   - Status: met

2. Compose area shows "Sending to" preview with To and CC recipients
   - Evidence: `components/dashboard/action-station.tsx` (`EmailRecipientEditor` shows `To:` and `CC:` above compose).
   - Status: met

3. Users can add/remove CC recipients before sending
   - Evidence: `components/dashboard/action-station.tsx` (chip UI + input + remove), plus CC plumbed to `sendEmailMessage(...)` and `approveAndSendDraft(...)`.
   - Status: met

4. Instantly replies include CC/BCC when provided
   - Evidence: `lib/instantly-api.ts` (sends `cc_address_email_list` / `bcc_address_email_list`), `actions/email-actions.ts` (passes CC/BCC to Instantly).
   - Status: met

5. New inbound emails capture fromEmail/toEmail from webhooks
   - Evidence: `app/api/webhooks/email/route.ts`, `app/api/webhooks/smartlead/route.ts`, `app/api/webhooks/instantly/route.ts` (participant fields persisted to `Message` rows).
   - Status: met

6. `npm run lint` passes
   - Evidence: `npm run lint` exit code `0` (warnings only).
   - Status: met

7. `npm run build` passes
   - Evidence: `npm run build` exit code `0`.
   - Status: met

8. `npm run db:push` completes successfully
   - Evidence: `npm run db:push` reported “The database is already in sync with the Prisma schema.”
   - Status: met

## Plan Adherence
- Planned vs implemented deltas:
  - Instantly: initial plan assumed “no CC”; implementation supports CC/BCC for replies via API v2 fields.
  - CC server-side enforcement: helper exists (`lib/email-participants.ts:sanitizeCcList`) but is not wired into `actions/email-actions.ts` / `actions/message-actions.ts` yet (UI validation exists).

## Multi-Agent Coordination
- Recent phases by mtime: `phase-50` → `phase-41` (checked via `ls -dt docs/planning/phase-* | head -10`).
- Overlap: Phase 50 touches Phase 46-adjacent surfaces (`actions/email-actions.ts`, `actions/lead-actions.ts`, `components/dashboard/*`); lint/build/db:push passed on the combined working tree.
- Merge correctness: no conflict markers found (`rg -n "^<<<<<<<" -S .`).

## Risks / Rollback
- CC validation relies primarily on UI; a caller could bypass UI and send malformed CC arrays → follow-up: enforce `sanitizeCcList` server-side.
- Working tree is dirty/uncommitted; `lib/email-participants.ts` is currently untracked → ensure these are committed before deploy.

## Follow-ups
- Commit untracked/new artifacts: `lib/email-participants.ts` and `docs/planning/phase-50/*`.
- Add server-side CC sanitization/limit enforcement using `sanitizeCcList` in email send actions.
- Run an end-to-end provider smoke test (EmailBison, SmartLead, Instantly) to confirm participant fields and CC/BCC delivery in real threads.
