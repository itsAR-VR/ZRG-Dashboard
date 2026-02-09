import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

test("cron background-jobs includes draft pipeline retention + memory pruning", () => {
  const filePath = path.join(process.cwd(), "app/api/cron/background-jobs/route.ts");
  const source = fs.readFileSync(filePath, "utf8");

  assert.ok(source.includes("DRAFT_PIPELINE_RUN_RETENTION_DAYS"), "should respect retention env var");
  assert.ok(source.includes("pruneDraftPipelineRuns"), "should prune DraftPipelineRun rows");
  assert.ok(source.includes("pruneExpiredInferredLeadMemory"), "should prune inferred LeadMemoryEntry");
  assert.ok(source.includes("pruneExpiredInferredWorkspaceMemory"), "should prune inferred WorkspaceMemoryEntry");
  assert.ok(source.includes("workspaceMemoryEntry"), "should reference WorkspaceMemoryEntry model");
});

