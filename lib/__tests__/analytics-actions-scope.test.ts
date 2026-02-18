import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

describe("analytics action scope + window guards", () => {
  it("uses shared workspace scope resolution instead of owner/member-only checks", () => {
    const source = read("actions/analytics-actions.ts");
    assert.match(
      source,
      /resolveAnalyticsClientScope\(user,\s*clientId\)/,
      "expected getAnalytics to validate workspace access via shared scope resolution"
    );
    assert.ok(
      !source.includes("accessibleClientWhere("),
      "expected analytics actions to avoid owner/member-only filters that bypass super-admin scope"
    );
  });

  it("treats analytics window end bounds as exclusive when building daily stats labels", () => {
    const source = read("actions/analytics-actions.ts");
    assert.match(
      source,
      /Math\.max\(statsStartDay\.getTime\(\), statsTo\.getTime\(\) - 1\)/,
      "expected weekly stats day labels to remain valid for single-day exclusive-end windows"
    );
  });

  it("preserves auth error semantics instead of collapsing them into generic 500s", () => {
    const source = read("actions/analytics-actions.ts");
    assert.match(
      source,
      /message === "Not authenticated" \|\| message === "Unauthorized"/,
      "expected analytics actions to propagate auth failures for proper status mapping"
    );
  });
});
