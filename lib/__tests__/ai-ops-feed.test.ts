import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { __aiOpsFeedInternals } from "@/actions/ai-ops-feed-actions";

describe("AI ops feed internals", () => {
  it("parseCursorDate returns null for invalid input", () => {
    assert.equal(__aiOpsFeedInternals.parseCursorDate(null), null);
    assert.equal(__aiOpsFeedInternals.parseCursorDate(""), null);
    assert.equal(__aiOpsFeedInternals.parseCursorDate("not-a-date"), null);
  });

  it("parseCursorDate parses a valid ISO timestamp", () => {
    const d = __aiOpsFeedInternals.parseCursorDate("2026-02-06T12:34:56.789Z");
    assert.ok(d instanceof Date);
    assert.equal(d?.toISOString(), "2026-02-06T12:34:56.789Z");
  });

  it("extractAiInteractionSummary reads bookingGate summaries only", () => {
    const summary = __aiOpsFeedInternals.extractAiInteractionSummary({
      bookingGate: {
        decision: "approve",
        confidence: 0.83,
        issuesCount: 2,
        // Should be ignored if present.
        messageText: "do not leak this",
      },
      otherTopLevel: { messageText: "do not leak this either" },
    });

    assert.deepEqual(summary, { decision: "approve", confidence: 0.83, issuesCount: 2 });
  });

  it("extractOverseerPayloadSummary omits evidence and returns intent/status for extract", () => {
    const summary = __aiOpsFeedInternals.extractOverseerPayloadSummary("extract", {
      intent: "accept_offer",
      is_scheduling_related: true,
      evidence: ["quoted message should not be surfaced"],
      clarification_reason: "should not be surfaced",
    });

    assert.deepEqual(summary, { status: "accept_offer", decision: null, issuesCount: null });
  });

  it("extractOverseerPayloadSummary returns decision + issuesCount for gate/booking_gate", () => {
    const gate = __aiOpsFeedInternals.extractOverseerPayloadSummary("gate", {
      decision: "revise",
      issues: ["too_long", "too_pushy"],
      rationale: "should not be surfaced",
    });

    assert.deepEqual(gate, { status: null, decision: "revise", issuesCount: 2 });

    const bookingGate = __aiOpsFeedInternals.extractOverseerPayloadSummary("booking_gate", {
      decision: "needs_clarification",
      issues: ["timezone_unknown"],
      clarification_message: "What timezone are you in?",
    });

    assert.deepEqual(bookingGate, { status: null, decision: "needs_clarification", issuesCount: 1 });
  });
});

