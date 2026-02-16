import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

describe("Analytics response time metrics SQL", () => {
  it("does not cast an aggregate before FILTER", () => {
    const source = read("actions/analytics-actions.ts");

    const normalized = source.replace(/\s+/g, " ");

    assert.ok(
      !normalized.includes("AVG(EXTRACT(EPOCH FROM (next_sent_at - sent_at)) * 1000)::double precision FILTER"),
      "expected to avoid `AVG(... )::double precision FILTER (...)` syntax"
    );
    assert.ok(
      normalized.includes("AVG(EXTRACT(EPOCH FROM (next_sent_at - sent_at)) * 1000) FILTER"),
      "expected `AVG(... ) FILTER (...)` form"
    );
  });
});
