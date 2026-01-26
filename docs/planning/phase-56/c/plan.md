# Phase 56c — Manual Smoke Tests (Critical Flows)

## Focus
Run and document high-signal manual smoke tests that validate the most failure-prone real-world flows shipped across Phases 46–55.

## Inputs
- Phase 46 FC runbook: `docs/planning/phase-46/e/plan.md`
- Phase 48 manual test checklist: `docs/planning/phase-48/review.md` (Remaining Work)
- Phase 51 follow-ups: `docs/planning/phase-51/review.md` (manual smoke tests)

## Work
1) **FC “double set” regression check (Phase 46)**
   - Execute the Phase 46e checklist and confirm no duplicate outbound rows appear after sync.

2) **Auto-send orchestration (Phases 47–48)**
   - Validate:
     - AI_AUTO_SEND immediate path respects cancellation checks.
     - AI_AUTO_SEND delayed path schedules, validates, and sends correctly.
     - Low-confidence path triggers Slack notification (no send).

3) **Inbound post-process kernel (Phase 51)**
   - Validate SmartLead and Instantly inbound post-process still runs end-to-end and preserves prior behavior (draft generation, booking inference, auto-send gating).

4) **Email participants + CC (Phase 50)**
   - Validate participant headers render correctly and CC delivery behaves correctly across at least one provider thread.

## Output
- A single “smoke test report” with dates, test cases run, and outcomes (no PII; reference lead IDs only if necessary).

## Handoff
If any flow fails, open a follow-on phase scoped to the regression (include repro steps + logs).
If all pass, proceed to Phase 56d to fill remaining high-risk unit test gaps.

