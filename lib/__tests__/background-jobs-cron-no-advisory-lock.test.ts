import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

describe("cron background jobs safety", () => {
  it("does not use Postgres session advisory locks (pooling can orphan locks)", () => {
    const filePath = path.join(process.cwd(), "app/api/cron/background-jobs/route.ts");
    const source = fs.readFileSync(filePath, "utf8");

    assert.ok(!source.includes("pg_try_advisory_lock"), "background-jobs cron must not acquire advisory locks");
    assert.ok(!source.includes("pg_advisory_unlock"), "background-jobs cron must not release advisory locks");
  });
});

