import assert from "node:assert/strict";
import test from "node:test";

import { resolveTemperatureAndReasoning } from "../ai/prompt-runner/runner";

test("prompt runner: gpt-5-mini + temperature uses minimal reasoning (never none)", () => {
  assert.deepEqual(
    resolveTemperatureAndReasoning({ model: "gpt-5-mini", temperature: 0, reasoningEffort: null }),
    { temperature: 0, reasoning: { effort: "minimal" } }
  );
});

test("prompt runner: gpt-5-mini coerces reasoningEffort none -> minimal", () => {
  assert.deepEqual(
    resolveTemperatureAndReasoning({ model: "gpt-5-mini", temperature: null, reasoningEffort: "none" }),
    { reasoning: { effort: "minimal" } }
  );
});

test("prompt runner: gpt-5.2 + temperature defaults to reasoning none", () => {
  assert.deepEqual(
    resolveTemperatureAndReasoning({ model: "gpt-5.2", temperature: 0, reasoningEffort: null }),
    { temperature: 0, reasoning: { effort: "none" } }
  );
});

test("prompt runner: gpt-5.1 + temperature defaults to reasoning none", () => {
  assert.deepEqual(
    resolveTemperatureAndReasoning({ model: "gpt-5.1", temperature: 0, reasoningEffort: null }),
    { temperature: 0, reasoning: { effort: "none" } }
  );
});
