import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

describe("cron followups overlap lock", () => {
  it("guards followups cron with a Postgres advisory lock", () => {
    const filePath = path.join(process.cwd(), "app/api/cron/followups/route.ts");
    const source = fs.readFileSync(filePath, "utf8");

    assert.ok(source.includes("pg_try_advisory_lock"), "expected followups cron route to acquire an advisory lock");
    assert.ok(source.includes("pg_advisory_unlock"), "expected followups cron route to release an advisory lock");
  });
});

