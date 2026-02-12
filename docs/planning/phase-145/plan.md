# Phase 145 — AI-First Booking Reliability, Replay Decision Track, and Process 4/5 Handoff Hardening

## Purpose

Fix booking/drafting failures in real inbound conversations by moving to an **AI-first decision contract** with strict execution semantics, then validating with a dual-track replay suite (decision extraction + outbound quality).

This phase is the dedicated follow-on to replay findings in phase 141/143 and is intentionally separate from dashboard performance work in phase 144.

## Context

Recent replay investigations exposed critical behavior gaps:

- Case `59dcfea3-84bc-48eb-b378-2a54995200d0:email`
  - Lead already qualified and gave a clear booking window.
  - Draft continued selling/re-qualification instead of booking-first handling.
- Case `bfbdfd3f-a65f-47e2-a53b-1c06e2b2bfc5:email`
  - Asked fee/frequency + provided time preferences.
  - Draft missed required pricing response behavior and proposed misaligned times.
- Case `2a703183-e8f3-4a1f-8cde-b4bf4b4197b6:email`
  - Lead provided booking-forward link intent.
  - Draft added extra pitch and wrong voice behavior instead of minimal booking handling.

Also observed:

- Replay currently focuses on draft + judge, not full booking simulation.
- Historical `max_output_tokens` occurred in prior run, but latest run class is mostly policy quality failures.
- Environment blockers have previously obscured validation (`P1001` DB connectivity, API key errors), so this phase requires stronger preflight and artifacts.

## Locked Decisions (Human Confirmed)

### Decision architecture

- Meeting extraction/booking intent/qualification extraction must be **binary yes/no** (no confidence-driven branching for extraction).
- Draft gate may still use confidence and treats low confidence as `< 0.70`.
- Deterministic logic is execution-level only after AI extraction output is present.
- Qualification source precedence: `serviceDescription` first, then knowledge assets, then transcript context when needed for tie-breaks.

### Messaging + booking behavior

- Booking-first priority: do not keep selling once the lead is ready to book.
- Do not re-qualify when already qualified.
- Pricing details: only if explicitly asked.
- Community details: only if explicitly asked.
- If lead asks to book and provides sufficient window/details, respond to their message and move booking forward directly.

### Time and timezone behavior

- Outbound time options must be displayed in **lead timezone only**.
- No mixed-zone options like `EST` for a lead-window supplied in `PST`.
- If booking flow requires timezone but cannot infer reliably, use Slack handoff with explicit `timezone_missing` reason tag.

### Process 4 / Process 5 handoff behavior

- For **Process 4** and **Process 5**:
  - Always send Slack notification.
  - Do not send outbound auto-reply to lead.
- Lead-provided scheduling link process (Process 5): Slack only.
- Phone-preference process: Slack call task with reason “call this number immediately”.
- Slack payload must support quick actions:
  - open contact in GHL
  - open contact in dashboard
- If extraction says booking intent is yes for Process 4/5 but draft-gate confidence is low, still proceed with Slack-only behavior (no outbound reply).

### Routing + notifications

- Router remains always-on by default, with explicit kill-switch support.
- Route-only visibility must not be dropped for P4/P5.
- Route-only Slack notifications are mandatory for P4/P5; non-P4/P5 route-only behavior remains configurable by notification type settings.
- Slack notifications support:
  - multiple channels
  - configured assignees (DM/mention fan-out)
  - per-notification-type toggles similar to existing notification settings
- Dedup window: 5 minutes (same lead + reason).
- No automatic escalation when unacknowledged.

### Release/quality gates

- Critical set: core 3 (`59dc`, `bfb`, `2a70`) + top 10 recent failures.
- Critical cases require both tracks to pass:
  - decision extraction track
  - outbound quality track
- Non-critical pass gate: `>= 90%`.
- Auto rollback trigger: critical failure regressions.
- Artifact retention: 30 days.
- Timezone drift alerting: enabled.

### Scope decisions

- In-scope channels for this phase: email, SMS, LinkedIn.
- Smartlead/Instantly rollout remains explicitly deferred unless added by separate scoped decision.

## Non-Goals

- No broad rewrite of unrelated dashboard performance/UI systems.
- No replacement of existing booking engine semantics outside scoped P4/P5/process-orchestration changes.
- No hidden deterministic overrule before AI extraction output is produced.

## Concurrent Phases / Coordination

| Phase | Status | Overlap | Coordination |
|-------|--------|---------|--------------|
| 141 | Active history / partial gates | replay harness, route skip observability, ai-drafts | Preserve prior replay artifacts and skip telemetry semantics. |
| 142 | Active | qualification queue and confidence policy | Align with extraction-vs-gate split (binary extraction + confidence gate). |
| 143 | Active | process router + signal detector + Slack surfacing | Reconcile route-only notification semantics and process 4/5 behavior. |
| 144 | Active | docs and settings surfaces | Do not mix performance scope into this phase. |

## Supersession Matrix (Authoritative in 145)

| Prior Phase Policy | 145 Decision | Effect |
|--------------------|--------------|--------|
| 143 route-only alerts mostly signal-driven | P4/P5 route-only notifications are mandatory | Prevents silent high-priority handoff drops |
| 143 notify+tag-only without explicit P4/P5 outbound suppression | P4/P5 are Slack-only handoff with no lead auto-reply | Removes conflicting auto-generated outbound during human handoff |
| Legacy dedupe keyed by message/signal/channel | 145 introduces lead+reason 5-minute dedupe for handoff notifications | Requires migration-safe transition to avoid spam/over-suppression |

## Toggle and Kill-Switch Precedence

From highest to lowest precedence:

1. Global emergency kill switch for 145 routing/notification handoff.
2. Workspace-level 145 routing/notification kill switch.
3. Phase-143 router toggle (`aiRouteBookingProcessEnabled`).
4. Phase-141 draft/step gates (`draftGenerationEnabled`, `draftGenerationStep2Enabled`, `draftVerificationStep3Enabled`, `meetingOverseerEnabled`).
5. Default route execution behavior.

If any higher-precedence switch disables a path, lower-level toggles cannot re-enable it.

## Objectives

- [x] Implement AI decision contract v1 (binary extraction fields + evidence anchors).
- [ ] Enforce extraction/gate split: binary extraction vs confidence-based draft gate.
- [ ] Implement booking-first orchestration path for qualified booking intent.
- [ ] Implement timezone-safe option rendering (lead timezone only).
- [x] Implement nearest-slot fallback policy:
  - exact match preferred,
  - if nearest is within +15 minutes after suggested time: auto-hold + confirm,
  - otherwise offer nearest two options.
- [ ] Implement Process 4/5 Slack-only behavior (no outbound auto-reply).
- [ ] Implement phone handoff Slack task payload with GHL/dashboard quick-action links.
- [ ] Implement multi-channel + assignee notification fan-out with type toggles.
- [ ] Add route/notification kill switches (workspace + global).
- [ ] Extend replay to dual-track execution (decision + outbound) with explicit failure classes.
- [x] Add preflight checks for DB/API/key health before replay runs.
- [x] Update phase-skill workflows (especially phase-review) to require this suite for AI messaging changes.

## AI Decision Contract v1 (Required Interface)

```json
{
  "isQualified": "yes|no",
  "hasBookingIntent": "yes|no",
  "shouldBookNow": "yes|no",
  "leadTimezone": "IANA|null",
  "leadProposedWindows": ["normalized window objects"],
  "needsPricingAnswer": "yes|no",
  "needsCommunityDetails": "yes|no",
  "responseMode": "booking_only|info_then_booking|clarify_only",
  "evidence": ["short, source-grounded citations from transcript/assets"]
}
```

Rules:

- No confidence fields for extraction outputs.
- Schema-invalid or missing required fields = extraction failure.
- One bounded repair attempt allowed; else classify as `decision_error`.

## Execution Semantics (Post-Extraction)

1. Run extraction contract.
2. If `responseMode=booking_only` and `shouldBookNow=yes`:
   - execute booking selection policy,
   - send booking confirmation only (unless process 4/5 Slack-only path applies).
3. If Process 4/5:
   - Slack notification only,
   - no lead auto-reply.
4. If `needsPricingAnswer=yes`:
   - include pricing response (cadence-aligned per existing pricing safety constraints).
5. If `needsCommunityDetails=yes`:
   - include concise details only if requested.
6. Never re-qualify when `isQualified=yes`.

### Process-specific override

- Process 4/5 are terminal handoff modes for auto-reply:
  - emit Slack notification payload,
  - suppress outbound lead reply,
  - include route + reason tags (`call_immediate`, `lead_link_handoff`, `timezone_missing` as applicable).

## Edge Case Matrix (Must Cover)

### Booking intent / qualification

- Lead is already qualified and proposes a window.
- Lead qualifies and asks pricing in same message.
- Lead asks to book but includes unrelated marketing copy.
- Lead gives vague “next week” without timezone.
- Lead gives conflicting windows in one message.

### Timezone / scheduling

- Lead timezone inferred from body text.
- Lead timezone inferred from CRM/Bison/GHL vars.
- Timezone missing/ambiguous.
- Suggested times cross DST boundary.
- Suggested time in past by the time job runs.
- Nearest slot falls +10m after requested (auto-hold path).
- Nearest slot falls +25m after requested (offer-two path).

### Process 4/5 and routing

- Route-only classification with zero action signals.
- Lead-provided scheduler link in body.
- Scheduler link in signature only.
- Phone number present + explicit call preference.
- High-priority P4/P5 notification dedup collision.

### Replay / validation / ops

- Judge truncation (`max_output_tokens`) regression.
- Invalid API key / auth failure.
- DB connectivity (`P1001`) during replay.
- Empty case selection due filters.
- Critical-case pass but non-critical rate below 90%.

## Known Weak Spots and Mitigations

1. **Extraction/gate drift across phases (142 vs 145 contract)**
- Mitigation: formal contract docs + schema validation + migration notes in phase-review.

2. **Route-only metadata drop in pipelines**
- Mitigation: explicit route propagation checks and tests where `signals.length=0`.

3. **Process 4/5 accidental outbound replies**
- Mitigation: hard execution gate + test assertions that outbound is suppressed.

4. **Timezone mismatch output**
- Mitigation: lead-TZ-only formatter + drift alert + replay assertion.

5. **Notification noise/spam**
- Mitigation: 5-minute dedup key and notification-type selectors.

6. **Environment-dependent false negatives in replay**
- Mitigation: preflight checks and classify as infra errors, not model-quality failures.

7. **Cross-phase policy drift (`binary extraction` vs older `confidence >= 0.7` disqualification semantics)**
- Mitigation: document split explicitly in code and phase-review checks:
  - extraction contract stays binary,
  - confidence remains gate-only where already designed (draft gate, disqualification confidence paths).

8. **Route-only pipeline drop from signal-count gating**
- Mitigation: ensure downstream payload pass-through conditions include `route != null` even when `signals.length === 0`.

9. **Process #5 behavior ambiguity across historical docs**
- Mitigation: enforce single-source policy in this phase (`Slack-only, no lead auto-reply`) and reference this phase from phase-review.

10. **Notification operations drift (missing channels/assignees/type toggles)**
- Mitigation: add config validation checks and UI persistence tests for multi-channel + assignee fan-out.

## Validation and Acceptance

### Required command gates

- `npm run lint`
- `npm run build`
- `npm run test`
- `npm run test:ai-drafts`
- `npm run test:ai-replay -- --mode both --critical-cases <core3+top10>` (or equivalent command once implemented)
- `npm run test:ai-replay -- --mode both --thread-ids-file docs/planning/phase-145/replay-case-manifest.json`

### Pass criteria

- Core 3 + top 10 critical: all pass both tracks.
- Non-critical suite: `>= 90%` pass.
- No timezone drift violations on booking-mode outputs.
- Process 4/5 cases produce Slack notifications and no outbound auto-reply.

## Rollout and Rollback

### Rollout

1. Deploy behind feature flags.
2. Shadow run decision track for selected workspaces.
3. Enable outbound track after critical-case pass in pre-prod.
4. Enable production workspace-by-workspace.

### Rollback trigger

- Any critical-case regression in production replay or monitoring triggers immediate feature disable via kill switch.

## Blocker Register

| Blocker Class | Signature | Impact | Mitigation | Unblock Command |
|---------------|-----------|--------|------------|-----------------|
| DB connectivity | `P1001` | Replay unavailable | Validate env/network path and DB host reachability | `npm run test:ai-replay -- --client-id <id> --dry-run --limit 20` |
| Auth/API key | 401 / invalid key | Judge/replay unavailable | Refresh runtime API key | `npm run test:ai-replay -- --client-id <id> --dry-run --limit 20` |
| Schema drift | `P2022` | Live replay generation fails | Sync DB schema used by replay runtime | `npm run db:push` then rerun both replay commands |
| Empty selection | 0 candidates | No quality signal | Use canonical replay client and/or explicit thread-id manifest | `npm run test:ai-replay -- --mode both --thread-ids-file docs/planning/phase-145/replay-case-manifest.json` |

## Subphase Index

- a — Decision Contract + Prompt/Schema Hardening (binary extraction)
- b — Booking Orchestration + Timezone/Nearest-Slot Execution Rules
- c — Process 4/5 Slack-Only Handoff + Notification Fan-Out + Kill Switches
- d — Replay Dual-Track Expansion + Infra Preflight + Artifact Model
- e — Phase Skill / Review Workflow Hardening (Codex + Claude parity)
- f — Verification Packet, Release Gate Execution, and Review Closure

## Repo Reality Check (RED TEAM)

### What exists today

| File | Lines | Key Exports | Phase 145 Role |
|------|-------|-------------|----------------|
| `lib/meeting-overseer.ts` | 592 | `MeetingOverseerExtractDecision` (20 fields), `runMeetingOverseerExtraction`, `runMeetingOverseerGate` | Existing extraction contract — consumed by new decision contract |
| `lib/action-signal-detector.ts` | 650 | `BookingProcessRoute`, `ActionSignalDetectionResult`, `notifyActionSignals`, 5-process taxonomy | Existing routing + notification infra — extended by P4/P5 handoff |
| `lib/ai-drafts.ts` | 3896 | `generateResponseDraft`, `buildActionSignalsPromptAppendix`, pricing safety | **6-phase hot spot** (135,138,139,140,141,143) — minimize direct edits |
| `lib/followup-engine.ts` | 2754+ | `AutoBookingContext` (12 fields), `AutoBookingMatchStrategy`, `processMessageForAutoBooking` | Existing booking orchestration — integrate nearest-slot policy |
| `lib/booking.ts` | 586 | `bookMeetingForLead`, `storeOfferedSlots`, dual-write atomic | Booking execution — consumed by orchestration |
| `lib/timezone-inference.ts` | 490 | `ensureLeadTimezone`, 5-strategy inference chain | Timezone resolution — consumed by TZ-safe rendering |
| `lib/availability-distribution.ts` | 140 | `selectDistributedAvailabilitySlots`, TZ-aware business hours | Slot distribution — consumed by nearest-slot policy |
| `lib/inbound-post-process/pipeline.ts` | 522 | `runInboundPostProcessPipeline`, 17 linear stages | Pipeline integration — add P4/P5 conditional checks |
| `lib/ai/route-skip-observability.ts` | 50+ | `recordAiRouteSkip`, telemetry for disabled routes | Route-skip telemetry — reuse for P4/P5 suppression logging |
| `lib/notification-center.ts` | — | `notifyOnLeadSentimentChange`, sentiment routing, dedup | Existing notification infra — extend for P4/P5 types |
| `lib/ai-replay/` | 7 files | `runReplayCase`, `runReplayJudge`, case selection, CLI, types | Replay framework — extend to dual-track |

### Contract relationship: new AIDecisionContractV1 vs. existing contracts

The new `AIDecisionContractV1` is an **orchestration-layer contract** that consumes outputs from:
- `MeetingOverseerExtractDecision` → feeds `hasBookingIntent`, `shouldBookNow`, `leadTimezone`, `leadProposedWindows`
- `ActionSignalDetectionResult` → feeds process routing (P4/P5 detection)
- `AutoBookingContext` → feeds `isQualified` determination

It does **not** replace these contracts. It composes them into a unified decision structure with binary extraction fields. Downstream consumers (`generateResponseDraft`, pipeline stages) read from the composed contract.

### What the plan requires but doesn't exist yet

- `AIDecisionContractV1` type → new file: `lib/ai/decision-contract.ts`
- `responseMode` concept → new field consumed by draft generation path
- P4/P5 conditional branching in pipeline → add pre-draft-generation gate
- Per-notification-type toggles for P4/P5 → new WorkspaceSettings fields
- Multi-channel assignee fan-out config → new WorkspaceSettings fields
- Dual-track replay mode → extend `lib/ai-replay/` types + runner

## RED TEAM Findings (Gaps / Weak Spots)

### Highest-risk failure modes

1. **New contract vs. existing contracts — integration undefined** → Fixed above: orchestration layer model documented. 145a must implement composition, not replacement.
2. **`responseMode` has no mapping to draft generation** → 145a/145b must specify exact integration point (new parameter to `generateResponseDraft()` or pre-draft gate).
3. **`lib/ai-drafts.ts` 6-phase hot spot** → Factor new logic into `lib/ai/decision-contract.ts` to minimize merge surface. Read file state before every edit.
4. **Pipeline is linear — no conditional branching** → 145c must add P4/P5 check before `draft_generation` stage using existing `shouldGenerateDraft()` pattern or new gate.
5. **"Feature flags" infrastructure doesn't exist** → Use workspace toggles + env-var kill switches (existing pattern).

### Missing infrastructure

6. `notifyActionSignals()` (line 555, `lib/action-signal-detector.ts`) already sends Slack notifications → 145c builds on this, not from scratch.
7. `recordAiRouteSkip()` (`lib/ai/route-skip-observability.ts`) → reuse for P4/P5 suppression telemetry.
8. Phase 141 toggle fields (`draftGenerationEnabled`, etc.) in WorkspaceSettings → new kill switches must be additive.
9. Notification dedup uses `NotificationEvent.dedupeKey` with configurable window → P4/P5 5-minute window is a per-type override.

### Schema migration needed

- New WorkspaceSettings fields for P4/P5 notification config, kill switches
- Explicit `npm run db:push` step required in 145c

### NTTAN validation required

All subphases touching AI/message behavior (145a, 145b, 145c) must include:
- `npm run test:ai-drafts`
- `npm run test:ai-replay -- --client-id <clientId> --dry-run --limit 20`
- `npm run test:ai-replay -- --client-id <clientId> --limit 20 --concurrency 3`

## External Blockers (Tracked)

- Replay commands can fail from environment DB/API issues (`P1001`, auth).
- These must be classified distinctly from model-quality failures.

## Phase Summary (running)

- 2026-02-12 — Created phase-145 from investigation + user policy lock session.
- Sources incorporated:
  - replay artifacts for core cases,
  - cross-phase scans across phases 115–144,
  - explicit user decisions on extraction/gating/process4-5/notifications/release gates.
- 2026-02-12 06:26 UTC — Implemented subphase 145a contract foundation: added `AIDecisionContractV1` derivation/validation/repair module and wired contract attachment into meeting overseer extraction return path. Added contract tests and test-orchestrator registration; local quality gates passed (`lint`, `build`, `test`, `test:ai-drafts`). NTTAN live replay remains partially blocked by `P2022` column-not-found mismatch for client `ef824...`; replay client `29156...` has zero selectable messages. (files: `lib/ai/decision-contract.ts`, `lib/meeting-overseer.ts`, `lib/__tests__/ai-decision-contract.test.ts`, `scripts/test-orchestrator.ts`, `docs/planning/phase-145/a/plan.md`)
- 2026-02-12 06:26 UTC — Ran phase-145 RED TEAM gap pass and patched decision-completeness gaps: added supersession matrix (143→145 policy overrides), kill-switch precedence, deterministic replay manifest (`docs/planning/phase-145/replay-case-manifest.json`), blocker register, P4/P5 execution wording fixes, dedupe migration note, coordination pre-flight checklists (145b/c/d), mandatory NTTAN commands in 145d, and explicit closure states in 145f. (files: `docs/planning/phase-145/plan.md`, `docs/planning/phase-145/replay-case-manifest.json`, `docs/planning/phase-145/c/plan.md`, `docs/planning/phase-145/d/plan.md`, `docs/planning/phase-145/b/plan.md`, `docs/planning/phase-145/f/plan.md`, `docs/planning/phase-145/review.md`)
- 2026-02-12 06:47 UTC — Implemented 145b/145d/145e partials: (1) follow-up booking now consumes `decision_contract_v1` fields as primary booking/qualification/timezone authority with fail-closed behavior on contract errors, plus nearest-slot policy update (`+15m` auto-hold-after and `+25m` nearest-two fallback offers); (2) replay runner gained schema/API preflight checks, `--thread-ids-file` manifest mode, richer artifact diagnostics (`judgePromptKey`, `judgeSystemPrompt`, `failureType`), and larger adaptive judge budgets; (3) workflow docs + Codex/Claude skill parity updated for manifest-driven NTTAN gates. Validation: `lint` pass, `build` pass, `test` pass, `test:ai-drafts` pass, replay dry-run pass with explicit schema-drift warning, replay live-run blocked fast by preflight schema drift. (files: `lib/followup-engine.ts`, `lib/ai-drafts.ts`, `lib/meeting-overseer.ts`, `lib/ai-replay/*`, `scripts/live-ai-replay.ts`, `lib/ai-replay/__tests__/cli.test.ts`, `AGENTS.md`, `CLAUDE.md`, `/Users/AR180/.codex/skills/{phase-review,phase-gaps,terminus-maximus}/SKILL.md`, `/Users/AR180/.claude/skills/{phase-review,phase-gaps,terminus-maximus}/SKILL.md`)
- 2026-02-12 07:05 UTC — Cleared replay infra blocker and ran live model generations on the critical manifest: `npm run db:push` succeeded against `db.pzaptpgrcezknnsfytob.supabase.co`, then live replay executed (no P1001/P2022) with artifacts at `run-2026-02-12T06-51-35-686Z.json`, `run-2026-02-12T07-00-06-514Z.json`, and `run-2026-02-12T07-03-11-855Z.json`. Added timezone robustness by prioritizing explicit inbound timezone over stale lead timezone and loading latest inbound text when trigger message context is missing; strengthened booking-first/scheduling-only and explicit-question coverage in draft + overseer prompts. Outcome improved from `passed=2/8` to `passed=3/7` evaluated, including core case `2a70...` now passing; `59dc...` and `bfb...` remain open for stricter scheduling-window + required-pricing/qualification phrasing enforcement. (files: `lib/timezone-inference.ts`, `lib/ai-drafts.ts`, `lib/meeting-overseer.ts`)
