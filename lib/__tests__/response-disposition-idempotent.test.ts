import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

describe("responseDisposition idempotent paths", () => {
  it("persists responseDisposition when email draft already has a message", () => {
    const source = read("actions/email-actions.ts");
    assert.match(source, /existingMessage[\s\S]*responseDisposition/, "expected responseDisposition update in existingMessage path");
    assert.ok(
      source.includes("existingMessage.body"),
      "existingMessage idempotent path should compute disposition from stored sent body"
    );
    assert.ok(
      source.includes("afterClaimMessage.body"),
      "after-claim idempotent path should compute disposition from stored sent body"
    );
  });

  it("persists responseDisposition for system email idempotent path", () => {
    const source = read("lib/email-send.ts");
    assert.match(source, /existingMessage[\s\S]*responseDisposition/, "expected responseDisposition update in existingMessage path");
    assert.ok(
      source.includes("existingMessage.body"),
      "existingMessage idempotent path should compute disposition from stored sent body"
    );
    assert.ok(
      source.includes("afterClaimMessage.body"),
      "after-claim idempotent path should compute disposition from stored sent body"
    );
  });

  it("always persists responseDisposition for SMS draft approvals", () => {
    const source = read("actions/message-actions.ts");
    assert.ok(!source.includes("pendingPartIndexes.length > 0 ? { responseDisposition } : {}"));
    assert.match(source, /status:\s*"approved"[\s\S]*responseDisposition/);
    assert.ok(
      source.includes("dispositionContent"),
      "SMS idempotent path should derive disposition from sent bodies"
    );
  });
});
