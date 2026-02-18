import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

describe("supabase middleware next-action refresh behavior", () => {
  it("does not bypass middleware refresh unconditionally for next-action requests", () => {
    const source = read("lib/supabase/middleware.ts");
    const normalized = source.replace(/\s+/g, " ");

    assert.match(normalized, /const isNextActionRequest = request\.method === "POST" && request\.headers\.has\("next-action"\);/);
    assert.match(normalized, /const isPublicRoute = isAuthPage \|\| isApiRoute \|\| isNextActionRequest;/);
    assert.doesNotMatch(
      normalized,
      /if \(request\.method === "POST" && request\.headers\.has\("next-action"\)\) \{ return NextResponse\.next\(\{ request \}\); \}/
    );
  });
});
