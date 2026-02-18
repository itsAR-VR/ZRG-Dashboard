import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

describe("response timing analytics SQL guards", () => {
  it("uses bigint for AI drift ms to avoid integer overflow on delayed jobs", () => {
    const source = read("actions/response-timing-analytics-actions.ts");
    assert.match(
      source,
      /\)\s*::bigint as drift_ms/,
      "expected AI drift bucketing query to cast to bigint instead of int"
    );
    assert.ok(
      !source.includes(")::int as drift_ms"),
      "expected AI drift bucketing query to avoid int cast overflow risk"
    );
  });

  it("uses an explicit interactive transaction timeout budget for heavy analytics reads", () => {
    const source = read("actions/response-timing-analytics-actions.ts");
    assert.match(
      source,
      /},\s*\{\s*timeout:\s*15000,\s*maxWait:\s*5000\s*}\);/,
      "expected response-timing analytics transaction to declare timeout/maxWait options"
    );
  });
});
