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
          updatedContent = args?.data?.content ?? null;
          return { count: 1 };
        },
      },
    } as any,
  });

  assert.equal(res.telemetry.attempted, true);
  assert.equal(res.telemetry.improved, true);
  assert.equal(res.revisedDraft?.includes("clarify"), true);
  assert.equal(updatedContent, res.revisedDraft);
});

test("maybeReviseAutoSendDraft: does not persist when confidence does not improve", async () => {
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
        updateMany: async () => {
          updateCalls += 1;
          return { count: 1 };
        },
      },
    } as any,
  });

  assert.equal(res.telemetry.attempted, true);
  assert.equal(res.telemetry.improved, false);
  assert.equal(res.revisedDraft, null);
  assert.equal(updateCalls, 0);
});

