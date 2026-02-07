import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";

import { createAutoSendExecutor, determineAutoSendMode, executeAutoSend as executeAutoSendDefault } from "../orchestrator";
import type { AutoSendContext } from "../types";

function createCampaign(
  overrides: Partial<NonNullable<AutoSendContext["emailCampaign"]>> = {}
): NonNullable<AutoSendContext["emailCampaign"]> {
  return {
    id: "campaign-1",
    name: "Test Campaign",
    bisonCampaignId: "bison-1",
    responseMode: "AI_AUTO_SEND",
    autoSendConfidenceThreshold: 0.9,
    ...overrides,
  };
}

function createContext(overrides: Partial<AutoSendContext> = {}): AutoSendContext {
  return {
    clientId: "client-1",
    leadId: "lead-1",
    triggerMessageId: "msg-1",
    draftId: "draft-1",
    draftContent: "Hello, this is a test draft response.",
    channel: "email",
    latestInbound: "Inbound message body",
    subject: "Re: Subject",
    conversationHistory: "Conversation transcript",
    sentimentTag: "Information Requested",
    messageSentAt: new Date("2026-01-01T00:00:00Z"),
    automatedReply: null,
    leadFirstName: "John",
    leadLastName: "Doe",
    leadEmail: "john@example.com",
    emailCampaign: null,
    autoReplyEnabled: false,
    validateImmediateSend: true,
    includeDraftPreviewInSlack: false,
    ...overrides,
  };
}

const defaultSlackApprovalConfig = {
  token: "xoxb-test",
  recipients: [{ id: "U1", displayName: "Test User" }],
};

describe("determineAutoSendMode", () => {
  it("returns AI_AUTO_SEND when campaign is AI mode (even if autoReplyEnabled is true)", () => {
    const context = createContext({
      emailCampaign: createCampaign({ responseMode: "AI_AUTO_SEND" }),
      autoReplyEnabled: true,
    });
    assert.equal(determineAutoSendMode(context), "AI_AUTO_SEND");
  });

  it("returns LEGACY_AUTO_REPLY when no campaign and autoReplyEnabled=true", () => {
    const context = createContext({ emailCampaign: null, autoReplyEnabled: true });
    assert.equal(determineAutoSendMode(context), "LEGACY_AUTO_REPLY");
  });

  it("returns DISABLED when campaign exists but is not AI mode", () => {
    const context = createContext({
      emailCampaign: createCampaign({ responseMode: "SETTER_MANAGED" }),
    });
    assert.equal(determineAutoSendMode(context), "DISABLED");
  });

  it("returns DISABLED when no campaign and autoReplyEnabled=false", () => {
    const context = createContext({ emailCampaign: null, autoReplyEnabled: false });
    assert.equal(determineAutoSendMode(context), "DISABLED");
  });

  it("returns DISABLED when global kill-switch is enabled", () => {
    const prev = process.env.AUTO_SEND_DISABLED;
    process.env.AUTO_SEND_DISABLED = "1";
    try {
      const context = createContext({
        emailCampaign: createCampaign({ responseMode: "AI_AUTO_SEND" }),
        autoReplyEnabled: true,
      });
      assert.equal(determineAutoSendMode(context), "DISABLED");
    } finally {
      if (prev === undefined) {
        delete process.env.AUTO_SEND_DISABLED;
      } else {
        process.env.AUTO_SEND_DISABLED = prev;
      }
    }
  });
});

describe("executeAutoSend - AI_AUTO_SEND path", () => {
  it("skips when global kill-switch is enabled", async () => {
    const prev = process.env.AUTO_SEND_DISABLED;
    process.env.AUTO_SEND_DISABLED = "1";
    try {
      const evaluateAutoSend = mock.fn(async () => ({
        confidence: 1,
        safeToSend: true,
        requiresHumanReview: false,
        reason: "unused",
      }));

      const { executeAutoSend } = createAutoSendExecutor({
        approveAndSendDraftSystem: mock.fn(async () => ({ success: true, messageId: "sent-1" })),
        decideShouldAutoReply: mock.fn(async () => ({ shouldReply: false, reason: "unused" })),
        evaluateAutoSend,
        getPublicAppUrl: () => "https://app.example.com",
        getCampaignDelayConfig: mock.fn(async () => null),
        scheduleDelayedAutoSend: mock.fn(async () => ({ scheduled: false as const, skipReason: "unused" })),
        scheduleAutoSendAt: mock.fn(async () => ({ scheduled: false as const, skipReason: "unused" })),
        validateDelayedAutoSend: mock.fn(async () => ({ proceed: true })),
        getSlackAutoSendApprovalConfig: mock.fn(async () => defaultSlackApprovalConfig),
        sendSlackDmByUserIdWithToken: mock.fn(async (_opts: unknown) => ({ success: true })),
        recordAutoSendDecision: mock.fn(async () => undefined),
      });

      const result = await executeAutoSend(
        createContext({
          emailCampaign: createCampaign(),
        })
      );

      assert.equal(result.mode, "DISABLED");
      assert.equal(result.outcome.action, "skip");
      assert.equal(result.outcome.reason, "globally_disabled_via_env");
      assert.equal(evaluateAutoSend.mock.calls.length, 0);
    } finally {
      if (prev === undefined) {
        delete process.env.AUTO_SEND_DISABLED;
      } else {
        process.env.AUTO_SEND_DISABLED = prev;
      }
    }
  });

  it("skips when draft content is missing/whitespace", async () => {
    const evaluateAutoSend = mock.fn(async () => ({
      confidence: 1,
      safeToSend: true,
      requiresHumanReview: false,
      reason: "unused",
    }));

    const { executeAutoSend } = createAutoSendExecutor({
      approveAndSendDraftSystem: mock.fn(async () => ({ success: true, messageId: "sent-1" })),
      decideShouldAutoReply: mock.fn(async () => ({ shouldReply: false, reason: "unused" })),
      evaluateAutoSend,
      getPublicAppUrl: () => "https://app.example.com",
      getCampaignDelayConfig: mock.fn(async () => null),
      scheduleDelayedAutoSend: mock.fn(async () => ({ scheduled: false as const, skipReason: "unused" })),
      scheduleAutoSendAt: mock.fn(async () => ({ scheduled: false as const, skipReason: "unused" })),
      validateDelayedAutoSend: mock.fn(async () => ({ proceed: true })),
      getSlackAutoSendApprovalConfig: mock.fn(async () => defaultSlackApprovalConfig),
      sendSlackDmByUserIdWithToken: mock.fn(async (_opts: unknown) => ({ success: true })),
      recordAutoSendDecision: mock.fn(async () => undefined),
    });

    const result = await executeAutoSend(
      createContext({
        emailCampaign: createCampaign(),
        draftContent: "   ",
      })
    );

    assert.equal(result.mode, "AI_AUTO_SEND");
    assert.equal(result.outcome.action, "skip");
    assert.equal(result.outcome.reason, "missing_draft_content");
    assert.equal(evaluateAutoSend.mock.calls.length, 0);
  });

  it("sends immediately when confidence >= threshold and no delay configured", async () => {
    const evaluateAutoSend = mock.fn(async () => ({
      confidence: 0.95,
      safeToSend: true,
      requiresHumanReview: false,
      reason: "Good to send",
    }));
    const getCampaignDelayConfig = mock.fn(async () => null);
    const validateDelayedAutoSend = mock.fn(async () => ({ proceed: true }));
    const approveAndSendDraftSystem = mock.fn(async () => ({ success: true, messageId: "sent-1" }));
    const scheduleDelayedAutoSend = mock.fn(async () => ({ scheduled: false as const, skipReason: "already_scheduled" }));
    const sendSlackDmByEmail = mock.fn(async (_opts: unknown) => ({ success: true }));
    const recordAutoSendDecision = mock.fn(async () => undefined);
    const decideShouldAutoReply = mock.fn(async () => ({ shouldReply: false, reason: "no" }));

    const { executeAutoSend } = createAutoSendExecutor({
      approveAndSendDraftSystem,
      decideShouldAutoReply,
      evaluateAutoSend,
      getPublicAppUrl: () => "https://app.example.com",
      getCampaignDelayConfig,
      scheduleDelayedAutoSend,
      scheduleAutoSendAt: mock.fn(async () => ({ scheduled: false as const, skipReason: "unused" })),
      validateDelayedAutoSend,
      getSlackAutoSendApprovalConfig: mock.fn(async () => defaultSlackApprovalConfig),
      sendSlackDmByUserIdWithToken: sendSlackDmByEmail,
      recordAutoSendDecision,
    });

    const result = await executeAutoSend(
      createContext({
        emailCampaign: createCampaign({ autoSendConfidenceThreshold: 0.9 }),
        includeDraftPreviewInSlack: true,
      })
    );

    assert.equal(result.mode, "AI_AUTO_SEND");
    assert.equal(result.outcome.action, "send_immediate");
    assert.equal(approveAndSendDraftSystem.mock.calls.length, 1);
    assert.deepEqual(approveAndSendDraftSystem.mock.calls[0]?.arguments, ["draft-1", { sentBy: "ai" }]);
    assert.equal(scheduleDelayedAutoSend.mock.calls.length, 0);
    assert.equal(sendSlackDmByEmail.mock.calls.length, 0);
    assert.equal(recordAutoSendDecision.mock.calls.length, 1);
    const recordArg = (recordAutoSendDecision.mock.calls as unknown[])[0] as { arguments: [{ action?: string }] };
    assert.equal(recordArg?.arguments[0]?.action, "send_immediate");
  });

  it("attempts revision when below threshold and uses revised evaluation when improved", async () => {
    const evaluateAutoSend = mock.fn(async () => ({
      confidence: 0.4,
      safeToSend: true,
      requiresHumanReview: false,
      reason: "Below threshold",
      source: "model" as const,
    }));

    const maybeReviseAutoSendDraft = mock.fn(async () => ({
      revisedDraft: "Improved draft response",
      revisedEvaluation: {
        confidence: 0.95,
        safeToSend: true,
        requiresHumanReview: false,
        reason: "Improved",
        source: "model" as const,
      },
      telemetry: {
        attempted: true,
        selectorUsed: false,
        improved: true,
        originalConfidence: 0.4,
        revisedConfidence: 0.95,
        threshold: 0.9,
      },
    }));

    const approveAndSendDraftSystem = mock.fn(async () => ({ success: true, messageId: "sent-1" }));
    const recordAutoSendDecision = mock.fn(async () => undefined);

    const { executeAutoSend } = createAutoSendExecutor({
      approveAndSendDraftSystem,
      decideShouldAutoReply: mock.fn(async () => ({ shouldReply: false, reason: "unused" })),
      evaluateAutoSend,
      maybeReviseAutoSendDraft,
      getPublicAppUrl: () => "https://app.example.com",
      getCampaignDelayConfig: mock.fn(async () => null),
      scheduleDelayedAutoSend: mock.fn(async () => ({ scheduled: false as const, skipReason: "unused" })),
      scheduleAutoSendAt: mock.fn(async () => ({ scheduled: false as const, skipReason: "unused" })),
      validateDelayedAutoSend: mock.fn(async () => ({ proceed: true })),
      getSlackAutoSendApprovalConfig: mock.fn(async () => defaultSlackApprovalConfig),
      sendSlackDmByUserIdWithToken: mock.fn(async (_opts: unknown) => ({ success: true })),
      recordAutoSendDecision,
    });

    const result = await executeAutoSend(
      createContext({
        emailCampaign: createCampaign({ autoSendConfidenceThreshold: 0.9 }),
        includeDraftPreviewInSlack: true,
      })
    );

    assert.equal(result.mode, "AI_AUTO_SEND");
    assert.equal(result.outcome.action, "send_immediate");
    assert.equal(evaluateAutoSend.mock.calls.length, 1);
    assert.equal(maybeReviseAutoSendDraft.mock.calls.length, 1);
    assert.equal(approveAndSendDraftSystem.mock.calls.length, 1);
    assert.equal(recordAutoSendDecision.mock.calls.length, 1);

    const recordArg = (recordAutoSendDecision.mock.calls as unknown[])[0] as { arguments: [{ confidence?: number }] };
    assert.equal(recordArg?.arguments[0]?.confidence, 0.95);
  });

  it("does not attempt revision when evaluator returns a hard block", async () => {
    const evaluateAutoSend = mock.fn(async () => ({
      confidence: 0,
      safeToSend: false,
      requiresHumanReview: true,
      reason: "Opt-out/unsubscribe request detected",
      source: "hard_block" as const,
      hardBlockCode: "opt_out" as const,
    }));

    const maybeReviseAutoSendDraft = mock.fn(async () => ({
      revisedDraft: "should not be used",
      revisedEvaluation: {
        confidence: 1,
        safeToSend: true,
        requiresHumanReview: false,
        reason: "unused",
        source: "model" as const,
      },
      telemetry: {
        attempted: true,
        selectorUsed: false,
        improved: false,
        originalConfidence: 0,
        revisedConfidence: 1,
        threshold: 0.9,
      },
    }));

    const sendSlackDmByEmail = mock.fn(async (_opts: unknown) => ({ success: true }));

    const { executeAutoSend } = createAutoSendExecutor({
      approveAndSendDraftSystem: mock.fn(async () => ({ success: true, messageId: "sent-1" })),
      decideShouldAutoReply: mock.fn(async () => ({ shouldReply: false, reason: "unused" })),
      evaluateAutoSend,
      maybeReviseAutoSendDraft,
      getPublicAppUrl: () => "https://app.example.com",
      getCampaignDelayConfig: mock.fn(async () => null),
      scheduleDelayedAutoSend: mock.fn(async () => ({ scheduled: false as const, skipReason: "unused" })),
      scheduleAutoSendAt: mock.fn(async () => ({ scheduled: false as const, skipReason: "unused" })),
      validateDelayedAutoSend: mock.fn(async () => ({ proceed: true })),
      getSlackAutoSendApprovalConfig: mock.fn(async () => defaultSlackApprovalConfig),
      sendSlackDmByUserIdWithToken: sendSlackDmByEmail,
      recordAutoSendDecision: mock.fn(async () => undefined),
    });

    const result = await executeAutoSend(
      createContext({
        emailCampaign: createCampaign({ autoSendConfidenceThreshold: 0.9 }),
      })
    );

    assert.equal(result.mode, "AI_AUTO_SEND");
    assert.equal(result.outcome.action, "needs_review");
    assert.equal(maybeReviseAutoSendDraft.mock.calls.length, 0);
    assert.equal(sendSlackDmByEmail.mock.calls.length, 1);
  });

  it("returns error when approveAndSendDraftSystem fails", async () => {
    const evaluateAutoSend = mock.fn(async () => ({
      confidence: 0.95,
      safeToSend: true,
      requiresHumanReview: false,
      reason: "Good to send",
    }));
    const getCampaignDelayConfig = mock.fn(async () => null);
    const approveAndSendDraftSystem = mock.fn(async () => ({ success: false, error: "send_failed" }));
    const sendSlackDmByEmail = mock.fn(async (_opts: unknown) => ({ success: true }));

    const { executeAutoSend } = createAutoSendExecutor({
      approveAndSendDraftSystem,
      decideShouldAutoReply: mock.fn(async () => ({ shouldReply: false, reason: "unused" })),
      evaluateAutoSend,
      getPublicAppUrl: () => "https://app.example.com",
      getCampaignDelayConfig,
      scheduleDelayedAutoSend: mock.fn(async () => ({ scheduled: false as const, skipReason: "unused" })),
      scheduleAutoSendAt: mock.fn(async () => ({ scheduled: false as const, skipReason: "unused" })),
      validateDelayedAutoSend: mock.fn(async () => ({ proceed: true })),
      getSlackAutoSendApprovalConfig: mock.fn(async () => defaultSlackApprovalConfig),
      sendSlackDmByUserIdWithToken: sendSlackDmByEmail,
      recordAutoSendDecision: mock.fn(async () => undefined),
    });

    const result = await executeAutoSend(
      createContext({
        emailCampaign: createCampaign(),
        validateImmediateSend: false,
      })
    );

    assert.equal(result.mode, "AI_AUTO_SEND");
    assert.equal(result.outcome.action, "error");
    assert.equal(result.outcome.error, "send_failed");
    assert.equal(sendSlackDmByEmail.mock.calls.length, 0);
  });

  it("schedules delayed send when delay window is configured", async () => {
    const runAt = new Date("2026-01-01T00:03:00Z");
    const evaluateAutoSend = mock.fn(async () => ({
      confidence: 0.95,
      safeToSend: true,
      requiresHumanReview: false,
      reason: "Good to send",
    }));
    const getCampaignDelayConfig = mock.fn(async () => ({ delayMinSeconds: 180, delayMaxSeconds: 420 }));
    const scheduleDelayedAutoSend = mock.fn(async () => ({ scheduled: true as const, runAt }));
    const validateDelayedAutoSend = mock.fn(async () => ({ proceed: true }));
    const approveAndSendDraftSystem = mock.fn(async () => ({ success: true, messageId: "sent-1" }));
    const sendSlackDmByEmail = mock.fn(async (_opts: unknown) => ({ success: true }));
    const decideShouldAutoReply = mock.fn(async () => ({ shouldReply: false, reason: "no" }));

    const { executeAutoSend } = createAutoSendExecutor({
      approveAndSendDraftSystem,
      decideShouldAutoReply,
      evaluateAutoSend,
      getPublicAppUrl: () => "https://app.example.com",
      getCampaignDelayConfig,
      scheduleDelayedAutoSend,
      scheduleAutoSendAt: mock.fn(async () => ({ scheduled: false as const, skipReason: "unused" })),
      validateDelayedAutoSend,
      getSlackAutoSendApprovalConfig: mock.fn(async () => defaultSlackApprovalConfig),
      sendSlackDmByUserIdWithToken: sendSlackDmByEmail,
      recordAutoSendDecision: mock.fn(async () => undefined),
    });

    const result = await executeAutoSend(
      createContext({
        emailCampaign: createCampaign(),
        includeDraftPreviewInSlack: true,
      })
    );

    assert.equal(result.outcome.action, "send_delayed");
    assert.equal(approveAndSendDraftSystem.mock.calls.length, 0);
  });

  it("does not fallback to immediate send if delayed send is already scheduled", async () => {
    const evaluateAutoSend = mock.fn(async () => ({
      confidence: 0.95,
      safeToSend: true,
      requiresHumanReview: false,
      reason: "Good to send",
    }));
    const getCampaignDelayConfig = mock.fn(async () => ({ delayMinSeconds: 180, delayMaxSeconds: 420 }));
    const scheduleDelayedAutoSend = mock.fn(async () => ({ scheduled: false as const, skipReason: "already_scheduled" }));
    const validateDelayedAutoSend = mock.fn(async () => ({ proceed: true }));
    const approveAndSendDraftSystem = mock.fn(async () => ({ success: true, messageId: "sent-1" }));
    const sendSlackDmByEmail = mock.fn(async (_opts: unknown) => ({ success: true }));
    const decideShouldAutoReply = mock.fn(async () => ({ shouldReply: false, reason: "no" }));

    const { executeAutoSend } = createAutoSendExecutor({
      approveAndSendDraftSystem,
      decideShouldAutoReply,
      evaluateAutoSend,
      getPublicAppUrl: () => "https://app.example.com",
      getCampaignDelayConfig,
      scheduleDelayedAutoSend,
      scheduleAutoSendAt: mock.fn(async () => ({ scheduled: false as const, skipReason: "unused" })),
      validateDelayedAutoSend,
      getSlackAutoSendApprovalConfig: mock.fn(async () => defaultSlackApprovalConfig),
      sendSlackDmByUserIdWithToken: sendSlackDmByEmail,
      recordAutoSendDecision: mock.fn(async () => undefined),
    });

    const result = await executeAutoSend(
      createContext({
        emailCampaign: createCampaign(),
      })
    );

    assert.equal(result.outcome.action, "skip");
    assert.equal(approveAndSendDraftSystem.mock.calls.length, 0);
  });

  it("skips immediate send when validateDelayedAutoSend fails", async () => {
    const evaluateAutoSend = mock.fn(async () => ({
      confidence: 0.95,
      safeToSend: true,
      requiresHumanReview: false,
      reason: "Good to send",
    }));
    const getCampaignDelayConfig = mock.fn(async () => null);
    const validateDelayedAutoSend = mock.fn(async () => ({ proceed: false, reason: "newer_inbound" }));
    const approveAndSendDraftSystem = mock.fn(async () => ({ success: true, messageId: "sent-1" }));
    const scheduleDelayedAutoSend = mock.fn(async () => ({ scheduled: true as const, runAt: new Date() }));
    const sendSlackDmByEmail = mock.fn(async (_opts: unknown) => ({ success: true }));
    const decideShouldAutoReply = mock.fn(async () => ({ shouldReply: false, reason: "no" }));

    const { executeAutoSend } = createAutoSendExecutor({
      approveAndSendDraftSystem,
      decideShouldAutoReply,
      evaluateAutoSend,
      getPublicAppUrl: () => "https://app.example.com",
      getCampaignDelayConfig,
      scheduleDelayedAutoSend,
      scheduleAutoSendAt: mock.fn(async () => ({ scheduled: false as const, skipReason: "unused" })),
      validateDelayedAutoSend,
      getSlackAutoSendApprovalConfig: mock.fn(async () => defaultSlackApprovalConfig),
      sendSlackDmByUserIdWithToken: sendSlackDmByEmail,
      recordAutoSendDecision: mock.fn(async () => undefined),
    });

    const result = await executeAutoSend(
      createContext({
        emailCampaign: createCampaign(),
        validateImmediateSend: true,
      })
    );

    assert.equal(result.outcome.action, "skip");
    assert.equal(approveAndSendDraftSystem.mock.calls.length, 0);
    assert.equal(validateDelayedAutoSend.mock.calls.length, 1);
    assert.deepEqual(validateDelayedAutoSend.mock.calls[0]?.arguments, [
      { leadId: "lead-1", triggerMessageId: "msg-1", draftId: "draft-1" },
    ]);
  });

  it("uses unknown_reason when immediate-send validation fails without a reason", async () => {
    const evaluateAutoSend = mock.fn(async () => ({
      confidence: 0.95,
      safeToSend: true,
      requiresHumanReview: false,
      reason: "Good to send",
    }));
    const getCampaignDelayConfig = mock.fn(async () => null);
    const validateDelayedAutoSend = mock.fn(async () => ({ proceed: false }));

    const { executeAutoSend } = createAutoSendExecutor({
      approveAndSendDraftSystem: mock.fn(async () => ({ success: true, messageId: "sent-1" })),
      decideShouldAutoReply: mock.fn(async () => ({ shouldReply: false, reason: "unused" })),
      evaluateAutoSend,
      getPublicAppUrl: () => "https://app.example.com",
      getCampaignDelayConfig,
      scheduleDelayedAutoSend: mock.fn(async () => ({ scheduled: false as const, skipReason: "unused" })),
      scheduleAutoSendAt: mock.fn(async () => ({ scheduled: false as const, skipReason: "unused" })),
      validateDelayedAutoSend,
      getSlackAutoSendApprovalConfig: mock.fn(async () => defaultSlackApprovalConfig),
      sendSlackDmByUserIdWithToken: mock.fn(async (_opts: unknown) => ({ success: true })),
      recordAutoSendDecision: mock.fn(async () => undefined),
    });

    const result = await executeAutoSend(
      createContext({
        emailCampaign: createCampaign(),
        validateImmediateSend: true,
      })
    );

    assert.equal(result.mode, "AI_AUTO_SEND");
    assert.equal(result.outcome.action, "skip");
    assert.equal(result.outcome.reason, "immediate_send_validation_failed:unknown_reason");
    assert.equal(result.telemetry.immediateValidationSkipReason, "unknown_reason");
  });

  it("sends Slack review DM when safeToSend=false, including draft preview when enabled", async () => {
    const evaluateAutoSend = mock.fn(async () => ({
      confidence: 0.5,
      safeToSend: false,
      requiresHumanReview: true,
      reason: "Review needed",
    }));
    const getCampaignDelayConfig = mock.fn(async () => null);
    const scheduleDelayedAutoSend = mock.fn(async () => ({ scheduled: true as const, runAt: new Date() }));
    const validateDelayedAutoSend = mock.fn(async () => ({ proceed: true }));
    const approveAndSendDraftSystem = mock.fn(async () => ({ success: true, messageId: "sent-1" }));
    const sendSlackDmByEmail = mock.fn(async (_opts: unknown) => ({ success: true }));
    const recordAutoSendDecision = mock.fn(async () => undefined);
    const decideShouldAutoReply = mock.fn(async () => ({ shouldReply: false, reason: "no" }));

    const { executeAutoSend } = createAutoSendExecutor({
      approveAndSendDraftSystem,
      decideShouldAutoReply,
      evaluateAutoSend,
      getPublicAppUrl: () => "https://app.example.com",
      getCampaignDelayConfig,
      scheduleDelayedAutoSend,
      scheduleAutoSendAt: mock.fn(async () => ({ scheduled: false as const, skipReason: "unused" })),
      validateDelayedAutoSend,
      getSlackAutoSendApprovalConfig: mock.fn(async () => defaultSlackApprovalConfig),
      sendSlackDmByUserIdWithToken: sendSlackDmByEmail,
      recordAutoSendDecision,
    });

    const result = await executeAutoSend(
      createContext({
        emailCampaign: createCampaign(),
        includeDraftPreviewInSlack: true,
      })
    );

    assert.equal(result.outcome.action, "needs_review");
    assert.equal(sendSlackDmByEmail.mock.calls.length, 1);
    assert.equal(recordAutoSendDecision.mock.calls.length, 1);
    const recordArg = (recordAutoSendDecision.mock.calls as unknown[])[0] as { arguments: [{ action?: string }] };
    assert.equal(recordArg?.arguments[0]?.action, "needs_review");

    const opts = sendSlackDmByEmail.mock.calls[0]?.arguments[0] as { blocks?: Array<{ type: string; text?: { text?: string } }> };
    const hasDraftPreviewBlock = (opts.blocks || []).some((b) => b.type === "section" && (b.text?.text || "").includes("*Draft Preview:*"));
    assert.equal(hasDraftPreviewBlock, true);

    const inboundBlock = (opts.blocks || []).find(
      (b) => b.type === "section" && (b.text?.text || "").includes("*Lead Message Preview:*")
    );
    assert.equal(Boolean(inboundBlock), true);
    const inboundText = inboundBlock?.text?.text || "";
    assert.equal(inboundText.includes("Re: Subject"), true);
    assert.equal(inboundText.includes("Inbound message body"), true);

    const actionsBlock = (opts.blocks || []).find((b: any) => b.type === "actions");
    const actionIds = (actionsBlock?.elements || []).map((e: any) => e.action_id);
    assert.equal(actionIds.includes("regenerate_draft_fast"), true);

    const regenButton = (actionsBlock?.elements || []).find((e: any) => e.action_id === "regenerate_draft_fast");
    assert.equal(typeof regenButton?.value, "string");
    const regenValue = JSON.parse(regenButton.value) as { cycleSeed?: string; regenCount?: number };
    assert.equal(regenValue.cycleSeed, "draft-1");
    assert.equal(regenValue.regenCount, 0);
  });

  it("renders Unknown lead name in Slack blocks when lead info is missing", async () => {
    const evaluateAutoSend = mock.fn(async () => ({
      confidence: 0.5,
      safeToSend: false,
      requiresHumanReview: true,
      reason: "Review needed",
    }));
    const sendSlackDmByEmail = mock.fn(async (_opts: unknown) => ({ success: true }));

    const { executeAutoSend } = createAutoSendExecutor({
      approveAndSendDraftSystem: mock.fn(async () => ({ success: true, messageId: "sent-1" })),
      decideShouldAutoReply: mock.fn(async () => ({ shouldReply: false, reason: "unused" })),
      evaluateAutoSend,
      getPublicAppUrl: () => "https://app.example.com",
      getCampaignDelayConfig: mock.fn(async () => null),
      scheduleDelayedAutoSend: mock.fn(async () => ({ scheduled: false as const, skipReason: "unused" })),
      scheduleAutoSendAt: mock.fn(async () => ({ scheduled: false as const, skipReason: "unused" })),
      validateDelayedAutoSend: mock.fn(async () => ({ proceed: true })),
      getSlackAutoSendApprovalConfig: mock.fn(async () => defaultSlackApprovalConfig),
      sendSlackDmByUserIdWithToken: sendSlackDmByEmail,
      recordAutoSendDecision: mock.fn(async () => undefined),
    });

    await executeAutoSend(
      createContext({
        emailCampaign: createCampaign(),
        leadFirstName: null,
        leadLastName: null,
        leadEmail: null,
        includeDraftPreviewInSlack: false,
      })
    );

    assert.equal(sendSlackDmByEmail.mock.calls.length, 1);
    const opts = sendSlackDmByEmail.mock.calls[0]?.arguments[0] as {
      blocks?: Array<{ type: string; fields?: Array<{ type: string; text: string }> }>;
    };

    const leadBlock = (opts.blocks || []).find((b) => b.type === "section" && Array.isArray(b.fields));
    const leadFieldText = leadBlock?.fields?.[0]?.text || "";
    assert.equal(leadFieldText.includes("Unknown"), true);
    assert.equal(leadFieldText.includes("john@example.com"), false);
  });

  it("omits draft preview in Slack blocks when includeDraftPreviewInSlack=false", async () => {
    const evaluateAutoSend = mock.fn(async () => ({
      confidence: 0.5,
      safeToSend: false,
      requiresHumanReview: true,
      reason: "Review needed",
    }));
    const getCampaignDelayConfig = mock.fn(async () => null);
    const scheduleDelayedAutoSend = mock.fn(async () => ({ scheduled: true as const, runAt: new Date() }));
    const validateDelayedAutoSend = mock.fn(async () => ({ proceed: true }));
    const approveAndSendDraftSystem = mock.fn(async () => ({ success: true, messageId: "sent-1" }));
    const sendSlackDmByEmail = mock.fn(async (_opts: unknown) => ({ success: true }));
    const decideShouldAutoReply = mock.fn(async () => ({ shouldReply: false, reason: "no" }));

    const { executeAutoSend } = createAutoSendExecutor({
      approveAndSendDraftSystem,
      decideShouldAutoReply,
      evaluateAutoSend,
      getPublicAppUrl: () => "https://app.example.com",
      getCampaignDelayConfig,
      scheduleDelayedAutoSend,
      scheduleAutoSendAt: mock.fn(async () => ({ scheduled: false as const, skipReason: "unused" })),
      validateDelayedAutoSend,
      getSlackAutoSendApprovalConfig: mock.fn(async () => defaultSlackApprovalConfig),
      sendSlackDmByUserIdWithToken: sendSlackDmByEmail,
      recordAutoSendDecision: mock.fn(async () => undefined),
    });

    await executeAutoSend(
      createContext({
        emailCampaign: createCampaign(),
        includeDraftPreviewInSlack: false,
      })
    );

    const opts = sendSlackDmByEmail.mock.calls[0]?.arguments[0] as { blocks?: Array<{ type: string; text?: { text?: string } }> };
    const hasDraftPreviewBlock = (opts.blocks || []).some((b) => b.type === "section" && (b.text?.text || "").includes("*Draft Preview:*"));
    assert.equal(hasDraftPreviewBlock, false);

    const hasInboundPreviewBlock = (opts.blocks || []).some(
      (b) => b.type === "section" && (b.text?.text || "").includes("*Lead Message Preview:*")
    );
    assert.equal(hasInboundPreviewBlock, true);
  });
});

describe("executeAutoSend - LEGACY_AUTO_REPLY path", () => {
  it("sends when decideShouldAutoReply returns shouldReply=true", async () => {
    const decideShouldAutoReply = mock.fn(async () => ({ shouldReply: true, reason: "Ok" }));
    const approveAndSendDraftSystem = mock.fn(async () => ({ success: true, messageId: "sent-legacy" }));

    const { executeAutoSend } = createAutoSendExecutor({
      approveAndSendDraftSystem,
      decideShouldAutoReply,
      evaluateAutoSend: mock.fn(async () => ({
        confidence: 0,
        safeToSend: false,
        requiresHumanReview: true,
        reason: "unused",
      })),
      getPublicAppUrl: () => "https://app.example.com",
      getCampaignDelayConfig: mock.fn(async () => null),
      scheduleDelayedAutoSend: mock.fn(async () => ({ scheduled: false as const, skipReason: "unused" })),
      scheduleAutoSendAt: mock.fn(async () => ({ scheduled: false as const, skipReason: "unused" })),
      validateDelayedAutoSend: mock.fn(async () => ({ proceed: true })),
      getSlackAutoSendApprovalConfig: mock.fn(async () => defaultSlackApprovalConfig),
      sendSlackDmByUserIdWithToken: mock.fn(async (_opts: unknown) => ({ success: true })),
      recordAutoSendDecision: mock.fn(async () => undefined),
    });

    const result = await executeAutoSend(
      createContext({
        emailCampaign: null,
        autoReplyEnabled: true,
      })
    );

    assert.equal(result.mode, "LEGACY_AUTO_REPLY");
    assert.equal(result.outcome.action, "send_immediate");
    assert.equal(approveAndSendDraftSystem.mock.calls.length, 1);
  });

  it("returns error when approveAndSendDraftSystem fails", async () => {
    const decideShouldAutoReply = mock.fn(async () => ({ shouldReply: true, reason: "Ok" }));
    const approveAndSendDraftSystem = mock.fn(async () => ({ success: false, error: "send_failed" }));

    const { executeAutoSend } = createAutoSendExecutor({
      approveAndSendDraftSystem,
      decideShouldAutoReply,
      evaluateAutoSend: mock.fn(async () => ({
        confidence: 0,
        safeToSend: false,
        requiresHumanReview: true,
        reason: "unused",
      })),
      getPublicAppUrl: () => "https://app.example.com",
      getCampaignDelayConfig: mock.fn(async () => null),
      scheduleDelayedAutoSend: mock.fn(async () => ({ scheduled: false as const, skipReason: "unused" })),
      scheduleAutoSendAt: mock.fn(async () => ({ scheduled: false as const, skipReason: "unused" })),
      validateDelayedAutoSend: mock.fn(async () => ({ proceed: true })),
      getSlackAutoSendApprovalConfig: mock.fn(async () => defaultSlackApprovalConfig),
      sendSlackDmByUserIdWithToken: mock.fn(async (_opts: unknown) => ({ success: true })),
      recordAutoSendDecision: mock.fn(async () => undefined),
    });

    const result = await executeAutoSend(
      createContext({
        emailCampaign: null,
        autoReplyEnabled: true,
      })
    );

    assert.equal(result.mode, "LEGACY_AUTO_REPLY");
    assert.equal(result.outcome.action, "error");
    assert.equal(result.outcome.error, "send_failed");
  });

  it("skips when decideShouldAutoReply returns shouldReply=false", async () => {
    const decideShouldAutoReply = mock.fn(async () => ({ shouldReply: false, reason: "Ack-only" }));
    const approveAndSendDraftSystem = mock.fn(async () => ({ success: true, messageId: "sent-legacy" }));

    const { executeAutoSend } = createAutoSendExecutor({
      approveAndSendDraftSystem,
      decideShouldAutoReply,
      evaluateAutoSend: mock.fn(async () => ({
        confidence: 0,
        safeToSend: false,
        requiresHumanReview: true,
        reason: "unused",
      })),
      getPublicAppUrl: () => "https://app.example.com",
      getCampaignDelayConfig: mock.fn(async () => null),
      scheduleDelayedAutoSend: mock.fn(async () => ({ scheduled: false as const, skipReason: "unused" })),
      scheduleAutoSendAt: mock.fn(async () => ({ scheduled: false as const, skipReason: "unused" })),
      validateDelayedAutoSend: mock.fn(async () => ({ proceed: true })),
      getSlackAutoSendApprovalConfig: mock.fn(async () => defaultSlackApprovalConfig),
      sendSlackDmByUserIdWithToken: mock.fn(async (_opts: unknown) => ({ success: true })),
      recordAutoSendDecision: mock.fn(async () => undefined),
    });

    const result = await executeAutoSend(
      createContext({
        emailCampaign: null,
        autoReplyEnabled: true,
      })
    );

    assert.equal(result.mode, "LEGACY_AUTO_REPLY");
    assert.equal(result.outcome.action, "skip");
    assert.equal(approveAndSendDraftSystem.mock.calls.length, 0);
  });
});

describe("executeAutoSend - DISABLED + debug logging", () => {
  it("returns skip in DISABLED mode and logs when AUTO_SEND_DEBUG=1", async () => {
    const previousDebug = process.env.AUTO_SEND_DEBUG;
    process.env.AUTO_SEND_DEBUG = "1";

    const logMock = mock.method(console, "log", () => undefined);

    try {
      const { executeAutoSend } = createAutoSendExecutor({
        approveAndSendDraftSystem: mock.fn(async () => ({ success: true, messageId: "unused" })),
        decideShouldAutoReply: mock.fn(async () => ({ shouldReply: false, reason: "unused" })),
        evaluateAutoSend: mock.fn(async () => ({
          confidence: 0,
          safeToSend: false,
          requiresHumanReview: true,
          reason: "unused",
        })),
        getPublicAppUrl: () => "https://app.example.com",
        getCampaignDelayConfig: mock.fn(async () => null),
        scheduleDelayedAutoSend: mock.fn(async () => ({ scheduled: false as const, skipReason: "unused" })),
        scheduleAutoSendAt: mock.fn(async () => ({ scheduled: false as const, skipReason: "unused" })),
        validateDelayedAutoSend: mock.fn(async () => ({ proceed: true })),
        getSlackAutoSendApprovalConfig: mock.fn(async () => defaultSlackApprovalConfig),
        sendSlackDmByUserIdWithToken: mock.fn(async (_opts: unknown) => ({ success: true })),
        recordAutoSendDecision: mock.fn(async () => undefined),
      });

      const result = await executeAutoSend(
        createContext({
          emailCampaign: createCampaign({ responseMode: "SETTER_MANAGED" }),
          autoReplyEnabled: true,
        })
      );

      assert.equal(result.mode, "DISABLED");
      assert.equal(result.outcome.action, "skip");
      assert.equal(result.outcome.reason, "auto_send_disabled");
      assert.equal(logMock.mock.calls.length, 1);
      assert.equal(String(logMock.mock.calls[0]?.arguments[0]).includes("[AutoSend] Complete"), true);
    } finally {
      logMock.mock.restore();
      if (previousDebug === undefined) {
        delete process.env.AUTO_SEND_DEBUG;
      } else {
        process.env.AUTO_SEND_DEBUG = previousDebug;
      }
    }
  });

  it("logs starting and complete for non-disabled mode when AUTO_SEND_DEBUG=1", async () => {
    const previousDebug = process.env.AUTO_SEND_DEBUG;
    process.env.AUTO_SEND_DEBUG = "1";

    const logMock = mock.method(console, "log", () => undefined);

    try {
      const decideShouldAutoReply = mock.fn(async () => ({ shouldReply: false, reason: "Ack-only" }));

      const { executeAutoSend } = createAutoSendExecutor({
        approveAndSendDraftSystem: mock.fn(async () => ({ success: true, messageId: "unused" })),
        decideShouldAutoReply,
        evaluateAutoSend: mock.fn(async () => ({
          confidence: 0,
          safeToSend: false,
          requiresHumanReview: true,
          reason: "unused",
        })),
        getPublicAppUrl: () => "https://app.example.com",
        getCampaignDelayConfig: mock.fn(async () => null),
        scheduleDelayedAutoSend: mock.fn(async () => ({ scheduled: false as const, skipReason: "unused" })),
        scheduleAutoSendAt: mock.fn(async () => ({ scheduled: false as const, skipReason: "unused" })),
        validateDelayedAutoSend: mock.fn(async () => ({ proceed: true })),
        getSlackAutoSendApprovalConfig: mock.fn(async () => defaultSlackApprovalConfig),
        sendSlackDmByUserIdWithToken: mock.fn(async (_opts: unknown) => ({ success: true })),
        recordAutoSendDecision: mock.fn(async () => undefined),
      });

      const result = await executeAutoSend(
        createContext({
          emailCampaign: null,
          autoReplyEnabled: true,
        })
      );

      assert.equal(result.mode, "LEGACY_AUTO_REPLY");
      assert.equal(result.outcome.action, "skip");

      assert.equal(logMock.mock.calls.length, 2);
      assert.equal(String(logMock.mock.calls[0]?.arguments[0]).includes("[AutoSend] Starting"), true);
      assert.equal(String(logMock.mock.calls[1]?.arguments[0]).includes("[AutoSend] Complete"), true);
    } finally {
      logMock.mock.restore();
      if (previousDebug === undefined) {
        delete process.env.AUTO_SEND_DEBUG;
      } else {
        process.env.AUTO_SEND_DEBUG = previousDebug;
      }
    }
  });

  it("default exported executeAutoSend returns DISABLED without calling external deps", async () => {
    const result = await executeAutoSendDefault(
      createContext({
        emailCampaign: createCampaign({ responseMode: "SETTER_MANAGED" }),
        autoReplyEnabled: true,
      })
    );

    assert.equal(result.mode, "DISABLED");
    assert.equal(result.outcome.action, "skip");
    assert.equal(result.outcome.reason, "auto_send_disabled");
  });
});
