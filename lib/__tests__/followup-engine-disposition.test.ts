import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

describe("followup-engine responseDisposition", () => {
  it("persists responseDisposition when a follow-up email draft is already sending but a message exists", () => {
    const source = read("lib/followup-engine.ts");
    assert.match(
      source,
      /draft\.status === "sending"[\s\S]*inFlightMessage[\s\S]*status:\s*"approved"[\s\S]*responseDisposition/,
      "expected followup-engine to persist responseDisposition when approving an in-flight draft"
    );
  });
});

