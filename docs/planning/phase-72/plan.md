# Phase 72 — Robust CC'd Recipient Handling in Email Threads

## Purpose

When someone CC'd on an email thread replies (instead of the original lead), the system needs to correctly identify the replier, address AI drafts to them, and ensure follow-up workflows include all relevant parties.

## Context

### Problem Statement

Current behavior has these gaps:
1. **Inbound sender is stored, but not consistently used for recipients** — The system stores who sent an inbound email (`Message.fromEmail`), but outbound TO/CC logic is provider-dependent (notably EmailBison still defaults TO `Lead.email`)
2. **AI drafts address the wrong person** — AI always greets `Lead.firstName` regardless of who actually replied
3. **Replies + stored outbound metadata can be wrong** — Even when a CC'd person replies, outbound behavior and/or stored `Message.toEmail` can still reflect `Lead.email` instead of the actual replier
4. **CC addresses are passively inherited** — No intelligent CC management (e.g., adding replier to CC if not present)
5. **No way to track alternate contacts** — Lead has single `email` field, no concept of associated emails

### User Requirements

1. **AI should respond to the correct person** — When a CC'd person replies, AI drafts should address them appropriately
2. **Replies should go TO the CC person** — More natural conversation flow, with original lead in CC
3. **Workflows should include both parties** — Follow-ups should go TO the CC replier, with the original lead in CC (swap)
4. **Allow promoting CC'd person to primary** — UI action to swap primary contact when the CC'd person becomes the main point of contact
5. **Promotion is admin-only** — Setters can request approval, but cannot directly mutate the lead primary email

### Technical Discovery

From codebase exploration:

| Component | Current State |
|-----------|---------------|
| `Message` model | Has `fromEmail`, `fromName`, `toEmail`, `toName`, `cc[]`, `bcc[]` (Phase 50) |
| `Lead` model | Single `email` field, no alternate emails |
| `lib/email-participants.ts` | Already exists (Phase 50) for CC formatting/validation (`sanitizeCcList`, `normalizeEmail`, etc.) |
| `lib/ai-drafts.ts` | Uses `lead.firstName` for greeting, no replier awareness |
| `lib/email-send.ts` | Recipient behavior differs by provider; outbound `Message.toEmail` currently records `lead.email` even when provider send target differs |
| `lib/followup-engine.ts` | Sends follow-up emails via `sendEmailReply(draft.id)` (no CC override), so it inherits CC from latest inbound email only |
| Webhooks | Store `fromEmail`; EmailBison webhook already detects when sender differs from campaign lead email and matches by `emailBisonLeadId` |

### Thread Handle Architecture

Email replies use provider-specific thread handles (not email addresses) for routing:
- **EmailBison**: `emailBisonReplyId`
- **SmartLead**: `campaignId + statsId + messageId`
- **Instantly**: `replyToUuid + eaccount`

This means changing the TO address won't break threading — the provider routes based on thread handle, not recipient.

## Concurrent Phases

| Phase | Status | Overlap | Coordination |
|-------|--------|---------|--------------|
| Phase 70 | Active | `prisma/schema.prisma`, `actions/lead-actions.ts`, `lib/email-send.ts` | Read current state before modifying; Phase 70 adds AIDraft fields, we add Lead fields |
| Phase 71 | Active | `actions/lead-actions.ts`, `lib/followup-engine.ts` | Verify Phase 71 changes before touching follow-up behavior or lead actions |

Recent nearby phases with overlap (verify behavior before changing):
- Phase 66: `app/api/webhooks/*`, `lib/ai-drafts.ts` (email inbound pipeline + sentiment/draft workflows)
- Phase 69/67/64/62: `lib/ai-drafts.ts`, `lib/followup-engine.ts`, `prisma/schema.prisma` (shared hot spots)

## Pre-Flight Conflict Check (Multi-Agent)

- [ ] Run `git status --porcelain` and note uncommitted changes in files this phase will touch:
  - `prisma/schema.prisma` (M - Phase 70 changes)
  - `lib/email-send.ts` (new file from Phase 70)
  - `actions/lead-actions.ts` (M - Phase 70 changes)
  - `lib/ai-drafts.ts`
  - `lib/followup-engine.ts`
  - `lib/lead-matching.ts` (will need alternate-email matching for promotion safety)
  - `lib/email-reply-handle.ts` (SmartLead recipient behavior uses reply-handle metadata)
  - `app/api/webhooks/smartlead/route.ts`
  - `app/api/webhooks/instantly/route.ts`
  - `app/api/webhooks/email/route.ts`
- [ ] Re-read current file contents before implementing (don't rely on cached assumptions)
- [ ] Schema changes are additive (new nullable fields) — safe to layer on Phase 70's changes

## Repo Reality Check (RED TEAM)

- What exists today:
  - `lib/email-participants.ts` already exists (Phase 50) and is used by `lib/email-send.ts` for CC sanitization.
  - SmartLead inbound replies store `Message.fromEmail` and encode the inbound sender into the SmartLead reply-handle; `lib/email-send.ts` can already target `smartLeadHandle.toEmail`.
  - `app/api/webhooks/email/route.ts` already logs when reply sender differs from campaign lead email and prefers matching by `emailBisonLeadId`.
  - EmailBison “reply to message” endpoint supports explicit `to_emails` + optional `cc_emails`/`bcc_emails` when replying to a `reply_id` (`POST /api/replies/{reply_id}/reply`).
  - `actions/email-actions.ts` already supports CC overrides via `sendEmailReply(draftId, editedContent, { cc })`.
- What the plan assumes:
  - Add Lead-level fields to persist “current replier” and “alternate emails” so UI, drafts, and follow-ups can act without re-scanning message history.
  - Update outbound recipient resolution so provider sends and stored `Message.toEmail` stay aligned.
- Verified touch points:
  - `lib/ai-drafts.ts`: `generateResponseDraft()`, `buildEmailDraftStrategyInstructions()`
  - `lib/followup-engine.ts`: `executeFollowUpStep()`
  - `app/api/webhooks/*/route.ts`: inbound email `fromEmail` is persisted on `Message`

## RED TEAM Findings (Gaps / Weak Spots)

### Highest-risk failure modes
- **Promoting CC contact to primary can split threads** (SmartLead/Instantly webhooks still key off the campaign contact email) → Update lead matching to also match by `alternateEmails` (new subphase `h`).
- **Plan assumes a new `lib/email-participants.ts`** but it already exists (Phase 50) with a different `normalizeEmail()` signature → Extend the existing module carefully or create a sibling matching module; don’t clobber current exports.
- **Outbound `Message.toEmail` is currently recorded as `lead.email`** even when provider send target differs (e.g., SmartLead reply-handle `toEmail`) → Ensure Phase 72e updates stored message metadata to the actual resolved recipient.

### Missing or ambiguous requirements
- Decision (locked): when a CC'd person becomes the active replier, outbound emails (manual replies + follow-ups) should swap recipients: **TO = current replier, CC = original lead**.
- Decision (locked): **no expiration** for `currentReplierEmail` — it remains active until the primary email replies again (or an admin promotes a contact).

### Performance / timeouts
- EmailBison webhook is already heavy; avoid adding slow calls on the webhook path → Prefer minimal `Lead` updates and/or move CC-replier detection into the existing background job where possible.

### Security / permissions
- Promotion action is admin-only; setters can request approval (non-mutating) → Use `requireClientAdminAccess` for mutation and a separate request action for setters.

### Testing / validation
- Add unit coverage for email normalization/matching and alternate-email promotion invariants.
- Add manual smoke tests for each provider (SmartLead/Instantly/EmailBison) including “promote then receive another webhook for original email”.

## Objectives

* [x] Add schema fields to `Lead` for tracking alternate emails and current replier
* [x] Create utility functions for email matching and CC replier detection
* [x] Update webhooks to detect when a CC'd person replies and update Lead accordingly
* [x] Pass replier context to AI draft generation so drafts address the correct person
* [x] Implement smart TO/CC resolution: reply TO the CC person, CC the original lead
* [x] Update follow-up engine so follow-up emails also swap TO/CC (TO current replier, CC original lead)
* [x] Add server action + UI to promote alternate contact to primary
* [x] Update lead matching to treat `alternateEmails` as matchable (promotion safety)
* [x] Verify with `npm run lint && npm run build`

## Constraints

- Schema changes must be additive (nullable fields with defaults) for safe migration
- Thread handles remain authoritative for routing — only TO/CC addresses change
- Existing behavior preserved when no CC replier scenario (original lead replies)
- Must work with all three email providers (EmailBison, SmartLead, Instantly)
- If `Lead.email` is changed via promotion, SmartLead/Instantly inbound events must still attach to the same lead (via `alternateEmails` matching)
- Promotion is admin-only; setter flow is request-only (no direct mutation)
- No TTL/expiration for `currentReplierEmail` (it remains active until primary replies again or an admin promotes a contact)

## Success Criteria

- [x] When CC person replies, `Lead.currentReplierEmail` is populated
- [x] AI drafts greet the replier's name when they replied (not always `lead.firstName`)
- [x] Outbound replies go TO the CC person with original lead in CC
- [x] Follow-up emails go TO the current replier (when set) with the original lead in CC
- [x] UI shows alternate emails and allows promotion to primary
- [x] After promotion, provider webhooks still match the same lead (no duplicate lead created for the old email)
- [x] `npm run lint` and `npm run build` pass
- [x] Existing email flows (original lead replies) work unchanged

## Subphase Index

* a — Schema enhancement (add Lead fields for alternate emails + current replier)
* b — Email participant utilities (matching, normalization, CC replier detection)
* c — Webhook ingestion (detect CC repliers in SmartLead/Instantly/EmailBison webhooks)
* d — AI draft context (pass replier identity to draft generation)
* e — Smart CC management (TO/CC resolution on outbound emails)
* f — Follow-up sequence enhancement (swap TO/CC for active CC replier)
* g — Contact promotion UI (server action + UI to promote alternate to primary)
* h — Lead matching hardening (match by `alternateEmails` so promotion doesn’t split threads)

## Key Files

| Component | File | Changes |
|-----------|------|---------|
| Prisma schema | `prisma/schema.prisma` | Add `alternateEmails`, `currentReplierEmail`, `currentReplierName`, `currentReplierSince` to Lead (and index as needed) |
| Email utilities | `lib/email-participants.ts` | Existing (Phase 50) — extend or add a sibling module for matching/detection without breaking current exports |
| Lead matching | `lib/lead-matching.ts` | Match inbound emails by `lead.email` OR `lead.alternateEmails` (promotion safety) |
| Reply handles | `lib/email-reply-handle.ts` | SmartLead reply-handle carries a `toEmail` used by `lib/email-send.ts` |
| AI drafts | `lib/ai-drafts.ts` | Pass replier context, adjust greeting |
| Email send | `lib/email-send.ts` | Smart TO/CC resolution based on who replied |
| Follow-up engine | `lib/followup-engine.ts` | Follow-up emails also swap TO/CC when CC replier is active |
| SmartLead webhook | `app/api/webhooks/smartlead/route.ts` | Detect CC replier, update Lead |
| Instantly webhook | `app/api/webhooks/instantly/route.ts` | Detect CC replier, update Lead |
| EmailBison webhook | `app/api/webhooks/email/route.ts` | Detect CC replier, update Lead |
| Lead actions | `actions/lead-actions.ts` | Add `promoteAlternateContactToPrimary` |
| Inbox UI | `components/dashboard/inbox-view.tsx` | Show alternate emails, promotion action |

## Open Questions (Need Human Input)

- None (all open questions resolved).

## Assumptions (Agent)

- Assumption: “current replier” can be derived from the latest inbound `Message.fromEmail`/`fromName` and persisted onto the Lead. (confidence ~95%)
  - Mitigation check: confirm each provider reliably populates `fromEmail` for inbound replies.
- Assumption: `alternateEmails` stores normalized lowercase emails and excludes the current primary `Lead.email`. (confidence ~95%)
  - Mitigation check: add a small invariant check/dedupe when writing `alternateEmails`.
- Assumption: Promotion must not break webhook lead association, so lead matching should include `alternateEmails` membership checks. (confidence ~95%)
  - Mitigation check: manual test “promote then receive webhook for old email” per provider.
- Assumption: EmailBison replies support explicitly setting `to_emails`/`cc_emails`/`bcc_emails` on `/api/replies/{reply_id}/reply`. (confidence ~95%)
  - Mitigation check: confirm our `sendEmailBisonReply()` maps payload fields 1:1 and verify in staging.

## Phase Summary

### Shipped
- Added Lead schema fields (`alternateEmails`, `currentReplierEmail`, `currentReplierName`, `currentReplierSince`) + GIN index
- Extended `lib/email-participants.ts` with CC replier detection utilities + unit tests
- Updated SmartLead/Instantly/EmailBison webhooks to track CC repliers and persist alternate emails
- Updated AI draft context to greet the correct person (replier vs original lead)
- Implemented smart TO/CC resolution in `lib/email-send.ts` — reply TO replier, CC original lead
- Verified follow-ups inherit swap logic via `sendEmailReply()` — no code changes needed
- Added promotion actions (admin-only `promoteAlternateContactToPrimary`, setter `requestPromoteAlternateContactToPrimary`)
- Updated `lib/lead-matching.ts` to match by `alternateEmails` — prevents thread splits after promotion
- Extended inbox UI with current replier badge + alternate contacts list + promotion buttons

### Verified
- `npm run lint`: pass (0 errors, 18 warnings) — Fri Jan 30 22:03 EST 2026
- `npm run build`: pass — Fri Jan 30 22:04 EST 2026
- `npm test`: pass (57/57) — Fri Jan 30 22:10 EST 2026
- Build output includes non-blocking warnings (workspace root inferred from multiple lockfiles; `middleware` convention deprecation; `baseline-browser-mapping` staleness notice)

### Remaining
- Run `npm run db:push` against the intended DB (not run in this environment)
- Manual smoke tests for CC replier flows + promotion
