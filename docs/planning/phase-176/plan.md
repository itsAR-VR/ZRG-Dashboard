# Phase 176 — Scheduling Window Enforcement + Reschedule Support + No-Draft Fix

## Purpose
Fix scheduling edge cases where the system (1) proposes out-of-window or repeated time slots, (2) fails to produce an AI draft due to “intentional routing”, and (3) mishandles “no concrete date” deferrals by not asking for a date/time.

## Context
Recent inbound replies and dashboard notifications show recurring failures:
* `Follow-Up Timing Not Scheduled` when a lead defers without a concrete date (e.g., “maybe in the future”, “not at this time”).
* `AI Draft Skipped (Intentional Routing)` for Meeting Requested flows (draft generation is skipped because a scheduling/follow-up task was created).
* Scheduling/reschedule replies suggesting times outside the lead’s stated window, and sometimes repeating previously offered times.

Hard evidence:
* Jam: `https://jam.dev/c/ef529046-ef5e-492d-a14c-0e13b660a453` (Founders Club clientId `ef824aca-a3c9-4cde-b51f-2e421ebb6b6e`) shows a reschedule thread where the assistant offered out-of-window times and the UI showed no drafts.
* Supabase example (Founders Club):
  * Lead `efd5727a-2287-4099-b2d8-05def2cf8921` (Caleb Owen) has an inbound reschedule message `0920ae43-ecf2-4bdd-bdc3-4c08e4549dc9` with explicit windows, but an outbound reply `bf9692eb-ff67-4764-8ba4-e5f6a8809c52` offered times outside those windows.

Key decisions from the thread:
* Non-deterministic policy: use AI for nuanced handling; keep deterministic logic narrow and “invariant enforcement” style.
* “2nd week of March” semantics: week-of-month is **Mon–Sun**.
* If a lead requests a window and **no offered slot matches**, respond **not available (yet/right now)** and include the calendar link; do **not** propose other times.
* Hybrid: deterministic messaging for **SMS**, AI-driven messaging for **email/LinkedIn**.
* If the reply is primarily an **objection** (e.g., “we already use X”), route to objection-handling mode (not follow-up timing clarify).

## Concurrent Phases
This phase overlaps with recent work in follow-up timing + scheduling/AI drafting logic. Treat as high-conflict and re-read current file state immediately before edits.

| Phase | Status | Overlap | Coordination |
|-------|--------|---------|--------------|
| Phase 175 | Recent / complete | follow-up timing clarifier flow, inbound post-process wiring | Preserve Phase 175 behavior; only extend for objection-routing + draft-skipping gaps found in production. |
| Phase 166 | Recent / complete | meeting window selection + offered-slot policy + revision constraints | Do not regress “offered slot is source of truth”; extend to reschedule + link-only fallback enforcement. |
| Phase 174–173 | Recent | inbound post-process orchestration + routing | Avoid drive-by refactors in shared inbound processors; keep changes scoped to draft/task creation semantics. |

## Objectives
* [x] Identify where/why “draft skipped” and “no concrete date” warnings still occur in production paths.
* [ ] Enforce meeting scheduling policy: match requested window to offered slots; otherwise send link-only (no alternative times).
* [ ] Add explicit support for “move/reschedule meeting” requests (same policy constraints; do not repeat prior offers).
* [ ] Ensure a draft exists even when scheduling flow creates a follow-up task (no “manual-only” dead ends).
* [ ] Add regression coverage (unit + replay manifest) and run NTTAN gates.

## Constraints
* Do not invent times: offered slots are source-of-truth.
* If requested window has no matching offered slot, output must include known calendar link and must not propose out-of-window times.
* Must not repeat already-offered times.
* Channel policy:
  * SMS: deterministic copy for “ask for a date” + “link-only fallback”.
  * Email/LinkedIn: AI-generated copy, but must satisfy deterministic invariants.
* No PII leakage into repo docs (only IDs in manifests; no raw message bodies).

## RED TEAM Findings (Gaps / Weak Spots)
### Highest-risk failure modes
* Week-of-month matching depends on `OfferedSlot.datetime` being a parseable ISO timestamp. If upstream provides non-parseable `datetime`, the system will fail closed to link-only (safe but may reduce in-window confirmations).
* “Intentional routing” skips drafting based on `schedulingHandled` (follow-up task created or timing scheduled). Any future code path that creates a FollowUpTask without an `AIDraft` can reintroduce dead-end behavior; backfill + fallback logic mitigates, but it’s still a hot spot.
* Objection vs Follow Up ambiguity: competitor objections often include “maybe later” language. If sentiment analysis regresses, the follow-up timing flow can reappear; keep Objection emit allowed + higher priority than Follow Up.

### Testing / validation
* NTTAN replay must include at least one hard-window case (Caleb) and at least one competitor-deferral objection (Terra) to prevent regressions.

## Success Criteria
* Caleb Owen reschedule case (and similar windowed requests) no longer produces out-of-window offers:
  * Draft either selects an offered slot inside the requested window OR responds link-only.
* Meeting Requested “intentional routing” no longer results in missing drafts in the inbox UI.
* Follow-up deferral with no concrete date generates an “ask for date/time” draft (or routes to objection handler when appropriate).
* NTTAN validation gates pass (manifest-first; client-id fallback if needed):
  * `npm run test:ai-drafts`
  * `npm run test:ai-replay -- --thread-ids-file docs/planning/phase-176/replay-case-manifest.json --dry-run`
  * `npm run test:ai-replay -- --thread-ids-file docs/planning/phase-176/replay-case-manifest.json --concurrency 3`
  * Fallback if manifest is incomplete:
    * `npm run test:ai-replay -- --client-id ef824aca-a3c9-4cde-b51f-2e421ebb6b6e --dry-run --limit 20`
    * `npm run test:ai-replay -- --client-id ef824aca-a3c9-4cde-b51f-2e421ebb6b6e --limit 20 --concurrency 3`

## Open Questions (Need Human Input)
* Should we implement the optional “notify me when that specific window opens” follow-up enrollment now, or defer it to a later phase?
  - Why it matters: it requires new state (persisting requested window(s)) and a cron-driven notifier/backfill path; higher scope/risk than the policy/invariant fixes.
  - Default (if no answer): defer to a later phase after the core policy enforcement is shipped.

## Subphase Index
* a — Investigation + Policy Spec (Jam + Supabase-backed cases)
* b — Meeting Scheduler: Window Mismatch => Link-Only + Reschedule Support
* c — Follow-Up Timing Clarifier + Objection Routing + “No Draft” Fix
* d — Tests + Replay Manifest + NTTAN Gates + Phase Review + Commit/Push

## Phase Summary (running)
- 2026-02-20 — Identified emitters + root causes for the two Slack warnings and pulled Jam + Supabase-backed case IDs (files: `docs/planning/phase-176/a/plan.md`, `lib/followup-timing.ts`, `lib/background-jobs/email-inbound-post-process.ts`, `lib/followup-engine.ts`).
- 2026-02-20 — Hardened scheduling window enforcement in the revision loop (week-of-month support + link-only no-match behavior) (files: `lib/auto-send/revision-constraints.ts`, `docs/planning/phase-176/b/plan.md`).
- 2026-02-20 — Fixed “no draft” routed scheduling dead-ends via FollowUpTask→AIDraft backfill + skip fallback; enabled Objection classification for competitor deferrals (files: `lib/followup-task-drafts.ts`, `lib/background-jobs/*-inbound-post-process.ts`, `lib/inbound-post-process/pipeline.ts`, `lib/background-jobs/maintenance.ts`, `lib/sentiment.ts`, `docs/planning/phase-176/c/plan.md`).
