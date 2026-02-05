import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

describe("send_outcome_unknown recovery", () => {
  it("updates drafts when send outcome is unknown (server action)", () => {
    const source = read("actions/email-actions.ts");
    assert.match(source, /send_outcome_unknown[\s\S]*status:\s*"approved"/);
  });

  it("updates drafts when send outcome is unknown (system send)", () => {
    const source = read("lib/email-send.ts");
    assert.match(source, /send_outcome_unknown[\s\S]*status:\s*"approved"/);
  });
});
