import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

test("background maintenance includes draft pipeline retention + memory pruning", () => {
  const maintenancePath = path.join(process.cwd(), "lib/background-jobs/maintenance.ts");
  const source = fs.readFileSync(maintenancePath, "utf8");
  const routeSource = fs.readFileSync(
    path.join(process.cwd(), "app/api/cron/background-jobs/route.ts"),
    "utf8"
  );

  assert.ok(source.includes("DRAFT_PIPELINE_RUN_RETENTION_DAYS"), "should respect retention env var");
  assert.ok(source.includes("pruneDraftPipelineRuns"), "should prune DraftPipelineRun rows");
  assert.ok(source.includes("pruneExpiredInferredLeadMemory"), "should prune inferred LeadMemoryEntry");
  assert.ok(source.includes("pruneExpiredInferredWorkspaceMemory"), "should prune inferred WorkspaceMemoryEntry");
  assert.ok(source.includes("workspaceMemoryEntry"), "should reference WorkspaceMemoryEntry model");
  assert.ok(routeSource.includes("runBackgroundMaintenance"), "cron route should invoke shared maintenance helper");
});
