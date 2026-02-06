# Phase 110 — Reconcile Monday Board vs Repo Reality (AI Bugs + Feature Requests)

## Purpose
Use a subagent-driven audit to reconcile the Monday board “AI Bugs + Feature Requests” against actual repo state, so we can say (with evidence) what’s **fixed**, what’s **still open**, and what’s **out of scope** for this repo. Where “fixed” items are not marked Done on Monday, the plan should include updating the board with evidence (phase refs + code touchpoints).

Secondarily, close any remaining **AI draft outcome analytics correctness** gaps (e.g., stable windowing) discovered during the reconciliation.

## Context
Monday board in scope:
- Board: “AI Bugs + Feature Requests” (`18395010806`) (46 items as of **2026-02-05**)
- Groups: Bugs, Feature Requests
- Key columns:
  - Status: `color_mkzh9ttq` (Working on it / Done / Stuck)
  - Issue Type: `color_mkzhypxv` (Bug / Error / UX Issue / Feature Request)
  - AI Tool/System: `color_mkzhkaqg` (Sales Call AI / Master Inbox / LMS)
  - Jam Link: `text_mm00xvew`

Important reality: this repo is the **ZRG Dashboard / Master Inbox** codebase. Items scoped to **Sales Call AI** or **LMS** may be **out of scope** here (we can still track them, but we may not be able to validate them in this repo).

Immediate “open” board items to reconcile (Status not set / not Done as of **2026-02-05**):
- Bugs (Master Inbox):
  - `11196938130` — AI not drafting responses (🔴 Critical)
  - `11174440376` — Website link not generated
  - `11183404766` — Blank slot + “more info” after yes (🟡 Medium, Jam)
  - `11185162432` — Asking questions post booking (🟠 High, Jam)
  - `11188016134` — Bad response for meeting request (🟠 High, Jam)
  - `11195846714` — Reactivation SMS not sending (+ maybe LinkedIn) (🟠 High, Jam)
- Feature Requests (mostly out-of-scope or not implemented; still track):
  - `11157946059` — Admin default sequences across client workspaces (🟡 Medium)
  - `11177512976` — Preview lead email in Slack
  - plus additional FRs from the Phase 106 snapshot (Calling System, Mobile App, etc.)

Board reconciliation should explicitly cross-reference the already-shipped backlog work in:
- Phase 106 (board snapshot + multiple bug fixes, incl. booking/availability/website link/reactivation prereqs)
- Phase 101 (analytics: edited vs auto-sent vs approved for `11177342525`)
- Phase 109 (draft generation regression fixes; relevant to `11196938130` class)

### Repo Reality Check (Verified)
Status snapshot based on current filesystem + code:

| Finding | Status | Evidence (Code) | Evidence (Plans/Tests) |
| --- | --- | --- | --- |
| (1) Disposition missing on idempotent paths (email/sms) | **Fixed (Phase 110b)** | Email idempotent paths compute/persist disposition: `actions/email-actions.ts` + `lib/email-send.ts`. SMS approvals persist disposition: `actions/message-actions.ts`. Follow-up idempotent branch now computes/persists disposition: `lib/followup-engine.ts`. | Phase 106s tests still cover the original idempotent surfaces (`lib/__tests__/response-disposition-idempotent.test.ts`). Phase 110b adds follow-up-specific regression coverage: `lib/__tests__/followup-engine-disposition.test.ts` + `scripts/test-orchestrator.ts`. |
| (2) `send_outcome_unknown` drafts stuck in `sending` | **Fixed** | Server/system email send set draft to `approved` on `send_outcome_unknown`: `actions/email-actions.ts`, `lib/email-send.ts`. Stale `sending` drafts reconciled in cron: `app/api/cron/background-jobs/route.ts` → `lib/ai-drafts/stale-sending-recovery.ts`. | Phase 105 + 106t: `docs/planning/phase-105/*`, `docs/planning/phase-106/t/plan.md`. Static tests: `lib/__tests__/send-outcome-unknown-recovery.test.ts`, `lib/__tests__/stale-sending-recovery.test.ts`. |
| (3) Analytics window uses `AIDraft.updatedAt` | **Fixed (Phase 110c)** | `actions/ai-draft-response-analytics-actions.ts` now anchors the window to derived send-time (`min(Message.sentAt)` per draft) via `draft_send_time` CTE. | Phase 110c adds regression coverage: `lib/__tests__/analytics-windowing-stable.test.ts` + `scripts/test-orchestrator.ts`. |
| (4) Monday backlog items | **Covered by prior phases; confirm any remaining live-only verification** | Website + booking/overseer/blank-slot fixes are in code (Phase 106). Edited vs auto-sent vs approved analytics feature implemented (Phase 101). | Phase 106 is the canonical backlog plan; Phase 101 implements item `11177342525`. |

### Verified Touchpoints For Top “Open” Board Bugs (So We Don’t Re-triage Blindly)
- `11196938130` (AI not drafting responses):
  - Draft generation triggers: `lib/ai-drafts.ts`, `app/api/cron/background-jobs/route.ts`, `lib/inbound-post-process/pipeline.ts`
  - Manual sentiment backfill path (Phase 109): `actions/crm-actions.ts`, `lib/manual-draft-generation.ts`, `components/dashboard/action-station.tsx`
- `11174440376` (Website link not generated):
  - Knowledge/website asset extraction: `lib/knowledge-asset-context.ts`
  - Prompt injection: `lib/ai-drafts.ts`
- `11183404766` / `11185162432` / `11188016134` (blank slots, post-yes behavior, meeting request quality):
  - Availability formatting guards: `lib/availability-format.ts`
  - Overseer rules + gating: `lib/meeting-overseer.ts`, `lib/ai-drafts.ts`
- `11195846714` (Reactivation SMS/LinkedIn not sending):
  - Prereq surfacing: `lib/reactivation-sequence-prereqs.ts`, `lib/reactivation-engine.ts`
  - Cron: `app/api/cron/reactivations/route.ts`

## Preliminary Reconciliation (As-of 2026-02-05)
This is a **starting hypothesis** for Phase 110a to verify. Do not mark items Done purely from this table; attach evidence.

| Item ID | Title | Current Board Status | Likely Repo Status | Evidence Starting Points |
| --- | --- | --- | --- | --- |
| 11196938130 | AI not drafting responses | Open | **Fixed (Shipped)** (Phase 109) | Phase 109 shipped manual-sentiment-triggered draft generation + compose UI refetch on sentiment (`docs/planning/phase-109/plan.md`). |
| 11174440376 | Website link not generated | Open | **Fixed (Shipped)** (Phase 106) | `docs/planning/phase-106/plan.md`, `lib/knowledge-asset-context.ts`, `lib/ai-drafts.ts`. |
| 11183404766 | Blank slot + “more info” after yes | Open | **Fixed (Shipped)** (Phase 106) | `docs/planning/phase-106/plan.md`, `lib/availability-format.ts`, `lib/meeting-overseer.ts`. |
| 11185162432 | Asking questions post booking | Open | **Fixed (Shipped)** (Phase 106) | `docs/planning/phase-106/plan.md`, `lib/meeting-overseer.ts`. |
| 11188016134 | Bad response for meeting request | Open | **Fixed (Shipped)** (Phase 106) | `docs/planning/phase-106/plan.md`, `lib/ai-drafts.ts`, `lib/meeting-overseer.ts`. |
| 11195846714 | Reactivation SMS not sending | Open | **Fixed (Shipped)** (Phase 106r) | Phase 106r shipped prerequisite surfacing + send-path behavior to prevent silent failure (`docs/planning/phase-106/r/plan.md`, `lib/reactivation-engine.ts`). |
| 11177342525 | Edited vs auto-sent vs approved | Open | **Fixed (Shipped)** (Phase 101) | `docs/planning/phase-101/plan.md`, `actions/ai-draft-response-analytics-actions.ts`. |
| 11157946059 | Admin default sequences across workspaces | Open | **Open (Not implemented)** | Tracked in Phase 106 snapshot; no evidence of implementation. |
| 11177512976 | Preview lead email in Slack | Open | **Open (Not implemented)** | Tracked in Phase 106 snapshot; needs design/UX + Slack payload changes. |
| 11177594620 | AI Responses improvement | Open | **Open / needs spec** | Tracked in Phase 106 snapshot; likely a spec doc + prompt/rubric work. |

## Definitions (So “Fixed” Means Something)
For the reconciliation matrix, classify every Monday item into **exactly one** bucket:
- **Fixed (Shipped)**: code change exists in this repo, with phase notes/tests indicating the intended behavior is implemented.
- **Fixed (Verified)**: Fixed (Shipped) plus at least one verification signal (Jam repro re-tested, Playwright/live smoke, or DB evidence on a real lead/thread).
- **Open (Not Fixed)**: issue still reproducible or the intended behavior is not implemented.
- **Out of Scope (Other System/Repo)**: appears to belong to Sales Call AI, LMS, or non-dashboard work.
- **Needs Repro / Missing Info**: cannot determine due to missing Jam/repro details.

## Concurrent Phases
Recent phases (last 10 by mtime) include work in overlapping domains.

| Phase | Status | Overlap | Coordination |
| --- | --- | --- | --- |
| Phase 109 | Shipped | AI draft generation + webhook/cron hardening (`actions/crm-actions.ts`, `lib/ai-drafts.ts`, webhooks/cron) | Re-read touched files before edits; Phase 109 is relevant to “AI not drafting responses” class. |
| Phase 108 | Shipped | Insights/reporting + schema changes | Analytics changes here should avoid reworking the message-performance pipeline. |
| Phase 107 | Shipped (live verification pending) | `lib/email-send.ts` + evaluator context | If we touch email send paths, ensure we don’t regress reply payload changes. |
| Phase 106 | Shipped | Disposition idempotency + send recovery + overseer/booking | Treat as source-of-truth for prior fixes; only patch uncovered gaps. |
| Phase 105 | Shipped | Email single-flight/idempotency + `send_outcome_unknown` typing | Reuse patterns; don’t reintroduce duplicate sends. |
| Phase 101 | Shipped | `AIDraft.responseDisposition` + outcome analytics action | We’ll likely update `actions/ai-draft-response-analytics-actions.ts`. |

## Objectives
* [x] Produce a board-wide reconciliation matrix (46 items): ID → bucket (Fixed Shipped / Fixed Verified / Open / Out of Scope / Needs Repro) with evidence links (phase + code touchpoints).
* [x] Identify mismatches: items not marked Done on Monday but already shipped (Phase 106/101/109) and prepare an evidence-based board update plan.
* [x] Identify truly open Master Inbox bugs and produce a prioritized, de-duped implementation backlog (new phases or subphases as needed).
* [x] If still open, close residual AI draft outcome correctness issues:
  - `responseDisposition` missing on any idempotent paths
  - outcome analytics window drift (avoid `AIDraft.updatedAt`)
* [x] Add regression coverage for any new correctness changes.

Working artifact:
- `docs/planning/phase-110/monday-reconciliation.md`

Matrix summary (as-of **2026-02-05**, 46 items):
- Fixed (Verified): 30
- Fixed (Shipped): 7
- Open (Not Fixed): 9
- Needs Repro / Missing Info: 0

## Next Phase Candidates (Post-110)
Prioritized by “still open” + impact.

1. “Shipped in repo, pending prod verification” (set Status=Done only after verification):
   - `11196938130` (Phase 109)
   - `11195846714` (Phase 106r)
   - `11174440376`, `11183404766`, `11185162432`, `11188016134` (Phase 106)
   - `11177342525` (Phase 101)
2. Feature requests (spec required; no implementation evidence yet):
   - `11157946059` admin default sequences across workspaces
   - `11177512976` preview lead email in Slack
   - `11177594620` AI Responses improvement (split into discrete backlog items from the linked doc)
   - `11127267338` calling system, `11127271384` mobile app
   - `11049445047` command AI to adjust draft, `11075133751` all replies filters
   - `11155102345` sales call AI, `11155120538` AI growth strategist

## Constraints
- Keep behavior multi-tenant safe and workspace-scoped.
- Avoid schema changes unless required for correctness and long-term stability.
- Do not log PII in actions/cron.
- Follow AGENTS.md: validate secrets before reading bodies; keep actions returning `{ success, data?, error? }`.
- Phase 110 is primarily a **reconciliation** phase: do not “fix everything” in one pass; isolate truly open bugs and queue dedicated execution phases.

## Success Criteria
1. All 46 Monday board items (enumerated via Monday MCP tools) have a single bucket classification + evidence (phase and/or code touchpoints).
2. Items that are **Fixed (Shipped)** but not marked Done have an explicit “board update” action plan (or are updated during execution if allowed).
3. Truly open Master Inbox bugs are clearly separated from feature requests/out-of-scope work, with a short “next phase” plan per item.
4. Any analytics/correctness changes done under this phase have regression coverage and do not rely on `AIDraft.updatedAt` for time-window filtering.

## Subphase Index
* a — Audit & reconcile: map Monday items + reported findings → code + phase plans, identify what’s truly open
* b — Close remaining disposition gaps (follow-up idempotency + any approved-but-null disposition states)
* c — Stabilize analytics windowing (replace `updatedAt` filter with stable send-time anchor)
* d — Regression coverage + validation checklist (tests/lint/build; db push if needed)
* e — Reconcile “should already be fixed” items (11196938130, 11195846714) against prior phases + update matrix/board notes

## RED TEAM Findings (Gaps / Weak Spots)

### Highest-risk failure modes
- **Board says “open” but code is already shipped** → we burn time re-fixing solved issues. Mitigation: reconciliation matrix must cite Phase 106/101/109 evidence and then drive Monday updates.
- **Board “Done” does not equal “Verified”** → regressions can slip. Mitigation: distinguish “Fixed (Shipped)” vs “Fixed (Verified)” and prioritize verification for 🔴/🟠 items.
- **“AI not drafting responses” is too broad** → multiple root causes (cron not running, webhook failures, gating, manual sentiment path). Mitigation: require a concrete repro path and check background jobs/ingestion health as part of the audit.

### Missing or ambiguous requirements
- No agreed definition of “fixed” (repo vs prod vs verified) → use the Definitions section and confirm with stakeholders.
- No explicit scope boundary across AI Tool/System (Master Inbox vs LMS/Sales Call AI) → classify out-of-scope items and avoid trying to “fix” them in this repo.

### Performance / timeouts
- Deep verification via Jam/live flows can be time-expensive → timebox verification, prioritize by Priority/Impact, and use subagents to parallelize analysis.

### Security / permissions
- If we write back to Monday (status/comments), ensure we only write evidence and do not paste PII or customer identifiers.

### Multi-agent coordination
- Phase 109/106/101 touch similar AI draft and send paths → re-read current files before edits; avoid re-introducing send idempotency regressions.

### Repo data completeness (RED TEAM)
- Resolved: reconciliation matrix now covers 46/46 items (`docs/planning/phase-110/monday-reconciliation.md`) and Phase 110a used Monday MCP tools to pull the full board.

### Code correctness gaps (RED TEAM)
- **Analytics query performance risk** → Separate indexes on `Message(aiDraftId)` and `Message(sentAt)` exist but no composite. Run `EXPLAIN ANALYZE` to verify performance; add `Message(aiDraftId, sentAt)` if needed.
- **Drafts with disposition but no outbound Message** → Phase 110c intentionally EXCLUDES these from time-windowed counts (no stable time anchor available). Confirm this matches reporting expectations.

## Resolved Questions
- **Board write-backs:** Hybrid. Post minimal evidence updates; set Status=Done only when verified deployed to prod.
- **"Done" definition:** Done = deployed to prod. Track "Shipped in repo" vs "Verified in prod" via item Updates (no extra columns).
- **Scope:** Classify all 46 items, but plan/execute fixes only for Master Inbox in this repo.
- **Evidence format:** Minimal note on Monday; full evidence lives in `docs/planning/phase-110/monday-reconciliation.md`.
- **Verification mode:** Jam-first when Jam link exists; otherwise use DB evidence/local tests (or leave pending).
- **AI not drafting (`11196938130`) if still reported post-Phase 109:** Require repro details (channel, lead/thread, timestamp, expected vs actual) to determine which trigger path is failing (manual sentiment vs cron/webhook vs gating vs UI refetch).

## Assumptions (Agent, >= 90% confidence)
- `computeAIDraftResponseDisposition` from `lib/ai-drafts/response-disposition.ts` is the correct helper for 110b (confidence ~95%). Mitigation: if follow-up sends should always be AUTO_SENT (cron-driven), adjust sentBy parameter.
- The 10s statement_timeout in the analytics query is sufficient after CTE change (confidence ~90%). Mitigation: run EXPLAIN ANALYZE on prod data.
- Time-windowed analytics should exclude drafts without outbound Messages (no stable send-time anchor) (confidence ~90%). Mitigation: if we need to include these drafts in the future, add a stable per-draft send timestamp (e.g., `AIDraft.sentAt`) and backfill from Message.
- Monday board has <= ~50 items; single page fetch is sufficient (confidence ~95%). Mitigation: use cursor pagination if needed.

## Phase Summary (running)
- 2026-02-05 — Completed 46-item Monday reconciliation matrix + posted minimal evidence updates on open shipped items (files: `docs/planning/phase-110/monday-reconciliation.md`, `docs/planning/phase-110/a/plan.md`, `docs/planning/phase-110/plan.md`)
- 2026-02-05 — Fixed follow-up disposition persistence + stabilized outcome analytics windowing + added regression tests; ran test/lint/build and captured review notes (files: `lib/followup-engine.ts`, `actions/ai-draft-response-analytics-actions.ts`, `lib/__tests__/followup-engine-disposition.test.ts`, `lib/__tests__/analytics-windowing-stable.test.ts`, `scripts/test-orchestrator.ts`, `docs/planning/phase-110/review.md`)
- 2026-02-05 — Post-implementation RED TEAM pass: updated Phase 110 Repo Reality Check + remaining risk notes to match shipped changes (files: `docs/planning/phase-110/plan.md`)
- 2026-02-05 — Reclassified `11196938130` + `11195846714` as Fixed (Shipped) with Phase 109/106r evidence, posted minimal Monday updates, added Phase 110e, and re-ran quality gates (files: `docs/planning/phase-110/monday-reconciliation.md`, `docs/planning/phase-110/e/plan.md`, `docs/planning/phase-110/plan.md`, `docs/planning/phase-110/review.md`)
