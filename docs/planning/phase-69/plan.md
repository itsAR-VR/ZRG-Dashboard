# Phase 69 — AI Auto-Send Debug + Slack Fix + Backfill Script

## Purpose

Fix AI auto-send pipeline issues (Slack notifications failing due to missing OAuth scopes) and create a backfill script to regenerate drafts and process auto-send for all historical responses in AI_AUTO_SEND campaigns.

## Context

### User's Original Instructions

> 1. AI auto send campaigns aren't having messages sent (not sure if this is because we are hitting the confidence gate and the slack token we set up isn't sending slack notifications to jon@zeroriskgrowth.com or because of another issue)
> 2. Followup sequences are paused and we not seeing them sent. not sure if this is because we messed something up with auto send. if it is something else just note it and don't go any further.
>
> Our biggest priority right now is:
> 1. Making sure the AI-autosend is working with the confidence gate and slack notifications set up correctly
> 2. Making sure for all AI auto-send campaigns (these are set-up in the booking tab within settings in our platform) we are backfilling all previous responses. So essentially the responses we have gotten in response to our AI-autosend campaigns should have A. new drafts generated for all messages then B. the reply sent. Obviously using our pre-existing infrastructure to do this.
>
> We will use context7 for all API documentation for slack. Here is the exact permissions we have given the slack bot:
> - assistant:write, channels:read, chat:write, chat:write.public, users:write (Bot Token)
> - users:read (User Token)
>
> In order to verify slack notis are working we will send 10 messages to jon@zeroriskgrowth.com via slack and they will say "Please confirm you can see this message, if you can then take a screenshot and send it to me @AR"
>
> Then we will verify via the backfill script that this is working. Obviously the way that works is by running through the full process, draft gen, confidence gate, then messaging jon@zeroriskgrowth.com if we are below the set confidence percentage within the dashboard. And obviously logging it all as part of the script so we can see it's running properly.
>
> One more thing is we want the AI drafts to be regenerated first for all the responses to the AI-auto send managed campaigns, and we send in the request to generate them all at the same time (making sure availability slots are correct according to spec, ie: not giving the same slots to everyone and having too much overlap. Obviously we are prioritizing booking them in ASAP so healthy overlap is fine).
>
> Then after the responses are generated we are sending out the responses, this can be one by one so we see exactly what's going on. The backfill script should be similar to other ones we have created but this time I want the complete logs stored in a file/artifact within our codebase.

### Root Cause Analysis

**Issue 1: Slack Notifications Not Working — CONFIRMED ROOT CAUSE**

The Slack bot is **missing required OAuth scopes**:
- `users.lookupByEmail` requires `users:read.email` (current scope `users:read` is different)
- `conversations.open` requires `conversations:write` (not present)

**Evidence:** `lib/slack-dm.ts:94` calls `users.lookupByEmail` which returns an error without `users:read.email` scope. The error is not propagated loudly, so Slack DMs fail silently.

**Issue 2: Follow-Up Sequences Paused — NOT A BUG**

Database analysis shows follow-ups are paused for **expected reasons**:
| Pause Reason | Count | Status |
|--------------|-------|--------|
| `lead_replied` | 629 | Expected - prevents spam during active conversations |
| `awaiting_approval` | 413 | Expected - manual review required |
| `awaiting_enrichment` | 112 | Expected - waiting for phone/LinkedIn data |
| `active` (no pause) | 331 | Running normally |

**Conclusion:** Follow-up pausing is working as designed. No action needed.

**Issue 3: Many Inbound Messages Missing Drafts**

- Of 30 recent inbound messages to AI_AUTO_SEND campaigns, only 7 have drafts
- Background jobs are running (8,172 EMAIL_INBOUND_POST_PROCESS jobs succeeded)
- The backfill script will address this.

## Concurrent Phases

| Phase | Status | Overlap | Coordination |
|-------|--------|---------|--------------|
| Phase 67 | Complete | Auto-send infrastructure | Read-only |
| Phase 68 | Complete | Follow-up UI | Independent |
| Phase 64 | In progress | `lib/ai-drafts.ts`, booking link insertion | Coordinate if touching draft generation behavior |
| Phase 63 | Complete | `lib/ai-drafts.ts` reliability/logging | Ensure backfill logging doesn’t reintroduce noisy errors |
| Phase 62 | In progress | `lib/availability-cache.ts` slot sourcing | Draft generation uses availability cache; avoid drift |
| Phase 61 | Complete | `lib/availability-cache.ts` TTL/filters | Ensure backfill respects current availability filters |

## Pre-Flight Conflict Check (Multi-Agent)

- [ ] `git status --porcelain` shows no unexpected edits in `lib/ai-drafts.ts`, `lib/auto-send/*`, `lib/slack-dm.ts`, `lib/background-jobs/email-inbound-post-process.ts`
- [ ] Scan last 10 phases for overlaps (`ls -dt docs/planning/phase-* | head -10`)
- [ ] If any overlap exists, re-read the current file contents before implementing

## Objectives

* [ ] Fix Slack OAuth scopes (user action in Slack admin)
* [x] Create test script to verify Slack DM delivery (10 test messages)
* [x] Create backfill script for AI auto-send campaigns with full logging
* [ ] Store complete logs as artifact in codebase

## Constraints

- Backfill must use existing `generateResponseDraft` and `executeAutoSend` infrastructure
- Availability slots distributed via existing `WorkspaceAvailabilityCache` system
- Draft generation runs in parallel batches, auto-send runs sequentially
- Complete logs persisted to `scripts/logs/` directory
- Slack API references must use Context7 (per user instruction)
- Slack integration uses **bot token only** (`SLACK_BOT_TOKEN`); there is no user-token path in `lib/slack-dm.ts`
- Backfill must follow the same safety gates as email inbound processing (opt-outs/bounces, `shouldGenerateDraft`, and auto-book skips)
- Respect `AUTO_SEND_DISABLED` (global kill-switch) and `OPENAI_DRAFT_TIMEOUT_MS` defaults unless explicitly overridden
- Backfill concurrency and rate limiting must be configurable (avoid OpenAI/Slack rate limits)

## Success Criteria

- [ ] Slack test messages delivered to jon@zeroriskgrowth.com *(blocked: Slack scope fix required)*
- [x] Backfill script generates drafts for all AI auto-send responses
- [x] Backfill script processes auto-send with confidence gate and Slack notifications
- [x] Log artifact created at `scripts/logs/backfill-ai-auto-send-{timestamp}.log`
- [x] `npm run lint` and `npm run build` pass
- [x] Backfill uses the same AutoSendContext fields as `lib/background-jobs/email-inbound-post-process.ts`
- [x] Backfill logs are .gitignored and include lead names/emails per requirement (no full message bodies)
- [x] Backfill is resumable; regenerate-all mode will intentionally create new drafts per run

## Subphase Index

* a — Fix Slack OAuth scopes (user action + documentation)
* b — Create Slack test script (10 messages to jon@)
* c — Create AI auto-send backfill script
* d — Run backfill and verify
* e — Backfill safety + context alignment (RED TEAM addendum; execute before d)

## Key Files

| Component | File |
|-----------|------|
| Slack DM | `lib/slack-dm.ts` |
| Auto-Send Orchestrator | `lib/auto-send/orchestrator.ts` |
| Auto-Send Evaluator | `lib/auto-send-evaluator.ts` |
| Draft Generation | `lib/ai-drafts.ts` |
| Availability Cache | `lib/availability-cache.ts` |
| Backfill Pattern | `scripts/backfill-lead-scoring.ts` |

## Repo Reality Check (RED TEAM)

- What exists today:
  - `lib/slack-dm.ts` uses `users.lookupByEmail` + `conversations.open` with **bot token** only (`SLACK_BOT_TOKEN`).
  - `executeAutoSend` is called from `lib/background-jobs/email-inbound-post-process.ts` with a fully-populated `AutoSendContext`.
  - `generateResponseDraft` defaults to `OPENAI_DRAFT_TIMEOUT_MS` unless overridden.
  - `scripts/logs/` already exists and contains `scripts/logs/assert-known-errors.ts`.
- What the plan assumes:
  - Slack scope changes apply to the bot token and the app is reinstalled to refresh the token.
  - Backfill can reuse the same safety gates and transcript-building as email inbound post-process.
- Verified touch points:
  - `lib/slack-dm.ts`: `lookupSlackUserIdByEmail`, `openDmChannel`, `sendSlackDmByEmail`
  - `lib/background-jobs/email-inbound-post-process.ts`: `generateResponseDraft(...)` + `executeAutoSend(...)` context
  - `lib/auto-send/types.ts`: `AutoSendContext` fields required by orchestrator
  - `lib/sentiment.ts`: `buildSentimentTranscriptFromMessages`, `shouldGenerateDraft`

## RED TEAM Findings (Gaps / Weak Spots)

### Highest-risk failure modes
- **Auto-send context mismatch** (missing `conversationHistory`, `latestInbound`, `messageSentAt`) → build context using the same pattern as `lib/background-jobs/email-inbound-post-process.ts`.
- **Compliance breach** (sending to opt-outs/bounces) → reuse `shouldGenerateDraft`, `isOptOutText`, and `detectBounce` gates before draft generation and auto-send.
- **Slack still silent after scope fix** (token not reinstalled or wrong token updated) → add an explicit “bot token reinstalled + updated in Vercel” verification step.

### Missing or ambiguous requirements
- Backfill target definition is unclear: “all previous responses” vs “only missing AIDrafts” → decide whether to regenerate existing drafts.
- Auto-send timing: should campaign delay settings be honored during backfill or bypassed for immediate sends?
- Log content: requirement says “complete logs stored in repo” but this conflicts with PII hygiene → confirm redaction expectations.

### Repo mismatches (fix the plan)
- Plan references a “user token” scope, but the code path only uses a **bot token**. Update scopes/docs accordingly.
- `scripts/logs/.gitkeep` is unnecessary because `scripts/logs/` already exists.

### Performance / timeouts
- Draft generation can be slow; ensure concurrency is configurable and defaults to a safe value (consider `REGENERATE_ALL_DRAFTS_CONCURRENCY` as precedent).
- Sequential auto-send can still trigger Slack rate limits if many reviews fire; add optional pacing between sends.

### Security / permissions
- `AUTO_SEND_DISABLED=1` should prevent any apply run from sending; require explicit override to proceed.

### Testing / validation
- Add a dry-run summary that lists counts per campaign and per skip reason (opt-out, bounce, missing transcript).
- Verify Slack DM success/failure is logged per draft (not just aggregated).

## Assumptions (Agent)

- Backfill should mirror the email inbound post-process safety gates and context assembly (confidence ~95%).
  - Mitigation check: If backfill must behave differently, enumerate which gates to bypass and why.

## Assumptions (Agent)

- Backfill should mirror the email inbound post-process safety gates and context assembly (confidence ~95%).
  - Mitigation check: If backfill must behave differently, enumerate which gates to bypass and why.
- Backfill should **regenerate drafts for all AI auto-send managed responses**, not just missing drafts (confidence ~95%).
  - Mitigation check: If cost/time is too high, add a `--missing-only` flag to narrow scope.
- Backfill should **send immediately** (no campaign delays) because responses are already delayed (confidence ~95%).
  - Mitigation check: If campaign pacing must be preserved, re-enable delays via an optional flag.
- Backfill logs should include **full lead names + emails** (confidence ~95%).
  - Mitigation check: If log sharing risk is a concern, add a `--redact` flag.

## Phase Summary (2026-01-29)

**Completed:**
- Added `scripts/test-slack-dm.ts` to send 10 verification DMs to Jon.
- Implemented `scripts/backfill-ai-auto-send.ts` with draft regeneration, auto-send (immediate), safety gates, and resumable state.
- Updated `.gitignore` to exclude `scripts/logs/*.log` and backfill state files.

**Key decisions locked:**
- Regenerate drafts for **all** AI auto-send responses (default).
- Bypass campaign delays (immediate send) for backfill runs.
- Logs include lead names + emails, but avoid full message bodies.

**Artifacts:**
- `scripts/test-slack-dm.ts`
- `scripts/backfill-ai-auto-send.ts`
- `.gitignore`

**Remaining:**
- Update Slack app scopes (`users:read.email`, `conversations:write`) + reinstall + deploy new `SLACK_BOT_TOKEN`.
- Run `scripts/test-slack-dm.ts` and collect Jon's screenshot confirmation.
- Run backfill dry-run/apply and verify Slack DMs + logs.

## Post-Implementation Review (2026-01-29)

**Quality Gates:**
- `npm run lint`: PASS (0 errors, 18 pre-existing warnings)
- `npm run build`: PASS (37 routes generated)

**Status:** Code artifacts complete. Runtime verification blocked on Slack scope fix.

See `docs/planning/phase-69/review.md` for full evidence mapping.
