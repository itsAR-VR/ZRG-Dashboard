import assert from "node:assert/strict";
import test from "node:test";

import { applyFlatPromptOverrides, hashPromptContent, type AIPromptTemplate } from "../ai/prompt-registry";

function makeBaseTemplate(): AIPromptTemplate {
  return {
    key: "test.prompt.v1",
    featureId: "test.prompt",
    name: "Test Prompt",
    description: "",
    model: "gpt-5-mini",
    apiType: "responses",
    messages: [
      { role: "system", content: "SYSTEM_DEFAULT" },
      { role: "user", content: "USER_DEFAULT_0" },
      { role: "user", content: "USER_DEFAULT_1" },
    ],
  };
}

test("applyFlatPromptOverrides: system override applies when valid", () => {
  const base = makeBaseTemplate();
  const out = applyFlatPromptOverrides({
    base,
    workspaceOverrides: [],
    systemOverrides: [
      {
        role: "user",
        index: 0,
        content: "USER_SYSTEM",
        baseContentHash: hashPromptContent("USER_DEFAULT_0"),
        updatedAt: new Date("2026-02-10T12:00:00.000Z"),
      },
    ],
  });

  assert.equal(out.template.messages[1]?.content, "USER_SYSTEM");
  assert.equal(out.overrideVersion, "sys_202602101200");
  assert.equal(out.hasWorkspaceOverrides, false);
  assert.equal(out.appliedSystemCount, 1);
  assert.equal(out.appliedWorkspaceCount, 0);
});

test("applyFlatPromptOverrides: workspace override wins over system default", () => {
  const base = makeBaseTemplate();
  const out = applyFlatPromptOverrides({
    base,
    workspaceOverrides: [
      {
        role: "user",
        index: 0,
        content: "USER_WORKSPACE",
        baseContentHash: hashPromptContent("USER_DEFAULT_0"),
        updatedAt: new Date("2026-02-10T13:00:00.000Z"),
      },
    ],
    systemOverrides: [
      {
        role: "user",
        index: 0,
        content: "USER_SYSTEM",
        baseContentHash: hashPromptContent("USER_DEFAULT_0"),
        updatedAt: new Date("2026-02-10T12:00:00.000Z"),
      },
    ],
  });

  assert.equal(out.template.messages[1]?.content, "USER_WORKSPACE");
  assert.equal(out.overrideVersion, "ws_202602101300");
  assert.equal(out.hasWorkspaceOverrides, true);
  assert.equal(out.appliedSystemCount, 0);
  assert.equal(out.appliedWorkspaceCount, 1);
});

test("applyFlatPromptOverrides: stale workspace override falls back to valid system default", () => {
  const base = makeBaseTemplate();
  const out = applyFlatPromptOverrides({
    base,
    workspaceOverrides: [
      {
        role: "user",
        index: 0,
        content: "USER_WORKSPACE",
        baseContentHash: "deadbeefdeadbeef", // mismatch
        updatedAt: new Date("2026-02-10T13:00:00.000Z"),
      },
    ],
    systemOverrides: [
      {
        role: "user",
        index: 0,
        content: "USER_SYSTEM",
        baseContentHash: hashPromptContent("USER_DEFAULT_0"),
        updatedAt: new Date("2026-02-10T12:00:00.000Z"),
      },
    ],
  });

  assert.equal(out.template.messages[1]?.content, "USER_SYSTEM");
  assert.equal(out.overrideVersion, "sys_202602101200");
  assert.equal(out.hasWorkspaceOverrides, false);
  assert.equal(out.appliedSystemCount, 1);
  assert.equal(out.appliedWorkspaceCount, 0);
});

test("applyFlatPromptOverrides: stale system+workspace overrides fall back to code defaults", () => {
  const base = makeBaseTemplate();
  const out = applyFlatPromptOverrides({
    base,
    workspaceOverrides: [
      {
        role: "user",
        index: 0,
        content: "USER_WORKSPACE",
        baseContentHash: "deadbeefdeadbeef",
        updatedAt: new Date("2026-02-10T13:00:00.000Z"),
      },
    ],
    systemOverrides: [
      {
        role: "user",
        index: 0,
        content: "USER_SYSTEM",
        baseContentHash: "deadbeefdeadbeef",
        updatedAt: new Date("2026-02-10T12:00:00.000Z"),
      },
    ],
  });

  assert.equal(out.template.messages[1]?.content, "USER_DEFAULT_0");
  assert.equal(out.overrideVersion, null);
  assert.equal(out.hasWorkspaceOverrides, false);
  assert.equal(out.appliedSystemCount, 0);
  assert.equal(out.appliedWorkspaceCount, 0);
});

