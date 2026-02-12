# Phase 143f — AI Booking Process Router (1–5) in Detector

## Focus

Add an AI router inside `lib/action-signal-detector.ts` that classifies inbound messages into Booking Processes `1..5` and attaches route metadata to detection output.

## Inputs

- Existing detector: `lib/action-signal-detector.ts`
  - Current type: `ActionSignalDetectionResult = { signals: ActionSignal[]; hasCallSignal: boolean; hasExternalCalendarSignal: boolean }`
  - `EMPTY_ACTION_SIGNAL_RESULT` constant at line 36 — used in 5 files
  - `detectActionSignals()` at lines 202-249 — two return paths (early gate at 213, normal at 245-249)
  - `runStructuredJsonPrompt` already imported (line 8), used by Tier-2 at lines 153-170
  - No `channel` param in current signature (lines 202-209)
- Prompt infra: `lib/ai/prompt-runner`, `lib/ai/prompt-registry.ts`
  - `action_signal.detect.v1` exists (gpt-5-nano, binary classification)
  - `action_signal.route_booking_process.v1` does NOT exist yet
  - Registration pattern: add entry to `listAIPromptTemplates()` array
- Additional inbound processors present in runtime:
  - `lib/background-jobs/smartlead-inbound-post-process.ts`
  - `lib/background-jobs/instantly-inbound-post-process.ts`
  - Decide whether router support is in-scope now or deferred.
- Booking process references:
  - `docs/notes/booking-process-5.md` — Lead-provided scheduler link semantics
  - `components/dashboard/settings/booking-process-reference.tsx` — UI reference
  - `lib/booking-process-templates.ts` — Named templates (NOT numeric IDs; templates are: "Link + Qualification", "Initial Email Times", "Lead Proposes Times")
  - Prisma `BookingProcess` model exists with `BookingProcessStage[]` — workspace-level, campaign-assigned

## Downstream Consumers (must remain compatible)

- `lib/ai-drafts.ts` — imports `ActionSignalDetectionResult` (line 55), uses in `DraftGenerationOptions.actionSignals`, `hasActionSignal()`, `buildActionSignalsPromptAppendix()`, `buildActionSignalsGateSummary()`
- `lib/inbound-post-process/pipeline.ts` — `let actionSignals = EMPTY_ACTION_SIGNAL_RESULT` (line 350)
- `lib/background-jobs/sms-inbound-post-process.ts` — `let actionSignals = EMPTY_ACTION_SIGNAL_RESULT` (line 270)
- `lib/background-jobs/linkedin-inbound-post-process.ts` — `let actionSignals = EMPTY_ACTION_SIGNAL_RESULT` (line 238)
- `lib/background-jobs/email-inbound-post-process.ts` — `let actionSignals = EMPTY_ACTION_SIGNAL_RESULT` (line 991)
- `lib/__tests__/action-signal-detector.test.ts` — `deepEqual` against `EMPTY_ACTION_SIGNAL_RESULT` (line 106), inline `ActionSignalDetectionResult` constructions (lines 172, 184, 196)

## Work

1. Add route types to detector module:
- `BookingProcessId = 1 | 2 | 3 | 4 | 5`
- `BookingProcessRoute = { processId: BookingProcessId; confidence: number; rationale: string; uncertain: boolean }`
- Extend `ActionSignalDetectionResult` with `route: BookingProcessRoute | null`
- **Update `EMPTY_ACTION_SIGNAL_RESULT` to include `route: null`** — this constant is used in 5 files (4 pipelines + tests) and TypeScript will error if the shape doesn't match the updated type.

2. Register new prompt key in `lib/ai/prompt-registry.ts`:
- `action_signal.route_booking_process.v1`
- Model: `gpt-5-mini` (5-class + rationale needs reliable structured output; nano insufficient)
- Reasoning: minimal
- Strict JSON schema matching `BookingProcessRoute`:
  ```json
  { "processId": 1-5, "confidence": 0.0-1.0, "rationale": "string", "uncertain": true/false }
  ```
- `maxOutputTokens`: 200 (sufficient for classification + short rationale)
- Prompt must include explicit 5-class taxonomy definitions:
  - **P1** = Link + Qualification (lead needs qualifying questions, then booking link)
  - **P2** = Initial Email Times / EmailBison slots (lead selecting from offered times)
  - **P3** = Lead Proposes Times (lead suggests specific date/time, auto-book when clear)
  - **P4** = Call Requested (lead wants a phone call, not email scheduling)
  - **P5** = Lead-Provided Scheduler Link (lead sends their own Calendly/Cal.com/etc.)

3. Add `routeBookingProcessWithAi(...)` in detector:
- Inputs include stripped/full text, sentiment, scheduler-link evidence.
- **Channel context:** Add optional `channel?: "sms" | "email" | "linkedin"` to `detectActionSignals()` opts. All 4 callers already have channel context — pass it through. This avoids a separate function signature for the router.
- Use `runStructuredJsonPrompt<BookingProcessRoute>` following the existing Tier-2 call pattern (lines 153-170): `pattern`, `clientId`, `leadId`, `promptKey`, `featureId`, `input`, `schema`, `maxOutputTokens`.
- Add optional injected router hook (parity with `disambiguate`): `routeBookingProcess?: BookingProcessRoutingFn` so 143h can run deterministic tests without live model calls.
- Wrap in try/catch with fail-safe `null` return on errors (non-blocking).
- Enforce timeout budget: route call target <=2.5s, fail-open to `route: null`.

4. Integrate router call into `detectActionSignals(...)`:
- Maintain existing sentiment gate.
- Keep existing signal extraction for compatibility.
- Attach `route` when AI returns output.
- Always route when available (confidence metadata only; no threshold gate).
- Ensure route metadata is returned even when `signals.length === 0` (required for Process 1-3 visibility).
- **Update both return paths:**
  - Early gate return at line 213: `return { ...EMPTY_ACTION_SIGNAL_RESULT }` (already updated via constant).
  - Normal return object at lines 245-249: add `route` field.
- **Update inline result construction in existing tests** (line 106 uses `deepEqual` against `EMPTY_ACTION_SIGNAL_RESULT` — shape must match).

5. Keep deterministic backstops minimal:
- No additional heavy branch matrices.
- Preserve existing dedupe/fail-safe patterns.

## Validation (RED TEAM)

- `rg --line-number "action_signal.route_booking_process.v1|BookingProcessRoute|route:" lib/action-signal-detector.ts lib/ai/prompt-registry.ts`
- Confirm `EMPTY_ACTION_SIGNAL_RESULT` includes `route: null`.
- Confirm no Prisma schema changes required.
- Confirm detector still returns safe empty defaults when gated/failing.
- Confirm all 4 pipeline callers still compile (adding optional `channel` param is non-breaking).
- Confirm route is preserved for route-only outcomes (`signals.length === 0`).
- Confirm channel scope decision is explicit for Smartlead/Instantly (implemented or marked deferred in root plan/open questions).
- Confirm existing 18 tests still pass after type extension.

## Assumptions / Open Questions (RED TEAM)

- Assumption: `email|sms|linkedin` remain the mandatory channels for this subphase, with Smartlead/Instantly rollout decided at root-plan level. (confidence ~90%)
- Open question: should router execute for neutral sentiment, or only under existing positive-sentiment gating?
  - Why it matters: neutral gating materially changes Process 1-3 capture rate and cost/latency envelope.
  - Current default: preserve current positive-sentiment gate.
  - Confidence: ~70%

## Progress This Turn (Terminus Maximus)
- Work done:
  - Implemented routing model + result extension in `lib/action-signal-detector.ts`:
    - added `BookingProcessId`, `BookingProcessRoute`, `route` field on `ActionSignalDetectionResult`,
    - updated `EMPTY_ACTION_SIGNAL_RESULT` to include `route: null`,
    - added injected `routeBookingProcess` hook + `channel/provider` routing context,
    - added fail-open AI router path and route normalization.
  - Registered router prompt in `lib/ai/prompt-registry.ts` with key `action_signal.route_booking_process.v1` (model `gpt-5-mini`, strict schema).
  - Wired router context into all existing callsites:
    - `lib/inbound-post-process/pipeline.ts`
    - `lib/background-jobs/email-inbound-post-process.ts`
    - `lib/background-jobs/sms-inbound-post-process.ts`
    - `lib/background-jobs/linkedin-inbound-post-process.ts`
  - Added workspace-level router toggle plumbing:
    - `prisma/schema.prisma` (`WorkspaceSettings.aiRouteBookingProcessEnabled`)
    - `actions/settings-actions.ts` (read/write)
    - `components/dashboard/settings-view.tsx` (toggle + status tile)
- Commands run:
  - `rg --line-number "action_signal.route_booking_process.v1|BookingProcessRoute|route:\\s*null|aiRouteBookingProcessEnabled" lib actions components prisma` — pass (all required symbols present).
  - `DATABASE_URL='postgresql://test:test@localhost:5432/test?schema=public' DIRECT_URL='postgresql://test:test@localhost:5432/test?schema=public' OPENAI_API_KEY='test' node --conditions=react-server --import tsx --test lib/__tests__/action-signal-detector.test.ts` — pass (25 tests).
- Blockers:
  - None for implementation. Smartlead/Instantly routing remains explicitly deferred at root-plan level.
- Next concrete steps:
  - Complete 143g route-aware Slack/draft context surfacing and 143h expanded validation/reporting.

## Output

- Router prompt + schema shipped (`action_signal.route_booking_process.v1`).
- Detector now emits route metadata for Process 1–5 while preserving existing signal detection behavior.
- Route context reaches all in-scope inbound pipelines (email/SMS/LinkedIn) with workspace-level enable/disable control.
- No booking mutation side effects were introduced in this subphase.

## Handoff

Phase 143g consumes the new `route` payload for Slack/body context enrichment while keeping notifications signal-driven and preserving existing dedupe semantics.
