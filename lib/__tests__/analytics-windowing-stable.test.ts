import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

describe("AI draft outcome analytics windowing", () => {
  it("anchors windowing to Message.sentAt (not AIDraft.updatedAt)", () => {
    const source = read("actions/ai-draft-response-analytics-actions.ts");
    assert.ok(!source.includes('d."updatedAt" >='), 'expected analytics query to avoid using AIDraft.updatedAt for windows');
    assert.match(source, /draft_send_time/, "expected a CTE or derived send-time anchor");
    assert.match(source, /dst\."sentAt"/, "expected windowing to filter on derived sentAt");
  });
});
