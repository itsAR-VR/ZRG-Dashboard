import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

describe("Response timing analytics SQL typing", () => {
  it("casts window/date params to stable SQL types for interval arithmetic", () => {
    const source = read("actions/response-timing-analytics-actions.ts");
    const normalized = source.replace(/\s+/g, " ");

    assert.match(normalized, /\(\$\{from\}::timestamp\)/);
    assert.match(normalized, /\(\$\{to\}::timestamp\)/);
    assert.match(normalized, /\(\(\$\{attributionWindowDays\}::int\) \* interval '1 day'\)/);
    assert.match(normalized, /\(\(\$\{maturityBufferDays\}::int\) \* interval '1 day'\)/);
  });
});
