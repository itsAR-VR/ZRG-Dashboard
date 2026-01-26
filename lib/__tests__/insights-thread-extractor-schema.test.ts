import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { z } from "zod";

// Mirror of ObjectionResponseSchema from `lib/insights-chat/thread-extractor.ts`.
// We intentionally recreate it here (instead of importing the module) to avoid
// pulling in Prisma/env-dependent server modules during unit tests.
const OBJECTION_TYPES = ["pricing", "timing", "authority", "need", "trust", "competitor", "none"] as const;

const ObjectionResponseSchema = z.object({
  objection_type: z.enum(OBJECTION_TYPES),
  agent_response: z.string().transform((val) => val.slice(0, 300)),
  outcome: z.enum(["positive", "negative", "neutral"]),
});

describe("ObjectionResponseSchema", () => {
  it("truncates agent_response longer than 300 chars", () => {
    const longResponse = "A".repeat(500);
    const input = {
      objection_type: "pricing" as const,
      agent_response: longResponse,
      outcome: "positive" as const,
    };

    const result = ObjectionResponseSchema.parse(input);
    assert.equal(result.agent_response.length, 300);
    assert.equal(result.agent_response, "A".repeat(300));
  });

  it("preserves agent_response at exactly 300 chars", () => {
    const exactResponse = "B".repeat(300);
    const input = {
      objection_type: "timing" as const,
      agent_response: exactResponse,
      outcome: "neutral" as const,
    };

    const result = ObjectionResponseSchema.parse(input);
    assert.equal(result.agent_response.length, 300);
    assert.equal(result.agent_response, exactResponse);
  });

  it("preserves short agent_response unchanged", () => {
    const shortResponse = "Quick reply";
    const input = {
      objection_type: "need" as const,
      agent_response: shortResponse,
      outcome: "negative" as const,
    };

    const result = ObjectionResponseSchema.parse(input);
    assert.equal(result.agent_response, shortResponse);
  });

  it("handles empty string agent_response", () => {
    const input = {
      objection_type: "authority" as const,
      agent_response: "",
      outcome: "neutral" as const,
    };

    const result = ObjectionResponseSchema.parse(input);
    assert.equal(result.agent_response, "");
  });

  it("validates objection_type enum", () => {
    const input = {
      objection_type: "invalid_type",
      agent_response: "test",
      outcome: "positive",
    };

    assert.throws(() => ObjectionResponseSchema.parse(input));
  });

  it("validates outcome enum", () => {
    const input = {
      objection_type: "pricing" as const,
      agent_response: "test",
      outcome: "invalid_outcome",
    };

    assert.throws(() => ObjectionResponseSchema.parse(input));
  });

  it("accepts all valid objection_type values", () => {
    const objectionTypes = ["pricing", "timing", "authority", "need", "trust", "competitor", "none"] as const;

    for (const objectionType of objectionTypes) {
      const input = {
        objection_type: objectionType,
        agent_response: "test response",
        outcome: "positive" as const,
      };

      const result = ObjectionResponseSchema.parse(input);
      assert.equal(result.objection_type, objectionType);
    }
  });

  it("accepts all valid outcome values", () => {
    const outcomes = ["positive", "negative", "neutral"] as const;

    for (const outcome of outcomes) {
      const input = {
        objection_type: "pricing" as const,
        agent_response: "test response",
        outcome,
      };

      const result = ObjectionResponseSchema.parse(input);
      assert.equal(result.outcome, outcome);
    }
  });
});

