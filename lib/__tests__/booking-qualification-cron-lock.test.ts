import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

describe("cron booking-qualification overlap lock", () => {
  it("guards booking-qualification cron with a Postgres advisory lock", () => {
    const filePath = path.join(
      process.cwd(),
      "app/api/cron/booking-qualification-jobs/route.ts"
    );
    const source = fs.readFileSync(filePath, "utf8");

    assert.ok(
      source.includes("pg_try_advisory_lock"),
      "expected booking-qualification cron route to acquire an advisory lock"
    );
    assert.ok(
      source.includes("pg_advisory_unlock"),
      "expected booking-qualification cron route to release an advisory lock"
    );
  });
});
