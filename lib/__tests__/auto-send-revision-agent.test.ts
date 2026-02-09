import assert from "node:assert/strict";
import test from "node:test";

import { maybeReviseAutoSendDraft } from "@/lib/auto-send/revision-agent";

test("maybeReviseAutoSendDraft: skips when kill-switch is enabled", async () => {
  const prev = process.env.AUTO_SEND_REVISION_DISABLED;
  process.env.AUTO_SEND_REVISION_DISABLED = "1";
  try {
    const res = await maybeReviseAutoSendDraft({
      clientId: "c1",
      leadId: "l1",
      emailCampaignId: "ec1",
      draftId: "d1",
      channel: "email",
      subject: "Hello",
      latestInbound: "Inbound",
      conversationHistory: "History",
      draft: "Draft",
      evaluation: { confidence: 0.2, safeToSend: false, requiresHumanReview: true, reason: "Low confidence" },
      threshold: 0.9,
      reEvaluate: async () => ({ confidence: 0, safeToSend: false, requiresHumanReview: true, reason: "n/a" }),
    });

    assert.equal(res.telemetry.attempted, false);
    assert.equal(res.revisedDraft, null);
  } finally {
    process.env.AUTO_SEND_REVISION_DISABLED = prev;
  }
});

test("maybeReviseAutoSendDraft: persists revised draft when confidence improves", async () => {
  let updatedContent: string | null = null;
  const updateManyCalls: any[] = [];

  const res = await maybeReviseAutoSendDraft({
    clientId: "c1",
    leadId: "l1",
    emailCampaignId: "ec1",
    draftId: "d1",
    channel: "email",
    subject: "Hello",
    latestInbound: "Inbound asks about pricing",
    conversationHistory: "History",
    draft: "Original draft",
    evaluation: { confidence: 0.4, safeToSend: true, requiresHumanReview: false, reason: "Missing verified pricing context", source: "model" },
    threshold: 0.9,
    reEvaluate: async (draft) => ({
      confidence: draft.includes("clarify") ? 0.92 : 0.1,
      safeToSend: true,
      requiresHumanReview: false,
      reason: "ok",
      source: "model",
    }),
    selectOptimizationContext: async () => ({
      selection: {
        selected_chunk_ids: ["mp:summary"],
        selected_context_markdown: "- Keep it concise",
        what_to_apply: ["Ask one question"],
        what_to_avoid: ["No hard pricing"],
        missing_info: [],
        confidence: 0.8,
      },
      telemetry: { chunksConsidered: 1, candidatesSent: 1, mpPackPresent: true, insightsPackPresent: false },
    }),
    runPrompt: (async () => ({
      success: true,
      data: {
        revised_draft: "Can you clarify what pricing range you're targeting?",
        changes_made: ["Added a single clarifying question"],
        issues_addressed: ["Missing pricing context"],
        confidence: 0.7,
      },
    })) as any,
    db: {
      aIDraft: {
        updateMany: async (args: any) => {
          updateManyCalls.push(args);
          if (typeof args?.data?.content === "string") {
            updatedContent = args.data.content;
          }
          return { count: 1 };
        },
      },
    } as any,
  });

  assert.equal(res.telemetry.attempted, true);
  assert.equal(res.telemetry.improved, true);
  assert.equal(res.revisedDraft?.includes("clarify"), true);
  assert.equal(updatedContent, res.revisedDraft);

  // First DB write should be the one-time attempt claim.
  assert.equal(updateManyCalls.length >= 1, true);
  assert.equal(updateManyCalls[0]?.where?.autoSendRevisionAttemptedAt, null);
  assert.equal(updateManyCalls[0]?.data?.autoSendOriginalConfidence, 0.4);
});

test("maybeReviseAutoSendDraft: does not persist when confidence does not improve", async () => {
  const updateManyCalls: any[] = [];
  let updatedContent: string | null = null;

  const res = await maybeReviseAutoSendDraft({
    clientId: "c1",
    leadId: "l1",
    emailCampaignId: "ec1",
    draftId: "d1",
    channel: "email",
    subject: "Hello",
    latestInbound: "Inbound",
    conversationHistory: "History",
    draft: "Original draft",
    evaluation: { confidence: 0.6, safeToSend: true, requiresHumanReview: false, reason: "Unclear CTA", source: "model" },
    threshold: 0.9,
    reEvaluate: async () => ({
      confidence: 0.5,
      safeToSend: true,
      requiresHumanReview: false,
      reason: "still unclear",
      source: "model",
    }),
    runPrompt: (async () => ({
      success: true,
      data: {
        revised_draft: "Revised draft but not better",
        changes_made: [],
        issues_addressed: [],
        confidence: 0.2,
      },
    })) as any,
    db: {
      aIDraft: {
        updateMany: async (args: any) => {
          updateManyCalls.push(args);
          if (typeof args?.data?.content === "string") {
            updatedContent = args.data.content;
          }
          return { count: 1 };
        },
      },
    } as any,
  });

  assert.equal(res.telemetry.attempted, true);
  assert.equal(res.telemetry.improved, false);
  assert.equal(res.revisedDraft, null);
  assert.equal(updatedContent, null);
  assert.equal(updateManyCalls.length >= 1, true);
});

test("maybeReviseAutoSendDraft: skips when revision attempt is already claimed", async () => {
  let updateCalls = 0;

  const res = await maybeReviseAutoSendDraft({
    clientId: "c1",
    leadId: "l1",
    emailCampaignId: "ec1",
    draftId: "d1",
    channel: "email",
    subject: "Hello",
    latestInbound: "Inbound",
    conversationHistory: "History",
    draft: "Original draft",
    evaluation: { confidence: 0.2, safeToSend: true, requiresHumanReview: false, reason: "Low confidence", source: "model" },
    threshold: 0.9,
    reEvaluate: async () => ({ confidence: 0, safeToSend: false, requiresHumanReview: true, reason: "n/a", source: "model" }),
    runPrompt: (async () => {
      throw new Error("runPrompt should not be called when claim fails");
    }) as any,
    selectOptimizationContext: async () => {
      throw new Error("selectOptimizationContext should not be called when claim fails");
    },
    db: {
      aIDraft: {
        updateMany: async () => {
          updateCalls += 1;
          return { count: 0 }; // Simulate "already claimed" / no-op update
        },
      },
    } as any,
  });

  assert.equal(updateCalls, 1);
  assert.equal(res.telemetry.attempted, false);
  assert.equal(res.revisedDraft, null);
});

test("maybeReviseAutoSendDraft: allows repeat attempts in loop mode (iteration>0) even if already claimed", async () => {
  const updateManyCalls: any[] = [];
  let updatedContent: string | null = null;

  const res = await maybeReviseAutoSendDraft({
    clientId: "c1",
    leadId: "l1",
    emailCampaignId: "ec1",
    draftId: "d1",
    channel: "email",
    iteration: 1,
    subject: "Hello",
    latestInbound: "Inbound asks about pricing",
    conversationHistory: "History",
    draft: "Original draft",
    evaluation: { confidence: 0.4, safeToSend: true, requiresHumanReview: false, reason: "Below threshold", source: "model" },
    threshold: 0.9,
    reEvaluate: async () => ({
      confidence: 0.95,
      safeToSend: true,
      requiresHumanReview: false,
      reason: "Improved",
      source: "model",
    }),
    runPrompt: (async () => ({
      success: true,
      data: {
        revised_draft: "Revised draft content",
        changes_made: ["Added context"],
        issues_addressed: ["Pricing"],
        confidence: 0.7,
      },
    })) as any,
    db: {
      aIDraft: {
        updateMany: async (args: any) => {
          updateManyCalls.push(args);
          if (updateManyCalls.length === 1) {
            return { count: 0 }; // Simulate "already claimed" on the first claim attempt
          }
          if (typeof args?.data?.content === "string") {
            updatedContent = args.data.content;
          }
          return { count: 1 };
        },
      },
    } as any,
  });

  assert.equal(res.telemetry.attempted, true);
  assert.equal(res.telemetry.improved, true);
  assert.equal(res.revisedDraft, "Revised draft content");
  assert.equal(updatedContent, "Revised draft content");
});
