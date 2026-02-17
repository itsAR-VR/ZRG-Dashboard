# Phase 166 — Availability Window Booking: Deterministic Slot Match + Link Fallback

## Purpose
Make direct booking robust when a lead provides a window (e.g. “Monday morning”): select a real offered slot that matches the window and confirm it; if no matching slot exists, fall back to a known scheduling link. Eliminate “slot hallucination” confirmations in both runtime draft generation and the revision agent.

## Context
- Replay failures show the model confirming a lead-proposed time even when the offered availability differs (slot mismatch).
- Architecture: runtime drafting sources availability from `Lead.offeredSlots` (prior outbound) or live slots via `getWorkspaceAvailabilitySlotsUtc()`, then passes that into meeting overseer + draft generation as the source of truth.
- Root failure mode: slot-to-availability enforcement historically applied only in `shouldBookNow=yes` paths; other booking-intent modes could still produce committal confirmations that don’t match offered slots.
- User-required behavior:
  - For window-only intent (day + time-of-day, explicit ranges, relative windows), pick exactly one matching offered slot and confirm it.
  - If the requested window has no matching offered slots, do not “force” an out-of-window confirmation; instead direct to a known scheduling link.
  - Confirmation copy should carry the standard reschedule guidance: “If that time doesn't work, let me know or feel free to reschedule using the calendar invite.”

## Concurrent Phases

| Phase | Status | Overlap | Coordination |
|-------|--------|---------|--------------|
| Phase 165 | Active | Background orchestration touches message/revision surfaces | Re-run NTTAN gates after any merge; avoid semantic drift in revision constraints. |
| Phase 164 | Active | Inbox perf work (unrelated) | Keep changes isolated to AI scheduling files. |
| Phase 162 | Completed | AI pipeline scheduling correctness/slot confirmation | Preserve its invariants; do not reintroduce “pick first offered slot” behavior. |
| Working tree | Active | Untracked Playwright artifacts under `artifacts/live-env-playwright/` | Do not mix perf artifacts into AI/NTTAN work or commits. |

## Repo Reality Check (RED TEAM)
- What exists today:
  - Runtime and revision touchpoints already exist in-repo: `lib/ai-drafts.ts`, `lib/meeting-overseer.ts`, `lib/auto-send/revision-constraints.ts`, and `lib/ai-replay/invariants.ts`.
  - Replay CLI already supports manifest-driven execution via `--thread-ids-file` and manifest keys `threadIds`, `caseIds`, `criticalCore3`, and `criticalTop10`.
  - Historical replay artifacts already exist under `.artifacts/ai-replay/` and include prior slot/date mismatch cases.
- What this phase assumes:
  - Window-booking code paths in runtime + revision are already implemented and now need deterministic validation + evidence packaging.
  - Multi-agent overlap in shared AI files is expected and requires pre-flight coordination each turn.
- Verified touch points:
  - `lib/meeting-overseer.ts` (`selectOfferedSlotByPreference`, day/time-of-day normalization)
  - `lib/ai-drafts.ts` (window matching + booking/link fallback hooks)
  - `lib/auto-send/revision-constraints.ts` (`validateRevisionAgainstHardConstraints`)
  - `lib/ai-replay/invariants.ts` (`slot_mismatch`, `date_mismatch`)
  - `scripts/live-ai-replay.ts` + `lib/ai-replay/cli.ts` (manifest and artifact handling)

## RED TEAM Findings (Gaps / Weak Spots)
### Highest-risk failure modes
- Manifest-less replay runs can drift away from the exact historical slot/date mismatch regressions.
  - Mitigation: lock Phase 166 replay to `docs/planning/phase-166/replay-case-manifest.json` (hybrid seed strategy).
- Shared AI files (`lib/ai-drafts.ts`) are currently modified in the working tree.
  - Mitigation: run pre-flight conflict checks each turn and document coordination in active subphase output.

### Missing or ambiguous requirements
- Existing plan used only client-id sampling replay commands and did not require manifest curation.
  - Plan fix: add new subphase `e` for manifest curation + diagnostics hardening.
- Existing plan did not require run-level replay diagnostics capture.
  - Plan fix: require `judgePromptKey`, `judgeSystemPrompt`, and `failureType` evidence in outputs.

### Testing / validation hardening
- Existing gates did not encode optional baseline comparison.
  - Plan fix: include `--baseline` compare when prior artifacts are available.

## Pre-Flight Conflict Check
- [x] Run `git status --porcelain` and record unexpected overlaps.
- [x] Scan last 10 phases (`ls -dt docs/planning/phase-* | head -10`) before touching shared AI files.
- [x] Re-read current file contents before edits; do not rely on cached assumptions.

## Objectives
* [x] Codify the “window booking” policy and edge cases (exact time vs window, relative dates, timezone, lead scheduler link).
* [x] Ensure runtime drafting picks a real offered slot for window requests and never confirms a time that isn’t available.
* [x] Ensure the revision agent is forced to do the same (match an offered slot or use link fallback) and fails validation otherwise.
* [x] Validate against unit tests and NTTAN replay gates; verify representative slot-mismatch cases no longer fail.
* [x] Record a small evidence packet (before/after case IDs + invariant counts).

## Constraints
- Use offered slots as source of truth; never invent times.
- Window matching must consider time-of-day and explicit ranges, not just weekday.
- If no slot matches the requested window, use known scheduling link (workspace booking link or lead scheduler link) instead of confirming an out-of-window slot.
- Respect lead scheduler links: if the lead provides their own link, do not offer our slots.
- Use inbound message timestamp for relative preferences (“next week”, “tomorrow”) to avoid drift.
- Must not leak PII (phone numbers) into outbound drafts or saved artifacts.

## Success Criteria
- Direct booking behavior:
  - “Monday morning” selects an offered Monday-morning slot and confirms it.
  - If only Monday evening slots exist, reply uses scheduling link (no fake morning confirmation).
- Revision-loop behavior:
  - Revisions cannot pass validation if they confirm a time when no offered slot matches the requested window unless they include known scheduling link fallback.
- NTTAN validation gates pass:
  - `npm run test:ai-drafts`
  - `npm run test:ai-replay -- --thread-ids-file docs/planning/phase-166/replay-case-manifest.json --dry-run`
  - `npm run test:ai-replay -- --thread-ids-file docs/planning/phase-166/replay-case-manifest.json --concurrency 3`
  - Optional baseline compare when prior artifact exists:
    - `npm run test:ai-replay -- --thread-ids-file docs/planning/phase-166/replay-case-manifest.json --baseline .artifacts/ai-replay/<prior-run>.json`
- Replay evidence packet includes:
  - artifact path(s),
  - run-level `config.judgePromptKey` + `config.judgeSystemPrompt`,
  - per-case `failureType` distribution and critical invariant counts.

## Subphase Index
* a — Policy Spec + Case Catalog
* b — Runtime Slot Selection Hardening
* c — Revision Constraints + Invariant Alignment
* d — NTTAN Replay Validation + Evidence Packet
* e — Replay Manifest Curation + Diagnostics Hardening

## Assumptions (Agent)
- Assumption: Subphases `a`-`d` are treated as completed/read-only for RED TEAM refinement because they already contain non-empty Output + Handoff sections. (confidence ~95%)
  - Mitigation check: if new runtime defects emerge during replay, open append-only follow-up subphase(s) rather than rewriting completed ones.
- Assumption: Existing `.artifacts/ai-replay` history is sufficient to seed a deterministic hybrid manifest for this phase. (confidence ~95%)
  - Mitigation check: if seeded IDs are stale/missing in DB, replace only missing entries with fresh high-risk selections and record the substitution.

## Open Questions (Need Human Input)
- [x] Replay preflight connectivity blocker resolved on rerun (2026-02-17); manifest-based dry/live replay evidence captured in this phase.

## Phase Summary (running)
- 2026-02-17 — RED TEAM hardening applied: added repo reality check, explicit gaps, manifest-driven NTTAN requirements, and appended subphase `e` for deterministic replay diagnostics. (files: `docs/planning/phase-166/plan.md`)
- 2026-02-17 — Executed NTTAN gates for subphase `e`: `npm run test:ai-drafts` passed (`76/76`), replay dry/live blocked by Supabase DB preflight connectivity; blocker artifacts and diagnostics captured. (files: `docs/planning/phase-166/e/plan.md`, `docs/planning/phase-166/replay-case-manifest.json`, `.artifacts/ai-replay/run-2026-02-17T04-51-07-682Z.json`, `.artifacts/ai-replay/run-2026-02-17T04-51-10-801Z.json`)
- 2026-02-17 — One-shot Terminus governance pass executed across phases `151-165`: global validation gates passed on current worktree, all prior phases now have `review.md`, phase-level integrity matrix recorded, and root plans were backfilled with retroactive validation checkpoints. (artifact: `docs/planning/phase-166/artifacts/terminus-audit-151-165-2026-02-17.md`)
- 2026-02-17 — End-of-turn NTTAN rerun succeeded with manifest-based gates: `test:ai-drafts` pass, replay dry-run pass, replay live pass with zero critical invariants and zero infra failures. Evidence artifacts: `.artifacts/ai-replay/run-2026-02-17T05-40-49-224Z.json` (dry), `.artifacts/ai-replay/run-2026-02-17T05-40-49-052Z.json` (live). Prompt metadata: `judgePromptKey=meeting.overseer.gate.v1`, `judgeSystemPrompt=PER_CASE_CLIENT_PROMPT`.
- 2026-02-17 — Folded in concurrent Phase 162 AI-route-authoritative routing hardening (`lib/action-signal-detector.ts` + tests + phase docs) into this one-shot validation/closure run; deterministic gates remained green (`npm test` 401/401, `npm run test:ai-drafts` 76/76).
- 2026-02-17 — Final closure pass: verified phase-integrity matrix for phases `151-165` (all review files present, all subphase Output/Handoff sections non-empty), authored `docs/planning/phase-166/review.md`, and prepared this branch for commit/push.
