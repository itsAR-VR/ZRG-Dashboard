# Phase 143 — Action Signal Detector, Slack Surfacing, and Booking Process Router

## Purpose

Surface high-value inbound booking/call intent quickly and safely by combining:
- Action-signal detection for Process 4/5 style intent,
- AI-based booking-process routing (Processes 1–5),
- Slack notifications + draft/gate context tagging.

This phase explicitly **does not add new booking automation side effects**. It only improves routing, visibility, and prompt context.

## Context

Phase 143a-143e implemented baseline action-signal detection and channel wiring. That baseline is now extended to align with the Booking Processes model (1–5) without replacing existing booking automation logic.

Existing Process 5 behavior already captures/stores lead-provided scheduler links and applies lead-link override behavior in drafts. The new extension adds robust AI routing + Slack/context tagging across currently wired inbound channels (email/SMS/LinkedIn).

## Decisions Locked

- Routing scope: **Hybrid AI Router** across Booking Processes `1..5`.
- Actioning mode: **Notify + Tag only** (no new mutation side effects from router decisions).
- Confidence policy: **Always route** when AI returns a classification.
- Safety policy: Keep minimal deterministic backstops (sentiment gate, dedupe, fail-safe error handling) and avoid heavy deterministic branching that can interfere with AI routing.
- Validation bar: include expanded verification with `npm test` (not only targeted test + lint + build).

## Concurrent Phases

| Phase | Status | Overlap | Coordination |
|-------|--------|---------|--------------|
| 139 | Active (uncommitted) | `lib/followup-engine.ts`, `lib/meeting-overseer.ts`, `lib/ai-drafts.ts` | Merge by symbol; avoid stale line references. |
| 140 | Active (uncommitted) | `lib/ai-drafts.ts`, `lib/ai/prompt-registry.ts` | Re-read before edits; preserve pricing/cadence hardening. |
| 141 | Active (uncommitted) | `lib/ai-drafts.ts`, `lib/ai/prompt-registry.ts` | Preserve runtime route-skip observability and Step2/Step3 gates. |
| 138 | Active (uncommitted) | `lib/inbound-post-process/pipeline.ts`, `lib/background-jobs/*-inbound-post-process.ts`, `lib/ai-drafts.ts` | Reconcile pipeline/draft edits before router shape changes. |
| 137 | Active | `lib/background-jobs/email-inbound-post-process.ts` | Re-read latest file state; do not rely on stale line anchors. |
| 142 | Active | booking qualification surfaces | No direct router overlap, but shared dirty tree/build context. |
| 144 | Active | docs/settings adjacency | Keep scope isolated to Phase 143 files. |

## Objectives

### Completed foundation (a-e)

- [x] Create `lib/action-signal-detector.ts` (heuristic + signature disambiguation + Slack notify)
- [x] Register `action_signal.detect.v1` prompt in prompt registry
- [x] Add/confirm `"action_signal_detection"` pipeline stage
- [x] Wire detection + passthrough in shared email, background email, SMS, and LinkedIn paths
- [x] Extend `DraftGenerationOptions` with `actionSignals` and inject signal-aware prompt/gate context
- [x] Add baseline regression tests (`lib/__tests__/action-signal-detector.test.ts`)
- [x] Verify targeted tests + lint + build

### Pending extension (f-h)

- [x] Add AI router prompt + schema for booking process classification (`1..5`)
- [x] Extend detector result model with router output (`processId`, `confidence`, `rationale`, `uncertain`)
- [x] Inject route metadata into Slack surfacing (notify+tag only)
- [x] Inject route-aware context into draft appendices and meeting-overseer memory context
- [x] Add router regression fixtures/tests for all 5 process classes + fail-open/fail-safe paths
- [x] Run expanded verification: targeted tests + `npm test` + lint + build
- [ ] Complete external-db-dependent validation gates: `npm run db:push` + both NTTAN replay commands (currently blocked by `P1001` DB reachability).

## Constraints

- Prisma change scope is limited to workspace toggle plumbing for router enablement (`WorkspaceSettings.aiRouteBookingProcessEnabled`).
- Router output must not directly trigger new booking mutations.
- Existing booking automations remain source-of-truth:
  - offered/proposed-time flows,
  - call-requested task creation,
  - lead scheduler-link capture and manual-review pathways.
- Detection/routing failures must never block draft generation.
- Route metadata must not be dropped for Process 1-3 (route-only cases with zero action signals).
- Router calls must fail-open with bounded latency (default budget: `maxOutputTokens=200`, timeout target <= 2.5s per call).
- Router scope must explicitly declare channel coverage (Email/SMS/LinkedIn now; Smartlead/Instantly either added in this phase or explicitly deferred).
- Keep deterministic logic minimal and non-invasive to AI routing.

## Repo Reality Check (RED TEAM)

- What exists now:
  - `lib/action-signal-detector.ts` implemented with signal model and Slack notify.
  - `lib/ai-drafts.ts` already consumes typed `actionSignals` for prompt/gate context.
  - All four inbound processing paths pass action-signal payloads.
  - Additional inbound processors exist: `lib/background-jobs/smartlead-inbound-post-process.ts` and `lib/background-jobs/instantly-inbound-post-process.ts`.
  - `lib/booking-process-instructions.ts` + booking templates already model Process families but are not currently used as a router classifier.
- Known overlap risk:
  - `lib/ai-drafts.ts` and prompt registry are active hot files across recent phases.
  - Current draft passthrough patterns in pipelines are signal-count gated (`signals.length > 0`), which can hide Process 1-3 route metadata unless explicitly updated.
- Coordination policy:
  - Merge by function/symbol anchors only.

## Success Criteria

- Router returns a process classification (`1..5`) for representative inbound messages across email/SMS/LinkedIn.
- Route metadata survives route-only cases (`signals.length === 0`) so Process 1-3 is still visible to draft/gate context.
- Slack surfacing includes route metadata (`processId`, confidence, rationale) with no additional mutation side effects.
- Draft/gate context reflects route semantics (especially Process 4 + 5) without regressing existing lead-link override behavior.
- Existing action-signal behavior remains non-blocking and backwards-compatible when router is unavailable.
- Channel scope is explicit (Smartlead/Instantly integration either implemented in this phase or documented as deferred with follow-up phase reference).
- Expanded validation passes:
  - targeted detector/router tests,
  - `npm test`,
  - `npm run lint`,
  - `npm run build`.

## Subphase Index

- a — Core detection module + prompt registration (completed)
- b — Pipeline type + email pipeline integration (completed)
- c — SMS + LinkedIn pipeline integration (completed)
- d — Draft generation context injection (completed)
- e — Unit tests + verification (completed)
- f — AI booking-process router prompt + detector integration (completed)
- g — Route-aware Slack + draft/overseer context tagging (completed)
- h — Router regression suite + expanded validation + review update (partial: local gates complete; DB-dependent gates blocked)

## Assumptions (Agent)

- Existing Process 5 capture/override flow remains authoritative and should not be replaced in this phase. (confidence ~95%)
- Notify+tag-only mode is sufficient for this phase; new side-effectful routing can be a follow-on phase after telemetry proves reliability. (confidence ~92%)
- Always-route policy is intentional despite lower-confidence classifications; confidence is metadata, not a gate, for this phase. (confidence ~90%)
- `gpt-5-mini` is the right model for 5-class classification + rationale. (confidence ~95% — decided by human; nano insufficient for this task)
- Process 1-3 can be reliably distinguished from message text alone. (confidence ~70% — these categories overlap significantly without campaign/context metadata)

## Open Questions (Need Human Input)

- ~~**Q1 (M5):** Should a workspace-level `aiRouteBookingProcessEnabled` toggle be added (like Phase 141's route switches), or is the router always-on acceptable for this phase? If always-on, what's the disable path if classifications are noisy?~~
  - Resolved: toggle added to `WorkspaceSettings` and Settings UI.
- ~~**Q2 (M6):** Should booking-process routing run only for positive sentiment, or also run for neutral/unknown intent messages (e.g. "what times work?")?~~
  - Resolved: preserve existing positive-sentiment gate.
- ~~**Q3 (M7):** For route-only classifications (`route != null`, `signals.length === 0`), should Slack send route-only notifications or keep Slack alerts signal-driven only while still tagging draft/gate context?~~
  - Resolved: keep Slack signal-driven; route-only context still passed to draft/gate.
- ~~**Q4 (M8):** Are `smartlead` and `instantly` inbound processors in-scope for router rollout in this phase, or explicitly deferred?~~
  - Resolved: deferred in this phase; email/SMS/LinkedIn remain in-scope.
- ~~**Q5 (M9):** Is the default router latency/timeout budget (<=2.5s fail-open) acceptable, or should a tighter cap be enforced?~~
  - Resolved: keep current implementation timeout (`4_000ms`) as acceptable for this phase.
- ~~**Q6 (M10):** Should we require explicit telemetry metrics on route outcomes (`processId`, `confidence`, `uncertain`) in this phase, or defer to follow-on observability work?~~
  - Resolved: route outcome telemetry writer added with environment guard.
- ~~**Q2 (M2):** Resolved — use `gpt-5-mini` from the start for the 5-class router.~~

## External Blockers (Current)

- `npm run db:push` fails with `P1001` (cannot reach `db.pzaptpgrcezknnsfytob.supabase.co:5432`).
- `npm run test:ai-replay -- --client-id ef824aca-a3c9-4cde-b51f-2e421ebb6b6e --dry-run --limit 20` fails with `P1001`.
- `npm run test:ai-replay -- --client-id ef824aca-a3c9-4cde-b51f-2e421ebb6b6e --limit 20 --concurrency 3` fails with `P1001`.

## Multi-Agent Conflict Scan (2026-02-12 05:45Z)

- Last-10-phase overlap scanned: `phase-135` through `phase-144`.
- Critical collision surfaces:
  - `lib/ai-drafts.ts` and `lib/meeting-overseer.ts` (phases 139/140/141/143 all touch draft/gate semantics).
  - `lib/ai/prompt-registry.ts` (phases 135/140/141/143 touch prompt keys/overrides).
- High-risk drift surfaces:
  - Inbound pipeline contract spread across `lib/inbound-post-process/pipeline.ts` and `lib/background-jobs/*-inbound-post-process.ts` with shared `ActionSignalDetectionResult` shape changes.
  - Route propagation can be lost if any callsite re-creates signal-only payloads instead of forwarding `route`.
- Scope decision locked from this scan:
  - Smartlead/Instantly router propagation is deferred (explicitly out-of-scope for 143f-g execution).

## RED TEAM Conflict Addendum (2026-02-12)

### Highest-risk failure modes

- **Pipeline contract race:** phases `138/137/142` overlap `pipeline.ts` and background inbound processors while 143f changes `detectActionSignals` shape (`route` + `channel`).
  - Mitigation: merge/re-read inbound callsites first, then apply 143f signature changes in one pass, then run compile/test gates.
- **Hot-file overwrite in `lib/ai-drafts.ts`:** phases `138/139/140/141/143` all edit prompt/gate flow.
  - Mitigation: patch by function anchors (`buildActionSignalsPromptAppendix`, `buildActionSignalsGateSummary`), then re-run route-aware prompt assertions.
- **Prompt registry collision:** phases `140/141/143` all edit `lib/ai/prompt-registry.ts`.
  - Mitigation: add router prompt key after reconciling existing entries and verify key presence + uniqueness via `rg`.

### Dependency races / stale assumptions

- **Route-only visibility gap:** current pipeline passthrough is signal-count gated, so Process 1-3 can be dropped unless route passthrough is explicitly added.
- **Channel coverage assumption:** plan says "all inbound channels" but Smartlead/Instantly processors currently remain outside action-signal router wiring.
- **Dirty-tree integration risk:** large uncommitted change-set can silently regress route field propagation unless grep/compile checks are run immediately after merge.

### Execution ordering constraints

1. Reconcile concurrent inbound pipeline edits (`137/138/142`) on latest file state.
2. Apply 143f detector type/signature changes (`route`, `channel`, `EMPTY_ACTION_SIGNAL_RESULT` shape).
3. Reconcile `lib/ai/prompt-registry.ts` changes from `140/141`, then add `action_signal.route_booking_process.v1`.
4. Apply 143g route-aware prompt/gate tagging in `lib/ai-drafts.ts` by symbol anchors.
5. Execute 143h validation suite (including NTTAN gates) and update review evidence.

## RED TEAM Findings (2026-02-11)

### Repo Reality Verified

The following repo state was verified against plan assumptions:

| Artifact | Exists | Notes |
|----------|--------|-------|
| `lib/action-signal-detector.ts` | ✅ | Two-tier detection (heuristic + AI), `notifyActionSignals()`, `EMPTY_ACTION_SIGNAL_RESULT` constant |
| `lib/ai/prompt-registry.ts` | ✅ | `action_signal.detect.v1` registered (gpt-5-nano). No `action_signal.route_booking_process.v1` yet. |
| `lib/booking-process-templates.ts` | ✅ | Static `BOOKING_PROCESS_TEMPLATES[]` array — named templates, NOT numeric process IDs |
| `docs/notes/booking-process-5.md` | ✅ | Lead-provided scheduler link docs (capture + manual review path) |
| `components/dashboard/settings/booking-process-reference.tsx` | ✅ | Settings UI reference |
| `lib/booking-process-instructions.ts` | ✅ | Process instruction builder — not currently used as classifier |
| `runStructuredJsonPrompt` import | ✅ | Already imported in detector (line 8), used by Tier-2 disambiguation (lines 153-170) |

**Consumers of `EMPTY_ACTION_SIGNAL_RESULT` (5 files):**
- `lib/inbound-post-process/pipeline.ts` (line 350)
- `lib/background-jobs/sms-inbound-post-process.ts` (line 270)
- `lib/background-jobs/linkedin-inbound-post-process.ts` (line 238)
- `lib/background-jobs/email-inbound-post-process.ts` (line 991)
- `lib/__tests__/action-signal-detector.test.ts` (lines 106, 168)

**Consumers of `ActionSignalDetectionResult` type (2 files beyond detector):**
- `lib/ai-drafts.ts` — imported at line 55, used in `DraftGenerationOptions.actionSignals`, `hasActionSignal()`, `buildActionSignalsPromptAppendix()`, `buildActionSignalsGateSummary()`
- `lib/__tests__/action-signal-detector.test.ts` — inline constructions at lines 172, 184, 196

**Current `detectActionSignals()` signature (lines 202-209):**
```typescript
export async function detectActionSignals(opts: {
  strippedText: string;
  fullText: string;
  sentimentTag: string | null;
  workspaceBookingLink: string | null;
  clientId: string;
  leadId: string;
  disambiguate?: SignatureDisambiguationFn;
}): Promise<ActionSignalDetectionResult>
```
Note: No `channel` parameter exists. Plan 143f step 3 expects one.

**Current return paths in `detectActionSignals()` (lines 213, 245-249):**
- Early gate: `return EMPTY_ACTION_SIGNAL_RESULT;`
- Normal: `return { signals, hasCallSignal: ..., hasExternalCalendarSignal: ... };` — no `route` field

**Current test assertions:**
- Line 106: `assert.deepEqual(result, EMPTY_ACTION_SIGNAL_RESULT)` — strict shape comparison
- 13 test cases in 4 describe blocks, total 18 passing (per review.md, though file shows 13 tests in 4 blocks — discrepancy may be from sub-cases)

**Hot-file overlap (git status):**
- `lib/ai-drafts.ts` — modified by phases 135, 138, 139, 140, 141, 143
- `lib/ai/prompt-registry.ts` — modified by phases 135, 140, 141
- `lib/inbound-post-process/pipeline.ts` — modified by phase 142 (type mismatch causing build block)
- 54 modified files + 17 untracked across all active phases

**`notifyActionSignals()` Slack dedupe key format:**
```
action_signal:{clientId}:{leadId}:{messageId}:{signal.type}:slack:{channelId}
```
Route metadata must enrich the Slack payload body (not alter the key) to avoid duplicate alerts.

### Critical (2)

**C1. `EMPTY_ACTION_SIGNAL_RESULT` must include `route: null` (143f)**

The constant is defined at line 36 of `lib/action-signal-detector.ts`:
```typescript
export const EMPTY_ACTION_SIGNAL_RESULT: ActionSignalDetectionResult = {
  signals: [],
  hasCallSignal: false,
  hasExternalCalendarSignal: false,
};
```
When `ActionSignalDetectionResult` gains `route: BookingProcessRoute | null`, this constant must add `route: null`. Without it, TypeScript errors in all 5 consumer files. Additionally, the inline return at lines 245-249 constructs `{ signals, hasCallSignal, hasExternalCalendarSignal }` without `route` — this must also be updated.

**Patched in:** 143f step 1 (constant) + step 4 (return paths).

**C2. Missing NTTAN validation gates (143h)**

Phase 143f adds a new AI prompt (`action_signal.route_booking_process.v1`). Phase 143g modifies `buildActionSignalsPromptAppendix()` which injects into draft generation. Per CLAUDE.md, any change touching AI drafting/prompt behavior requires:
- `npm run test:ai-drafts` — AI behavior regression suite
- `npm run test:ai-replay -- --client-id <clientId> --dry-run --limit 20` — dry-run replay
- `npm run test:ai-replay -- --client-id <clientId> --limit 20 --concurrency 3` — live replay

None appeared in any 143f/g/h validation section. The appendix change could cause draft regressions (e.g., route-aware guidance accidentally suppressing pricing mention or availability formatting).

**Patched in:** 143h step 5 (added all 3 NTTAN commands).

### High (4)

**H1. `deepEqual` test will break on type extension (143f)**

`lib/__tests__/action-signal-detector.test.ts` line 106:
```typescript
assert.deepEqual(result, EMPTY_ACTION_SIGNAL_RESULT);
```
This is strict deep equality. When `detectActionSignals()` is gated (non-positive sentiment), it returns `EMPTY_ACTION_SIGNAL_RESULT`. If the constant is updated but `detectActionSignals()` still constructs an inline object without `route`, this test fails. Both the constant AND the inline return object at lines 245-249 must include `route`.

Additionally, lines 172, 184, 196 construct `ActionSignalDetectionResult` inline in test assertions — these will need `route: null` too.

**Patched in:** 143f step 4 (explicit call-out of both return paths + test inline constructions).

**H2. Router `runStructuredJsonPrompt` call pattern underspecified (143f)**

Plan said "Use `runStructuredJsonPrompt` with fail-safe null return" without specifying required parameters. The existing Tier-2 call (lines 153-170) shows the full pattern:
```typescript
const result = await runStructuredJsonPrompt<SignatureDisambiguationResult>({
  pattern: "structured_json",
  clientId: opts.clientId,
  leadId: opts.leadId ?? null,
  promptKey: "action_signal.detect.v1",
  featureId: "action_signal.detect",
  input: [...],
  schema: { ... },
  maxOutputTokens: ...,
});
```
Without specifying `schema` shape and `maxOutputTokens`, the implementer would need to guess values.

**Patched in:** 143f step 2 (JSON schema shape) + step 3 (full call pattern reference with `maxOutputTokens: 200`).

**H3. `detectActionSignals()` missing `channel` param (143f)**

143f step 3 says router inputs include "channel" but the current function signature (lines 202-209) has no `channel` parameter. Two approaches:
- (a) Add optional `channel?: string` to opts — requires updating 4 callers (non-breaking since optional)
- (b) Pass `channel` separately to `routeBookingProcessWithAi()` — creates split contract

Approach (a) is cleaner since all callers already have channel context available.

**Patched in:** 143f step 3 (added `channel?: "sms" | "email" | "linkedin"` to opts, noted callers already have context).

**H4. Hot-file body edit collision risk (143g)**

`lib/ai-drafts.ts` is modified by phases 139, 140, 141, and 143g. The functions 143g needs to edit:
- `buildActionSignalsPromptAppendix()` — currently lines 116-134
- `buildActionSignalsGateSummary()` — currently lines 136-151

These are function body edits, not new symbol additions. If concurrent phases reflow the file, line references become stale. Must re-read file immediately before editing and anchor to function name, not line number.

**Patched in:** 143g step 2 (explicit function names + re-read instruction).

### Medium (5)

**M1. Process 1-5 taxonomy not in prompt spec (143f)**

`lib/booking-process-templates.ts` defines named templates ("Link + Qualification", "Initial Email Times", etc.) but does NOT assign numeric Process IDs. The router prompt must define the 5-class taxonomy explicitly so the AI model can classify consistently.

**Patched in:** 143f step 2 (P1-P5 definitions added).

**M2. Model escalation to `gpt-5-mini` (143f) — RESOLVED**

Original plan specified `gpt-5-nano`. The existing Tier-2 disambiguation uses nano for binary classification, but 5-class + rationale + uncertainty flag is more complex. Human decision: use `gpt-5-mini` from the start.

**Patched in:** 143f step 2 (model changed to `gpt-5-mini`).

**M3. Test fixtures for Process 1-3 underspecified (143h)**

Process 4 (call) and Process 5 (external calendar) have clear signal patterns in existing heuristics. But distinguishing P1 (qualification needed) vs P2 (selecting offered times) vs P3 (proposing times) from message text alone is ambiguous without campaign/context metadata. Test fixtures need representative examples that encode these distinctions.

**Patched in:** 143h step 1 (representative examples for each process class).

**M4. Slack dedupe key vs route enrichment ambiguity (143g)**

Existing dedupe key: `action_signal:{clientId}:{leadId}:{messageId}:{signalType}:slack:{channelId}`. If route metadata were sent as a separate alert, dedupe would prevent it (same key). Clarified: route metadata enriches the existing notification payload body, not a separate alert.

**Patched in:** 143g step 1 (explicit clarification).

**M5. No rollback/feature-flag for router**

The router is always-on per confidence policy. No workspace-level toggle exists (unlike Phase 141's `aiRouteDraftEnabled` etc.). If router classifications are noisy in production, there's no fast disable path without a code deploy. Escalated to Open Questions (Q1).

**Escalated to:** Open Questions Q1.

**Status update (2026-02-12):** resolved. `WorkspaceSettings.aiRouteBookingProcessEnabled` was added and wired through settings actions + UI.

### Low (2)

**L1. No minimum test count target (143h)**

Baseline has 18 tests. Extension should add at least 7+ (one per process class + fail-safe + appendix routes). Set minimum target: 25+ total.

**Patched in:** 143h step 1.

**L2. Review artifact update scope unclear (143h)**

143h said "update review.md" without specifying sections. Required sections: router verification evidence, NTTAN replay results, updated success criteria mapping, residual risks.

**Patched in:** 143h output section.

**All findings patched into subphase plans (143f, 143g, 143h).**

## Phase Summary (running)

- 2026-02-12 02:39:25Z — Completed Phase 143 baseline wiring and validation (shared email + background email + SMS + LinkedIn; typed draft-context injection; detector tests; lint/build).
- 2026-02-12 02:43:07Z — Completed RED TEAM wrap-up and phase review artifact; added detector suite to global test orchestrator.
- 2026-02-12 03:13:57Z — Updated phase plan to decision-complete extension scope: hybrid AI router (1–5), notify+tag-only actioning, always-route confidence policy, minimal deterministic backstops, expanded verification gates.
- 2026-02-12 03:13:57Z — Note: existing `docs/planning/phase-143/review.md` reflects baseline subphases `a-e`; subphases `f-h` remain pending for extension completion.
- 2026-02-11 — RED TEAM review of pending subphases f-h: 2 Critical + 4 High + 5 Medium + 2 Low findings. All patched into subphase plans. Added NTTAN validation, EMPTY_ACTION_SIGNAL_RESULT update, channel param, Process taxonomy, and hot-file coordination anchors.
- 2026-02-12 04:58 UTC — Added multi-agent conflict addendum for pending subphases `f/g/h`, including phase-overlap matrix (`137/138/139/140/141/142/144`), route-only visibility risk, channel-scope gap (Smartlead/Instantly), and explicit ordering constraints for safe execution.
- 2026-02-12 05:45:07Z — Completed implementation across `f/g`: router prompt + detector route model, channel/provider callsite wiring, route-aware Slack/draft context updates, and workspace toggle plumbing (`actions/settings-actions.ts`, `components/dashboard/settings-view.tsx`, `prisma/schema.prisma`).
- 2026-02-12 05:45:07Z — Validation status: local gates pass (`action-signal-detector` targeted suite, `npm run test:ai-drafts`, `npm test`, `npm run lint`, `npm run build`); DB-dependent gates blocked by `P1001` (`db:push`, both replay commands).
