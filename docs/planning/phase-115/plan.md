# Phase 115 - Auto-Send Revision Agent (Confidence-Driven + Auto-Optimized Context)

## Purpose
Add a bounded "revision agent" to the AI auto-send path: when the evaluator confidence is below the configured threshold, automatically diagnose why, select the most relevant optimization learnings ("what worked" / "what failed"), revise the draft under our safety rules, then re-evaluate once before deciding to send vs route to human review.

## Context
- Today the AI auto-send flow is: generate draft -> `auto_send.evaluate.v1` -> if confidence >= threshold then send (or schedule delayed send); else `needs_review` + Slack DM.
- We already have:
  - A proven "revise or approve" pattern for scheduling replies (`meeting.overseer.gate.v1` can return `decision="revise"` with `final_draft`).
  - Workspace-scoped "what worked / what failed" artifacts via:
    - Message Performance synthesis (stored in an `InsightContextPack` session titled "Message Performance")
    - Insights Chat context packs (stored as `InsightContextPack.synthesis.pack_markdown`, follow-up weighted)
- Missing: a dedicated auto-send revision loop that uses evaluator feedback + these learnings to attempt a better draft before escalating to human review.
- Requirement from user: the revision should use "agentic search" to select only the most relevant parts of the packs to the current lead/draft, rather than stuffing entire packs into the prompt.

## Concurrent Phases
Phases 112-114 are all committed to `main` (commits `c681af1`, `0841635`, `72ca136`). No uncommitted changes exist. Phase 115 builds on stable infrastructure.

| Phase | Status | Overlap | Coordination |
|-------|--------|---------|--------------|
| Phase 114 | Shipped (`c681af1`) | AI Ops feed + Admin Dashboard | Add new featureIds to AI Ops visibility (no raw text); do not refactor Admin UI. |
| Phase 112 | Shipped (`72ca136`) | LeadContextBundle + Prompt runner metadata + AIInteraction policy | Reuse stats-only metadata patterns; no PII in telemetry. |
| Phase 107 | Shipped | Auto-send evaluator input/context injection | Do not bump `auto_send.evaluate.v1`; reuse existing evaluator input builder. |
| Phase 108 | Shipped | Message Performance packs + Insights context packs | Consume existing persisted packs. |

## Repo Reality Check (RED TEAM — Phase 115)

### Verified Touch Points
| Reference | Location | Status |
|-----------|----------|--------|
| `evaluateAutoSend()` | `lib/auto-send-evaluator.ts:186` | Exists, returns `{ confidence, safeToSend, requiresHumanReview, reason }` |
| `executeAutoSend()` | `lib/auto-send/orchestrator.ts:599` | Exists, factory pattern via `createAutoSendExecutor(deps)` |
| `AutoSendEvaluation` type | `lib/auto-send-evaluator.ts:12-17` | Exists — **no** `source`/`hardBlockCode` yet (new work) |
| Hard-block early returns | `lib/auto-send-evaluator.ts:203-248` | 5 blocks: empty draft, opt-out, blacklist, automated reply, missing key |
| `InsightContextPack` model | `prisma/schema.prisma:750` | Exists with `synthesis Json?`, `sessionId`, `status` |
| `InsightsChatSession` model | `prisma/schema.prisma:707` | Exists — **`title` is on Session, not Pack** |
| `MessagePerformanceSynthesis` type | `lib/message-performance-synthesis.ts:9-22` | Fields: summary, highlights, patterns, antiPatterns, recommendations, caveats, confidence |
| `MESSAGE_PERFORMANCE_SESSION_TITLE` | `lib/message-performance-report.ts:8` | Constant to reuse for session lookup |
| `InsightContextPackSynthesis` type | `lib/insights-chat/pack-synthesis.ts:24-29` | Has `pack_markdown`, `key_takeaways[]`, `recommended_experiments[]`, `data_gaps[]` |
| Prompt runner | `lib/ai/prompt-runner/runner.ts` | Exports `runStructuredJsonPrompt`, supports reasoningEffort |
| `gpt-5-mini` model | `lib/auto-send-evaluator.ts:343` | Active in evaluator |
| `AIDraft` model | `prisma/schema.prisma:1167` | Has `autoSendConfidence`, `autoSendAction`, `autoSendReason` — **no** revision fields yet |
| AI Ops feed | `actions/ai-ops-feed-actions.ts:28-36` | `AI_OPS_FEATURE_IDS` array, trivially extensible |
| `LeadContextBundle` (Phase 112) | `lib/lead-context-bundle.ts` | Exports `buildLeadContextBundle()`, token budgets, profile types |
| `AutoSendDependencies` (DI interface) | `lib/auto-send/orchestrator.ts:60-72` | All external functions injected; revision agent must be added here |

### Mismatches Found & Fixed
| Issue | Plan Said | Reality | Fix |
|-------|-----------|---------|-----|
| Email webhook inline auto-send | 115c Work Item 3: "Replace inline auto-send in `app/api/webhooks/email/route.ts`" | Webhook was refactored in Phase 35. Dead code in block comment. Active auto-send runs via `EMAIL_INBOUND_POST_PROCESS` background job which already calls `executeAutoSend()` | **Remove 115c Work Item 3 entirely** |
| InsightContextPack title lookup | "InsightContextPack in a session titled 'Message Performance'" | `title` is on `InsightsChatSession`, not `InsightContextPack`. Lookup = session-by-title then pack-by-sessionId | Fixed in 115a plan |
| Chunking from `pack_markdown` | "split `pack_markdown` by Markdown headings" | `pack_markdown` (up to 20K chars) may contain PII via `evidence_quotes`. Structured fields are PII-safer | Use `key_takeaways[]`, `recommended_experiments[]`, `data_gaps[]` only; skip raw `pack_markdown` for v1 |
| Missing `highlights[]` in chunking | "what_worked from patterns + recommendations" | `MessagePerformanceSynthesis` also has `highlights[]` (key wins) and `summary` | Include `highlights` + `summary` in chunking |

## RED TEAM Findings Summary

| ID | Severity | Finding | Fix |
|----|----------|---------|-----|
| RT-01 | **CRITICAL** | 115c Work Item 3 (email webhook refactor) is moot — already uses `executeAutoSend()` via background jobs | Remove work item; revision auto-propagates via orchestrator |
| RT-06 | HIGH | Revision agent must integrate into DI factory (`AutoSendDependencies`) | Add `maybeReviseAutoSendDraft` to deps interface |
| RT-09 | HIGH | Revised draft must be persisted to `AIDraft.content` in DB BEFORE `approveAndSendDraftSystem()` reads it | DB update → context update → threshold check → send |
| RT-10 | HIGH | 4 sequential LLM calls (eval + selector + revise + re-eval) can take 60s+; starves job queue | 10s timeout per new prompt; 35s aggregate revision-path timeout |
| RT-12 | HIGH | Insights `pack_markdown` may contain PII (evidence quotes) | Use only structured fields for v1; skip raw `pack_markdown` |
| RT-17 | HIGH | AIDraft lacks revision tracking fields | Add `autoSendRevised Boolean`, `autoSendOriginalConfidence Float?` to schema |
| RT-13 | MEDIUM | Prompt injection risk via `latestInbound` in revision prompt | Add explicit anti-injection system instruction |
| RT-14 | MEDIUM | Kill-switch check location unspecified | Check at top of `maybeReviseAutoSendDraft()`, not orchestrator |
| RT-15 | MEDIUM | Adding DI dep breaks 12+ existing orchestrator tests | Add `createDefaultMocks()` helper to test file |
| RT-19/20 | MEDIUM | `AutoSendEvaluation` type changes must be backward-compatible | Make `source`, `hardBlockCode` optional with defaults |

## Open Questions (Need Human Input)

### Q1: Skip `pack_markdown` chunking for v1?
**Why it matters:** Raw `pack_markdown` may contain PII. Using only structured fields is safer but less granular.
**Assumption (90%):** Yes, skip for v1. Enable with PII scrubber in future phase.

### Q2: AIDraft schema fields for revision tracking?
**Why it matters:** Without them, operators can't distinguish "sent after revision" from "sent on first eval" in dashboard.
**Assumption (95%):** Yes, add `autoSendRevised` and `autoSendOriginalConfidence`.

### Q3: Aggregate timeout for revision path?
**Why it matters:** Background job cron has 240s budget. 4 LLM calls can take 60s+ worst-case.
**Assumption (90%):** 35s aggregate. Any timeout → fail-closed to needs_review.

## Objectives
* [ ] Add context retrieval + "agentic selection" (Message Performance + Insights pack) for a single auto-send attempt.
* [ ] Add revision prompt + orchestration helper (revise -> re-evaluate once).
* [ ] Integrate into auto-send execution paths (orchestrator only — email webhook already uses `executeAutoSend` via background jobs), fail-closed, bounded, and telemetry-safe.
* [ ] Add unit tests and verify `npm test`, `npm run lint`, `npm run build`.

## Constraints
- Scope: **AI_AUTO_SEND only** (campaign mode). No changes to LEGACY_AUTO_REPLY.
- Trigger: **evaluator confidence < threshold** (and only when evaluator is model-based, not hard safety blocks).
- Bounded loop:
  - max 1 context-select call
  - max 1 revise call
  - max 1 re-eval call (reusing existing evaluator)
- PII hygiene:
  - never store raw inbound text, conversation history, or draft content in `AIInteraction.metadata`
  - telemetry is stats-only (counts, booleans, token sizes, confidence deltas)
- Keep existing prompt keys stable; add new prompt keys for selector/reviser.
- Fail closed: any selector/reviser failure falls back to existing `needs_review` behavior (Slack DM + dashboard review).

## Success Criteria
1. When `auto_send.evaluate.v1` returns `confidence < threshold` (and not a hard safety block), the system attempts a single revision and then re-evaluates:
   - if revised confidence >= threshold (and safe), proceed with existing send/schedule logic
   - else fall back to `needs_review`
2. Revised draft content is persisted only when it demonstrably improves quality:
   - prefer `revised_confidence > original_confidence` as the primary criterion
   - never persist an empty/invalid revision
3. Operators can see revision activity in the Admin "AI Ops (Last 3 Days)" feed without raw text exposure (event-only visibility).
4. Unit tests cover: trigger gating, hard-block bypass, confidence-delta persistence rule, and "max one revision" behavior.

## Subphase Index
* a - Context sources + agentic selector prompt
* b - Revision prompt + orchestration helper
* c - Integration into auto-send paths + telemetry + tests + AI Ops visibility

