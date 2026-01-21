# Phase 48c — Unit Test Suite for Orchestrator

## Focus

Create comprehensive unit tests for the `AutoSendOrchestrator` to ensure correctness before migrating the background job files. Tests should cover all paths through the decision tree and verify the mutual exclusion contract.

## Inputs

- Orchestrator implementation from subphase b: `lib/auto-send/orchestrator.ts`
- Types from subphase a: `lib/auto-send/types.ts`
- Understanding of existing behavior from the 4 background job files

## Work

### 1. Test Setup

Create `lib/auto-send/__tests__/orchestrator.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  executeAutoSend,
  determineAutoSendMode,
} from "../orchestrator";
import type { AutoSendContext } from "../types";

// Mock all external dependencies
vi.mock("@/lib/auto-send-evaluator", () => ({
  evaluateAutoSend: vi.fn(),
}));

vi.mock("@/lib/auto-reply-gate", () => ({
  decideShouldAutoReply: vi.fn(),
}));

vi.mock("@/lib/background-jobs/delayed-auto-send", () => ({
  scheduleDelayedAutoSend: vi.fn(),
  getCampaignDelayConfig: vi.fn(),
}));

vi.mock("@/actions/message-actions", () => ({
  approveAndSendDraftSystem: vi.fn(),
}));

vi.mock("@/lib/slack-dm", () => ({
  sendSlackDmByEmail: vi.fn(),
}));

vi.mock("@/lib/app-url", () => ({
  getPublicAppUrl: vi.fn(() => "https://app.example.com"),
}));

// Import mocks for assertions
import { evaluateAutoSend } from "@/lib/auto-send-evaluator";
import { decideShouldAutoReply } from "@/lib/auto-reply-gate";
import { scheduleDelayedAutoSend, getCampaignDelayConfig } from "@/lib/background-jobs/delayed-auto-send";
import { approveAndSendDraftSystem } from "@/actions/message-actions";
import { sendSlackDmByEmail } from "@/lib/slack-dm";
```

### 2. Test Factory for Context

```typescript
function createTestContext(overrides: Partial<AutoSendContext> = {}): AutoSendContext {
  return {
    clientId: "client-123",
    leadId: "lead-456",
    triggerMessageId: "msg-789",
    draftId: "draft-abc",
    draftContent: "Hello, this is a test draft response.",
    channel: "email",
    latestInbound: "I'm interested in learning more.",
    subject: "Re: Our product",
    conversationHistory: "Previous messages...",
    sentimentTag: "Information Requested",
    messageSentAt: new Date("2024-01-15T10:00:00Z"),
    leadFirstName: "John",
    leadLastName: "Doe",
    leadEmail: "john@example.com",
    emailCampaign: null,
    autoReplyEnabled: false,
    ...overrides,
  };
}

function createAiAutoSendCampaign(overrides: Partial<AutoSendContext["emailCampaign"]> = {}): NonNullable<AutoSendContext["emailCampaign"]> {
  return {
    id: "campaign-123",
    name: "Test Campaign",
    bisonCampaignId: "bison-456",
    responseMode: "AI_AUTO_SEND",
    autoSendConfidenceThreshold: 0.9,
    ...overrides,
  };
}
```

### 3. Test Suite: `determineAutoSendMode`

```typescript
describe("determineAutoSendMode", () => {
  it("returns AI_AUTO_SEND when campaign has AI mode enabled", () => {
    const context = createTestContext({
      emailCampaign: createAiAutoSendCampaign(),
    });
    expect(determineAutoSendMode(context)).toBe("AI_AUTO_SEND");
  });

  it("returns LEGACY_AUTO_REPLY when no campaign but autoReplyEnabled=true", () => {
    const context = createTestContext({
      emailCampaign: null,
      autoReplyEnabled: true,
    });
    expect(determineAutoSendMode(context)).toBe("LEGACY_AUTO_REPLY");
  });

  it("returns DISABLED when campaign exists but not AI mode", () => {
    const context = createTestContext({
      emailCampaign: createAiAutoSendCampaign({ responseMode: "SETTER_MANAGED" }),
    });
    expect(determineAutoSendMode(context)).toBe("DISABLED");
  });

  it("returns DISABLED when no campaign and autoReplyEnabled=false", () => {
    const context = createTestContext({
      emailCampaign: null,
      autoReplyEnabled: false,
    });
    expect(determineAutoSendMode(context)).toBe("DISABLED");
  });

  it("returns DISABLED when campaign is null and autoReplyEnabled undefined", () => {
    const context = createTestContext({
      emailCampaign: null,
      autoReplyEnabled: undefined,
    });
    expect(determineAutoSendMode(context)).toBe("DISABLED");
  });

  describe("mutual exclusion", () => {
    it("AI_AUTO_SEND takes precedence over autoReplyEnabled when both are true", () => {
      const context = createTestContext({
        emailCampaign: createAiAutoSendCampaign(),
        autoReplyEnabled: true, // This should be ignored
      });
      expect(determineAutoSendMode(context)).toBe("AI_AUTO_SEND");
    });

    it("LEGACY_AUTO_REPLY only activates when no emailCampaign exists", () => {
      const context = createTestContext({
        emailCampaign: createAiAutoSendCampaign({ responseMode: "SETTER_MANAGED" }),
        autoReplyEnabled: true,
      });
      // Campaign exists (even if not AI mode), so legacy doesn't activate
      expect(determineAutoSendMode(context)).toBe("DISABLED");
    });
  });
});
```

### 4. Test Suite: `executeAutoSend` - AI_AUTO_SEND Path

```typescript
describe("executeAutoSend - AI_AUTO_SEND path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends immediately when confidence >= threshold and no delay configured", async () => {
    vi.mocked(evaluateAutoSend).mockResolvedValue({
      confidence: 0.95,
      safeToSend: true,
      requiresHumanReview: false,
      reason: "Good to send",
    });
    vi.mocked(getCampaignDelayConfig).mockResolvedValue(null);
    vi.mocked(approveAndSendDraftSystem).mockResolvedValue({
      success: true,
      messageId: "sent-msg-123",
    });

    const context = createTestContext({
      emailCampaign: createAiAutoSendCampaign({ autoSendConfidenceThreshold: 0.9 }),
    });

    const result = await executeAutoSend(context);

    expect(result.mode).toBe("AI_AUTO_SEND");
    expect(result.outcome.action).toBe("send_immediate");
    expect(result.telemetry.confidence).toBe(0.95);
    expect(approveAndSendDraftSystem).toHaveBeenCalledWith("draft-abc", { sentBy: "ai" });
  });

  it("schedules delayed send when confidence >= threshold and delay configured", async () => {
    const runAt = new Date("2024-01-15T10:05:00Z");
    vi.mocked(evaluateAutoSend).mockResolvedValue({
      confidence: 0.95,
      safeToSend: true,
      requiresHumanReview: false,
      reason: "Good to send",
    });
    vi.mocked(getCampaignDelayConfig).mockResolvedValue({
      delayMinSeconds: 180,
      delayMaxSeconds: 420,
    });
    vi.mocked(scheduleDelayedAutoSend).mockResolvedValue({
      scheduled: true,
      runAt,
    });

    const context = createTestContext({
      emailCampaign: createAiAutoSendCampaign(),
    });

    const result = await executeAutoSend(context);

    expect(result.mode).toBe("AI_AUTO_SEND");
    expect(result.outcome.action).toBe("send_delayed");
    if (result.outcome.action === "send_delayed") {
      expect(result.outcome.runAt).toEqual(runAt);
    }
    expect(approveAndSendDraftSystem).not.toHaveBeenCalled();
  });

  it("returns needs_review when confidence < threshold", async () => {
    vi.mocked(evaluateAutoSend).mockResolvedValue({
      confidence: 0.75,
      safeToSend: true,
      requiresHumanReview: true,
      reason: "Low confidence - ambiguous intent",
    });
    vi.mocked(sendSlackDmByEmail).mockResolvedValue({ success: true });

    const context = createTestContext({
      emailCampaign: createAiAutoSendCampaign({ autoSendConfidenceThreshold: 0.9 }),
    });

    const result = await executeAutoSend(context);

    expect(result.mode).toBe("AI_AUTO_SEND");
    expect(result.outcome.action).toBe("needs_review");
    if (result.outcome.action === "needs_review") {
      expect(result.outcome.confidence).toBe(0.75);
    }
    expect(sendSlackDmByEmail).toHaveBeenCalled();
  });

  it("sends Slack notification with correct blocks when review needed", async () => {
    vi.mocked(evaluateAutoSend).mockResolvedValue({
      confidence: 0.7,
      safeToSend: true,
      requiresHumanReview: true,
      reason: "Ambiguous response",
    });
    vi.mocked(sendSlackDmByEmail).mockResolvedValue({ success: true });

    const context = createTestContext({
      emailCampaign: createAiAutoSendCampaign(),
      leadFirstName: "Jane",
      leadLastName: "Smith",
    });

    await executeAutoSend(context);

    expect(sendSlackDmByEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "jon@zeroriskgrowth.com",
        dedupeKey: "auto_send_review:draft-abc",
        blocks: expect.arrayContaining([
          expect.objectContaining({
            type: "header",
            text: expect.objectContaining({ text: "AI Auto-Send: Review Needed" }),
          }),
        ]),
      })
    );
  });

  it("skips when evaluator returns safeToSend=false", async () => {
    vi.mocked(evaluateAutoSend).mockResolvedValue({
      confidence: 0.95,
      safeToSend: false,
      requiresHumanReview: true,
      reason: "Opt-out detected",
    });
    vi.mocked(sendSlackDmByEmail).mockResolvedValue({ success: true });

    const context = createTestContext({
      emailCampaign: createAiAutoSendCampaign(),
    });

    const result = await executeAutoSend(context);

    expect(result.outcome.action).toBe("needs_review");
    expect(approveAndSendDraftSystem).not.toHaveBeenCalled();
  });

  it("uses default threshold when campaign threshold not set", async () => {
    vi.mocked(evaluateAutoSend).mockResolvedValue({
      confidence: 0.85,
      safeToSend: true,
      requiresHumanReview: false,
      reason: "OK",
    });
    vi.mocked(sendSlackDmByEmail).mockResolvedValue({ success: true });

    const context = createTestContext({
      emailCampaign: createAiAutoSendCampaign({ autoSendConfidenceThreshold: undefined as any }),
    });

    const result = await executeAutoSend(context);

    // Default threshold is 0.9, so 0.85 should trigger review
    expect(result.outcome.action).toBe("needs_review");
  });
});
```

### 5. Test Suite: `executeAutoSend` - LEGACY_AUTO_REPLY Path

```typescript
describe("executeAutoSend - LEGACY_AUTO_REPLY path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends when decideShouldAutoReply returns shouldReply=true", async () => {
    vi.mocked(decideShouldAutoReply).mockResolvedValue({
      shouldReply: true,
      reason: "Conversational reply appropriate",
    });
    vi.mocked(approveAndSendDraftSystem).mockResolvedValue({
      success: true,
      messageId: "sent-msg-456",
    });

    const context = createTestContext({
      emailCampaign: null,
      autoReplyEnabled: true,
    });

    const result = await executeAutoSend(context);

    expect(result.mode).toBe("LEGACY_AUTO_REPLY");
    expect(result.outcome.action).toBe("send_immediate");
    expect(approveAndSendDraftSystem).toHaveBeenCalledWith("draft-abc", { sentBy: "ai" });
  });

  it("skips when decideShouldAutoReply returns shouldReply=false", async () => {
    vi.mocked(decideShouldAutoReply).mockResolvedValue({
      shouldReply: false,
      reason: "Acknowledgement-only reply",
    });

    const context = createTestContext({
      emailCampaign: null,
      autoReplyEnabled: true,
    });

    const result = await executeAutoSend(context);

    expect(result.mode).toBe("LEGACY_AUTO_REPLY");
    expect(result.outcome.action).toBe("skip");
    if (result.outcome.action === "skip") {
      expect(result.outcome.reason).toBe("Acknowledgement-only reply");
    }
    expect(approveAndSendDraftSystem).not.toHaveBeenCalled();
  });

  it("does NOT send Slack notifications (legacy path has no review flow)", async () => {
    vi.mocked(decideShouldAutoReply).mockResolvedValue({
      shouldReply: false,
      reason: "Skipped",
    });

    const context = createTestContext({
      emailCampaign: null,
      autoReplyEnabled: true,
    });

    await executeAutoSend(context);

    expect(sendSlackDmByEmail).not.toHaveBeenCalled();
  });

  it("does NOT support delay scheduling (immediate only)", async () => {
    vi.mocked(decideShouldAutoReply).mockResolvedValue({
      shouldReply: true,
      reason: "OK",
    });
    vi.mocked(approveAndSendDraftSystem).mockResolvedValue({ success: true });

    const context = createTestContext({
      emailCampaign: null,
      autoReplyEnabled: true,
    });

    await executeAutoSend(context);

    // Should NOT check for delay config in legacy path
    expect(getCampaignDelayConfig).not.toHaveBeenCalled();
    expect(scheduleDelayedAutoSend).not.toHaveBeenCalled();
  });
});
```

### 6. Test Suite: Edge Cases

```typescript
describe("executeAutoSend - edge cases", () => {
  it("returns skip when draftId is missing", async () => {
    const context = createTestContext({
      draftId: "",
      emailCampaign: createAiAutoSendCampaign(),
    });

    const result = await executeAutoSend(context);

    expect(result.outcome.action).toBe("skip");
    if (result.outcome.action === "skip") {
      expect(result.outcome.reason).toBe("missing_draft");
    }
  });

  it("returns skip when draftContent is empty", async () => {
    const context = createTestContext({
      draftContent: "",
      emailCampaign: createAiAutoSendCampaign(),
    });

    const result = await executeAutoSend(context);

    expect(result.outcome.action).toBe("skip");
  });

  it("returns error when send fails", async () => {
    vi.mocked(evaluateAutoSend).mockResolvedValue({
      confidence: 0.95,
      safeToSend: true,
      requiresHumanReview: false,
      reason: "OK",
    });
    vi.mocked(getCampaignDelayConfig).mockResolvedValue(null);
    vi.mocked(approveAndSendDraftSystem).mockResolvedValue({
      success: false,
      error: "Draft not found",
    });

    const context = createTestContext({
      emailCampaign: createAiAutoSendCampaign(),
    });

    const result = await executeAutoSend(context);

    expect(result.outcome.action).toBe("error");
    if (result.outcome.action === "error") {
      expect(result.outcome.error).toBe("Draft not found");
    }
  });

  it("tracks evaluation time in telemetry", async () => {
    vi.mocked(evaluateAutoSend).mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 50)); // Simulate latency
      return { confidence: 0.95, safeToSend: true, requiresHumanReview: false, reason: "OK" };
    });
    vi.mocked(getCampaignDelayConfig).mockResolvedValue(null);
    vi.mocked(approveAndSendDraftSystem).mockResolvedValue({ success: true });

    const context = createTestContext({
      emailCampaign: createAiAutoSendCampaign(),
    });

    const result = await executeAutoSend(context);

    expect(result.telemetry.evaluationTimeMs).toBeGreaterThan(0);
  });

  it("handles null sentimentTag gracefully", async () => {
    vi.mocked(evaluateAutoSend).mockResolvedValue({
      confidence: 0.95,
      safeToSend: true,
      requiresHumanReview: false,
      reason: "OK",
    });
    vi.mocked(getCampaignDelayConfig).mockResolvedValue(null);
    vi.mocked(approveAndSendDraftSystem).mockResolvedValue({ success: true });

    const context = createTestContext({
      sentimentTag: null,
      emailCampaign: createAiAutoSendCampaign(),
    });

    const result = await executeAutoSend(context);

    expect(result.outcome.action).toBe("send_immediate");
  });

  it("builds lead name correctly with only first name", async () => {
    vi.mocked(evaluateAutoSend).mockResolvedValue({
      confidence: 0.7,
      safeToSend: true,
      requiresHumanReview: true,
      reason: "Review",
    });
    vi.mocked(sendSlackDmByEmail).mockResolvedValue({ success: true });

    const context = createTestContext({
      leadFirstName: "Alice",
      leadLastName: null,
      emailCampaign: createAiAutoSendCampaign(),
    });

    await executeAutoSend(context);

    expect(sendSlackDmByEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        blocks: expect.arrayContaining([
          expect.objectContaining({
            fields: expect.arrayContaining([
              expect.objectContaining({ text: expect.stringContaining("Alice") }),
            ]),
          }),
        ]),
      })
    );
  });
});
```

### 7. Validation

- Run `npm run test` and verify all tests pass
- Check coverage: `npm run test:coverage`
- Ensure >90% line coverage for orchestrator

## Output

- `lib/auto-send/__tests__/orchestrator.test.ts` created
- All test scenarios pass
- Coverage report shows >90% line coverage
- Tests document the mutual exclusion contract explicitly

## Handoff

Test suite is ready. Subphase d can begin migrating the first background job file with confidence that the orchestrator behaves correctly.
