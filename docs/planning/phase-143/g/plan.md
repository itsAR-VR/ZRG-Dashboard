# Phase 143g — Route-Aware Slack Surfacing + Draft/Gate Tagging

## Focus

Use router metadata for **notify+tag-only** behavior:
- enrich Slack alerts with process route info,
- enrich AI draft and overseer context with route-aware instructions,
- do not trigger any new booking automation side effects.

## Inputs

- Router output from Phase 143f: `ActionSignalDetectionResult.route: BookingProcessRoute | null`
- Existing notification path in `lib/action-signal-detector.ts`:
  - `notifyActionSignals()` at lines 253+
  - Slack dedupe key: `action_signal:{clientId}:{leadId}:{messageId}:{signalType}:slack:{channelId}`
  - Posts to `workspaceSettings.notificationSlackChannelIds`
  - Includes emoji (📞/📅), lead name, workspace, confidence, evidence, dashboard link
- Existing draft context path in `lib/ai-drafts.ts` (⚠️ HOT FILE — modified by phases 139/140/141):
  - `buildActionSignalsPromptAppendix()` at lines 116-134 — generates prompt guidance from signals
  - `buildActionSignalsGateSummary()` at lines 136-151 — generates meeting-overseer memory context
  - `hasActionSignal()` at line 112 — boolean helper
  - Both functions accept `ActionSignalDetectionResult | null | undefined`
- Existing inbound pipeline passthroughs already wired in phase 143 baseline (4 pipelines)
- Route metadata from 143f may exist even when `signals.length === 0` (Process 1-3 route-only outcomes) and must not be dropped.

## Work

1. Slack payload enrichment:
- Add process route fields to alert text:
  - process id (1–5)
  - confidence
  - rationale
  - uncertain flag
- **Dedupe key clarification:** Route metadata is appended to the _same_ Slack notification built by `notifyActionSignals()`, not sent as a separate alert. The existing dedupe key (`action_signal:{clientId}:{leadId}:{messageId}:{signalType}:slack:{channelId}`) remains unchanged — the route info enriches the payload body, not the key.
- Preserve existing dedupe key semantics.

2. Draft appendix update (`buildActionSignalsPromptAppendix` in `lib/ai-drafts.ts`, currently lines 116-134):
- **Re-read `lib/ai-drafts.ts` before editing** — this file is modified by phases 139/140/141 concurrently.
- Extend appendix builder to prefer route-aware guidance when `route` is present:
  - Process 4: call-request language and avoid conflicting email-only suggestions
  - Process 5: acknowledge lead-provided scheduler flow and avoid workspace-link nudges
  - Other processes (1/2/3): concise route tags for context without forcing side effects
- When `route` is null (AI failed or gated), fall back to existing signal-only appendix behavior.
- When `route` exists with zero signals, still append route-aware context (do not gate appendix on `signals.length`).

3. Overseer memory context update (`buildActionSignalsGateSummary` in `lib/ai-drafts.ts`, currently lines 136-151):
- Append compact route summary block (`process`, `confidence`, `rationale`, `uncertain`).
- Ensure this is additive to existing auto-booking context and does not override current gate flow.

4. Side-effect safety:
- Explicitly do not add new calls that mutate booking/task state from route output.
- Existing automations remain untouched.

5. Route-only notification policy:
- Keep Slack alerts signal-driven by default (no new route-only Slack sends) unless Open Question Q3 is answered otherwise.
- Always include route-only metadata in draft/gate context when available.
- Preserve existing dedupe key behavior regardless of route-only handling.

## Validation (RED TEAM)

- `rg --line-number "processId|confidence|rationale|uncertain|ACTION SIGNAL CONTEXT|route" lib/action-signal-detector.ts lib/ai-drafts.ts`
- Verify no new writes/mutations were introduced from router decisions.
- Verify existing lead scheduler-link override behavior remains present.
- Verify route-only cases (`signals.length === 0`) still appear in prompt appendix/gate summary.
- Verify Slack behavior remains unchanged for route-only cases unless Q3 explicitly enables route-only alerts.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Enriched `notifyActionSignals(...)` in `lib/action-signal-detector.ts` to accept optional `route` and include process/confidence/rationale/uncertain metadata in Slack message body.
  - Kept Slack sends signal-driven only (`signals.length > 0` gate preserved), so route-only classifications do not create new Slack notifications.
  - Updated `lib/ai-drafts.ts` route-aware context helpers:
    - added `hasActionSignalOrRoute(...)`,
    - expanded `buildActionSignalsPromptAppendix(...)` with Process 1–5 route guidance (including route-only cases),
    - expanded `buildActionSignalsGateSummary(...)` to include route metadata.
  - Updated draft pipeline callsites to preserve route-only payloads (`actionSignals.signals.length > 0 || actionSignals.route`).
- Commands run:
  - `rg --line-number "notifyActionSignals\\(|hasActionSignalOrRoute|ACTION SIGNAL CONTEXT|actionSignals\\.signals\\.length > 0 \\|\\| actionSignals\\.route" lib/action-signal-detector.ts lib/ai-drafts.ts lib/inbound-post-process/pipeline.ts lib/background-jobs/*-inbound-post-process.ts` — pass.
  - `npm test` — pass; includes `action signal prompt appendix` suite coverage for route-aware behaviors.
- Blockers:
  - None for code changes in this subphase.
- Next concrete steps:
  - Complete 143h command evidence and review artifact updates for expanded validation + blocked external gates.

## Output

- Slack notifications now carry route metadata when a signal-driven alert is emitted.
- Draft + overseer contexts include route-aware tags/instructions, including route-only outcomes.
- Notify+tag-only contract preserved (no new booking/task mutations).

## Handoff

Phase 143h finalizes verification/reporting: local quality gates + NTTAN evidence capture and explicit documentation of external DB blockers.
