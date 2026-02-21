# Phase 179 — FC Auto-Send + Sentiment Reliability (Follow-Up + Booking)

## Purpose
Fix Founders Club production issues where follow-up/sentiment Slack notifications correlate with missing or low-quality auto-sends, and eliminate high-impact misclassifications (especially false `Meeting Booked`) that cause setters to lose trust in the system.

## Context
We have multiple symptoms reported by setters + observed in the dashboard:
- Slack ops alerts like `⚠️ Follow-Up Timing Not Scheduled` and `⚠️ AI Draft Routed (Intentional Routing)` are firing, but the lead does not reliably receive an auto-sent clarifier / reply.
- Some auto-sent replies are overly generic (“basic comments”) for follow-up timing and scheduling flows.
- The AI is replying to leads who are not in AI-managed campaigns (setter-managed campaigns should not auto-send).
- Leads sending *their* calendar link are getting responses that imply we will pick/book a time, but the system does not actually book anything.
- False `Meeting Booked` sentiment is being set from text-only inbound messages (no booking webhook / no appointment record), leading to “confirmed booking but no invite” confusion.

Concrete examples from screenshots (Feb 2026):
- “week of March 2nd” style availability was tagged `Follow Up` (should be treated as a scheduling window request / meeting requested).
- “reach out after 2:30 tomorrow” was tagged `Meeting Booked` even though no booking exists.

We will implement a unified, deterministic set of invariants and gates across:
1. Sentiment classification (prevent false `Meeting Booked`; avoid `Follow Up` for scheduling windows)
2. Routing (lead-provided calendar links -> Booking Process 5 + Slack notify)
3. Auto-send eligibility (AI_AUTO_SEND campaign required; follow-up-task due processor grace window)
4. Draft quality (timing clarifier asks for timeframe; attempt #2 includes calendar link; AI-written, not hard-coded)
5. Reliability (reduce `max_output_tokens` truncation by 3x and improve retry behavior)

Workspace / client in scope:
- Founders Club (`clientId=ef824aca-a3c9-4cde-b51f-2e421ebb6b6e`)

## Concurrent Phases
Recent phases overlap heavily with this scope (untracked/dirty working tree). Phase 179 must coordinate, not fork semantics.

| Phase | Status | Overlap | Coordination |
|-------|--------|---------|--------------|
| Phase 180 | Active (untracked) | “Intentional routing” draft suppression for Meeting Requested | Phase 179 must coordinate to ensure Meeting Requested replies still generate normal inbound drafts; suppression should be Follow Up only. |
| Phase 178 | Active (untracked) | Booking Process 4/5 routing eligibility + call vs meeting disambiguation | Phase 179 must align calendar-link routing with Process 5 and avoid reintroducing false `Call Requested`. |
| Phase 177 | Active (untracked) | Booking Process 4/5 routing + notifications | Same as 178; ensure any changes to router eligibility are consistent. |
| Phase 176 | Active (untracked) | Scheduling window enforcement + reschedule support + “no draft” fixes | Phase 179 should reuse window policies (no out-of-window offers; no repeated unavailable suggestions). |
| Phase 175 | Active (tracked) | Follow-up timing clarifier tasks + auto-send gating | Phase 179 should align with Phase 175 clarifier logic (attempt #1 timeframe-only; attempt #2 includes calendar link) and harden due-time auto-send reliability. |

## Objectives
* [ ] Identify the exact gating points causing “Slack notified but no auto-send” in follow-up timing + booking flows.
* [ ] Prevent text-only false `Meeting Booked` and other high-impact sentiment mistakes.
* [ ] Enforce “AI auto-send only for AI_AUTO_SEND campaigns” across inbound + follow-up-task senders.
* [ ] Route lead-provided calendar links into Booking Process 5 and Slack notify (no “we’ll grab a time” replies).
* [ ] Improve follow-up timing clarification drafts (attempt #1 asks timeframe; attempt #2 includes calendar link) and reduce `max_output_tokens` truncation rates.

## Constraints
- Follow-up timing clarifier:
  - Attempt #1 asks for a concrete timeframe/date (month/quarter/date) with **no links**.
  - Attempt #2 includes the workspace calendar link as an escape hatch.
  - Copy should be AI-generated (not a fully deterministic canned message).
- If a lead requests a specific scheduling window and it’s not available, respond “not available yet” + calendar link; do not propose alternative times they already said they’re busy. (Phase 176 policy; keep aligned.)
- Do not auto-send for setter-managed campaigns. Auto-send requires campaign response mode `AI_AUTO_SEND`.
- Booking Process 5 / lead-provided scheduler link is manual-only: block auto-send (even in `AI_AUTO_SEND` campaigns) and route to manual task + Slack notify.
- `Meeting Booked` sentiment must be provider-evidence backed (Appointment/provider IDs); never text-only.
- If lead provides their own calendar link, we do not attempt to auto-book; route to Booking Process 5 + Slack notification + manual tasking.

## Decisions Locked (Feb 2026)
- Booking router Process 5 (lead-provided scheduler link) is manual-only: block auto-send; create task + Slack notify.
- “Meeting Booked” requires provider evidence (Appointment record and/or provider IDs); never text-only.
- Timing clarifier booking link is attempt #2 only (attempt #1 is timeframe-only).

## Repo Reality Check (RED TEAM)
- What exists today:
  - Follow-up timing task/draft creation and due-task sender: `lib/followup-timing.ts`
  - Inbound post-process routing + “intentional routing” skip: `lib/background-jobs/*-inbound-post-process.ts`, `lib/inbound-post-process/pipeline.ts`
  - Booking Process 4/5 routing + Process 5 manual task: `lib/action-signal-detector.ts`, `lib/lead-scheduler-link.ts`
  - Auto-send orchestration/gating: `lib/auto-send/orchestrator.ts`, `lib/auto-send-evaluator.ts`
- What this phase assumes:
  - We can prevent false `Meeting Booked` by enforcing provider-evidence gates at sentiment-write points (without a schema change).
  - We can hard-block Process 5 auto-send centrally (even when campaigns are `AI_AUTO_SEND`).
  - We can fix follow-up-timing due-task self-blocking without breaking anti-spam behavior.
- Verified touch points:
  - `lib/meeting-lifecycle.ts`
  - `lib/followup-timing.ts`
  - `actions/message-actions.ts`
  - `app/api/webhooks/email/route.ts`
  - `lib/auto-send-evaluator.ts`

## RED TEAM Findings (Gaps / Weak Spots)
### Highest-risk failure modes
- `Meeting Booked` set from text-only messages → setters treat “confirmed booking but no invite” as system lying.
- Broad “intentional routing” suppression hijacks Meeting Requested compose draft → low-quality routed `followup_task:*` draft shown or no useful draft.
- Follow-up timing due-task sender self-blocks due to post-process/AI activity → Slack fires, but no auto-send occurs.

### Testing / validation risks
- Replay manifests exist in earlier phases; Phase 179 must use its own manifest (`docs/planning/phase-179/replay-case-manifest.json`) so closeout is deterministic and repeatable.

## Success Criteria
- No new `Meeting Booked` states from text-only inbound messages without provider evidence (Appointment/provider IDs).
- Lead-provided calendar links reliably trigger Booking Process 5 + Slack notify and do not trigger “we’ll grab a time” outbound claims.
- Lead-provided calendar links / Process 5 flows never auto-send (manual task + Slack notify only).
- Follow-up timing clarifier:
  - Attempt #1 asks for timeframe (month/quarter/date) with no link.
  - Attempt #2 includes the workspace scheduling link when available.
- Follow-up-task due processor no longer self-blocks due to immediate post-process message activity (grace-window fix).
- Material reduction in `Post-process error: hit max_output_tokens` for the in-scope features after 3x retry/budget changes.

NTTAN validation (required):
- `npm run test:ai-drafts`
- Preferred (manifest-driven):
  - `npm run test:ai-replay -- --thread-ids-file docs/planning/phase-179/replay-case-manifest.json --dry-run`
  - `npm run test:ai-replay -- --thread-ids-file docs/planning/phase-179/replay-case-manifest.json --concurrency 3`
- Fallback (if manifest is not available):
  - `npm run test:ai-replay -- --client-id ef824aca-a3c9-4cde-b51f-2e421ebb6b6e --dry-run --limit 20`
  - `npm run test:ai-replay -- --client-id ef824aca-a3c9-4cde-b51f-2e421ebb6b6e --limit 20 --concurrency 3`
- After live replay, review `.artifacts/ai-replay/*.json` for `judgePromptKey`, `judgeSystemPrompt`, and per-case `failureType`.

## Planning Notes
- Subphases `e`/`f` were appended to incorporate locked Feb 2026 decisions (Process 5 manual-only; Meeting Booked evidence gate; clarifier link is attempt #2 only).
- Treat subphases `a`–`d` as read-only plan artifacts.

## Subphase Index
* a — Investigation: Slack Signals vs Auto-Send Gates (Supabase-backed repro + manifest)
* b — Fix: Sentiment/Route Invariants (Provider-evidence Meeting Booked, AI campaign gating, lead calendar link -> Process 5)
* c — Fix: Follow-Up Timing Auto-Send + Draft Quality (grace window, clarifier attempt #2 includes link, 3x token retries)
* d — Tests + NTTAN Gates + Phase Review + Commit/Push
* e — Policy Hardening: Process 5 Manual-Only + Meeting Booked Evidence Gate + Prompt Alignment
* f — Fix: Follow-Up Timing Due Processor Reliability + Attempt #2 Link Policy

## Phase Summary (running)
- 2026-02-21 — Created Phase 179 replay manifest and root-cause matrix; identified Phase 180 dependency for Meeting Requested draft suppression (files: `docs/planning/phase-179/replay-case-manifest.json`, `docs/planning/phase-179/a/plan.md`).
- 2026-02-21 — Implemented Meeting Booked evidence gate + external scheduler prompt alignment + Process 5 manual-only auto-send block (files: `lib/meeting-lifecycle.ts`, `lib/inbound-post-process/pipeline.ts`, `lib/background-jobs/email-inbound-post-process.ts`, `lib/background-jobs/sms-inbound-post-process.ts`, `lib/background-jobs/linkedin-inbound-post-process.ts`, `lib/sentiment.ts`, `lib/ai/prompts/sentiment-classify-v1.ts`, `lib/auto-send/orchestrator.ts`).
- 2026-02-21 — Hardened follow-up timing auto-send reliability (meaningful activity gate + AI campaign gating) and enforced Attempt #2 booking link inclusion; increased follow-up timing extraction token retry budget 3x (files: `lib/followup-timing.ts`, `actions/message-actions.ts`, `lib/followup-timing-extractor.ts`).
- 2026-02-21 — Completed NTTAN manifest replay (dry-run + live); captured artifact + judge metadata (files: `docs/planning/phase-179/d/plan.md`, `docs/planning/phase-179/review.md`).
