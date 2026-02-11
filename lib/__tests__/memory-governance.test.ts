import assert from "node:assert/strict";
import test from "node:test";

import { scrubMemoryProposalContent } from "../memory-governance/redaction";
import { decideMemoryProposal, resolveMemoryPolicySettings } from "../memory-governance/policy";

test("memory-governance: scrub strips emails/phones but keeps urls", () => {
  const raw = "Email me at test@example.com or call +1 (555) 123-4567. See https://example.com/pricing.";
  const res = scrubMemoryProposalContent(raw);
  assert.ok(res.content.includes("[redacted-email]"));
  assert.ok(res.content.includes("[redacted-phone]"));
  assert.ok(res.content.includes("https://example.com/pricing"));
});

test("memory-governance: empty allowlist disables auto-approval (fail-closed)", () => {
  const policy = resolveMemoryPolicySettings({ allowlistCategories: [] });
  assert.equal(policy.allowlistCategories.length, 0);

  const decision = decideMemoryProposal(
    {
      scope: "lead",
      category: "timezone_preference",
      content: "Lead prefers America/Los_Angeles timezone for scheduling.",
      ttlDays: 30,
      confidence: 0.95,
    },
    policy
  );

  assert.ok(decision);
  assert.equal(decision.status, "PENDING");
});

test("memory-governance: allowlisted proposal auto-approves when thresholds met", () => {
  const policy = resolveMemoryPolicySettings({
    allowlistCategories: ["timezone_preference"],
    minConfidence: 0.7,
    minTtlDays: 1,
    ttlCapDays: 90,
  });

  const decision = decideMemoryProposal(
    {
      scope: "lead",
      category: "timezone_preference",
      content: "Lead prefers America/Los_Angeles timezone for scheduling.",
      ttlDays: 30,
      confidence: 0.82,
    },
    policy
  );

  assert.ok(decision);
  assert.equal(decision.status, "APPROVED");
  assert.equal(decision.effectiveTtlDays, 30);
});

test("memory-governance: non-allowlisted proposals become PENDING", () => {
  const policy = resolveMemoryPolicySettings({
    allowlistCategories: ["timezone_preference"],
    minConfidence: 0.7,
    minTtlDays: 1,
    ttlCapDays: 90,
  });

  const decision = decideMemoryProposal(
    {
      scope: "lead",
      category: "custom_note",
      content: "Some untrusted note.",
      ttlDays: 30,
      confidence: 0.99,
    },
    policy
  );

  assert.ok(decision);
  assert.equal(decision.status, "PENDING");
});

test("memory-governance: ttlDays is capped by policy ttlCapDays", () => {
  const policy = resolveMemoryPolicySettings({
    allowlistCategories: ["timezone_preference"],
    minConfidence: 0.7,
    minTtlDays: 1,
    ttlCapDays: 90,
  });

  const decision = decideMemoryProposal(
    {
      scope: "lead",
      category: "timezone_preference",
      content: "Lead prefers Pacific time.",
      ttlDays: 365,
      confidence: 0.9,
    },
    policy
  );

  assert.ok(decision);
  assert.equal(decision.effectiveTtlDays, 90);
});
