codex resume 019c671a-18e8-7e51-ba8f-f61c63ca30cd# Phase 162 — Call-Request Signatures + Auto-Send Safety + Slot-Confirmation Correctness (Founders Club)

## Purpose
Fix the end-to-end FC inbound→AI pipeline so “call me at the number below/in my signature” is handled correctly (Slack notified, no redundant phone-number ask, no unintended auto-send), and stop the system from injecting arbitrary availability slots into booked confirmations.

## Context
We have a concrete regression in Founders Club email handling (example lead: `emad@tradefinancecompany.com`):
- Inbound email body: “you may reach me at direct contact number below” (phone is present in signature and already stored on the Lead).
- System drafted/sent: “Which number should we call?” (incorrect; we already have it).
- Expected behavior:
  - Route as Booking Process **4** (Call Requested) when the intent is to call using a number in the signature.
  - Send a Slack notification for the call request.
  - Per user decision: **do not auto-reply** when call intent is detected; notify only (regardless of whether a phone is on file).
  - Also per user decision: do **not** create a “call task” unless sentiment is explicitly `Call Requested` (notify-only for signature-style contact language when sentiment is `Interested`).
  - When the lead phone is missing (common for iPhone replies with no signature details), trigger the Clay phone enrichment stream to attempt to hydrate a callable number.

Root causes discovered in repo + DB:
- Draft generation uses **signature-stripped** text (`stripEmailQuotedSectionsForAutomation`), so call intent + signature phone can be invisible to generators.
- `notifyActionSignals()` only posts to Slack when `signals.length > 0`; route-only outcomes can silently skip notifications.
- Booking-process router output for the example was `processId=3 (uncertain)` and no signals were emitted, so Slack notify didn’t happen.
- Auto-send evaluator approved “ask for phone number” because it wasn’t reliably aware that the lead phone is already on file.

Separate correctness issue:
- `applyShouldBookNowConfirmationIfNeeded()` had logic that could fall back to `firstOfferedSlot` when it couldn’t map a slot explicitly referenced in the draft, causing incorrect booked confirmations and triggering `slot_mismatch` / `date_mismatch` invariants.

Key locked decisions from user:
- **Call Reply behavior:** If Booking Process 4 (call intent) is detected: **no auto-reply** (notify only), regardless of whether a phone is on file, and this policy is **global across all workspaces**.
- **Process 4 trigger policy:** “reach me at direct contact number below” (number in signature) with sentiment `Interested`: **notify only** (no call task unless sentiment is `Call Requested`).
- **PII in prompts:** pass phone number to **draft + evaluator** prompts if needed, but enforce guardrails so it never appears in the outbound message.
- **Clay enrichment dedupe:** for call-intent-triggered phone enrichment retries, apply a 24-hour dedupe window per lead/channel; keep legacy one-time enrichment behavior for non-call-intent paths.
- **Validation policy:** no NTTAN/replay gate is required for this phase; closure is based on deterministic code-level gates.

## Concurrent Phases

| Phase | Status | Overlap | Coordination |
|-------|--------|---------|--------------|
| Phase 160 | Active | `components/dashboard/settings-view.tsx`, `next.config.mjs` (Knowledge Assets upload) | Phase 162 must avoid Settings IA/upload changes; keep edits scoped to AI + inbound pipelines. |
| Phase 159 | Active | `components/dashboard/settings-view.tsx`, `next.config.mjs` (Knowledge Assets 413 hotfix) | Do not touch large-upload/413 mitigation codepaths in this phase. |
| Phase 158 | Active | Analytics + response timing + AI draft booking conversion stats (`actions/*`, `lib/response-timing/*`) | Phase 162 should not expand analytics scope; only touch those files if required for action-signal/auto-send correctness. |
| Phase 156 | Active | Settings IA refactor (`components/dashboard/settings-view.tsx`) | Do not modify Settings layout in this phase (except possibly documentation-only changes). |
| Phase 161 | Active | Inbox read API incident triage (`app/api/inbox/conversations/*`) | Independent; no coordination needed. |
| Uncommitted working tree | Active | Many modified `lib/*` AI files present | Phase 162 must consolidate and verify these changes before committing/pushing. |

## Repo Reality Check (RED TEAM)

- What exists today:
  - Planned touch files exist and are active in the current tree: `lib/ai-drafts.ts`, `lib/action-signal-detector.ts`, `lib/auto-send/orchestrator.ts`, `lib/auto-send-evaluator.ts`, `lib/inbound-post-process/pipeline.ts`, `lib/background-jobs/email-inbound-post-process.ts`, `lib/background-jobs/sms-inbound-post-process.ts`.
  - Referenced symbols exist: `applyShouldBookNowConfirmationIfNeeded`, `notifyActionSignals`, `generateResponseDraft`, `loadAutoSendWorkspaceContext`, `evaluateAutoSend`, `executeAutoSend`.
  - Required scripts exist: `test`, `typecheck`, `lint`, `build`.
- What the plan assumes:
  - Process 4 call-intent outcomes should always result in notify-only behavior (no auto-send).
  - Router decisions and action signals remain synchronized so Slack notify is not skipped.
  - No agentic replay gate is required for this phase; deterministic tests/build checks are sufficient.
- Verified touch points:
  - `lib/ai-drafts.ts` (`applyShouldBookNowConfirmationIfNeeded`, `generateResponseDraft`)
  - `lib/meeting-overseer.ts` (`accepted_slot_index` semantics)
  - `lib/action-signal-detector.ts` (`notifyActionSignals`)
  - `lib/auto-send-evaluator.ts` (`loadAutoSendWorkspaceContext`, `evaluateAutoSend`)
  - `lib/auto-send/orchestrator.ts` (`executeAutoSend`)
  - `lib/ai/prompt-registry.ts` (`draft.verify.email.step3.v1` context)

## Objectives
* [x] Fix slot confirmation logic so booked confirmations never inject arbitrary availability.
* [x] Improve action-signal routing for “call me at number below/signature” so it reliably routes to Process 4 and triggers Slack notify.
* [x] If call intent is detected and lead phone is missing, trigger phone enrichment (best-effort: messages/signature AI, then Clay).
* [x] If call intent is detected and lead phone is missing, suppress AI draft generation (notify-only; do not send a reply asking for a number).
* [x] Ensure auto-send evaluation and auto-send execution respect “phone on file” and “call intent” policy (skip auto-send, notify only).
* [x] Enforce call-intent enrichment dedupe at 24h per lead/channel, without changing non-call-intent enrichment policy.
* [x] Add a booking-intent availability alignment guard for `shouldBookNow=no` so drafts do not confirm unavailable windows; prefer one matching slot or scheduling-link fallback.
* [x] Harden revision constraints to block confirmations when no offered slot matches inbound window unless draft includes scheduling-link fallback.
* [x] Fix `auto_send_revise` structured output schema so revision loop stops throwing 400s.
* [x] Add regression tests/fixtures for the above.
* [x] Validate with deterministic gates (`npm test`, `npm run lint`, `npm run typecheck`, `npm run build`).

## Constraints
- **LLM-first**: prefer AI routing/extraction into structured JSON; deterministic actions should be powered by that structured output.
- Avoid FC-only hardcoding in shared libraries; if FC-specific behavior is required, gate it via `resolveWorkspacePolicyProfile()`.
- Safety: prevent outbound drafts from containing phone numbers even if phone is provided as internal prompt context.
- Keep changes isolated: do not regress Knowledge Assets, Settings IA, or Inbox Read API workstreams.

## Success Criteria
- Slot confirmations: no more `firstOfferedSlot`-style injection; `slot_mismatch`/`date_mismatch` caused by arbitrary slot selection is eliminated.
- Action signal: “direct contact number below” style replies produce a `call_requested` signal and Slack notify fires (deduped).
- Enrichment: when call intent is detected and lead phone is missing, we trigger the Clay phone enrichment stream (or otherwise hydrate a phone) so ops can call without asking for the number again.
- Drafting: when call intent is detected and lead phone is missing, we do not generate an AI draft (notify-only policy).
- Enrichment dedupe: repeated call-intent events for the same lead/channel do not retrigger Clay within 24h; non-call-intent enrichment behavior remains unchanged.
- Auto-send: when call intent is detected and the lead has a phone on file, auto-send returns `skip` (no outbound message sent).
- Auto-send: when call intent is detected and the lead phone is missing, auto-send still returns `skip` (no outbound message sent); rely on Slack notify + enrichment.
- Booking-intent alignment: for `shouldBookNow=no`, drafts do not confirm unavailable requested windows; they either propose one matching offered slot or provide scheduling-link fallback.
- Follow-up confirmation messaging: auto-book confirmation text uses consistent correction/reschedule wording with calendar-invite guidance.
- Revision agent: `auto_send_revise` no longer errors with invalid schema; revision loop works end-to-end.
- Validation gates pass:
  - `npm test`
  - `npm run test:ai-drafts`
  - `npm run lint`
  - `npm run typecheck`
  - `npm run build`

## RED TEAM Findings (Gaps / Weak Spots)

### Highest-risk failure modes
- Shared `lib/*` files are currently modified in working tree, creating semantic-merge risk across concurrent phases.
  - Mitigation: add explicit pre-flight conflict checks and coordination notes before commit/push.
- Call-intent enrichment can trigger repeatedly if dedupe scope is not explicit.
  - Mitigation: enforce 24h dedupe in the call-intent trigger path only and keep non-call-intent policy untouched.

### Missing or ambiguous requirements
- Policy scope and dedupe strategy were ambiguous.
  - Plan fix: lock decisions to global call-intent auto-send skip and 24h lead/channel dedupe for call-intent enrichment path.

### Repo mismatches (fix the plan)
- Prior plan required replay/NTTAN gates that are now explicitly out-of-scope for this phase.
  - Plan fix: replace replay gates with deterministic repository validation gates.

### Security / permissions
- Phone context is intentionally passed to AI prompts; accidental leakage into outbound text or logs remains a high-risk failure mode.
  - Plan fix: require outbound phone-redaction guard plus artifact review for PII leakage regressions.

### Testing / validation
- Plan now requires deterministic test/build validation in place of replay/NTTAN.
  - Plan fix: `npm test`, `npm run lint`, `npm run typecheck`, and `npm run build` are required before closure.

### Multi-agent coordination
- Phase 156 already touched `lib/auto-send-evaluator.ts` for `Lead.phone` selection, and this phase overlaps adjacent auto-send paths.
  - Plan fix: append a dedicated coordination hardening subphase before final commit/push.

## Assumptions (Agent)

- Assumption: Subphases `a` through `f` are treated as completed/read-only for RED TEAM refinement, so additional hardening work is appended as a new subphase. (confidence ~95%)
  - Mitigation question/check: if any `a`-`f` subphase is still actively in-flight, re-open it explicitly instead of executing `g`.
- Assumption: No NTTAN/replay evidence is required for Phase 162 acceptance in this execution cycle. (confidence ~95%)
  - Mitigation question/check: if release policy changes, add a dedicated replay phase rather than reopening this one mid-flight.

## Resolved Decisions (2026-02-16)

- Process 4 call intent auto-send suppression is global across workspaces.
- Call-intent-triggered Clay enrichment uses a 24h dedupe window per lead/channel.
- Dedupe scope applies only to call-intent-triggered enrichment path; non-call-intent behavior remains one-time policy.
- NTTAN/replay is not required for this phase closure.

## Subphase Index
* a — Preflight: Repro Packet + Working Tree Reconciliation
* b — Fix Slot-Confirmation Selection + Tests
* c — Action-Signal: Process 4 Routing + Slack Notify Reliability
* d — Auto-Send Safety: Phone-On-File + Call-Intent Policy + Revision Schema Fix
* e — Drafting Guardrails: Phone Context + “Don’t Ask Which Number” + No-PII Output
* f — Deterministic Validation + Commit/Push Checklist (No NTTAN)
* g — Coordination Hardening + Phase Closure

## Progress (2026-02-16)
- Implemented:
  - Slot confirmation: prefer the slot explicitly referenced in the draft over `accepted_slot_index` when they conflict.
  - Call intent: expanded detection to catch "direct contact number below" style replies; Slack notify now shows `Phone: (missing)` for call requests when no phone exists.
  - Booking router signaling: when AI route classification is available, route JSON is now authoritative for Slack action-signal notifications (Process 4 => `call_requested`, Process 5 => `book_on_external_calendar`); deterministic keyword heuristics are fallback-only when routing is unavailable.
  - Enrichment: when call intent is detected and phone is missing, trigger best-effort phone hydration (messages/signature AI where applicable, then Clay stream).
  - Drafting: suppress draft generation when call intent is detected and phone is missing (notify-only policy).
  - Auto-send: skip auto-send when call intent is detected (regardless of whether phone is on file).
  - Booking-intent availability guard: when `shouldBookNow=no`, align confirmations to in-window offered slots or switch to scheduling-link fallback if no matching slot exists.
  - Revision constraints: enforce window-match/link-fallback invariants during revision validation.
  - Follow-up confirmation wording: use consistent “let me know or reschedule using calendar invite” phrasing, with correction-only fallback when link is unavailable.
  - Draft safety: add phone-context prompt appendix and hard redact any phone-like numbers from outbound drafts.
- Tests:
  - `npm test` (pass; 397/397 tests, 0 failures)
  - `npm run test:ai-drafts` (pass; 76/76 tests, 0 failures)
  - `npm run lint` (pass with pre-existing warnings only)
  - `npm run typecheck` (pass)
  - `npm run build` (pass; no type/build errors)
  - Re-validation after reconciliation (2026-02-17): `npm test` (pass; 399/399 tests, 0 failures) and `npm run test:ai-drafts` (pass; 76/76 tests, 0 failures)
  - Re-validation after AI-route-authoritative routing change (2026-02-17): `npm test` (pass; 401/401 tests, 0 failures) and `npm run test:ai-drafts` (pass; 76/76 tests, 0 failures)
- Blocker:
  - none currently blocking deterministic gates.
- RED TEAM hardening status:
  - coordination summary completed for overlapping `lib/*` files; no additional conflicts detected this turn.

## Phase Summary (running)
- 2026-02-16 19:10 local — Updated plan defaults: removed NTTAN/replay gates, locked global call-intent auto-send skip, and locked call-intent enrichment dedupe scope/window (files: `docs/planning/phase-162/plan.md`).
- 2026-02-16 19:29 local — Implemented call-intent-only 24h Clay dedupe path and wired call-intent trigger metadata through inbound pipelines (files: `lib/phone-enrichment.ts`, `lib/inbound-post-process/pipeline.ts`, `lib/background-jobs/email-inbound-post-process.ts`, `lib/background-jobs/sms-inbound-post-process.ts`).
- 2026-02-16 19:31 local — Deterministic validation gates passed (`npm test`, `npm run lint`, `npm run typecheck`, `npm run build`); no new cross-phase file conflicts beyond known shared AI pipeline files.
- 2026-02-16 19:39 local — Corrected dedupe/one-time interaction so call-intent can retry after 24h while default path stays one-time; added regression tests for dedupe-window + retry policy branch logic (files: `lib/phone-enrichment.ts`, `lib/__tests__/phone-enrichment.test.ts`).
- 2026-02-16 19:47 local — Added `phone-enrichment` test file to the orchestrated suite and re-ran all deterministic gates successfully (`npm test`, `npm run lint`, `npm run typecheck`, `npm run build`) on latest tree.
- 2026-02-16 20:04 local — Reconciled additional slot-window safety edits: booking-intent availability alignment guard, revision-constraint window fallback enforcement, and follow-up confirmation wording tests; validated with `npm run test:ai-drafts` (files: `lib/ai-drafts.ts`, `lib/__tests__/ai-drafts-clarification-guards.test.ts`, `lib/auto-send/revision-constraints.ts`, `lib/auto-send/__tests__/revision-constraints.test.ts`, `lib/followup-engine.ts`, `lib/__tests__/followup-confirmation-message.test.ts`, `scripts/test-ai-drafts.ts`, `scripts/test-orchestrator.ts`).
- 2026-02-17 — Re-ran deterministic validation post-reconciliation: `npm run test:ai-drafts` (76/76) and `npm test` (399/399) both green, including new `followup-confirmation-message` coverage in orchestrated suite.
- 2026-02-17 — Updated `lib/action-signal-detector.ts` so AI booking-route JSON is authoritative for signal routing; added conflict + route5 fallback tests in `lib/__tests__/action-signal-detector.test.ts`; re-ran deterministic gates (`npm test` 401/401, `npm run test:ai-drafts` 76/76).

- 2026-02-17 — Terminus Maximus retroactive validation completed for Phase 162: global gates passed (lint/typecheck/build/test), review artifact present (docs/planning/phase-162/review.md), and subphase Output/Handoff integrity verified.
