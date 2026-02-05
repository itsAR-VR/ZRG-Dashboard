import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

describe("stale sending recovery wiring", () => {
  it("invokes stale draft recovery in background jobs cron", () => {
    const source = read("app/api/cron/background-jobs/route.ts");
    assert.ok(source.includes("recoverStaleSendingDrafts"));
  });
});
