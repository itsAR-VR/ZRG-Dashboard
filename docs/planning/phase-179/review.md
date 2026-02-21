# Phase 179 — Review

Date: 2026-02-21

## What shipped in this change set
- **Provider-evidence gate for `Meeting Booked`**:
  - If a classifier returns `Meeting Booked` but there is no provider evidence (no provider IDs on the Lead and no `Appointment` row with `status != CANCELED`), we downgrade to `Meeting Requested`.
- **Prompt alignment for scheduler-link instructions**:
  - “Book via my link / use my Calendly” is treated as `Meeting Requested` (manual booking flow), not `Meeting Booked`.
  - Removed unsafe availability fallback text that encouraged assuming a time was available and classifying as `Meeting Booked`.
- **Process 5 manual-only auto-send block**:
  - If action signals indicate an external calendar booking flow (`book_on_external_calendar` / Process 5), the auto-send orchestrator hard-blocks and leaves the draft for manual handling.
- **Follow-up timing reliability hardening**:
  - Due-task sender now requires `emailCampaign.responseMode === "AI_AUTO_SEND"` to auto-send follow-up tasks.
  - “Recent conversation activity” now only blocks auto-send on **inbound** or **setter outbound** activity after task creation (ignores AI/system).
  - Timing clarification Attempt #2 includes the workspace booking link (AI nudge when available; deterministic append fallback).
- **Token budget increase**:
  - Increased follow-up timing extraction retry budget by 3x to reduce `max_output_tokens` truncations.

## Files changed (high level)
- Sentiment + prompt: `lib/sentiment.ts`, `lib/ai/prompts/sentiment-classify-v1.ts`
- Meeting evidence gate: `lib/meeting-lifecycle.ts`, `lib/inbound-post-process/pipeline.ts`, `lib/background-jobs/*-inbound-post-process.ts`
- Auto-send block: `lib/auto-send/orchestrator.ts`
- Follow-up timing: `lib/followup-timing.ts`, `lib/followup-timing-extractor.ts`, `actions/message-actions.ts`

## Validation
- `npm run test:ai-drafts` — **pass**
- `npm run lint` — **pass** (warnings only)
- `npm run build` — **pass**
- NTTAN replay (manifest-driven) — **completed**
  - Dry-run:
    - `npm run test:ai-replay -- --thread-ids-file docs/planning/phase-179/replay-case-manifest.json --dry-run` — pass (selected=12)
  - Live:
    - `npm run test:ai-replay -- --thread-ids-file docs/planning/phase-179/replay-case-manifest.json --concurrency 3`
    - Summary: evaluated=10 passed=8 failedJudge=2 failed=0 averageScore=61.8
  - Artifact:
    - `.artifacts/ai-replay/run-2026-02-21T02-42-35-317Z.json`
  - Judge metadata:
    - `judgePromptKey`: `meeting.overseer.gate.v1`
    - `judgeSystemPrompt`: `PER_CASE_CLIENT_PROMPT`
  - FailureTypes:
    - draft_quality_error=2 (all other failure types = 0)
  - CriticalInvariants:
    - slot_mismatch=0, date_mismatch=0, fabricated_link=0, empty_draft=0, non_logistics_reply=0

## Residual risk
- Replay flagged `draft_quality_error=2` (near-threshold) with no critical invariant failures. If these are frequent in production, we should tune clarifier phrasing for:
  - broad windows (“mid March”) where the lead delegates to an assistant, and
  - day-level availability (“Tuesday”) without time.
