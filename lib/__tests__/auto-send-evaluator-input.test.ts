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
      leadMemoryContext: "Prior context: test@example.com",
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
      leadPhoneOnFile: true,
      actionSignalCallRequested: true,
      actionSignalExternalCalendar: false,
      actionSignalRouteSummary: "route summary",
      budgets: {
        conversationHistoryTokens: 50,
        serviceDescriptionTokens: 40,
        goalsTokens: 20,
        knowledgeContextTokens: 60,
        knowledgeAssetTokens: 50,
      },
    });

    const payload = JSON.parse(input.inputJson) as any;
    assert.equal(input.stats.conversationHistory.truncated, true);
    assert.equal(input.stats.serviceDescription.truncated, true);
    assert.equal(input.stats.goals.truncated, true);
    assert.ok(input.inputJson.includes("verified_context_instructions"));
    assert.ok(input.inputJson.includes("knowledge_context"));
    assert.ok("lead_memory_context" in payload);
    assert.equal(payload.lead_memory_context, "Prior context: test@example.com");
    assert.ok("service_description" in payload);
    assert.ok("goals" in payload);
    assert.ok("knowledge_context" in payload);
    assert.ok("pricing_terms_verified" in payload);
    assert.ok("pricing_terms_draft" in payload);
    assert.ok("pricing_terms_mismatch" in payload);
    assert.ok("pricingCadence" in input.stats);
    assert.equal(payload.lead_phone_on_file, true);
    assert.equal(payload.action_signal_call_requested, true);
    assert.equal(payload.action_signal_external_calendar, false);
    assert.equal(payload.action_signal_route_summary, "route summary");
  });

  it("flags pricing cadence mismatch when draft conflicts with verified context", () => {
    const input = buildAutoSendEvaluatorInput({
      channel: "email",
      subject: "Pricing details",
      latestInbound: "Can you share pricing?",
      conversationHistory: "Lead asked for pricing",
      categorization: "Information Requested",
      automatedReply: null,
      replyReceivedAtIso: "2026-02-05T00:00:00Z",
      draft: "Our plan is $1,700 per month.",
      workspaceContext: {
        serviceDescription: "Pricing is $1,700 per quarter. Quarterly only. No monthly payment plan.",
        goals: null,
        knowledgeAssets: [],
      },
    });

    const payload = JSON.parse(input.inputJson) as any;
    assert.equal(payload.pricing_terms_mismatch?.has_mismatch, true);
    assert.equal(Array.isArray(payload.pricing_terms_mismatch?.mismatches), true);
    assert.equal(payload.pricing_terms_mismatch.mismatches.length > 0, true);
    assert.equal(input.stats.pricingCadence.hasMismatch, true);
  });
});
