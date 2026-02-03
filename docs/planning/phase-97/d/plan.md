# Phase 97d — Tests + QA Checklist

## Focus
Verify evaluator semantics and prevent regressions; provide a reproducible manual QA runbook.

## Inputs
- Existing tests: `lib/auto-send/__tests__/orchestrator.test.ts`
- Updated evaluator semantics from Phase 97a
- UI warnings + stats from Phases 97b/97c

## Work

### Step 1: Add unit tests for evaluator output interpretation

Create or extend `lib/auto-send/__tests__/evaluator.test.ts`:

```ts
import assert from "node:assert/strict";
import { describe, it, mock, beforeEach, afterEach } from "node:test";
import { evaluateAutoSend } from "../auto-send-evaluator";

// Mock the prompt runner to control AI output
const mockPromptRunner = mock.module("@/lib/ai/prompt-runner", {
  namedExports: {
    runStructuredJsonPrompt: mock.fn(),
  },
});

describe("evaluateAutoSend - output interpretation", () => {
  it("returns safeToSend=false when safe_to_send=true AND requires_human_review=true (contradictory JSON)", async () => {
    // This is the key regression test for Phase 97a
    mockPromptRunner.runStructuredJsonPrompt.mock.mockImplementation(async () => ({
      success: true,
      data: {
        safe_to_send: true,
        requires_human_review: true, // Contradictory!
        confidence: 0.95,
        reason: "Test contradictory output",
      },
    }));

    const result = await evaluateAutoSend({
      clientId: "test-client",
      channel: "email",
      latestInbound: "What's your annual revenue?",
      conversationHistory: "Lead asked about revenue",
      categorization: "Information Requested",
      draft: "Could you share your approximate annual revenue range?",
    });

    // Safety-first: contradictory output must NOT be treated as safe
    assert.equal(result.safeToSend, false);
    assert.equal(result.requiresHumanReview, true);
  });

  it("returns safeToSend=true when safe_to_send=true AND requires_human_review=false AND confidence >= 0.01", async () => {
    mockPromptRunner.runStructuredJsonPrompt.mock.mockImplementation(async () => ({
      success: true,
      data: {
        safe_to_send: true,
        requires_human_review: false,
        confidence: 0.92,
        reason: "Standard qualification question",
      },
    }));

    const result = await evaluateAutoSend({
      clientId: "test-client",
      channel: "email",
      latestInbound: "What's your annual revenue?",
      conversationHistory: "Lead asked about revenue",
      categorization: "Information Requested",
      draft: "Could you share your approximate annual revenue range?",
    });

    assert.equal(result.safeToSend, true);
    assert.equal(result.requiresHumanReview, false);
    assert.ok(result.confidence >= 0.01);
  });

  it("returns safeToSend=false when confidence is zero", async () => {
    mockPromptRunner.runStructuredJsonPrompt.mock.mockImplementation(async () => ({
      success: true,
      data: {
        safe_to_send: true,
        requires_human_review: false,
        confidence: 0,
        reason: "Edge case",
      },
    }));

    const result = await evaluateAutoSend({
      clientId: "test-client",
      channel: "email",
      latestInbound: "Test",
      conversationHistory: "",
      categorization: null,
      draft: "Test draft",
    });

    assert.equal(result.safeToSend, false);
  });

  it("returns safeToSend=false when confidence is negative (clamped)", async () => {
    mockPromptRunner.runStructuredJsonPrompt.mock.mockImplementation(async () => ({
      success: true,
      data: {
        safe_to_send: true,
        requires_human_review: false,
        confidence: -0.5,
        reason: "Edge case",
      },
    }));

    const result = await evaluateAutoSend({
      clientId: "test-client",
      channel: "email",
      latestInbound: "Test",
      conversationHistory: "",
      categorization: null,
      draft: "Test draft",
    });

    // Negative confidence clamps to 0, which is < 0.01
    assert.equal(result.safeToSend, false);
    assert.equal(result.confidence, 0);
  });
});
```

### Step 2: Add test for existing orchestrator behavior

In `lib/auto-send/__tests__/orchestrator.test.ts`, add test to verify evaluator result is respected:

```ts
describe("executeAutoSend - evaluator output handling", () => {
  it("does not send when evaluator returns safeToSend=false", async () => {
    const evaluateAutoSend = mock.fn(async () => ({
      confidence: 0.95,
      safeToSend: false, // Not safe despite high confidence
      requiresHumanReview: true,
      reason: "Contradictory output",
    }));

    const executor = createAutoSendExecutor({
      evaluateAutoSend,
      // ... other mocks
    });

    const result = await executor(createContext({
      emailCampaign: createCampaign({ responseMode: "AI_AUTO_SEND" }),
    }));

    // Should NOT send
    assert.equal(result.sent, false);
    assert.equal(result.action, "needs_review");
  });
});
```

### Step 3: Run tests and verify

```bash
npm run test
npm run lint
npm run build
```

All must pass.

## Manual QA Checklist

### QA 1: Qualification Question Allowance (Jam Repro)

**Setup:**
1. Find or create an EmailCampaign with `responseMode = "AI_AUTO_SEND"` and `autoSendConfidenceThreshold = 0.9`
2. Have a Lead assigned to this campaign

**Steps:**
1. Simulate an inbound email from the lead asking about your services
2. Wait for background job to process → AI draft generated
3. Check `AIDraft.autoSendAction`:
   - If the draft asks a qualification question (e.g., revenue, headcount), it should be `send_immediate` or `send_delayed`, NOT `needs_review`
   - Check `AIDraft.autoSendReason` does NOT contain "sensitive" for qualification questions

**Expected:**
- Qualification questions are allowed
- Draft is auto-sent (or scheduled) rather than flagged for review

### QA 2: UI Warning for Misconfigured Campaign

**Setup:**
1. Create a campaign named "AI Responses - Test Client"
2. Set `responseMode = "SETTER_MANAGED"`

**Steps:**
1. Navigate to Dashboard → Settings → AI Campaign Assignment
2. Look for the campaign row

**Expected:**
- Inline warning appears on the row: “Named ‘AI Responses’ but mode is Setter-managed…”
- Header shows `AI Responses (setter): <count>`
- Changing to "AI auto‑send" removes the warning

### QA 3: Auto-Send Stats Visibility

**Setup:**
1. Ensure at least one campaign is `AI_AUTO_SEND` with some historical drafts

**Steps:**
1. Navigate to Dashboard → Settings → AI Campaign Assignment
2. Look at the header area

**Expected:**
- Stats display: "Last 30d: AI sent X · Review Y · Scheduled Z"
- Numbers reflect actual counts (verify against DB if needed)
- Stats update after page refresh

### QA 4: Contradictory JSON Handling

**Setup:**
1. This requires direct testing via code or mocked evaluator response

**Steps:**
1. Run the unit test from Step 1 above
2. Verify `safeToSend=false` when `safe_to_send=true` AND `requires_human_review=true`

**Expected:**
- Contradictory output is treated as NOT safe
- Unit test passes

## Output
- Tests added + passing locally (`npm run test`).
- Manual QA checklist documented (this file).
- All edge cases covered: contradictory JSON, zero/negative confidence, qualification questions.

### Completed (2026-02-03)
- Added unit tests for the safety-first evaluator interpretation via `interpretAutoSendEvaluatorOutput(...)`. (`lib/auto-send/__tests__/auto-send-evaluator.test.ts`)
- Verified quality gates:
  - `npm run test`: ✅ pass
  - `npm run lint`: ✅ pass (warnings only)
  - `npm run build`: ✅ pass

## Handoff
Phase 97 can be marked complete once tests/build/lint pass and Jam scenario is verified in a preview/prod environment.
