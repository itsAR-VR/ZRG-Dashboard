import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildAutoSendEvaluatorInput } from "../auto-send-evaluator-input";
import { buildKnowledgeContextFromAssets } from "../knowledge-asset-context";

describe("buildKnowledgeContextFromAssets", () => {
  it("respects token budgets and returns per-asset token/byte stats", () => {
    const assets = [
      {
        name: "Pricing Doc",
        type: "file",
        mimeType: "text/plain",
        originalFileName: "pricing.txt",
        textContent: "Price is $791 per month.\n".repeat(200),
        updatedAt: new Date("2026-02-01T00:00:00Z"),
      },
      {
        name: "FAQ",
        type: "text",
        mimeType: null,
        originalFileName: null,
        textContent: "Short FAQ content.",
        updatedAt: new Date("2026-02-02T00:00:00Z"),
      },
    ];

    const result = buildKnowledgeContextFromAssets({ assets, maxTokens: 120, maxAssetTokens: 80 });

    assert.equal(result.stats.totalAssets, 2);
    assert.ok(result.stats.totalBytes > 0);
    assert.ok(result.stats.totalTokensEstimated > 0);
    assert.ok(result.stats.perAsset.length >= 2);
    assert.ok(result.stats.includedTokensEstimated <= 120);
    assert.ok(result.context.includes("[FAQ]") || result.context.includes("[Pricing Doc]"));
  });
});

describe("buildAutoSendEvaluatorInput", () => {
  it("injects verified workspace context and truncates long fields by token estimate", () => {
    const input = buildAutoSendEvaluatorInput({
      channel: "email",
      subject: "Question",
      latestInbound: "How much does it cost?",
      conversationHistory: "line\n".repeat(10_000),
      categorization: "Information Requested",
      automatedReply: null,
      replyReceivedAtIso: "2026-02-05T00:00:00Z",
      draft: "It costs $791 per month.",
      workspaceContext: {
        serviceDescription: "Service description ".repeat(200),
        goals: "Goals ".repeat(200),
        knowledgeAssets: [
          {
            name: "Pricing Doc",
            type: "text",
            originalFileName: null,
            mimeType: null,
            textContent: "Price is $791 per month.",
            updatedAt: new Date("2026-02-02T00:00:00Z"),
          },
        ],
      },
      budgets: {
        conversationHistoryTokens: 50,
        serviceDescriptionTokens: 40,
        goalsTokens: 20,
        knowledgeContextTokens: 60,
        knowledgeAssetTokens: 50,
      },
    });

    assert.equal(input.stats.conversationHistory.truncated, true);
    assert.equal(input.stats.serviceDescription.truncated, true);
    assert.equal(input.stats.goals.truncated, true);
    assert.ok(input.inputJson.includes("verified_context_instructions"));
    assert.ok(input.inputJson.includes("knowledge_context"));
  });
});

