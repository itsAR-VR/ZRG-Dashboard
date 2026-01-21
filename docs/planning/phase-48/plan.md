# Phase 48 — Auto-Send Architecture Consolidation

## Purpose

Consolidate the duplicated auto-send/auto-reply decision logic from 4 background job files into a single, testable orchestration layer. This eliminates ~400 lines of duplicated code, improves maintainability, enables unit testing, and creates a foundation for future auto-send modes.

## Context

### Current State Analysis

The codebase has **two distinct auto-send systems** that evolved independently:

1. **EmailCampaign AI_AUTO_SEND Mode** (Modern, Phase ~40+)
   - Activated when `lead.emailCampaign.responseMode === "AI_AUTO_SEND"`
   - Uses `evaluateAutoSend()` from `lib/auto-send-evaluator.ts`
   - Returns `{ confidence: number, safeToSend: boolean, reason: string }`
   - Supports configurable confidence thresholds per campaign
   - Has delay scheduling (Phase 47l)
   - Sends Slack notifications for low-confidence drafts

2. **Legacy Per-Lead Auto-Reply** (Original system)
   - Activated when `!emailCampaign && lead.autoReplyEnabled === true`
   - Uses `decideShouldAutoReply()` from `lib/auto-reply-gate.ts`
   - Returns `{ shouldReply: boolean, reason: string }`
   - Simpler boolean decision (no confidence scoring)
   - No delay scheduling support

### Precedence Contract (Not DB-Enforced)

The systems are mutually exclusive by **code-path precedence**, not by database constraints:
```
IF emailCampaign exists AND responseMode === "AI_AUTO_SEND"
  → Use EmailCampaign evaluator path
ELSE IF !emailCampaign AND autoReplyEnabled === true
  → Use legacy per-lead path
ELSE
  → No auto-send (draft only)
```

Important nuance (current behavior): if an `emailCampaign` exists but its `responseMode` is not `"AI_AUTO_SEND"` (e.g. `SETTER_MANAGED` or `null`), we **do not** fall back to legacy per-lead auto-reply even if `autoReplyEnabled === true`.

This precedence contract is **implicit** (scattered across 4 files) and not enforced at a single point.

### The Duplication Problem

The auto-send decision tree is **copy-pasted across 4 background job files**:

| File | Lines | Notes |
|------|-------|-------|
| `lib/background-jobs/email-inbound-post-process.ts` | 936-1057 | ~120 lines of auto-send logic |
| `lib/background-jobs/sms-inbound-post-process.ts` | 264-382 | ~118 lines (nearly identical) |
| `lib/background-jobs/smartlead-inbound-post-process.ts` | 280-395 | ~115 lines |
| `lib/background-jobs/instantly-inbound-post-process.ts` | 285-398 | ~113 lines |

**Total duplicated code: ~465 lines**

### Issues This Causes

1. **Maintenance burden**: Any change to auto-send logic requires updating 4 files identically
2. **Divergence risk**: Files can drift out of sync (e.g., one file gets a bug fix, others don't)
3. **Testing impossibility**: Logic is embedded in large async job functions, making unit tests impractical
4. **Hidden business rules**: The mutual exclusion contract is implicit and undocumented
5. **No single source of truth**: Understanding "how does auto-send work?" requires reading 4 files
6. **Phase 47l complexity**: Delay scheduling added more conditionals, increasing duplication

### Existing Infrastructure (What We Keep)

| Component | File | Purpose | Status |
|-----------|------|---------|--------|
| `evaluateAutoSend()` | `lib/auto-send-evaluator.ts` | AI confidence scoring | ✅ Keep as-is |
| `decideShouldAutoReply()` | `lib/auto-reply-gate.ts` | Legacy boolean decision | ✅ Keep as-is |
| `scheduleDelayedAutoSend()` | `lib/background-jobs/delayed-auto-send.ts` | Delay scheduling | ✅ Keep as-is |
| `validateDelayedAutoSend()` | `lib/background-jobs/delayed-auto-send.ts` | Pre-send validation | ✅ Keep as-is |
| `runAiAutoSendDelayedJob()` | `lib/background-jobs/ai-auto-send-delayed.ts` | Delayed job executor | ✅ Keep as-is |
| `approveAndSendDraftSystem()` | `actions/message-actions.ts` | Final send action | ✅ Keep as-is |

## Concurrent Phases

| Phase | Status | Overlap | Coordination |
|-------|--------|---------|--------------|
| Phase 47 | ⚠️ Active/dirty in current working tree | All 4 background job files, `delayed-auto-send.ts` | Pre-flight: ensure Phase 47l delayed auto-send changes are committed/merged on the base branch before consolidating |
| Phase 46 | Unknown (working tree has changes) | `lib/ai-drafts.ts` | No direct overlap, but requires coordination if merging to a clean base branch |
| Phase 45 | Unknown | None | No overlap |

## Repo Reality Check (RED TEAM)

- What exists today:
  - Duplicated auto-send logic lives in:
    - `lib/background-jobs/email-inbound-post-process.ts`
    - `lib/background-jobs/sms-inbound-post-process.ts`
    - `lib/background-jobs/smartlead-inbound-post-process.ts`
    - `lib/background-jobs/instantly-inbound-post-process.ts`
  - Delay scheduling helpers exist (Phase 47l), but are currently present as **uncommitted** working tree files:
    - `lib/background-jobs/delayed-auto-send.ts`
    - `lib/background-jobs/ai-auto-send-delayed.ts`
  - `CampaignResponseMode` in `prisma/schema.prisma` is **only**: `SETTER_MANAGED | AI_AUTO_SEND` (no `"DRAFT_ONLY"`).
  - There is **no** configured unit test runner/script in `package.json` today (`npm run test` / `test:coverage` do not exist).
- What the plan assumes (needs tightening):
  - Phase 47 is “Complete / no conflict” (this is not true in the current working tree).
  - “Mutually exclusive by database design” (it’s precedence-based, not enforced by DB constraints).
  - A unit test runner and coverage gating exist (they do not; see Open Questions + new subphase h).
- Verified touch points:
  - `lib/auto-send-evaluator.ts`: `evaluateAutoSend()` (returns `{ confidence, safeToSend, requiresHumanReview, reason }`)
  - `lib/auto-reply-gate.ts`: `decideShouldAutoReply()`
  - `lib/background-jobs/delayed-auto-send.ts`: `getCampaignDelayConfig()`, `scheduleDelayedAutoSend()`, `validateDelayedAutoSend()`
  - `actions/message-actions.ts`: `approveAndSendDraftSystem()`
  - `lib/slack-dm.ts`: `sendSlackDmByEmail()`
  - `lib/app-url.ts`: `getPublicAppUrl()`

## Pre-Flight Conflict Check

- [ ] Ran `git status --porcelain` and confirmed no unexpected modifications to files this phase will touch
- [ ] Confirmed Phase 47l delay scheduling files are present **and committed** on the base branch (or explicitly decided to bundle Phase 47l + Phase 48)
- [ ] Confirmed `CampaignResponseMode` values and updated docs/tests accordingly (`SETTER_MANAGED` vs `"DRAFT_ONLY"`)
- [ ] Confirmed test harness approach for “>90% coverage” (see subphase h)

## Objectives

* [ ] Create a unified `AutoSendOrchestrator` that encapsulates the complete decision tree
* [ ] Extract common types and interfaces into a shared module
* [ ] Replace duplicated logic in all 4 background job files with calls to the orchestrator
* [ ] Add comprehensive unit tests for the orchestrator
* [ ] Document the mutual exclusion contract explicitly
* [ ] Add observability logging for which path was taken
* [ ] Ensure delay scheduling works correctly through the orchestrator
* [ ] Verify Slack notification behavior is preserved

## Constraints

- **No behavior changes**: This is a pure refactor; all existing behavior must be preserved exactly
- **Backward compatible**: Existing job parameters and signatures remain unchanged
- **Incremental migration**: Can update one job file at a time if needed
- **Test coverage required**: Orchestrator must have >90% line coverage before merging
- **No new runtime dependencies**: Use existing patterns and libraries at runtime
  - Dev-only test dependencies are allowed to satisfy coverage gating (Vitest + coverage) (Decision: 2026-01-21)
- **Preserve telemetry**: AIInteraction attribution must work identically

## Success Criteria

- [ ] All 4 background job files use the shared orchestrator
- [ ] Total lines of auto-send logic reduced from ~465 to <100 (across all jobs)
- [ ] `npm run lint` passes
- [ ] `npm run build` passes
- [ ] Unit tests exist for orchestrator with >90% coverage (and there is a runnable `npm` script for this)
- [ ] Existing manual tests pass (webhook → draft → auto-send flow)
- [ ] Slack notifications for low-confidence drafts still work
- [ ] Delay scheduling still works (Phase 47l)

## Subphase Index

* a — Types and interfaces extraction
* b — AutoSendOrchestrator core implementation
* c — Unit test suite for orchestrator
* d — Migration: email-inbound-post-process.ts
* e — Migration: sms-inbound-post-process.ts
* f — Migration: smartlead-inbound-post-process.ts + instantly-inbound-post-process.ts
* g — Documentation and observability
* h — Test harness + coverage gating (repo-aligned)

## Files to Modify

| File | Changes |
|------|---------|
| `lib/auto-send/types.ts` | NEW: Shared types and interfaces |
| `lib/auto-send/orchestrator.ts` | NEW: Unified decision orchestrator |
| `lib/auto-send/index.ts` | NEW: Public exports |
| `lib/auto-send/__tests__/orchestrator.test.ts` | NEW: Unit tests |
| `lib/auto-send/README.md` | NEW: Architecture documentation |
| `lib/background-jobs/email-inbound-post-process.ts` | Replace ~120 lines with orchestrator call |
| `lib/background-jobs/sms-inbound-post-process.ts` | Replace ~118 lines with orchestrator call |
| `lib/background-jobs/smartlead-inbound-post-process.ts` | Replace ~115 lines with orchestrator call |
| `lib/background-jobs/instantly-inbound-post-process.ts` | Replace ~113 lines with orchestrator call |
| `CLAUDE.md` | Update: Document `lib/auto-send/` structure |
| `package.json` | Update (if needed): add test/coverage scripts per subphase h |

## Design Decisions

### Orchestrator API Design

```typescript
// lib/auto-send/types.ts

export type AutoSendMode =
  | "AI_AUTO_SEND"      // EmailCampaign confidence-based mode
  | "LEGACY_AUTO_REPLY" // Per-lead boolean mode
  | "DISABLED";         // No auto-send

export type AutoSendOutcome =
  | { action: "send_immediate"; draftId: string }
  | { action: "send_delayed"; draftId: string; runAt: Date }
  | { action: "needs_review"; draftId: string; reason: string; confidence?: number }
  | { action: "skip"; reason: string }
  | { action: "error"; error: string };

export interface AutoSendContext {
  clientId: string;
  leadId: string;
  triggerMessageId: string;
  draftId: string;
  draftContent: string;

  channel: "email" | "sms" | "linkedin";
  latestInbound: string;
  subject?: string | null;
  conversationHistory: string;
  sentimentTag: string | null;
  messageSentAt: Date;

  // Campaign context (determines which path)
  emailCampaign?: {
    id: string;
    name: string;
    bisonCampaignId: string | null;
    responseMode: string | null;
    autoSendConfidenceThreshold: number;
  } | null;

  // Legacy per-lead flag
  autoReplyEnabled?: boolean;
}

export interface AutoSendResult {
  mode: AutoSendMode;
  outcome: AutoSendOutcome;
  telemetry: {
    path: "campaign_ai_auto_send" | "legacy_per_lead" | "disabled";
    evaluationTimeMs?: number;
    confidence?: number;
    delaySeconds?: number;
  };
}
```

### Orchestrator Implementation Strategy

```typescript
// lib/auto-send/orchestrator.ts

export async function executeAutoSend(
  context: AutoSendContext
): Promise<AutoSendResult> {
  const startTime = Date.now();

  // 1. Determine mode (explicit mutual exclusion check)
  const mode = determineAutoSendMode(context);

  if (mode === "DISABLED") {
    return {
      mode,
      outcome: { action: "skip", reason: "auto_send_disabled" },
      telemetry: { path: "disabled" },
    };
  }

  // 2. Route to appropriate evaluator
  if (mode === "AI_AUTO_SEND") {
    return await executeAiAutoSendPath(context, startTime);
  } else {
    return await executeLegacyAutoReplyPath(context, startTime);
  }
}

function determineAutoSendMode(context: AutoSendContext): AutoSendMode {
  // Explicit mutual exclusion logic
  if (
    context.emailCampaign &&
    context.emailCampaign.responseMode === "AI_AUTO_SEND"
  ) {
    return "AI_AUTO_SEND";
  }

  if (!context.emailCampaign && context.autoReplyEnabled) {
    return "LEGACY_AUTO_REPLY";
  }

  return "DISABLED";
}
```

### Migration Strategy

Each background job file will be updated to:

1. Build the `AutoSendContext` from existing variables
2. Call `executeAutoSend(context)`
3. Handle the `AutoSendResult` outcome appropriately

**Before (duplicated in each file):**
```typescript
if (responseMode === "AI_AUTO_SEND" && draftId && draftContent) {
  const evaluation = await evaluateAutoSend({ ... });
  if (evaluation.safeToSend && evaluation.confidence >= autoSendThreshold) {
    const delayConfig = await getCampaignDelayConfig(...);
    if (delayConfig && ...) {
      await scheduleDelayedAutoSend({ ... });
    } else {
      await approveAndSendDraftSystem(draftId, { sentBy: "ai" });
    }
  } else {
    await sendSlackDmByEmail({ ... }); // 50+ lines of Slack block building
  }
} else if (!emailCampaign && lead.autoReplyEnabled && draftId) {
  const decision = await decideShouldAutoReply({ ... });
  if (decision.shouldReply) {
    await approveAndSendDraftSystem(draftId, { sentBy: "ai" });
  }
}
```

**After (each file):**
```typescript
const autoSendResult = await executeAutoSend({
  clientId: client.id,
  leadId: lead.id,
  triggerMessageId: message.id,
  draftId,
  draftContent,
  channel: "email", // or "sms"
  latestInbound: messageBody,
  subject,
  conversationHistory: transcript,
  sentimentTag: lead.sentimentTag,
  messageSentAt: message.sentAt ?? new Date(),
  emailCampaign: lead.emailCampaign,
  autoReplyEnabled: lead.autoReplyEnabled,
});

// Handle outcome
switch (autoSendResult.outcome.action) {
  case "send_immediate":
  case "send_delayed":
    console.log(`[${logPrefix}] Auto-send ${autoSendResult.outcome.action}: ${draftId}`);
    break;
  case "needs_review":
    console.log(`[${logPrefix}] Auto-send blocked: ${autoSendResult.outcome.reason}`);
    break;
  case "skip":
    console.log(`[${logPrefix}] Auto-send skipped: ${autoSendResult.outcome.reason}`);
    break;
  case "error":
    console.error(`[${logPrefix}] Auto-send error: ${autoSendResult.outcome.error}`);
    break;
}
```

### Slack Notification Handling

The Slack notification logic (~50 lines per file) will be encapsulated in the orchestrator:

```typescript
// Internal to orchestrator
async function sendReviewNeededNotification(
  context: AutoSendContext,
  evaluation: AutoSendEvaluation,
  threshold: number
): Promise<void> {
  const leadName = /* build from context */;
  const campaignLabel = /* build from context */;
  const url = `${getPublicAppUrl()}/?view=inbox&leadId=${context.leadId}`;

  await sendSlackDmByEmail({
    email: "jon@zeroriskgrowth.com",
    dedupeKey: `auto_send_review:${context.draftId}`,
    text: `AI auto-send review needed (${evaluation.confidence.toFixed(2)} < ${threshold.toFixed(2)})`,
    blocks: [
      // Standard blocks - single source of truth
    ],
  });
}
```

### Testing Strategy

The orchestrator will have comprehensive unit tests:

```typescript
// lib/auto-send/__tests__/orchestrator.test.ts

describe("AutoSendOrchestrator", () => {
  describe("determineAutoSendMode", () => {
    it("returns AI_AUTO_SEND when campaign has AI mode enabled", () => {});
    it("returns LEGACY_AUTO_REPLY when no campaign but autoReplyEnabled", () => {});
    it("returns DISABLED when campaign exists but not AI mode", () => {});
    it("returns DISABLED when no campaign and autoReplyEnabled false", () => {});
    it("mutual exclusion: campaign AI mode takes precedence over autoReplyEnabled", () => {});
  });

  describe("executeAutoSend - AI_AUTO_SEND path", () => {
    it("sends immediately when confidence >= threshold and no delay configured", () => {});
    it("schedules delayed send when confidence >= threshold and delay configured", () => {});
    it("returns needs_review when confidence < threshold", () => {});
    it("sends Slack notification when confidence < threshold", () => {});
    it("skips when evaluator returns safeToSend=false", () => {});
  });

  describe("executeAutoSend - LEGACY_AUTO_REPLY path", () => {
    it("sends when decideShouldAutoReply returns shouldReply=true", () => {});
    it("skips when decideShouldAutoReply returns shouldReply=false", () => {});
  });

  describe("executeAutoSend - edge cases", () => {
    it("handles missing draftContent gracefully", () => {});
    it("handles evaluator timeout/error", () => {});
    it("logs telemetry correctly", () => {});
  });
});
```

## RED TEAM Findings (Gaps / Weak Spots)

### High Risk

1. **Multi-agent / dirty working tree conflicts are likely**
   - This plan overlaps with Phase 47l work (delay scheduling + background job edits), but Phase 47 is not clean/committed in the current workspace.
   - Mitigation: Require the Pre-Flight Conflict Check above; decide whether Phase 47l must land first (recommended) vs bundling.

2. **Testing plan is currently infeasible as written**
   - Repo has no `npm run test` / `test:coverage` and no installed test runner; subphase c assumes Vitest-style mocks.
   - Mitigation: Add subphase h to align on a test harness + coverage gating without violating the “no new dependencies” constraint (or explicitly relax it).

3. **Slack notification blocks must remain a “golden master”**
   - Slack payloads are long, duplicated, and easy to accidentally change while “refactoring.”
   - Mitigation: Copy the existing Slack `blocks` structure verbatim into a single helper; avoid re-formatting; add a regression assertion in tests that the blocks match expected shape/content (at minimum: header text, lead/campaign/sentiment/confidence fields, reason, preview, URL).

4. **Delay scheduling semantics are easy to change accidentally**
   - Current behavior: when delay is configured and `scheduleDelayedAutoSend()` returns `{ scheduled: false, skipReason: "already_scheduled" }`, the code logs and does **not** fallback to immediate send.
   - Mitigation: Orchestrator must branch on `skipReason` explicitly; only treat `"delay_window_zero"` as a reason to fallback to immediate send.

5. **Slack notification recipient is hardcoded** (`jon@zeroriskgrowth.com`)
   - Currently duplicated; consolidation doesn't change this
   - Future: make configurable per workspace
   - Mitigation: Extract as constant, document as known limitation

6. **No runtime validation of precedence contract**
   - If both `emailCampaign.responseMode === "AI_AUTO_SEND"` AND `autoReplyEnabled === true`, the EmailCampaign path wins (by if/else order)
   - This is implicit behavior that could surprise developers
   - Mitigation: Add explicit logging when both conditions are true

### Medium Risk

7. **Delay config lookup adds latency**
   - `getCampaignDelayConfig()` does a DB query even when delay might be 0
   - Mitigation: Consider including delay config in the `emailCampaign` selection, avoiding extra query

8. **Lead name building is inconsistent**
   - Some files use `[lead.firstName, lead.lastName].filter(Boolean).join(" ") || "Unknown"`
   - Others might have subtle variations
   - Mitigation: Standardize in orchestrator

### Low Risk

9. **LLM inputs are sensitive to small string changes**
   - Changing `latestInbound`/`conversationHistory` composition (subject prefixing, transcript fallback, etc.) can shift model outputs and effectively become a behavior change.
   - Mitigation: Treat each channel’s current `evaluateAutoSend()`/`decideShouldAutoReply()` call shape as canonical; replicate per-channel composition exactly.

10. **SMS uses `transcript || "Lead: ${messageBody}"` fallback**
   - Email uses `transcript || latestInbound`
   - This is channel-specific behavior that should be preserved
   - Mitigation: Document explicitly in types

11. **Test coverage for existing logic is 0%**
   - No existing unit tests for auto-send logic
   - Mitigation: Test the new orchestrator, not the old code

## Open Questions (Need Human Input)

- [x] Should Phase 48 be executed only after Phase 47l is committed/merged, or are we bundling them into a single merge?
  - Decision (2026-01-21): Phase 47l lands first, then Phase 48.
  - Why it matters: Phase 48 must treat Phase 47l delay scheduling semantics/files as baseline behavior to preserve.

- [x] How should we satisfy “>90% coverage” given the current repo has no test runner/scripts?
  - Decision (2026-01-21): Add dev-only test dependencies (Vitest + coverage) and wire up `npm run test` + `npm run test:coverage` in subphase h.
  - Why it matters: without scripts/harness, this phase cannot meet its own success criteria.

## Verification Plan

1. **Unit Tests**: Run orchestrator test suite, verify >90% coverage
2. **Manual Smoke Test (Email)**:
   - Send inbound email to lead with AI_AUTO_SEND campaign
   - Verify draft generated and sent (or held for review based on confidence)
3. **Manual Smoke Test (SMS)**:
   - Send inbound SMS to lead with AI_AUTO_SEND campaign
   - Verify draft generated and sent
4. **Manual Smoke Test (Legacy)**:
   - Send inbound to lead with `autoReplyEnabled=true` but no campaign
   - Verify legacy path works
5. **Delay Test**:
   - Configure campaign with 1-minute delay
   - Verify job is scheduled, not sent immediately
6. **Build/Lint**:
   - `npm run lint` passes
   - `npm run build` passes
