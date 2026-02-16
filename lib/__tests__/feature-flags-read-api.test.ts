import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

describe("read API feature flag semantics", () => {
  it("uses a production fail-open fallback only when flags are unset", () => {
    const source = read("lib/feature-flags.ts");
    const normalized = source.replace(/\s+/g, " ");

    assert.match(normalized, /function resolveReadApiFlag/);
    assert.match(normalized, /if \(serverValue !== null\) return serverValue;/);
    assert.match(normalized, /if \(publicValue !== null\) return publicValue;/);
    assert.match(normalized, /return isProductionRuntime\(\);/);
  });

  it("pins analytics and inbox read APIs to explicit server/public env keys", () => {
    const source = read("lib/feature-flags.ts");

    assert.ok(source.includes('serverKey: "ANALYTICS_READ_API_V1"'));
    assert.ok(source.includes('publicKey: "NEXT_PUBLIC_ANALYTICS_READ_API_V1"'));
    assert.ok(source.includes('serverKey: "INBOX_READ_API_V1"'));
    assert.ok(source.includes('publicKey: "NEXT_PUBLIC_INBOX_READ_API_V1"'));
  });
});
