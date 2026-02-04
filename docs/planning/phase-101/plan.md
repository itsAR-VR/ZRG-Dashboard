# Phase 101 — Analytics: Track AI Draft Outcomes (Auto‑Sent vs Approved vs Edited)

## Purpose
Add durable tracking so we can report (in Analytics) whether AI-drafted responses were **auto-sent**, **approved as-is**, or **edited before sending**.

## Context
Feature request source (Monday.com):
- Board: **AI Bugs + Feature Requests** (`board-18395010806`)
- Item: **“add ability to see which responses have been edited vs just auto sent vs approved”** (`item-11177342525`, created **2026-02-03**)
- Item details: no additional column data or updates recorded as of **2026-02-04**.

Decisions locked from conversation (confirmed **2026-02-04**):
- **Scope:** All channels (email, SMS, LinkedIn)
- **Surface:** Analytics
- **Backfill:** None (“going forward only”)
- **Counting unit:** Per **draft/response** (not per SMS message part)
- **Edited definition:** Strict compare to the draft content (`finalContent !== draft.content`)
- **Email scope:** Count only **`EmailCampaign.responseMode = AI_AUTO_SEND`** (SMS/LinkedIn have no campaign mode equivalent; count all)

Implementation idea (derived from repo reality):
- `Message.sentBy` already attributes outbound sends as `"ai"` or `"setter"`, but it does not tell whether a human edited the AI draft.
- Add a draft-level field on `AIDraft` (so multipart SMS does not overcount) that is set **only when a pending draft is successfully sent**.

## Concurrent Phases
Working tree currently contains uncommitted work from recent phases; treat these as integration constraints.

| Phase | Status | Overlap | Coordination |
|-------|--------|---------|--------------|
| Working tree | Uncommitted | `actions/email-actions.ts`, `actions/message-actions.ts`, `lib/email-send.ts`, `scripts/test-orchestrator.ts` modified | **Integrate** outcome tracking with existing send flows; merge test registration carefully |
| Phase 105 | Planning | `actions/email-actions.ts`, `lib/email-send.ts`, follow-up send flow | Ensure disposition updates do **not** break single-flight/idempotent send logic being planned in Phase 105. |
| Phase 100 | Uncommitted | `lib/ai/prompt-runner/runner.ts` modified | No overlap with Phase 101 |
| Phase 102 | Uncommitted | `components/dashboard/settings/ai-campaign-assignment.tsx` modified | No overlap with Phase 101 (different UI component) |
| Phase 97 | Complete | Domain overlap: `actions/auto-send-analytics-actions.ts` | Reuse conventions (scoped queries, counts-only, no PII) |
| Phase 99 | Planning only | None | No coordination needed |

## Objectives
* [x] Add a durable draft-level outcome enum + field (`AUTO_SENT`, `APPROVED`, `EDITED`)
* [x] Set outcome on successful send for all channels (email/SMS/LinkedIn) without backfilling historical data
* [ ] Add a scoped analytics action that counts outcomes per channel and date window (email limited to `AI_AUTO_SEND`)
* [ ] Add an Analytics card displaying these counts
* [ ] Add unit tests for the core disposition logic and run repo quality gates

## Constraints
- **No secrets/PII:** Analytics must return counts-only; do not return message bodies or evaluator reasons.
- **No backfill:** historical drafts remain untracked (`null` outcome) and are excluded from metrics.
- **Draft-level counting:** analytics counts **distinct drafts**, not outbound message rows (avoid SMS multipart inflation).
- **Email gating:** for email counts, include only leads whose `EmailCampaign.responseMode = 'AI_AUTO_SEND'`.
- **No edit-diff storage:** this phase only classifies outcomes; no diff UI or diff persistence beyond existing draft + final message content.
- Follow repo conventions: TS everywhere; server actions return `{ success, data?, error? }`.
- If `prisma/schema.prisma` changes, run `npm run db:push` per repo policy before shipping.

## Success Criteria
- New outbound sends from AI drafts result in `AIDraft.responseDisposition` being set:
  - `AUTO_SENT` when `sentBy="ai"`
  - `APPROVED` when `sentBy="setter"` and content unchanged
  - `EDITED` when `sentBy="setter"` and content changed
- Analytics page shows per-channel counts for the selected date window.
- `npm run test`, `npm run lint`, and `npm run build` pass.

## Repo Reality Check (RED TEAM)

### What Exists Today

| Component | File Path | Verified |
|-----------|-----------|----------|
| AIDraft model | `prisma/schema.prisma:923-957` | ✓ `responseDisposition` field added (Phase 101a) |
| SMS send path | `actions/message-actions.ts:1134-1238` → `approveAndSendDraftSystem()` | ✓ |
| Email send (server action) | `actions/email-actions.ts:41-167` → `sendEmailReply()` | ✓ Has `pending → sending` claim/lock |
| Email send (system) | `lib/email-send.ts:598-716` → `sendEmailReplyForDraftSystem()` | ✓ Mirrors server action |
| LinkedIn send | `actions/message-actions.ts:1244-1332` → `approveAndSendDraft()` LinkedIn branch | ✓ |
| Analytics patterns | `actions/auto-send-analytics-actions.ts` | ✓ Uses `resolveClientScope`, raw SQL counts |
| lib/ai-drafts folder | `lib/ai-drafts/` | ✓ `response-disposition.ts` helper added |

### Working Tree State (Multi-Agent)

| File | Status | Coordination |
|------|--------|--------------|
| `actions/email-actions.ts` | Modified | Read current content before editing; integrate with existing `pending → sending` flow |
| `actions/message-actions.ts` | Modified | Read current content before editing; ensure disposition set only after successful sends |
| `lib/email-send.ts` | Modified | Same — integrate, don't overwrite |
| `lib/followup-engine.ts` | Modified | No overlap with Phase 101 |
| `lib/ai/prompt-runner/runner.ts` | Modified (Phase 100) | No overlap with Phase 101 |
| `prisma/schema.prisma` | Modified (Phase 101a) | Schema already updated; no further changes expected |
| `scripts/test-orchestrator.ts` | Modified | Merge carefully when adding new test entry (Phase 101e) |
| `components/dashboard/settings/ai-campaign-assignment.tsx` | Modified (Phase 102) | No overlap with Phase 101 |

## RED TEAM Findings (Gaps / Weak Spots)

### Highest-Risk Failure Modes

| Risk | Mitigation |
|------|------------|
| Email `pending → sending → approved` state machine | Set `responseDisposition` **only** on final `sending → approved` transition |
| SMS multipart sends create multiple Message rows | Analytics uses `count(distinct d.id)` — disposition is on AIDraft not Message |
| LinkedIn `sentBy` might be missing | Default to `"setter"` if `meta.sentBy` is undefined |

### Missing Requirements (Fixed)

- **Index name:** Add explicit `@@index([responseDisposition], name: "AIDraft_responseDisposition_idx")`
- **SMS finalContent:** Compute `finalContent = opts.editedContent ?? draft.content` before disposition check
- **Email idempotency branch:** Do NOT set disposition in the "already sent" early-return path
- **Analytics join:** Use LEFT JOIN for EmailCampaign with filter `(d.channel != 'email' OR ec."responseMode" = 'AI_AUTO_SEND')`

### Testing Gaps (Fixed)

- Add test case: `sentBy="ai"` with `editedContent` → still `AUTO_SENT`
- Add test case: multipart SMS → single disposition

## Subphase Index
* a — Schema + disposition helper
* b — Persist disposition on send paths
* c — Analytics action (counts by channel/outcome)
* d — Analytics UI card
* e — Tests + validation checklist

## Assumptions (Agent)

1. **Assumption:** `sentBy="ai"` is always set correctly by auto-send paths (confidence ~95%)
   - Mitigation: Verify in `lib/auto-send/orchestrator.ts`

2. **Assumption:** `pending → sending → approved` flow is stable (confidence ~90%)
   - Mitigation: Read current file; integrate if Phase 100 changed this

3. **Assumption:** SMS multipart always goes through `approveAndSendDraftSystem` (confidence ~98%)

## Phase Summary (running)
- 2026-02-04 — Pulled Monday item details; no extra fields/updates found. Logged open questions for counting unit, edited definition, and email scope. (files: `docs/planning/phase-101/plan.md`, `docs/planning/phase-101/b/plan.md`)
- 2026-02-04 — Decisions confirmed: per‑draft counts, strict compare for edits, email scope limited to AI_AUTO_SEND. Added coordination note with Phase 105. (files: `docs/planning/phase-101/plan.md`)
- 2026-02-04 — Implemented disposition persistence in SMS, email (server + system), and LinkedIn send paths. (files: `actions/message-actions.ts`, `actions/email-actions.ts`, `lib/email-send.ts`, `docs/planning/phase-101/b/plan.md`)
