import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

describe("stale sending recovery wiring", () => {
  it("invokes stale draft recovery via shared background maintenance helper", () => {
    const routeSource = read("app/api/cron/background-jobs/route.ts");
    const maintenanceSource = read("lib/background-jobs/maintenance.ts");
    assert.ok(routeSource.includes("runBackgroundMaintenance"));
    assert.ok(maintenanceSource.includes("recoverStaleSendingDrafts"));
  });
});
